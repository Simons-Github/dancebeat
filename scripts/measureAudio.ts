/**
 * Measurement of the demo songs (Etappe 14a-1): exact tempo and beat phase over the whole song,
 * plus the energy per block of beats from which the sections are judged. Pure logic; the CLI is
 * measure-audio.ts (decoding needs ffmpeg).
 */
import type { OnsetEnvelope } from "../src/lib/beat.ts";

export interface BeatGrid {
  /** Tempo, rounded to 0.01 BPM. */
  bpm: number;
  /** Time of the first grid beat in ms, in [0, one beat), whole ms. */
  phaseMs: number;
  /** Comb-filter score of the winner (sum over all grid beats). */
  score: number;
}

/**
 * Fits a beat grid to the whole onset envelope with a comb filter: for every tempo candidate in
 * [minBpm, maxBpm] (step `stepBpm`) and every phase in [0, one beat) (step `phaseStepMs`) it sums
 * `values[i] + 0.5 * (values[i-1] + values[i+1])` at i = round(t / hopMs) for every grid beat
 * t = phase + k * beat. The highest sum wins. Over a whole song a tempo error of 0.01 BPM already
 * drifts the grid off the onsets, so the score peaks sharply. `minBpm === maxBpm` searches the
 * phase only.
 */
export function fitBeatGrid(
  env: OnsetEnvelope,
  minBpm: number,
  maxBpm: number,
  stepBpm = 0.01,
  phaseStepMs = 5,
): BeatGrid {
  const { hopMs, values } = env;
  if (!(minBpm > 0) || !(maxBpm >= minBpm) || !(stepBpm > 0) || !(hopMs > 0))
    throw new Error(`Invalid search range ${minBpm}-${maxBpm} BPM (step ${stepBpm})`);
  const n = values.length;
  const at = (i: number) => (i >= 0 && i < n ? (values[i] ?? 0) : 0);
  const endMs = n * hopMs;

  let best: BeatGrid = { bpm: minBpm, phaseMs: 0, score: -1 };
  const steps = Math.round((maxBpm - minBpm) / stepBpm);
  for (let s = 0; s <= steps; s++) {
    const bpm = minBpm + s * stepBpm;
    const beatMs = 60_000 / bpm;
    for (let phase = 0; phase < beatMs; phase += phaseStepMs) {
      let sum = 0;
      for (let t = phase; t < endMs; t += beatMs) {
        // values[i] covers [i·hop, (i+1)·hop): an onset at t lands in step floor(t / hop).
        const i = Math.floor(t / hopMs);
        sum += at(i) + 0.5 * (at(i - 1) + at(i + 1));
      }
      if (sum > best.score) best = { bpm, phaseMs: phase, score: sum };
    }
  }
  return {
    bpm: Math.round(best.bpm * 100) / 100,
    phaseMs: Math.round(best.phaseMs),
    score: best.score,
  };
}

/**
 * RMS per block of `blockBeats` beats, the first block starting at `phaseMs`. The last block may
 * be shorter (song end); samples before `phaseMs` are not counted.
 */
export function blockRms(
  samples: Float32Array,
  sampleRate: number,
  bpm: number,
  phaseMs: number,
  blockBeats = 4,
): number[] {
  if (!(bpm > 0) || !(sampleRate > 0) || !(blockBeats > 0)) return [];
  const blockSamples = ((blockBeats * 60_000) / bpm / 1000) * sampleRate;
  const start = (Math.max(0, phaseMs) / 1000) * sampleRate;
  const out: number[] = [];
  for (let b = 0; ; b++) {
    const from = Math.round(start + b * blockSamples);
    if (from >= samples.length) break;
    const to = Math.min(samples.length, Math.round(start + (b + 1) * blockSamples));
    let sum = 0;
    for (let i = from; i < to; i++) {
      const x = samples[i] ?? 0;
      sum += x * x;
    }
    out.push(to > from ? Math.sqrt(sum / (to - from)) : 0);
  }
  return out;
}

/** Formats ms as m:ss.s for the energy table. */
export function formatTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
