import { describe, expect, it } from "vitest";
import { angleDiff, computeAngles, figure, frameAt, lerpAngle } from "@/lib/pose";
import { mirrorChoreo, mirrorLandmarks } from "@/lib/choreo";
import { angleDeviation } from "@/lib/scoring";
import type { Choreography, Landmark } from "@/lib/types";

const flipX = (lm: Landmark[]): Landmark[] =>
  lm.map((p) => [1 - p[0], p[1], p[2] ?? 1] as Landmark);

describe("angleDiff / lerpAngle", () => {
  it("nimmt den kürzesten Bogen über ±180°", () => {
    expect(angleDiff(179, -179)).toBe(-2);
    expect(Math.abs(angleDiff(-170, 170))).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
  });
  it("interpoliert über die Grenze statt durch 0", () => {
    expect(Math.abs(lerpAngle(170, -170, 0.5))).toBe(180);
  });
});

describe("vorzeichenbehaftete Winkel", () => {
  it("Arme hängend ≈ 0°, seitlich ≈ +90°, oben ≈ +180° (beide Seiten gleich)", () => {
    const down = computeAngles(figure({ la: 0, ra: 0 }));
    const t = computeAngles(figure({ la: 90, ra: 90 }));
    const up = computeAngles(figure({ la: 170, ra: 170 }));
    expect(down.leftShoulder).toBeCloseTo(0, 6);
    expect(down.rightShoulder).toBeCloseTo(0, 6);
    expect(t.leftShoulder).toBeCloseTo(90, 6);
    expect(t.rightShoulder).toBeCloseTo(90, 6);
    expect(up.leftShoulder).toBeCloseTo(170, 6);
    expect(up.rightShoulder).toBeCloseTo(170, 6);
  });

  it("unterscheidet Arm seitlich weg von Arm quer vor dem Körper", () => {
    const out = computeAngles(figure({ la: 90, ra: 0 })).leftShoulder ?? NaN;
    const across = computeAngles(figure({ la: -90, ra: 0 })).leftShoulder ?? NaN;
    expect(out).toBeCloseTo(90, 6);
    expect(across).toBeCloseTo(-90, 6);
  });

  it("unterscheidet Beugerichtung am Ellbogen", () => {
    const a = computeAngles(figure({ la: 90, ra: 90, le: 90 })).leftElbow ?? NaN;
    const b = computeAngles(figure({ la: 90, ra: 90, le: -90 })).leftElbow ?? NaN;
    expect(Math.abs(a)).toBeCloseTo(90, 6);
    expect(Math.sign(a)).toBe(-Math.sign(b));
  });

  it("ist unabhängig davon, ob das Bild gespiegelt ist", () => {
    const lm = figure({ la: 135, ra: 30, le: 40, re: -60, ll: 20, lk: 50, lean: 12 });
    const a = computeAngles(lm);
    const b = computeAngles(flipX(lm));
    for (const [k, v] of Object.entries(a)) expect(b[k as keyof typeof b]).toBeCloseTo(v, 6);
  });

  it("Rumpfneigung zur linken Körperseite ist positiv, über ±180 kürzester Bogen", () => {
    // In the stored mirror space the body's left side is screen-left; lean > 0 moves right.
    const towardLeft = computeAngles(figure({ la: 0, ra: 0, lean: -15 })).torsoLean ?? NaN;
    expect(towardLeft).toBeCloseTo(15, 6);
    expect(
      angleDeviation(
        { torsoLean: 179, leftShoulder: 0, leftElbow: 0, rightShoulder: 0, rightElbow: 0 },
        { torsoLean: -179, leftShoulder: 0, leftElbow: 0, rightShoulder: 0, rightElbow: 0 },
      ),
    ).toBeCloseTo((2 * 0.5) / 8.5, 6);
  });
});

describe("mirrorChoreo", () => {
  const lm = figure({ la: 160, ra: 20, re: 60, lean: 10 });
  const choreo: Choreography = {
    title: "t",
    bpm: 120,
    offsetMs: 0,
    accentColor: "#FF2E93",
    secondaryColor: "#00E5FF",
    frames: [{ timeMs: 0, landmarks: lm, angles: computeAngles(lm) }],
    moves: [{ timeMs: 0, label: "x", iconId: "x", gold: false }],
  };

  it("vertauscht links und rechts: gespiegelte Winkel = Winkel der getauschten Landmarks", () => {
    const m = mirrorChoreo(choreo).frames[0]!;
    const expected = computeAngles(mirrorLandmarks(lm));
    for (const [k, v] of Object.entries(expected))
      expect(m.angles[k as keyof typeof m.angles]).toBeCloseTo(v, 6);
    expect(m.angles.leftShoulder).toBeCloseTo(choreo.frames[0]!.angles.rightShoulder ?? NaN, 6);
  });

  it("zweimal gespiegelt ergibt das Original", () => {
    expect(mirrorChoreo(mirrorChoreo(choreo))).toEqual(choreo);
  });

  it("frameAt interpoliert Winkel über den kürzesten Bogen", () => {
    const f = frameAt(
      [
        { timeMs: 0, landmarks: [], angles: { leftShoulder: 170 } },
        { timeMs: 100, landmarks: [], angles: { leftShoulder: -170 } },
      ],
      50,
    );
    expect(Math.abs(f?.angles.leftShoulder ?? 0)).toBe(180);
  });
});
