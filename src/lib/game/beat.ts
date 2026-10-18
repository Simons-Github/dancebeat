/** Highest pulse rate: never more than 3 pulses per second (photosensitivity guideline). */
export const MAX_PULSE_HZ = 3;
/** A pulse fades out over this long. */
export const PULSE_DECAY_MS = 220;

/** Beats per pulse so the pulse rate stays at or below MAX_PULSE_HZ. */
export function beatsPerPulse(bpm: number) {
  const hz = bpm / 60;
  return Math.max(1, Math.ceil(hz / MAX_PULSE_HZ));
}

/**
 * Pulse intensity 0..1 at game time `t` (ms): 1 on the beat, linear fade over PULSE_DECAY_MS.
 * Before the first beat (negative time) there is no pulse.
 */
export function beatPulse(t: number, bpm: number): number {
  if (!(bpm > 0) || !Number.isFinite(t) || t < 0) return 0;
  const period = (60000 / bpm) * beatsPerPulse(bpm);
  const since = t % period;
  return since < PULSE_DECAY_MS ? 1 - since / PULSE_DECAY_MS : 0;
}
