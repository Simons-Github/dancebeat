import { describe, expect, it } from "vitest";

import { estimateBeatPhaseMs, estimateBpmFromSamples, onsetEnvelope } from "@/lib/beat";

const SR = 22050;

/** Synthetic click track: short decaying bursts on every beat. */
function clickTrack(bpm: number, seconds: number, firstBeatMs = 0): Float32Array {
  const data = new Float32Array(SR * seconds);
  const beatSamples = (60 / bpm) * SR;
  for (let t = (firstBeatMs / 1000) * SR; t < data.length; t += beatSamples) {
    const start = Math.round(t);
    for (let k = 0; k < 400 && start + k < data.length; k++) {
      data[start + k] = Math.sin(k * 0.6) * Math.exp(-k / 80);
    }
  }
  return data;
}

/** Reference: the estimator as it was before the guards (undefined => NaN, candidate dropped). */
function legacyEstimate(data: Float32Array, sampleRate: number): number {
  const hop = Math.floor(sampleRate / 100);
  const env: number[] = [];
  let prev = 0;
  const maxN = Math.min(data.length, sampleRate * 90);
  for (let i = 0; i + hop < maxN; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) e += data[j]! * data[j]!;
    env.push(Math.max(0, e - prev));
    prev = e;
  }
  let best = 120,
    bestScore = -1;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const lag = 6000 / bpm;
    let s = 0;
    for (let i = 0; i + lag * 2 < env.length; i++)
      s += env[i]! * (env[Math.round(i + lag)]! + 0.5 * env[Math.round(i + lag * 2)]!);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  return best;
}

describe("estimateBpmFromSamples", () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ~${bpm} BPM and matches the legacy estimator`, () => {
      const data = clickTrack(bpm, 30);
      const est = estimateBpmFromSamples(data, SR);
      const legacy = legacyEstimate(data, SR);
      console.log(`bpm=${bpm} new=${est} legacy=${legacy}`);
      expect(Math.abs(est - bpm)).toBeLessThanOrEqual(2);
      expect(est).toBe(legacy);
    });
  }

  it("agrees with the legacy estimator across track lengths (edge case at the envelope end)", () => {
    const diffs: string[] = [];
    for (const bpm of [90, 120, 140]) {
      for (let sec = 20; sec < 32; sec += 0.37) {
        const data = clickTrack(bpm, sec);
        const a = estimateBpmFromSamples(data, SR);
        const b = legacyEstimate(data, SR);
        if (a !== b) diffs.push(`bpm=${bpm} len=${sec.toFixed(2)}s new=${a} legacy=${b}`);
      }
    }
    console.log(diffs.length ? diffs.join("\n") : "no differences");
    expect(diffs).toEqual([]);
  });
});

describe("onsetEnvelope", () => {
  it("uses the exact step length and respects maxSeconds", () => {
    const env = onsetEnvelope(new Float32Array(SR * 3), SR);
    expect(env.hopMs).toBeCloseTo((220 / SR) * 1000, 9);
    expect(env.values.length).toBe(Math.ceil((SR * 3 - 220) / 220));
    expect(onsetEnvelope(new Float32Array(SR * 3), SR, 1).values.length).toBe(100);
    expect(onsetEnvelope(new Float32Array(100), SR).values.length).toBe(0);
  });
});

describe("estimateBeatPhaseMs", () => {
  /** Distance of `t` to the nearest beat of the grid `first + k · beat`. */
  const gridError = (t: number, first: number, bpm: number) => {
    const beat = 60_000 / bpm;
    const d = (((t - first) % beat) + beat) % beat;
    return Math.min(d, beat - d);
  };

  for (const [bpm, first] of [
    [120, 230],
    [90, 0],
    [128, 401],
    [140, 77],
  ] as const) {
    it(`finds the beat grid at ${bpm} BPM, first beat ${first} ms`, () => {
      const env = onsetEnvelope(clickTrack(bpm, 40, first), SR);
      for (const fromMs of [0, 1234, 20_000]) {
        const t = estimateBeatPhaseMs(env, bpm, fromMs);
        expect(t).not.toBeNull();
        expect(t!).toBeGreaterThanOrEqual(fromMs);
        expect(t! - fromMs).toBeLessThan(60_000 / bpm);
        expect(gridError(t!, first, bpm)).toBeLessThanOrEqual(15);
      }
    });
  }

  it("still lands on the grid when the BPM is rounded (true 120.4, given 120)", () => {
    const env = onsetEnvelope(clickTrack(120.4, 40, 180), SR);
    const t = estimateBeatPhaseMs(env, 120, 10_000)!;
    expect(gridError(t, 180, 120.4)).toBeLessThanOrEqual(40);
  });

  it("stays near the section start when the BPM is off by one (true 128, given 127)", () => {
    const env = onsetEnvelope(clickTrack(128, 40, 401), SR);
    for (const fromMs of [0, 15_000]) {
      const t = estimateBeatPhaseMs(env, 127, fromMs)!;
      expect(gridError(t, 401, 128)).toBeLessThanOrEqual(50);
    }
  });

  it("is not fooled by weaker off-beat clicks", () => {
    const data = clickTrack(120, 30, 100);
    const off = clickTrack(120, 30, 350);
    for (let i = 0; i < data.length; i++) data[i]! += 0.4 * off[i]!;
    const t = estimateBeatPhaseMs(onsetEnvelope(data, SR), 120, 0)!;
    expect(gridError(t, 100, 120)).toBeLessThanOrEqual(15);
  });

  it("returns null for silence, too short windows and invalid input", () => {
    expect(estimateBeatPhaseMs(onsetEnvelope(new Float32Array(SR * 20), SR), 120, 0)).toBeNull();
    const env = onsetEnvelope(clickTrack(120, 20), SR);
    expect(estimateBeatPhaseMs(env, 120, 19_500)).toBeNull();
    expect(estimateBeatPhaseMs(env, 120, 0, 900)).toBeNull();
    expect(estimateBeatPhaseMs(env, 0, 0)).toBeNull();
    expect(estimateBeatPhaseMs(env, 120, -1)).toBeNull();
    expect(estimateBeatPhaseMs(env, 120, Number.NaN)).toBeNull();
  });
});
