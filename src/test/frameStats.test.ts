import { describe, expect, it } from "vitest";

import { FrameStats } from "@/lib/frameStats";

describe("FrameStats", () => {
  it("berechnet die Bildrate aus den letzten Frames", () => {
    const s = new FrameStats();
    for (let i = 0; i <= 30; i++) s.record(i * (1000 / 30), 10);
    expect(s.snapshot(1000).fps).toBeCloseTo(30, 0);
  });
  it("glättet die Inferenzzeit", () => {
    const s = new FrameStats();
    s.record(0, 10);
    s.record(33, 20);
    expect(s.snapshot(33).inferenceMs).toBeCloseTo(12, 5);
  });
  it("fällt auf 0, wenn keine Frames mehr kommen", () => {
    const s = new FrameStats();
    for (let i = 0; i < 10; i++) s.record(i * 33, 10);
    expect(s.snapshot(5000).fps).toBe(0);
  });
  it("reset leert alles", () => {
    const s = new FrameStats();
    s.record(0, 10);
    s.reset();
    expect(s.snapshot(0)).toEqual({ fps: 0, inferenceMs: 0 });
  });
});
