import { songRepository } from "../library/repository";
import { PlayRefusedError } from "./errors";
import { getSpotifyToken, SpotifyAuthError } from "./spotifyAuth";
import { effectivePlaybackRate } from "./rate";
import { musicGainFor, sharedAudioContext } from "./unlock";
import type { Song } from "../types";

export { PlayRefusedError };

export type SourceType = Song["source"]["type"];

export interface AudioSource {
  type: SourceType;
  lowPrecision: boolean;
  load(): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(ms: number): void;
  getTimeMs(): number;
  setVolume(v: number): void;
  onEnded(cb: () => void): void;
  /** Called when playback breaks after a successful `load()` (connection lost, decode error). */
  onError(cb: (message: string) => void): void;
  /**
   * Optional (YouTube, Spotify): playback started without a pending `play()`, e.g. a direct tap
   * on the video after the start was refused, or a resume in another Spotify app. The clock
   * already runs.
   */
  onExternalStart?(cb: () => void): void;
  /**
   * Optional (YouTube, Spotify): playback was paused directly in the player (tap on the video,
   * another Spotify app), not by `pause()`. The clock already holds.
   */
  onExternalPause?(cb: () => void): void;
  destroy(): void;
}

/** `name` of a DOMException-like rejection value ("" when there is none). */
function errorName(e: unknown) {
  return typeof e === "object" && e !== null && "name" in e && typeof e.name === "string"
    ? e.name
    : "";
}

export interface SourceOptions {
  /**
   * Audio element to play through instead of a new one: the shared element unlocked in a user
   * gesture (src/lib/audio/unlock.ts). It is emptied on destroy, never thrown away.
   */
  element?: HTMLAudioElement;
  /**
   * YouTube only: element the player is shown in (fills it). Without it the player stays hidden
   * off screen.
   */
  container?: HTMLElement;
}

/** Interpolierte Uhr: zwischen API-Abfragen per performance.now() fortschreiben, weich angleichen. */
class SmoothClock {
  private base = 0;
  private at = 0;
  private playing = false;
  private rate = 1;
  sync(apiMs: number, playing: boolean, hard = false) {
    const now = performance.now();
    const est = this.get();
    const diff = apiMs - est;
    if (hard || !this.playing || Math.abs(diff) > 400) this.base = apiMs;
    else this.base = est + diff * 0.3; // Sprünge glätten
    this.at = now;
    this.playing = playing;
  }
  setRate(r: number) {
    this.rate = r;
  }
  get() {
    return this.playing ? this.base + (performance.now() - this.at) * this.rate : this.base;
  }
}

/**
 * iOS loads media only after a gesture, so `canplay` may never come before `play()`. Loading
 * therefore counts as done on `loadedmetadata` or `canplay`, or after this timeout (then `play()`
 * does the actual loading). A real error still rejects.
 */
export const LOAD_TIMEOUT_MS = 5000;

/**
 * Element routed through Web Audio (iOS, see unlock.ts): after `play()` the AudioContext gets this
 * long to reach "running". Otherwise the start counts as refused (the clock would run in silence).
 */
export const CONTEXT_RESUME_TIMEOUT_MS = 500;

class ElementSource implements AudioSource {
  lowPrecision = false;
  el: HTMLAudioElement;
  private shared: boolean;
  private clock = new SmoothClock();
  private timer = 0;
  private destroyed = false;
  /** True while the element stalls for data (`waiting`); the clock holds until `playing`. */
  private waiting = false;
  private errorCb: (message: string) => void = () => {};
  /** Pending `load()` timeout and its resolver; cleared and settled by `destroy()`. */
  private loadTimeout = 0;
  private settleLoad: (() => void) | null = null;
  constructor(
    public type: "local" | "url",
    private getUrl: () => Promise<string>,
    private rate = 1,
    element?: HTMLAudioElement,
  ) {
    this.shared = !!element;
    this.el = element ?? new Audio();
    this.el.preload = "auto";
    this.el.defaultPlaybackRate = rate;
    this.el.playbackRate = rate;
    this.clock.setRate(rate);
  }
  private errorMessage() {
    return this.type === "url"
      ? "Die Audio-URL konnte nicht geladen werden. Prüfe den Link und ob die Datei öffentlich erreichbar ist."
      : "Die Audiodatei konnte nicht dekodiert werden. Bitte MP3, M4A, WAV oder OGG verwenden.";
  }
  async load() {
    const url = await this.getUrl();
    // Destroyed while the URL was resolved (song switch, route left): do not touch the element.
    if (this.destroyed) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      return;
    }
    const el = this.el;
    await new Promise<void>((res, rej) => {
      const done = () => {
        clearTimeout(this.loadTimeout);
        this.settleLoad = null;
        el.oncanplay = null;
        el.onloadedmetadata = null;
        res();
      };
      this.settleLoad = done;
      el.oncanplay = done;
      el.onloadedmetadata = done;
      el.onerror = () => {
        clearTimeout(this.loadTimeout);
        this.settleLoad = null;
        rej(new Error(this.errorMessage()));
      };
      this.loadTimeout = window.setTimeout(done, LOAD_TIMEOUT_MS);
      el.src = url;
      try {
        el.load();
      } catch {
        /* jsdom */
      }
    });
    // Destroyed while loading: the (shared) element may already belong to the next source.
    if (this.destroyed) return;
    el.defaultPlaybackRate = this.rate;
    el.playbackRate = this.rate;
    // After loading, errors are runtime errors (connection lost, decode failure mid-song).
    el.onerror = () => {
      if (this.destroyed) return;
      clearInterval(this.timer);
      this.clock.sync(el.currentTime * 1000, false, true);
      this.errorCb(
        this.type === "url" ? "Die Verbindung zur Musik ist abgebrochen." : this.errorMessage(),
      );
    };
    // Buffering: `paused` stays false, so the clock must be held explicitly.
    el.onwaiting = () => {
      this.waiting = true;
      this.clock.sync(el.currentTime * 1000, false, true);
    };
    el.onplaying = () => {
      this.waiting = false;
      this.clock.sync(el.currentTime * 1000, !el.paused, true);
    };
  }
  async play() {
    // Routed element: resume the context synchronously, while a tap gesture is still active.
    const ctx = musicGainFor(this.el) ? sharedAudioContext() : null;
    let resumed: Promise<void> = Promise.resolve();
    if (ctx) {
      try {
        resumed = ctx.resume().catch(() => {});
      } catch {
        /* checked below via ctx.state */
      }
    }
    try {
      await this.el.play();
    } catch (e: unknown) {
      const name = errorName(e);
      // NotAllowedError: no gesture. AbortError: the start was interrupted (pause, new source).
      if (name === "NotAllowedError" || name === "AbortError") throw new PlayRefusedError();
      // Anything else (NotSupportedError: on iOS loading may only happen here) is a real error.
      throw new Error(this.errorMessage());
    }
    if (this.destroyed) return;
    if (ctx) {
      const running = () => ctx.state === "running";
      if (!running()) {
        let timeout = 0;
        await Promise.race([
          resumed,
          new Promise<void>((res) => (timeout = window.setTimeout(res, CONTEXT_RESUME_TIMEOUT_MS))),
        ]);
        clearTimeout(timeout);
        if (this.destroyed) return;
        if (!running()) {
          // The element would play into a suspended graph: silence while the clock runs.
          this.el.pause();
          throw new PlayRefusedError();
        }
      }
    }
    this.clock.sync(this.el.currentTime * 1000, true, true);
    clearInterval(this.timer);
    this.timer = window.setInterval(
      () => this.clock.sync(this.el.currentTime * 1000, !this.el.paused && !this.waiting),
      250,
    );
  }
  pause() {
    clearInterval(this.timer);
    this.waiting = false;
    this.el.pause();
    this.clock.sync(this.el.currentTime * 1000, false, true);
  }
  seek(ms: number) {
    this.el.currentTime = ms / 1000;
    this.clock.sync(ms, !this.el.paused && !this.waiting, true);
  }
  getTimeMs() {
    return this.clock.get();
  }
  setVolume(v: number) {
    this.el.volume = v;
    // iOS ignores `volume`; a routed element is controlled through its gain instead.
    const gain = musicGainFor(this.el);
    if (gain) gain.gain.value = v;
  }
  onEnded(cb: () => void) {
    this.el.onended = cb;
  }
  onError(cb: (message: string) => void) {
    this.errorCb = cb;
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    clearTimeout(this.loadTimeout);
    // A pending load() resolves (and returns early) instead of hanging.
    const settle = this.settleLoad;
    this.settleLoad = null;
    settle?.();
    const el = this.el;
    el.pause();
    el.onended = null;
    el.onerror = null;
    el.onwaiting = null;
    el.onplaying = null;
    el.oncanplay = null;
    el.onloadedmetadata = null;
    if (el.src.startsWith("blob:")) URL.revokeObjectURL(el.src);
    if (this.shared) {
      // Keep the (unlocked) element, just drop the song.
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        /* jsdom */
      }
    } else el.src = "";
  }
}

// ---------- YouTube ----------
// SDK types come from @types/youtube and @types/spotify-web-playback-sdk (which also declares
// window.Spotify). The YouTube global is only present after the IFrame API script loaded.
declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let ytReady: Promise<void> | null = null;
/** Script load or `onYouTubeIframeAPIReady` not within this time: give up, the next try reloads. */
export const YT_SCRIPT_TIMEOUT_MS = 15000;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  ytReady ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    let timeout = 0;
    const fail = () => {
      clearTimeout(timeout);
      // Do not cache the failure: the next attempt starts with a fresh script tag.
      ytReady = null;
      s.remove();
      rej(new Error("YouTube konnte nicht geladen werden. Bist du online?"));
    };
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      res();
    };
    timeout = window.setTimeout(fail, YT_SCRIPT_TIMEOUT_MS);
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return ytReady;
}

export function parseYouTubeId(input: string) {
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(input.trim()) ? input.trim() : null;
}

/**
 * `play()` waits for PLAYING. Not PLAYING after this time: the start counts as refused (no gesture
 * reached the iframe). iOS often reports BUFFERING for a refused start and stays there, so
 * BUFFERING counts too; a slow but allowed start still arrives later as an external start.
 */
export const YT_PLAY_TIMEOUT_MS = 4000;

/** Player not ready (`onReady`) within this time after the API loaded: `load()` rejects. */
export const YT_LOAD_TIMEOUT_MS = 15000;

const YT_STATE_UNSTARTED = -1;

interface PendingPlay {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
  timers: number[];
}

class YouTubeSource implements AudioSource {
  type = "youtube" as const;
  lowPrecision = true;
  private player: YT.Player | null = null;
  private api: typeof YT | null = null;
  private clock = new SmoothClock();
  private resync = 0;
  private destroyed = false;
  /** Set on `onReady`; errors after that are runtime errors (`onError` callback). */
  private ready = false;
  /** Last state from `onStateChange`; drives the clock. */
  private ytState: number = YT_STATE_UNSTARTED;
  /** Seek before the first start: `seekTo` on an unstarted video would start it (assumption). */
  private pendingSeekMs: number | null = null;
  /** Shared by concurrent `play()` calls; rejected by `pause()`/`destroy()`. */
  private pending: PendingPlay | null = null;
  /** A play() was refused once: later calls wait without timeouts (tap on the video may start it). */
  private refusedOnce = false;
  /** Playback was started (by play() or externally) and not paused since. */
  private active = false;
  /**
   * The rate cannot be played (rejected on load, or the player kept another one): the video stays
   * visible, but a tap on it must not start playback at the wrong speed.
   */
  private rateFailed = false;
  /** `setPlaybackRate` retried after the player reported another rate. */
  private rateRetried = false;
  private loadTimer = 0;
  private settleLoad: (() => void) | null = null;
  private endedCb = () => {};
  private errorCb: (message: string) => void = () => {};
  private externalStartCb = () => {};
  private externalPauseCb = () => {};
  private host: HTMLDivElement;
  private visible: boolean;
  constructor(
    private videoId: string,
    /**
     * Playback rate (`effectivePlaybackRate`). Must match what the player really plays at, or the
     * game clock and the latency scaling (latency × rate) drift apart from the video.
     */
    private rate: number,
    container?: HTMLElement,
  ) {
    this.clock.setRate(rate);
    this.visible = !!container;
    this.host = document.createElement("div");
    this.host.style.cssText = container
      ? "position:absolute;inset:0"
      : "position:fixed;width:2px;height:2px;left:-10px;bottom:0;opacity:0.01;pointer-events:none";
    const inner = document.createElement("div");
    this.host.appendChild(inner);
    (container ?? document.body).appendChild(this.host);
  }
  private errorText(api: typeof YT, code: YT.PlayerError) {
    return code === api.PlayerError.EmbeddingNotAllowed ||
      code === api.PlayerError.EmbeddingNotAllowed2
      ? "Dieses Video darf nicht eingebettet werden."
      : "YouTube-Video nicht verfügbar.";
  }
  async load() {
    await loadYT();
    // Destroyed while the API script loaded (song switch, route left): no player.
    if (this.destroyed) return;
    const api = window.YT;
    const el = this.host.firstChild;
    if (!api || !(el instanceof HTMLElement))
      throw new Error("YouTube konnte nicht geladen werden.");
    this.api = api;
    await new Promise<void>((res, rej) => {
      const settle = () => {
        clearTimeout(this.loadTimer);
        this.settleLoad = null;
      };
      // destroy() during the wait ends load() quietly, like ElementSource.
      this.settleLoad = () => {
        settle();
        res();
      };
      this.loadTimer = window.setTimeout(() => {
        settle();
        rej(new Error("YouTube-Video lädt nicht. Prüfe Link und Verbindung."));
      }, YT_LOAD_TIMEOUT_MS);
      this.player = new api.Player(el, {
        videoId: this.videoId,
        width: this.visible ? "100%" : 2,
        height: this.visible ? "100%" : 2,
        host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: {
          onReady: () => {
            if (this.destroyed) return;
            settle();
            const player = this.player;
            if (this.rate !== 1 && player) {
              // An unsupported rate fails loudly instead of silently playing at 1× (desync).
              // An empty list means "unknown" (e.g. before the first start): try anyway.
              const available = player.getAvailablePlaybackRates();
              if (available.length > 0 && !available.includes(this.rate)) {
                this.rateFailed = true;
                rej(new Error(this.rateErrorText()));
                return;
              }
              player.setPlaybackRate(this.rate);
            }
            this.ready = true;
            res();
          },
          onError: (e: YT.OnErrorEvent) => {
            if (this.destroyed) return;
            const message = this.errorText(api, e.data);
            if (!this.ready) {
              settle();
              rej(new Error(message));
            } else this.fail(message);
          },
          onStateChange: (e: YT.OnStateChangeEvent) => this.stateChanged(api, e.data),
          onPlaybackRateChange: (e: YT.OnPlaybackRateChangeEvent) => this.rateChanged(e.data),
        },
      });
    });
  }
  /** Re-applies the rate if the player reports another one (it may reset it, e.g. on load). */
  private applyRate() {
    const player = this.player;
    if (this.rate === 1 || !player) return;
    if (player.getPlaybackRate() !== this.rate) player.setPlaybackRate(this.rate);
  }
  private rateErrorText() {
    const shown = String(this.rate).replace(".", ",");
    return `Dieses Video lässt sich nicht im Tempo ${shown}× abspielen. Stelle im Editor 1× ein.`;
  }
  /**
   * The player confirms rate changes asynchronously (`getPlaybackRate()` is cached). A different
   * rate is retried once; if it still differs, the clock (running at `rate`) would drift by up to
   * ~0.3 s without ever hard-resyncing, so playback stops with an error instead.
   */
  private rateChanged(actual: number) {
    if (this.destroyed || !this.ready || this.rateFailed || actual === this.rate) return;
    if (!this.rateRetried) {
      this.rateRetried = true;
      this.player?.setPlaybackRate(this.rate);
      return;
    }
    this.rateFailed = true;
    this.player?.pauseVideo();
    this.fail(this.rateErrorText());
  }
  private currentMs() {
    return this.pendingSeekMs ?? (this.player?.getCurrentTime() ?? 0) * 1000;
  }
  private stateChanged(api: typeof YT, state: YT.PlayerState) {
    if (this.destroyed) return;
    const playing = state === api.PlayerState.PLAYING;
    if (this.rateFailed) {
      // Wrong speed: a tap on the still visible video must not start the game clock.
      if (playing) this.player?.pauseVideo();
      return;
    }
    this.ytState = state;
    // Game time runs only while YouTube reports PLAYING; buffering and pausing hold it.
    if (playing) this.applyRate();
    const seekMs = this.pendingSeekMs;
    if (playing && seekMs !== null && !this.pending && !this.active && this.player) {
      // Started some other way (direct tap on the video, e.g. during the countdown): apply the
      // remembered seek now, so the intro skip (start offset) is not lost. The clock takes the
      // target directly; getCurrentTime() may still report the old position right after seekTo.
      this.pendingSeekMs = null;
      this.player.seekTo(seekMs / 1000, true);
      this.clock.sync(seekMs, true, true);
    } else {
      // Started some other way: a remembered seek no longer applies.
      if (playing) this.pendingSeekMs = null;
      this.clock.sync(this.currentMs(), playing, true);
    }
    if (playing && !this.pending && !this.active) {
      // Started without play() (direct tap on the video): count it as a successful start.
      this.active = true;
      this.refusedOnce = false;
      this.startResync(api);
      this.externalStartCb();
    } else if (playing) this.settlePlay();
    else if (state === api.PlayerState.PAUSED && this.active && !this.pending) {
      // Paused in the player itself (own pause() clears `active` first): report it once.
      this.active = false;
      clearInterval(this.resync);
      this.externalPauseCb();
    }
    if (state === api.PlayerState.ENDED) this.endedCb();
  }
  private takePending() {
    const p = this.pending;
    if (!p) return null;
    p.timers.forEach((t) => clearTimeout(t));
    this.pending = null;
    return p;
  }
  private settlePlay(error?: Error) {
    const p = this.takePending();
    if (!p) return;
    if (error) p.reject(error);
    else {
      // Started: later play() calls (resume, restart) get the refusal timeouts again.
      this.refusedOnce = false;
      this.active = true;
      p.resolve();
    }
  }
  /** Runtime error after `onReady`: stop the clock and report it. */
  private fail(message: string) {
    this.active = false;
    clearInterval(this.resync);
    this.clock.sync(this.currentMs(), false, true);
    this.settlePlay(new Error(message));
    this.errorCb(message);
  }
  private startResync(api: typeof YT) {
    clearInterval(this.resync);
    // Advanced locally per frame (SmoothClock), aligned with the API time every 500 ms.
    this.resync = window.setInterval(() => {
      this.clock.sync(this.currentMs(), this.ytState === api.PlayerState.PLAYING);
    }, 500);
  }
  play(): Promise<void> {
    const player = this.player;
    const api = this.api;
    if (this.destroyed || !player || !api || !this.ready)
      // Transient (not ready yet): a later tap may start it, so it counts as refused.
      return Promise.reject(new PlayRefusedError("YouTube-Player ist noch nicht geladen."));
    if (this.rateFailed) return Promise.reject(new Error(this.rateErrorText()));
    if (this.pending) return this.pending.promise;
    if (this.ytState === api.PlayerState.PLAYING) {
      this.active = true;
      this.startResync(api);
      return Promise.resolve();
    }
    let resolve = () => {};
    let reject: (e: Error) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const pending: PendingPlay = { promise, resolve, reject, timers: [] };
    this.pending = pending;
    if (this.pendingSeekMs !== null) {
      player.seekTo(this.pendingSeekMs / 1000, true);
      this.pendingSeekMs = null;
    }
    this.applyRate();
    player.playVideo();
    this.startResync(api);
    if (!this.refusedOnce) {
      pending.timers.push(
        window.setTimeout(() => {
          const s = this.ytState;
          if (s === api.PlayerState.PLAYING) return;
          this.refusedOnce = true;
          this.active = false;
          // Buffering keeps going: should it start after all, stateChanged reports an external
          // start and the game leaves "blocked" by itself.
          if (s !== api.PlayerState.BUFFERING) player.pauseVideo();
          this.settlePlay(
            new PlayRefusedError("YouTube hat den Start blockiert. Tippe zum Starten."),
          );
        }, YT_PLAY_TIMEOUT_MS),
      );
    }
    return promise;
  }
  pause() {
    this.active = false;
    clearInterval(this.resync);
    this.settlePlay(new Error("Wiedergabe angehalten."));
    if (!this.player) return;
    this.player.pauseVideo();
    this.clock.sync(this.currentMs(), false, true);
  }
  seek(ms: number) {
    const player = this.player;
    const api = this.api;
    if (!player || !api) {
      this.pendingSeekMs = ms;
      this.clock.sync(ms, false, true);
      return;
    }
    const s = this.ytState;
    const started =
      s === api.PlayerState.PLAYING ||
      s === api.PlayerState.PAUSED ||
      s === api.PlayerState.BUFFERING;
    if (!started && !this.pending) {
      // Not started (UNSTARTED, CUED, ENDED): seekTo would start playback; play() applies it.
      this.pendingSeekMs = ms;
      this.clock.sync(ms, false, true);
      return;
    }
    this.pendingSeekMs = null;
    player.seekTo(ms / 1000, true);
    this.clock.sync(ms, s === api.PlayerState.PLAYING, true);
  }
  getTimeMs() {
    return this.clock.get();
  }
  setVolume(v: number) {
    this.player?.setVolume(Math.round(v * 100));
  }
  onEnded(cb: () => void) {
    this.endedCb = cb;
  }
  onError(cb: (message: string) => void) {
    this.errorCb = cb;
  }
  onExternalStart(cb: () => void) {
    this.externalStartCb = cb;
  }
  onExternalPause(cb: () => void) {
    this.externalPauseCb = cb;
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.resync);
    this.settlePlay(new Error("Wiedergabe beendet."));
    this.settleLoad?.();
    try {
      this.player?.destroy();
    } catch {
      /* */
    }
    this.player = null;
    this.host.remove();
  }
}

// ---------- Spotify (login and token: ./spotifyAuth.ts; links: parseSpotifyTrackUri) ----------

export const SPOTIFY_SDK_URL = "https://sdk.scdn.co/spotify-player.js";
/** SDK script or `onSpotifyWebPlaybackSDKReady` not within this time: give up, the next try reloads. */
export const SPOTIFY_SCRIPT_TIMEOUT_MS = 15000;
/** Player not `ready` within this time after the SDK loaded: `load()` rejects. */
export const SPOTIFY_READY_TIMEOUT_MS = 15000;
/**
 * `play()` waits until the player reports playback (state not paused). Not within this time: the
 * start counts as refused, a tap retries it inside the gesture. Longer than YouTube's 4 s because
 * the start goes through the Web API first (assumption, tune on the device).
 */
export const SPOTIFY_PLAY_TIMEOUT_MS = 8000;
/** Resync of the clock with `getCurrentState()` while playing. */
export const SPOTIFY_POLL_MS = 500;

let spotifyReady: Promise<void> | null = null;
function loadSpotifySdk() {
  if (window.Spotify?.Player) return Promise.resolve();
  spotifyReady ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    let timeout = 0;
    const fail = () => {
      clearTimeout(timeout);
      // Do not cache the failure: the next attempt starts with a fresh script tag.
      spotifyReady = null;
      s.remove();
      rej(new Error("Spotify konnte nicht geladen werden. Bist du online?"));
    };
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      res();
    };
    timeout = window.setTimeout(fail, SPOTIFY_SCRIPT_TIMEOUT_MS);
    s.src = SPOTIFY_SDK_URL;
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return spotifyReady;
}

const SPOTIFY_ERRORS: Record<Spotify.ErrorTypes, string> = {
  account_error: "Spotify Premium wird benötigt, um im Browser abzuspielen.",
  authentication_error: "Spotify-Anmeldung abgelaufen. Bitte in den Einstellungen neu verbinden.",
  initialization_error: "Dein Browser unterstützt Spotify-Wiedergabe nicht.",
  playback_error: "Spotify konnte den Song nicht abspielen.",
};

const SPOTIFY_REFUSED = "Spotify hat den Start blockiert. Tippe zum Starten.";

/**
 * Position of a player state now: `timestamp` is the wall-clock time (epoch ms) of `position`,
 * so Date.now() is needed here; it never feeds game time directly.
 */
function statePositionMs(s: Spotify.PlaybackState) {
  return s.position + (s.paused ? 0 : Math.max(0, Date.now() - s.timestamp));
}

class SpotifySource implements AudioSource {
  type = "spotify" as const;
  lowPrecision = true;
  private player: Spotify.Player | null = null;
  private deviceId = "";
  private clock = new SmoothClock();
  private poll = 0;
  private destroyed = false;
  /** `load()` is under way: play() meanwhile counts as refused (a later tap may start it). */
  private loading = false;
  /** First `ready` arrived; errors after that are runtime errors (`onError` callback). */
  private loaded = false;
  /** The device is usable: false again after `not_ready` until the SDK reconnects. */
  private ready = false;
  /** The track was started on this device (start confirmed); later starts use `resume()`. */
  private started = false;
  /** The Web API accepted a start that was not confirmed yet; the track may play any moment. */
  private trackSent = false;
  /**
   * After `autoplay_failed`: the browser plays muted, if at all. Playing states are not taken as
   * a start until the next play() (inside a gesture).
   */
  private silent = false;
  /** Seek before the first start: sent as `position_ms` with the start (the SDK cannot seek yet). */
  private pendingSeekMs: number | null = null;
  /**
   * `pendingSeekMs` as sent with the running start. It stays pending until the start is
   * confirmed, so a refused start retries from the same position.
   */
  private sentSeekMs: number | null = null;
  /** Shared by concurrent `play()` calls; rejected by `pause()`/`destroy()`. */
  private pending: PendingPlay | null = null;
  /** Playback was started (by play() or externally) and not paused since. */
  private active = false;
  private endedSent = false;
  private volume = 1;
  private loadTimer = 0;
  private settleLoad: (() => void) | null = null;
  private endedCb = () => {};
  private errorCb: (message: string) => void = () => {};
  private externalStartCb = () => {};
  private externalPauseCb = () => {};
  constructor(private uri: string) {}
  async load() {
    this.loading = true;
    try {
      await this.connectPlayer();
    } finally {
      this.loading = false;
    }
  }
  private async connectPlayer() {
    // Throws a message for the UI when not connected or the session cannot be renewed.
    await getSpotifyToken();
    await loadSpotifySdk();
    // Destroyed while the SDK loaded (song switch, route left): no player.
    if (this.destroyed) return;
    const sdk = window.Spotify;
    if (!sdk?.Player) throw new Error("Spotify konnte nicht geladen werden.");
    const player = new sdk.Player({
      name: "DanceBeat",
      // The SDK asks again before the token expires; a failed refresh surfaces as
      // authentication_error.
      getOAuthToken: (cb) => {
        getSpotifyToken().then(cb, () => {});
      },
      volume: this.volume,
    });
    this.player = player;
    await new Promise<void>((res, rej) => {
      const settle = () => {
        clearTimeout(this.loadTimer);
        this.settleLoad = null;
      };
      // destroy() during the wait ends load() quietly, like the other sources.
      this.settleLoad = () => {
        settle();
        res();
      };
      const reject = (message: string) => {
        settle();
        rej(new Error(message));
      };
      this.loadTimer = window.setTimeout(
        () => reject("Spotify-Player lädt nicht. Prüfe deine Verbindung."),
        SPOTIFY_READY_TIMEOUT_MS,
      );
      player.addListener("ready", ({ device_id }: Spotify.WebPlaybackInstance) => {
        if (this.destroyed || this.ready) return;
        this.deviceId = device_id;
        this.ready = true;
        if (this.loaded) {
          // Reconnected after not_ready, possibly as a new device: the next play() starts the
          // track again via the Web API from the current position.
          this.unstart();
          return;
        }
        this.loaded = true;
        settle();
        res();
      });
      player.addListener("not_ready", () => {
        if (this.destroyed || !this.ready) return;
        this.ready = false;
        this.fail("Die Verbindung zu Spotify ist abgebrochen.");
      });
      (Object.keys(SPOTIFY_ERRORS) as Spotify.ErrorTypes[]).forEach((type) => {
        player.addListener(type, () => {
          if (this.destroyed) return;
          if (!this.loaded) reject(SPOTIFY_ERRORS[type]);
          else this.fail(SPOTIFY_ERRORS[type]);
        });
      });
      // The browser refused to start audio without a gesture: a tap can retry it.
      // Without a pending play() but while playing, it is silent playback: held like a pause.
      player.addListener("autoplay_failed", () => {
        if (this.destroyed) return;
        const wasActive = this.active && !this.pending;
        this.silent = true;
        this.active = false;
        clearInterval(this.poll);
        this.clock.sync(this.clock.get(), false, true);
        this.settlePlay(new PlayRefusedError(SPOTIFY_REFUSED));
        if (wasActive) this.externalPauseCb();
      });
      player.addListener("player_state_changed", (s: Spotify.PlaybackState | null) =>
        this.stateChanged(s),
      );
      const notConnected = () => {
        if (!this.destroyed && !this.loaded) reject("Spotify-Player konnte sich nicht verbinden.");
      };
      player.connect().then((ok) => {
        if (!ok) notConnected();
      }, notConnected);
    });
  }
  /**
   * The track no longer plays on this device (moved away, reconnected): the next play() starts it
   * again via the Web API, from the current position unless a seek is pending.
   */
  private unstart() {
    if (this.started || this.trackSent) this.pendingSeekMs ??= this.clock.get();
    this.started = false;
    this.trackSent = false;
  }
  private stateChanged(s: Spotify.PlaybackState | null) {
    if (this.destroyed || !this.loaded) return;
    if (!s) {
      // Playback moved to another device (Spotify Connect): the clock holds like a pause.
      this.clock.sync(this.clock.get(), false, true);
      this.unstart();
      if (this.active && !this.pending) this.externalPause();
      return;
    }
    const playing = !s.paused;
    if (playing && !this.pending && !this.active && (this.silent || !this.started)) {
      // Unwanted playback: a start that was cancelled after the Web API accepted it, or muted
      // playback after autoplay_failed. Stopped again; the clock keeps its position.
      void this.player?.pause().catch(() => {});
      return;
    }
    this.clock.sync(statePositionMs(s), playing, true);
    if (playing) {
      this.endedSent = false;
      if (this.pending) {
        this.settlePlay();
        const seekMs = this.pendingSeekMs;
        const sent = this.sentSeekMs;
        this.pendingSeekMs = null;
        this.sentSeekMs = null;
        if (seekMs !== null && seekMs !== sent) {
          // seek() while the start was under way: the PUT carried an older position.
          void this.player?.seek(seekMs).catch(() => {});
          this.clock.sync(seekMs, true, true);
        }
      } else if (!this.active && this.started) {
        // Resumed elsewhere (another Spotify app): count it as a start, the clock already runs.
        this.active = true;
        this.startPoll();
        this.externalStartCb();
      }
      return;
    }
    // Spotify reports the end of a single-track queue as paused at 0 with the track moved to
    // previous_tracks (assumption, check on the device).
    const ended = s.position === 0 && s.track_window.previous_tracks.length > 0;
    if (ended && this.started && !this.endedSent) {
      this.endedSent = true;
      this.started = false;
      this.trackSent = false;
      this.active = false;
      clearInterval(this.poll);
      this.endedCb();
    } else if (this.active && !this.pending) this.externalPause();
  }
  private externalPause() {
    this.active = false;
    clearInterval(this.poll);
    this.externalPauseCb();
  }
  private takePending() {
    const p = this.pending;
    if (!p) return null;
    p.timers.forEach((t) => clearTimeout(t));
    this.pending = null;
    return p;
  }
  private settlePlay(error?: Error) {
    const p = this.takePending();
    if (!p) return;
    if (error) p.reject(error);
    else {
      this.started = true;
      this.active = true;
      this.startPoll();
      p.resolve();
    }
  }
  /** Runtime error after `ready`: stop the clock and report it. */
  private fail(message: string) {
    this.active = false;
    clearInterval(this.poll);
    this.clock.sync(this.clock.get(), false, true);
    this.settlePlay(new Error(message));
    this.errorCb(message);
  }
  private startPoll() {
    clearInterval(this.poll);
    // Advanced locally per frame (SmoothClock), aligned with the player state every 500 ms.
    this.poll = window.setInterval(() => {
      this.player?.getCurrentState().then(
        (s) => {
          if (s && this.active && !this.destroyed) this.clock.sync(statePositionMs(s), !s.paused);
        },
        () => {},
      );
    }, SPOTIFY_POLL_MS);
  }
  play(): Promise<void> {
    const player = this.player;
    if (this.destroyed || !player || !this.ready)
      // Transient while loading: a later tap may start it, so it counts as refused. Otherwise
      // (never loaded, load failed, connection lost) tapping cannot help: a real error.
      return Promise.reject(
        this.loading
          ? new PlayRefusedError("Spotify-Player ist noch nicht geladen.")
          : new Error("Spotify-Player ist nicht bereit."),
      );
    if (this.pending) return this.pending.promise;
    this.silent = false;
    // Must run inside the gesture on iOS/Safari; harmless elsewhere.
    void player.activateElement().catch(() => {});
    let resolve = () => {};
    let reject: (e: Error) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const pending: PendingPlay = { promise, resolve, reject, timers: [] };
    this.pending = pending;
    pending.timers.push(
      window.setTimeout(() => {
        if (this.pending !== pending) return;
        this.active = false;
        void this.player?.pause().catch(() => {});
        this.settlePlay(new PlayRefusedError(SPOTIFY_REFUSED));
      }, SPOTIFY_PLAY_TIMEOUT_MS),
    );
    if (this.started) {
      // Like the first start: the seek stays pending until playback is confirmed.
      const seekMs = this.pendingSeekMs;
      this.sentSeekMs = seekMs;
      const resume = async () => {
        if (seekMs !== null) await player.seek(seekMs);
        await player.resume();
      };
      resume().catch(() => {
        if (this.pending === pending)
          this.settlePlay(new Error("Spotify konnte nicht weiterspielen."));
      });
    } else void this.startTrack(pending);
    // Resolves on the first state that is not paused (stateChanged).
    return promise;
  }
  /** First start on this device: the Web API plays the track from the remembered position. */
  private async startTrack(pending: PendingPlay) {
    this.sentSeekMs = this.pendingSeekMs;
    const positionMs = Math.max(0, Math.round(this.pendingSeekMs ?? 0));
    let ok = false;
    try {
      const token = await getSpotifyToken();
      if (this.pending !== pending) return;
      const r = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: [this.uri], position_ms: positionMs }),
        },
      );
      ok = r.ok;
      if (ok && !this.destroyed) this.trackSent = true;
    } catch (e: unknown) {
      if (this.pending !== pending) return;
      this.settlePlay(
        e instanceof SpotifyAuthError
          ? e
          : new Error("Spotify ist nicht erreichbar. Bist du online?"),
      );
      return;
    }
    if (this.pending !== pending) {
      // Paused or destroyed while the request was under way: the track may start anyway. Not
      // when a newer play() is pending or already playing; it must keep running.
      if (ok && !this.destroyed && !this.pending && !this.active)
        void this.player?.pause().catch(() => {});
      return;
    }
    if (!ok) this.settlePlay(new Error("Spotify konnte den Song nicht starten."));
  }
  pause() {
    this.active = false;
    clearInterval(this.poll);
    this.settlePlay(new Error("Wiedergabe angehalten."));
    if (!this.player || !this.ready) return;
    // Also when the Web API accepted a start whose first playing state is still on its way.
    if (this.started || this.trackSent) void this.player.pause().catch(() => {});
    this.clock.sync(this.clock.get(), false, true);
  }
  seek(ms: number) {
    if (!this.started || !this.player || !this.ready) {
      // Not started yet: the start sends it as position_ms (or applies it once playing).
      this.pendingSeekMs = ms;
      this.clock.sync(ms, false, true);
      return;
    }
    this.pendingSeekMs = null;
    void this.player.seek(ms).catch(() => {});
    this.clock.sync(ms, this.active, true);
  }
  getTimeMs() {
    return this.clock.get();
  }
  setVolume(v: number) {
    this.volume = v;
    void this.player?.setVolume(v).catch(() => {});
  }
  onEnded(cb: () => void) {
    this.endedCb = cb;
  }
  onError(cb: (message: string) => void) {
    this.errorCb = cb;
  }
  onExternalStart(cb: () => void) {
    this.externalStartCb = cb;
  }
  onExternalPause(cb: () => void) {
    this.externalPauseCb = cb;
  }
  destroy() {
    this.destroyed = true;
    this.active = false;
    clearInterval(this.poll);
    this.settlePlay(new Error("Wiedergabe beendet."));
    this.settleLoad?.();
    try {
      this.player?.disconnect();
    } catch {
      /* */
    }
    this.player = null;
  }
}

export function createSource(song: Song, opts: SourceOptions = {}): AudioSource {
  const s = song.source;
  switch (s.type) {
    case "local":
      return new ElementSource(
        "local",
        async () => {
          const b = await songRepository.getAudio(s.blobId);
          if (!b) throw new Error("Audiodatei nicht gefunden.");
          return URL.createObjectURL(b);
        },
        effectivePlaybackRate(song),
        opts.element,
      );
    case "url":
      return new ElementSource("url", async () => s.url, effectivePlaybackRate(song), opts.element);
    case "youtube":
      return new YouTubeSource(s.videoId, effectivePlaybackRate(song), opts.container);
    case "spotify":
      return new SpotifySource(s.trackUri);
  }
}

export const isLowPrecision = (song: Song) =>
  song.source.type === "youtube" || song.source.type === "spotify";
