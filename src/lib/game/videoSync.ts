import type { GamePhase } from "./controller";

/**
 * Drift between the dance video and its target position that is tolerated before seeking.
 * Seeking a media element costs a decode (a visible stutter on phones), so small drift is left
 * alone; 150 ms is well below what reads as "the dancer is off" next to the coach timing.
 */
export const VIDEO_SYNC_TOLERANCE_MS = 150;
/**
 * Minimum wall time between two seeks. After a seek a phone needs a moment to decode and catch
 * up; seeking again right away would only restart that wait (seek storm).
 */
export const VIDEO_SEEK_COOLDOWN_MS = 500;
/**
 * After `play()` was refused, the next attempt waits this long (wall time) unless the phase
 * changes; retrying every frame would only pile up rejected promises.
 */
export const VIDEO_PLAY_RETRY_MS = 2000;
/** Upper bound for the seek lead; a slower seek is a hiccup, not something to aim ahead for. */
export const MAX_SEEK_LEAD_MS = 1000;
/** Within this distance of the end the video counts as finished (no play(), it would rewind). */
const END_MARGIN_MS = 50;

/**
 * Position in the dance video (ms) that matches game time `gameMs`. The video follows the
 * choreography (what is scored and what the coach shows), not the audio: game time plus
 * `choreo.offsetMs`, the same conversion the editor uses for "music time". Never negative.
 */
export function videoTargetMs(gameMs: number, choreoOffsetMs: number): number {
  const t = gameMs + choreoOffsetMs;
  return Number.isFinite(t) && t > 0 ? t : 0;
}

export interface VideoSyncInput {
  /** Current video position (ms), `currentTime · 1000`. */
  currentMs: number;
  /** Target position from `videoTargetMs`. */
  targetMs: number;
  /** Game phase; only "playing" lets the video run. */
  phase: GamePhase;
  /** The element is paused (`video.paused`). */
  paused: boolean;
  /** A seek is still in progress (`video.seeking`); no new one is issued meanwhile. */
  seeking: boolean;
  /** Wall time since the last seek this loop issued (Infinity if none). */
  msSinceSeek: number;
  /** Video length (ms) once known; the target is clamped to it. */
  durationMs?: number;
  /** The video reached its end (`video.ended`); play() would rewind it, so it is never called. */
  ended: boolean;
  /** A play() promise has not settled yet; no second call meanwhile. */
  playPending: boolean;
  /** Wall time since play() was last refused (Infinity if not, or the phase changed since). */
  msSinceRefusal: number;
  /** Added to the target when seeking (`seekLeadMs`): the video lands where the game will be. */
  seekLeadMs: number;
}

export interface VideoSyncAction {
  /** Call `play()` (only ever true while paused). */
  play: boolean;
  /** Call `pause()` (only ever true while running). */
  pause: boolean;
  /** Set `currentTime` to this (ms), or null to leave the position alone. */
  seekMs: number | null;
}

/**
 * One step of keeping the video on its target, called once per animation frame. While playing
 * the video runs by itself (same rate as the music) and is only corrected when it drifts beyond
 * the tolerance. In every other phase it is paused and parked at the target, again seeking only
 * beyond the tolerance, so a still clock does not seek every frame. Seeks are throttled: none
 * while one is pending and none within the cooldown. play() is never called while a call is
 * pending, on an ended video, or within the retry wait after a refusal.
 */
export function videoSyncStep(input: VideoSyncInput): VideoSyncAction {
  const { currentMs, phase, paused, seeking, msSinceSeek, durationMs, ended } = input;
  const known = durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0;
  const targetMs = known ? Math.min(input.targetMs, durationMs) : input.targetMs;
  const atEnd = known && targetMs >= durationMs - END_MARGIN_MS;
  // Target 0 means "before the video starts" (clamped lead-in): wait on the first frame.
  const run = phase === "playing" && targetMs > 0 && !atEnd && !ended;
  const canPlay = !input.playPending && input.msSinceRefusal >= VIDEO_PLAY_RETRY_MS;
  const canSeek = !seeking && msSinceSeek >= VIDEO_SEEK_COOLDOWN_MS;
  const drifted = Math.abs(currentMs - targetMs) > VIDEO_SYNC_TOLERANCE_MS;
  const lead = run ? input.seekLeadMs : 0;
  const seekTo = known ? Math.min(targetMs + lead, durationMs) : targetMs + lead;
  return {
    play: run && paused && canPlay,
    pause: !run && !paused,
    seekMs: drifted && canSeek ? seekTo : null,
  };
}

/**
 * How far ahead of the target a seek aims while playing: the last measured seek duration (from
 * issuing the seek until it finished), clamped to 0..MAX_SEEK_LEAD_MS. A phone that needs longer
 * than the tolerance to decode after a seek would otherwise land behind every time and seek again
 * (endless stutter). Not playing: 0, the clock stands still.
 */
export function seekLeadMs(lastSeekLagMs: number, playing: boolean): number {
  if (!playing || !Number.isFinite(lastSeekLagMs) || lastSeekLagMs <= 0) return 0;
  return Math.min(lastSeekLagMs, MAX_SEEK_LEAD_MS);
}
