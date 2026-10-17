/** BPM-Schätzung per Onset-Detection (Energiefluss + Autokorrelation). */
export async function estimateBpm(file: Blob): Promise<number> {
  const ctx = new AudioContext();
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("Audio nicht dekodierbar.");
  } finally {
    ctx.close();
  }
  return estimateBpmFromSamples(buf.getChannelData(0), buf.sampleRate);
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
