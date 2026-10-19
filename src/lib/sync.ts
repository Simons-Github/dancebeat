import { gameTimeMs, type ClockOffsets } from "@/lib/audio/clock";

/**
 * Per-song sync test: the player taps along to the beat, the taps (audio positions from
 * `AudioSource.getTimeMs()`) give the song's `syncOffsetMs`.
 *
 * Sign convention: `gameTimeMs = audio − latency − syncOffsetMs − choreoOffsetMs`. The proposed
 * offset is the typical residual of `tap − latency − choreoOffset` against the beat grid
 * `k · 60000 / bpm`. With `syncOffsetMs = offset`, the game time at the moment the player hears
 * (and taps) a beat lands on the grid. Positive = the player hears the beat later than the
 * audio position says, so the choreography is shifted later.
 *
 * The result is only known modulo one beat: it lies in (−period/2, period/2].
 */

/** Taps needed (after the discarded first ones) before an offset is proposed. */
export const SYNC_MIN_TAPS = 8;
/** The first taps are usually still searching the beat and are dropped. */
export const SYNC_DISCARD_TAPS = 2;
/** Above this spread (median absolute deviation) the taps are too uneven to trust. */
export const SYNC_MAX_SPREAD_MS = 45;
/** Taps further than max(this, 3 · MAD) from the median count as outliers. */
export const SYNC_OUTLIER_FLOOR_MS = 60;

export interface SyncResult {
  /** Proposed `song.syncOffsetMs`, integer ms. */
  offsetMs: number;
  /** Median absolute deviation of the used taps around the offset, integer ms. */
  spreadMs: number;
  /** Taps used (after discarding the first ones and outliers). */
  count: number;
}

/** Wraps `x` into (−period/2, period/2]. */
export function wrapToBeat(x: number, period: number): number {
  return x - period * Math.ceil(x / period - 0.5);
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** `0` instead of `-0` (shows as "0 ms", compares cleanly). */
const roundMs = (x: number) => Math.round(x) || 0;

/**
 * Deviation of one tap from the beat grid of the current game clock, in (−period/2, period/2].
 * Positive = tapped after the beat. Used for the live list on the sync screen.
 */
export function beatDeviationMs(tapAudioMs: number, bpm: number, offsets: ClockOffsets): number {
  return wrapToBeat(gameTimeMs(tapAudioMs, offsets), 60000 / bpm);
}

/** Tap events older than this (or with a negative age) carry a bogus timestamp: age counts as 0. */
export const MAX_TAP_AGE_MS = 200;

/**
 * Audio position at which a tap actually happened. `nowAudioMs` is `getTimeMs()` read in the
 * handler, `eventAgeMs` how long ago (wall time, `performance.now() − event.timeStamp`) the input
 * event was created; the song runs at `rate`. Mirrors `frameGameTimeMs`: ages outside
 * 0..MAX_TAP_AGE_MS or not finite count as 0. Latency before the event exists (touch hardware)
 * stays in the result.
 */
export function tapAudioMs(nowAudioMs: number, eventAgeMs: number, rate = 1): number {
  const age =
    Number.isFinite(eventAgeMs) && eventAgeMs > 0 && eventAgeMs <= MAX_TAP_AGE_MS ? eventAgeMs : 0;
  return nowAudioMs - age * rate;
}

/**
 * Proposed sync offset from tap times (audio positions). Null when the tempo is invalid or fewer
 * than SYNC_MIN_TAPS usable taps remain after dropping the first SYNC_DISCARD_TAPS.
 *
 * Residuals are circular (a tap just before the beat and one just after are 2 ms apart, not one
 * period), so they are centered around their circular mean first, then wrapped again, and only
 * then reduced with the median.
 */
export function computeSyncOffset(
  tapAudioMs: readonly number[],
  bpm: number,
  latencyMs: number,
  choreoOffsetMs: number,
): SyncResult | null {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  const period = 60000 / bpm;
  const taps = tapAudioMs.slice(SYNC_DISCARD_TAPS).filter(Number.isFinite);
  if (taps.length < SYNC_MIN_TAPS) return null;

  const residuals = taps.map((t) => wrapToBeat(t - latencyMs - choreoOffsetMs, period));

  // Circular mean as the center; with no direction at all (taps spread evenly) take the first.
  let sin = 0;
  let cos = 0;
  for (const r of residuals) {
    const a = (2 * Math.PI * r) / period;
    sin += Math.sin(a);
    cos += Math.cos(a);
  }
  const center =
    Math.hypot(sin, cos) > 1e-9
      ? (Math.atan2(sin, cos) * period) / (2 * Math.PI)
      : (residuals[0] ?? 0);

  // Around the center the residuals are linear again.
  const around = residuals.map((r) => wrapToBeat(r - center, period));
  const m0 = median(around);
  const mad0 = median(around.map((d) => Math.abs(d - m0)));
  const limit = Math.max(SYNC_OUTLIER_FLOOR_MS, 3 * mad0);
  const kept = around.filter((d) => Math.abs(d - m0) <= limit);

  const m = median(kept);
  const spread = median(kept.map((d) => Math.abs(d - m)));
  return {
    offsetMs: roundMs(wrapToBeat(center + m, period)),
    spreadMs: roundMs(spread),
    count: kept.length,
  };
}

/** True when the taps are too uneven for the proposal to be trusted. */
export const isUneven = (r: SyncResult) => r.spreadMs > SYNC_MAX_SPREAD_MS;

/** "+40 ms", "−15 ms", "0 ms" (typographic minus). */
export const formatOffsetMs = (ms: number) =>
  `${ms > 0 ? "+" : ms < 0 ? "−" : ""}${Math.abs(Math.round(ms))} ms`;
