/** Everything that shifts the choreography against the audio position. */
export interface ClockOffsets {
  /** Global latency (settings); positive = the choreography comes later. */
  latencyMs: number;
  /** Per-song sync offset (`song.syncOffsetMs`). */
  syncOffsetMs: number;
  /** Choreography offset (`choreo.offsetMs`). */
  choreoOffsetMs: number;
  /**
   * Effective playback rate (`effectivePlaybackRate`), default 1. The latency is wall time; at
   * rate r it corresponds to `latency · r` ms of audio.
   */
  rate?: number;
}

/**
 * Game time (choreography time) for an audio position. The only conversion between the two:
 * `audio − latency·rate − song sync offset − choreo offset`. `startOffsetMs` is not subtracted: it
 * is a seek of the audio, so it is already contained in the audio position.
 */
export function gameTimeMs(audioMs: number, o: ClockOffsets): number {
  return audioMs - o.latencyMs * (o.rate ?? 1) - o.syncOffsetMs - o.choreoOffsetMs;
}

/** Inverse of `gameTimeMs`: the audio position at which the choreography reaches `gameMs`. */
export function audioTimeMs(gameMs: number, o: ClockOffsets): number {
  return gameMs + o.latencyMs * (o.rate ?? 1) + o.syncOffsetMs + o.choreoOffsetMs;
}

/**
 * Game time at which a camera frame was taken. `nowGameMs` is the clock read when the detection
 * result arrived, `frameAgeMs` how long ago (wall time) the picture was captured. The song runs
 * at `rate`, so wall time converts to song time by that factor. Ages outside 0..MAX are bogus
 * timestamps and count as 0.
 */
export const MAX_FRAME_AGE_MS = 500;
export function frameGameTimeMs(nowGameMs: number, frameAgeMs: number, rate = 1): number {
  const age =
    Number.isFinite(frameAgeMs) && frameAgeMs > 0 && frameAgeMs <= MAX_FRAME_AGE_MS
      ? frameAgeMs
      : 0;
  return nowGameMs - age * rate;
}
