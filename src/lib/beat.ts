import { t } from "@/lib/i18n";
import { deSettings } from "@/lib/i18n/de/settings";

/** German reference text of the decode error (tests); the thrown error follows the UI language. */
export const DECODE_ERROR_MESSAGE = deSettings["settings.beat.decodeError"];

/** Minimal view of a decoded buffer; keeps the analysis testable without an AudioContext. */
export interface DecodedAudio {
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

export type AudioDecoder = (data: ArrayBuffer) => Promise<DecodedAudio>;

/** Decodes with a short-lived AudioContext (browser only; called from handlers). */
const decodeWithAudioContext: AudioDecoder = async (data) => {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(data);
  } finally {
    void ctx.close().catch(() => {});
  }
};

/** Onset strength (positive energy flux) per analysis step; input of the beat-phase estimate. */
export interface OnsetEnvelope {
  /** Exact step length in ms (whole samples, so slightly below 10 ms at e.g. 22050 Hz). */
  hopMs: number;
  values: Float64Array;
}

export interface AudioAnalysis {
  bpm: number;
  durationMs: number;
  /** Envelope over the whole file (100 values per second, a few MB even for an hour). */
  envelope: OnsetEnvelope;
}

/**
 * Decodes the file once and returns the estimated BPM (refined to 0.1, clamped to 30-300), the duration
 * and the onset envelope. Also works on the audio track of a video file where the browser can
 * decode it. Throws an Error with a German message when the file cannot be decoded.
 */
export async function analyzeAudio(
  file: Blob,
  decode: AudioDecoder = decodeWithAudioContext,
): Promise<AudioAnalysis> {
  let buf: DecodedAudio;
  try {
    buf = await decode(await file.arrayBuffer());
  } catch {
    throw new Error(t("settings.beat.decodeError"));
  }
  const data = buf.getChannelData(0);
  const envelope = onsetEnvelope(data, buf.sampleRate);
  const coarse = Math.round(estimateBpmFromSamples(data, buf.sampleRate));
  const bpm = refineBpm(envelope, coarse);
  return {
    bpm: Math.min(300, Math.max(30, bpm)),
    durationMs: Math.round(buf.duration * 1000),
    envelope,
  };
}

/** BPM-Schätzung per Onset-Detection (Energiefluss + Autokorrelation). */
export async function estimateBpm(file: Blob): Promise<number> {
  return (await analyzeAudio(file)).bpm;
}

/** Samples per envelope step: 10 ms, rounded down to whole samples. */
const hopSamples = (sampleRate: number) => Math.floor(sampleRate / 100);

/**
 * Onset envelope: energy per step, minus the previous step's energy, clipped at 0. Covers at most
 * `maxSeconds` (default: everything).
 */
export function onsetEnvelope(
  data: Float32Array,
  sampleRate: number,
  maxSeconds = Infinity,
): OnsetEnvelope {
  const hop = hopSamples(sampleRate);
  const maxN = Math.min(data.length, sampleRate * maxSeconds);
  const values = new Float64Array(Math.max(0, Math.ceil((maxN - hop) / hop)));
  let prev = 0;
  let k = 0;
  for (let i = 0; i + hop < maxN; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) {
      const x = data[j];
      if (x !== undefined) e += x * x;
    }
    values[k++] = Math.max(0, e - prev);
    prev = e;
  }
  return { hopMs: (hop / sampleRate) * 1000, values: values.subarray(0, k) };
}

/** Pure part of the estimator (also used by tests): onset envelope + autocorrelation. */
export function estimateBpmFromSamples(data: Float32Array, sampleRate: number): number {
  // The lags below assume exactly 10 ms per step (kept from the original estimator).
  const env = onsetEnvelope(data, sampleRate, 90).values;
  let best = 120,
    bestScore = -1;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const lag = 6000 / bpm; // in 10ms-Schritten
    let s = 0;
    // Only sum terms whose rounded lag indices exist, so every candidate is scored over complete terms.
    for (let i = 0; Math.round(i + lag * 2) < env.length; i++) {
      const e0 = env[i],
        e1 = env[Math.round(i + lag)],
        e2 = env[Math.round(i + lag * 2)];
      if (e0 === undefined || e1 === undefined || e2 === undefined) continue;
      s += e0 * (e1 + 0.5 * e2);
    }
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  return best;
}

/** Search range around the coarse estimate, step and analysed span of `refineBpm`. */
const REFINE_RANGE_BPM = 3;
const REFINE_STEP_BPM = 0.02;
const REFINE_SPAN_MS = 300_000;
/** Scores within this fraction of the best count as equal (plateau, integer preference). */
const REFINE_TOLERANCE = 0.02;
/** The best candidate must score at least this multiple of the median candidate. */
const REFINE_MIN_CONTRAST = 1.5;

/**
 * Refines an integer BPM estimate to 0.1 BPM. Tries candidates `coarseBpm ± 3` in 0.02 steps
 * (the coarse estimator can run up to ~2 BPM low at high tempi)
 * and scores each with a phase-coherent comb filter over the first 300 s of the envelope: for every
 * phase (in envelope steps) the mean onset strength on the beat grid, neighbouring steps weighted
 * half; the best phase counts. A small tempo error drifts the grid off the onsets over a long span,
 * so the score peaks sharply at the true tempo. The winner is the middle of the plateau of
 * near-best candidates, rounded to 0.1; the nearest whole BPM wins when it scores within the
 * tolerance, so true integer tempi stay exact. Returns `coarseBpm` for silence, invalid input, a
 * peak without contrast (best < 1.5x the median candidate) or a plateau at the range edge.
 */
export function refineBpm(env: OnsetEnvelope, coarseBpm: number): number {
  const { hopMs, values } = env;
  if (!(coarseBpm > 0) || !Number.isFinite(coarseBpm) || !(hopMs > 0)) return coarseBpm;
  const n = Math.min(values.length, Math.floor(REFINE_SPAN_MS / hopMs));
  const at = (i: number) => (i < n ? (values[i] ?? 0) : 0);

  const score = (bpm: number) => {
    const beatSteps = 60_000 / bpm / hopMs;
    if (n < 2 * beatSteps) return 0;
    let best = 0;
    for (let phase = 0; phase < beatSteps; phase++) {
      let sum = 0;
      let count = 0;
      for (let t = phase; t < n; t += beatSteps) {
        const i = Math.round(t);
        sum += at(i) + 0.5 * (at(i - 1) + at(i + 1));
        count++;
      }
      if (sum / count > best) best = sum / count;
    }
    return best;
  };

  const steps = Math.round(REFINE_RANGE_BPM / REFINE_STEP_BPM);
  const candidates: { bpm: number; score: number }[] = [];
  for (let k = -steps; k <= steps; k++) {
    const bpm = coarseBpm + k * REFINE_STEP_BPM;
    if (bpm > 0) candidates.push({ bpm, score: score(bpm) });
  }
  let bestIdx = -1;
  let bestScore = 0;
  candidates.forEach((c, i) => {
    if (c.score > bestScore) {
      bestScore = c.score;
      bestIdx = i;
    }
  });
  if (bestIdx < 0) return coarseBpm;
  // Off-tempo candidates all score alike (click tracks: 2.5-3.6x the mean onset, the true tempo
  // 10-50x). A best that barely stands out is a side lobe, e.g. when the true tempo lies outside
  // the range: keep the coarse integer rather than a confident wrong fraction.
  const sorted = candidates.map((c) => c.score).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (bestScore < REFINE_MIN_CONTRAST * median) return coarseBpm;

  // Middle of the contiguous plateau of near-best candidates around the best one.
  const floor = bestScore * (1 - REFINE_TOLERANCE);
  let lo = bestIdx;
  let hi = bestIdx;
  while ((candidates[lo - 1]?.score ?? 0) >= floor) lo--;
  while ((candidates[hi + 1]?.score ?? 0) >= floor) hi++;
  // A plateau touching the edge: the true tempo may lie outside the range.
  if (lo === 0 || hi === candidates.length - 1) return coarseBpm;
  const winner = ((candidates[lo]?.bpm ?? coarseBpm) + (candidates[hi]?.bpm ?? coarseBpm)) / 2;

  const whole = Math.round(winner);
  if (whole > 0 && score(whole) >= floor) return whole;
  return Math.round(winner * 10) / 10;
}

/**
 * Window for the beat phase. Short, because even the refined BPM (0.1 resolution) is not exact:
 * 0.1 BPM off at 128 BPM drifts ~8 ms over 10 s, a missed refinement (1 BPM off) ~80 ms, so the
 * phase is off by roughly half that at the section start.
 */
export const BEAT_PHASE_WINDOW_MS = 10_000;

/**
 * Time of the first beat at or after `fromMs` (whole ms, same timeline as the envelope), or null
 * when the window holds fewer than two beats or no onsets (silence). Tries every phase in
 * envelope steps and sums the onset strength on the beat grid (comb filter, the neighbouring steps
 * weighted half so that a slightly wrong BPM still hits). Only looks at `windowMs` after `fromMs`,
 * and beats count less the later they are, so that the phase fits the start of the section best.
 */
export function estimateBeatPhaseMs(
  env: OnsetEnvelope,
  bpm: number,
  fromMs: number,
  windowMs = BEAT_PHASE_WINDOW_MS,
): number | null {
  const { hopMs, values } = env;
  if (!(bpm > 0) || !(hopMs > 0) || !Number.isFinite(fromMs) || fromMs < 0) return null;
  const beatMs = 60_000 / bpm;
  const endMs = Math.min(fromMs + windowMs, values.length * hopMs);
  if (endMs - fromMs < 2 * beatMs) return null;
  const at = (i: number) => values[i] ?? 0;

  let bestPhase = 0;
  let bestScore = 0;
  for (let phase = 0; phase < beatMs; phase += hopMs) {
    let score = 0;
    for (let t = fromMs + phase; t < endMs; t += beatMs) {
      const i = Math.round(t / hopMs);
      const weight = 1 - (t - fromMs) / (endMs - fromMs);
      score += weight * (at(i) + 0.5 * (at(i - 1) + at(i + 1)));
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestScore > 0 ? Math.round(fromMs + bestPhase) : null;
}

export const quantize = (t: number, bpm: number, offset = 0) => {
  const beat = 60000 / bpm;
  return Math.round((t - offset) / beat) * beat + offset;
};
