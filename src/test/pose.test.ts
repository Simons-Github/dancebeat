import { describe, expect, it } from "vitest";
import { computeAngles, figure } from "@/lib/pose";
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
