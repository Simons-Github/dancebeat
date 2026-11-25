import { describe, expect, it } from "vitest";
import { computeAngles, DENSE_FRAME_GAP_MS, figure, frameAt } from "@/lib/pose";
import type { Landmark } from "@/lib/types";

/** Simulates a camera frame: x normalized by a width that is `aspect` times the height. */
const squeeze = (lm: Landmark[], aspect: number): Landmark[] =>
  lm.map((p) => [0.5 + (p[0] - 0.5) / aspect, p[1], p[2] ?? 1] as Landmark);

describe("computeAngles: Seitenverhältnis", () => {
  const pose = figure({ la: 135, ra: 45, le: 40, re: 70, lean: 12 });
  const square = computeAngles(pose);

  it("liefert in einem 4:3-Bild mit aspect dieselben Winkel wie im quadratischen Raum", () => {
    const cam = computeAngles(squeeze(pose, 4 / 3), { aspect: 4 / 3 });
    for (const [k, v] of Object.entries(square)) {
      expect(cam[k as keyof typeof cam]).toBeCloseTo(v!, 6);
    }
  });

  it("weicht ohne aspect deutlich ab (der behobene Fehler)", () => {
    const distorted = computeAngles(squeeze(pose, 4 / 3));
    const diff = Math.abs((distorted.leftShoulder ?? 0) - (square.leftShoulder ?? 0));
    expect(diff).toBeGreaterThan(5);
  });
});

describe("frameAt easing", () => {
  const frame = (timeMs: number, x: number) => ({
    timeMs,
    landmarks: [[x, 0.5]] as Landmark[],
    angles: { leftShoulder: x * 100 },
  });

  it("interpoliert dichte Frames linear (kein Abbremsen an jedem Frame)", () => {
    const frames = [frame(0, 0), frame(DENSE_FRAME_GAP_MS, 1)];
    const f = frameAt(frames, DENSE_FRAME_GAP_MS / 4)!;
    expect(f.landmarks[0]![0]).toBeCloseTo(0.25, 12);
    expect(f.angles.leftShoulder).toBeCloseTo(25, 9);
  });

  it("blendet weit auseinanderliegende Schlüsselposen mit Smoothstep", () => {
    const frames = [frame(0, 0), frame(1000, 1)];
    expect(frameAt(frames, 250)!.landmarks[0]![0]).toBeCloseTo(0.15625, 12); // 3k² − 2k³
  });
});
