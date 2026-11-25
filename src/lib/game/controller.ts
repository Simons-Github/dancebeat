import { frameGameTimeMs } from "../audio/clock";
import { PlayRefusedError } from "../audio/errors";
import type { IntensityRating } from "../scorer";
import type { Angles, Move, Rating } from "../types";

export type GamePhase = "preparing" | "countdown" | "playing" | "paused" | "blocked" | "ended";
export type PauseReason = "user" | "hidden" | "camera";

export interface GameState {
  phase: GamePhase;
  /** During the countdown: 3, 2, 1, or 0 for the lead-in ("Bereit machen"). Else null. */
  count: number | null;
  pauseReason: PauseReason | null;
  /** No usable pose for a while during play: show a hint instead of silent X ratings. */
  bodyMissing: boolean;
}

export interface GameAudio {
  play(): Promise<void>;
  pause(): void;
  /** Audio position in ms (not game time). */
  seek(ms: number): void;
}

export interface GameScoring {
  sample(t: number, player: Angles | null, intensityRating?: IntensityRating): void;
  seekTo(t: number): void;
  reset(): void;
  done(): boolean;
}

export interface GameTiming {
  /** Lead-in before "3" on start and restart (covers the camera warm-up after the route change). */
  leadMs: number;
  /** One countdown step. */
  stepMs: number;
  /** Minimum game time between two samples. */
  sampleMs: number;
  /** Without camera frames for this long, the clock alone closes move windows. */
  stallMs: number;
  /** Game time without a usable pose before the "we can't see you" hint. */
  bodyMissingMs: number;
}

export const DEFAULT_TIMING: GameTiming = {
  leadMs: 2000,
  stepMs: 1000,
  sampleMs: 100,
  stallMs: 400,
  bodyMissingMs: 2500,
};

/** Movement mode (no camera): moves are rated from sensor intensity instead of angles. */
export interface GameMotion {
  rating(move: Move, fromMs: number, toMs: number): Rating;
  /** Game time of the last sensor measurement (-Infinity before the first). */
  lastSampleMs(): number;
}

export interface GameDeps {
  audio: GameAudio;
  /** The game clock (`useAudioClock().timeMs`). The only time source for scoring. */
  timeMs(): number;
  scoring: GameScoring;
  /** Audio position the song starts at (`song.startOffsetMs`). */
  startOffsetMs: number;
  /** Game time after which the game ends even if the audio has no end event (last move + tail). */
  endMs: number;
  /** Song playback rate; converts frame ages (wall time) into song time. */
  rate?: number;
  timing?: Partial<GameTiming>;
  /** Set: movement mode. No frames, no stall path; `bodyMissing` means no sensor data. */
  motion?: GameMotion;
  onState(state: GameState): void;
  onEnd(): void;
  /**
   * `audio.play()` failed for another reason than a refused start (`PlayRefusedError`), e.g. the
   * file cannot be played. The game goes back to "preparing"; the screen shows the message.
   */
  onPlayError?(message: string): void;
  /** Countdown sound: 3, 2, 1, and 0 for "go". */
  onBeep?(count: number): void;
}

interface PendingFrame {
  t: number;
  angles: Angles | null;
}

/** Shoulders are the minimum for any signed angle; an arm angle is the minimum for scoring. */
const hasBody = (a: Angles | null) =>
  !!a &&
  (a.leftShoulder != null ||
    a.rightShoulder != null ||
    a.leftElbow != null ||
    a.rightElbow != null);

/**
 * Game flow without React: countdown → playing ⇄ paused → ended, plus "blocked" when the browser
 * refuses to start the audio without a gesture. Countdown timers use setTimeout; scoring uses only
 * the game clock (`timeMs`). `tick()` runs once per animation frame.
 */
export class GameController {
  private deps: GameDeps;
  private timing: GameTiming;
  private s: GameState = { phase: "preparing", count: null, pauseReason: null, bodyMissing: false };
  private timers: ReturnType<typeof setTimeout>[] = [];
  private frame: PendingFrame | null = null;
  private lastSampleT = -Infinity;
  private lastFrameT = -Infinity;
  private lastBodyT = -Infinity;
  /** Bumped whenever a pending play() result must be ignored. */
  private playToken = 0;
  /** Token of the play() still awaiting the audio (-1: none). Stale once the token moves on. */
  private pendingPlay = -1;
  private disposed = false;
  private readonly motionRating: IntensityRating | undefined;

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
    const motion = deps.motion;
    this.motionRating = motion && ((m, from, to) => motion.rating(m, from, to));
  }

  get state(): GameState {
    return this.s;
  }

  private set(patch: Partial<GameState>) {
    this.s = { ...this.s, ...patch };
    this.deps.onState(this.s);
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  /** From "preparing" (or any time for a restart): rewind, reset scoring, count down, play. */
  start() {
    if (this.disposed) return;
    this.clearTimers();
    this.playToken++;
    this.deps.audio.pause();
    this.deps.audio.seek(this.deps.startOffsetMs);
    this.deps.scoring.reset();
    // Moves before the start position (intro skipped) are not judged.
    this.deps.scoring.seekTo(this.deps.timeMs());
    this.resetTracking();
    this.countdown(true);
  }

  restart() {
    this.start();
  }

  private resetTracking() {
    this.frame = null;
    this.lastSampleT = -Infinity;
    this.lastFrameT = -Infinity;
    this.lastBodyT = -Infinity;
  }

  private countdown(withLead: boolean) {
    const { leadMs, stepMs } = this.timing;
    const steps = [3, 2, 1];
    let at = 0;
    if (withLead) {
      this.set({ phase: "countdown", count: 0, pauseReason: null, bodyMissing: false });
      at = leadMs;
    }
    steps.forEach((n, i) => {
      const fire = () => {
        this.set({ phase: "countdown", count: n, pauseReason: null, bodyMissing: false });
        this.deps.onBeep?.(n);
      };
      if (i === 0 && !withLead) fire();
      else this.later(at, fire);
      at += stepMs;
    });
    this.later(at, () => {
      this.deps.onBeep?.(0);
      void this.play();
    });
  }

  /**
   * Starts the audio. Refused (no gesture, `PlayRefusedError`): "blocked" until `tap()`. Any other
   * failure: back to "preparing" and `onPlayError`.
   */
  private async play() {
    const token = ++this.playToken;
    this.pendingPlay = token;
    try {
      await this.deps.audio.play();
    } catch (e: unknown) {
      if (token !== this.playToken || this.disposed) return;
      if (e instanceof PlayRefusedError) {
        this.set({ phase: "blocked", count: null });
        return;
      }
      this.clearTimers();
      this.playToken++;
      this.set({ phase: "preparing", count: null, pauseReason: null, bodyMissing: false });
      this.deps.onPlayError?.(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      if (this.pendingPlay === token) this.pendingPlay = -1;
    }
    if (token !== this.playToken || this.disposed) {
      // Paused, restarted or left while play() was pending. Already "playing" (external start or
      // a newer play()): the audio must keep running.
      if (this.s.phase !== "playing") this.deps.audio.pause();
      return;
    }
    this.enterPlaying();
  }

  private enterPlaying() {
    // Pose data from before the pause belongs to another moment.
    this.frame = null;
    this.lastBodyT = this.deps.timeMs();
    this.set({ phase: "playing", count: null, pauseReason: null, bodyMissing: false });
  }

  /** True while a play() awaits the audio and has not been superseded. */
  private get playPending() {
    return this.pendingPlay === this.playToken;
  }

  /** "Zum Starten tippen": must be called inside the tap handler. A second tap waits for the first. */
  tap() {
    if (this.s.phase !== "blocked" || this.playPending) return;
    void this.play();
  }

  /**
   * The audio started without play() (direct tap on the YouTube video). "blocked": counts as the
   * start; a play() still pending is superseded and its late result ignored. "preparing",
   * "countdown", "paused": the audio runs behind the game's back and is paused again (the game
   * state stays authoritative; a later play() still works). "playing"/"ended": nothing to do.
   */
  externalStart() {
    if (this.disposed) return;
    const { phase } = this.s;
    if (phase === "blocked") {
      this.playToken++;
      this.enterPlaying();
    } else if (phase === "preparing" || phase === "countdown" || phase === "paused") {
      this.deps.audio.pause();
    }
  }

  /** Cancels a running countdown (the screen then goes back to the setup). */
  cancel() {
    this.clearTimers();
    this.playToken++;
    this.deps.audio.pause();
    this.set({ phase: "preparing", count: null });
  }

  pause(reason: PauseReason) {
    const { phase } = this.s;
    if (phase !== "countdown" && phase !== "playing" && phase !== "blocked") return;
    this.clearTimers();
    this.playToken++;
    this.deps.audio.pause();
    this.set({ phase: "paused", count: null, pauseReason: reason, bodyMissing: false });
  }

  /** "Weiter": a short countdown, then the music continues where it stopped. */
  resume() {
    if (this.s.phase !== "paused") return;
    this.countdown(false);
  }

  /** Audio ended or the end of the choreography was reached. */
  finish() {
    if (this.s.phase === "ended" || this.disposed) return;
    this.clearTimers();
    this.playToken++;
    // Judge whatever is still open (audio shorter than the choreography: those moves are X).
    const end = Math.max(this.deps.timeMs(), this.deps.endMs);
    if (this.motionRating) this.deps.scoring.sample(end, null, this.motionRating);
    else this.deps.scoring.sample(end, null);
    this.deps.audio.pause();
    this.set({ phase: "ended", count: null, bodyMissing: false });
    this.deps.onEnd();
  }

  /**
   * A detection result. `frameAgeMs` is how long ago the picture was taken; the angles are filed
   * under the game time of that moment, not the arrival time.
   */
  pushFrame(angles: Angles | null, frameAgeMs: number) {
    if (this.s.phase !== "playing") return;
    const t = frameGameTimeMs(this.deps.timeMs(), frameAgeMs, this.deps.rate ?? 1);
    this.frame = { t, angles };
    this.lastFrameT = Math.max(this.lastFrameT, t);
    if (hasBody(angles)) this.lastBodyT = Math.max(this.lastBodyT, t);
  }

  /** Once per animation frame. */
  tick() {
    if (this.s.phase !== "playing") return;
    const now = this.deps.timeMs();
    const { sampleMs, stallMs, bodyMissingMs } = this.timing;
    if (this.deps.motion && this.motionRating) {
      this.tickMotion(now, this.deps.motion, this.motionRating);
      return;
    }
    const f = this.frame;
    if (f && f.t - this.lastSampleT >= sampleMs) {
      this.deps.scoring.sample(f.t, f.angles);
      this.lastSampleT = f.t;
      this.frame = null;
    } else if (now - this.lastFrameT > stallMs) {
      // No frames (camera stalled): let the clock close the windows; nothing gets a pose.
      this.deps.scoring.sample(now - stallMs, null);
    }
    const missing = now - this.lastBodyT > bodyMissingMs;
    if (missing !== this.s.bodyMissing) this.set({ bodyMissing: missing });
    if (now >= this.deps.endMs && this.deps.scoring.done()) this.finish();
  }

  /** Movement mode: the clock alone closes the windows; the sensor buffer supplies the ratings. */
  private tickMotion(now: number, motion: GameMotion, rating: IntensityRating) {
    const { sampleMs, bodyMissingMs } = this.timing;
    if (now - this.lastSampleT >= sampleMs) {
      this.deps.scoring.sample(now, null, rating);
      this.lastSampleT = now;
    }
    // lastBodyT (set when play starts) gives the sensor the same grace period as the camera.
    const missing = now - Math.max(this.lastBodyT, motion.lastSampleMs()) > bodyMissingMs;
    if (missing !== this.s.bodyMissing) this.set({ bodyMissing: missing });
    if (now >= this.deps.endMs && this.deps.scoring.done()) this.finish();
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.playToken++;
  }
}
