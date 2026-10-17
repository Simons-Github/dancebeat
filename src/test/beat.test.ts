import { describe, expect, it } from "vitest";

import { estimateBpmFromSamples } from "@/lib/beat";

const SR = 22050;

/** Synthetic click track: short decaying bursts on every beat. */
function clickTrack(bpm: number, seconds: number): Float32Array {
  const data = new Float32Array(SR * seconds);
  const beatSamples = (60 / bpm) * SR;
  for (let t = 0; t < data.length; t += beatSamples) {
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
