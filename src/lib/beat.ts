export const DECODE_ERROR_MESSAGE =
  "Diese Datei lässt sich nicht abspielen. Bitte MP3, M4A, WAV oder OGG verwenden.";

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

/**
 * Decodes the file once and returns the estimated BPM (rounded, clamped to 30-300) and the
 * duration. Throws an Error with a German message when the file cannot be decoded.
 */
export async function analyzeAudio(
  file: Blob,
  decode: AudioDecoder = decodeWithAudioContext,
): Promise<{ bpm: number; durationMs: number }> {
  let buf: DecodedAudio;
  try {
    buf = await decode(await file.arrayBuffer());
  } catch {
    throw new Error(DECODE_ERROR_MESSAGE);
  }
  const bpm = Math.round(estimateBpmFromSamples(buf.getChannelData(0), buf.sampleRate));
  return {
    bpm: Math.min(300, Math.max(30, bpm)),
    durationMs: Math.round(buf.duration * 1000),
  };
}

/** BPM-Schätzung per Onset-Detection (Energiefluss + Autokorrelation). */
export async function estimateBpm(file: Blob): Promise<number> {
  return (await analyzeAudio(file)).bpm;
}

/** Pure part of the estimator (also used by tests): onset envelope + autocorrelation. */
export function estimateBpmFromSamples(data: Float32Array, sampleRate: number): number {
  const hop = Math.floor(sampleRate / 100); // 10 ms
  const env: number[] = [];
  let prev = 0;
  const maxN = Math.min(data.length, sampleRate * 90);
  for (let i = 0; i + hop < maxN; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) {
      const x = data[j];
      if (x !== undefined) e += x * x;
    }
    env.push(Math.max(0, e - prev));
    prev = e;
  }
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

export const quantize = (t: number, bpm: number, offset = 0) => {
  const beat = 60000 / bpm;
  return Math.round((t - offset) / beat) * beat + offset;
};
