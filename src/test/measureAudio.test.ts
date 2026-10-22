import { describe, expect, it } from "vitest";

import type { OnsetEnvelope } from "@/lib/beat";

import { blockRms, fitBeatGrid, formatTime } from "../../scripts/measureAudio";

const HOP_MS = 10;

/** Onset envelope with clicks of `strength` at phase + k * beat (plus optional offbeat clicks). */
function clickEnvelope(
  bpm: number,
  phaseMs: number,
  durationMs: number,
  offbeat = 0,
): OnsetEnvelope {
  const values = new Float64Array(Math.round(durationMs / HOP_MS));
  const beatMs = 60_000 / bpm;
  const put = (t: number, v: number) => {
    // Same binning as onsetEnvelope: step i covers [i·hop, (i+1)·hop).
    const i = Math.floor(t / HOP_MS);
    if (i < values.length) values[i] = (values[i] ?? 0) + v;
  };
  for (let t = phaseMs; t < durationMs; t += beatMs) {
    put(t, 1);
    if (offbeat > 0) put(t + beatMs / 2, offbeat);
  }
  return { hopMs: HOP_MS, values };
}

describe("fitBeatGrid", () => {
  it("recovers tempo and phase of a click track", () => {
    const env = clickEnvelope(123.45, 137, 170_000);
    const grid = fitBeatGrid(env, 123, 124);
    expect(Math.abs(grid.bpm - 123.45)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(grid.phaseMs - 137)).toBeLessThanOrEqual(HOP_MS);
  });

  it("searches the phase only when min and max tempo are equal", () => {
    const grid = fitBeatGrid(clickEnvelope(120, 260, 60_000), 120, 120);
    expect(grid.bpm).toBe(120);
    expect(Math.abs(grid.phaseMs - 260)).toBeLessThanOrEqual(HOP_MS);
  });

  it("prefers the beat over weaker offbeat clicks", () => {
    // Beat at 380 ms, offbeat at 130 ms (380 - 250): the grid must land on the beat.
    const grid = fitBeatGrid(clickEnvelope(120, 380, 60_000, 0.6), 120, 120);
    expect(Math.abs(grid.phaseMs - 380)).toBeLessThanOrEqual(HOP_MS);
  });

  it("rejects an invalid range", () => {
    expect(() => fitBeatGrid(clickEnvelope(120, 0, 10_000), 121, 120)).toThrow();
  });
});

describe("blockRms", () => {
  it("measures the RMS per block of beats from the phase on", () => {
    // 120 BPM at 1000 Hz: 4 beats = 2000 samples. Silence before the phase, then a square wave of
    // amplitude 0.5 for one block, then amplitude 0.2, then a half block of silence.
    const rate = 1000;
    const phase = 300;
    const samples = new Float32Array(phase + 2000 + 2000 + 1000);
    for (let i = 0; i < 2000; i++) samples[phase + i] = i % 2 ? 0.5 : -0.5;
    for (let i = 0; i < 2000; i++) samples[phase + 2000 + i] = i % 2 ? 0.2 : -0.2;
    const rms = blockRms(samples, rate, 120, phase);
    expect(rms).toHaveLength(3);
    expect(rms[0]).toBeCloseTo(0.5, 6);
    expect(rms[1]).toBeCloseTo(0.2, 6);
    expect(rms[2]).toBe(0);
  });

  it("supports other block lengths", () => {
    const samples = new Float32Array(2000).fill(0.25);
    expect(blockRms(samples, 1000, 120, 0, 2)).toHaveLength(2);
  });
});

it("formatTime prints m:ss.s", () => {
  expect(formatTime(0)).toBe("0:00.0");
  expect(formatTime(83_450)).toBe("1:23.5");
});
