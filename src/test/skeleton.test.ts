import { describe, expect, it } from "vitest";
import { mirrorAngles, mirrorLandmarks } from "@/lib/choreo";
import { angleDiff, computeAngles, figure, type FigureParams } from "@/lib/pose";
import {
  BONE_IDS,
  FIGURE_UNITS_PER_METER,
  fromLandmarks3d,
  interpolate,
  length,
  mirror3d,
  project,
  rotateYaw,
  slerp,
  type Landmark3d,
  type Skeleton3D,
  type Vec3,
} from "@/lib/skeleton";
import type { Angles, Landmark } from "@/lib/types";

const S = FIGURE_UNITS_PER_METER;

/** Lifts a 2D `figure()` into MediaPipe world landmarks (metres, hip origin, z = 0). */
function figureTo3d(lm: Landmark[], yawDeg = 0): Landmark3d[] {
  return lm.map((p) => {
    // Mirror space: the dancer's left is on screen left, i.e. world +x; MediaPipe y is down.
    const w = rotateYaw([-(p[0] - 0.5) / S, -(p[1] - 0.58) / S, 0], yawDeg);
    return [w[0], -w[1], -w[2], p[2] ?? 1];
  });
}

function expectAnglesClose(actual: Angles, expected: Angles, tolDeg = 1) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [k, v] of Object.entries(expected) as [keyof Angles, number][]) {
    const a = actual[k];
    expect(a).toBeDefined();
    expect(Math.abs(angleDiff(a!, v))).toBeLessThan(tolDeg);
  }
}

const POSES: FigureParams[] = [
  { la: 10, ra: 10 },
  { la: 170, ra: 170 },
  { la: 160, ra: 20, le: 0, re: 60 },
  { la: 80, ra: 80, ll: 25, rl: 25, lk: 70, rk: 70, dy: 0.06 },
  { la: 150, ra: 30, re: 90, lean: -10 },
  { la: 90, ra: 90, le: 100, re: 100 },
  { la: 60, ra: 60, ll: 50, lean: 8 },
  { la: 135, ra: 45, le: 40, re: 70, lean: 12 },
];

/** Upright skeleton facing the viewer with hanging limbs. */
const upright = (): Skeleton3D => ({
  root: { pos: [0, 0, 0], yawDeg: 0 },
  bones: {
    torso: [0, 1, 0],
    neck: [0, 1, 0],
    shoulders: [1, 0, 0],
    hips: [1, 0, 0],
    leftUpperArm: [0, -1, 0],
    leftForearm: [0, -1, 0],
    rightUpperArm: [0, -1, 0],
    rightForearm: [0, -1, 0],
    leftThigh: [0, -1, 0],
    leftShin: [0, -1, 0],
    rightThigh: [0, -1, 0],
    rightShin: [0, -1, 0],
  },
});

/** Unsigned 2D angle between segments a0→a1 and b0→b1 in degrees. */
function angle2d(lm: Landmark[], a0: number, a1: number, b0: number, b1: number) {
  const p = (i: number) => lm[i]!;
  const ax = p(a1)[0] - p(a0)[0],
    ay = p(a1)[1] - p(a0)[1];
  const bx = p(b1)[0] - p(b0)[0],
    by = p(b1)[1] - p(b0)[1];
  return (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180) / Math.PI;
}

describe("Skeleton3D: Rundweg über project", () => {
  it.each(POSES)("frontale Figur %o ergibt dieselben Winkel wie die 2D-Figur", (p) => {
    const flat = figure(p);
    const lm = project(fromLandmarks3d(figureTo3d(flat)));
    expectAnglesClose(computeAngles(lm), computeAngles(flat));
  });

  it("legt Gelenke wie figure() ab (Hüfte bei y = 0,58 plus dy)", () => {
    const flat = figure({ la: 80, ra: 80, ll: 25, rl: 25, lk: 70, rk: 70, dy: 0.06 });
    const lm = project(fromLandmarks3d(figureTo3d(flat)));
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      expect(lm[i]![0]).toBeCloseTo(flat[i]![0], 9);
      expect(lm[i]![1]).toBeCloseTo(flat[i]![1], 9);
      expect(lm[i]![2]).toBe(1);
    }
    // Points the skeleton does not cover are present but invisible.
    expect(lm).toHaveLength(33);
    expect(lm[17]![2]).toBe(0);
    expect(lm[32]![2]).toBe(0);
  });

  it("erkennt eine gedrehte Aufnahme als Gier, die Knochen bleiben gleich", () => {
    const flat = figure({ la: 135, ra: 45, le: 40, re: 70, lean: 12 });
    const front = fromLandmarks3d(figureTo3d(flat));
    const turned = fromLandmarks3d(figureTo3d(flat, 35));
    expect(turned.root.yawDeg).toBeCloseTo(35, 9);
    for (const id of BONE_IDS) {
      const a = front.bones[id]!,
        b = turned.bones[id]!;
      for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k]!, 9);
    }
  });
});

describe("Skeleton3D: Seitenansicht", () => {
  // Left upper arm raised forward, forearm bent up 90° in the sagittal plane.
  const sk = upright();
  sk.bones.leftUpperArm = [0, 0, 1];
  sk.bones.leftForearm = [0, 1, 0];

  it("zeigt den Arm frontal verkürzt und um 90° gedreht in voller Länge", () => {
    const front = project(sk);
    expect(front[13]![0]).toBeCloseTo(front[11]![0], 9);
    expect(front[13]![1]).toBeCloseTo(front[11]![1], 9);

    const side = project({ ...sk, root: { ...sk.root, yawDeg: 90 } });
    expect(side).toEqual(project(sk, { yawDeg: 90 }));
    // Facing the screen's left: shoulders overlap, the upper arm points left at full length.
    expect(side[11]![0]).toBeCloseTo(side[12]![0], 9);
    expect(side[13]![0]).toBeCloseTo(side[11]![0] - 0.13, 9);
    expect(side[13]![1]).toBeCloseTo(side[11]![1], 9);
    expect(angle2d(side, 11, 13, 13, 15)).toBeCloseTo(90, 6);
  });

  it("liefert ohne Schulterbreite im Bild keine Winkel (Orientierung unbestimmt)", () => {
    expect(computeAngles(project(sk, { yawDeg: 90 }))).toEqual({});
  });

  it("ergibt von hinten dieselben Winkel wie von vorn", () => {
    const flat = figure({ la: 150, ra: 30, re: 90, lean: -10 });
    const s = fromLandmarks3d(figureTo3d(flat));
    expectAnglesClose(computeAngles(project(s, { yawDeg: 180 })), computeAngles(project(s)));
  });
});

describe("slerp", () => {
  const a: Vec3 = [0, -1, 0];
  const b: Vec3 = [1, 0, 0];

  it("trifft die Endpunkte exakt", () => {
    expect(slerp(a, b, 0)).toEqual(a);
    expect(slerp(a, b, 1)).toEqual(b);
  });

  it("liegt in der Mitte normiert auf dem Bogen", () => {
    const m = slerp(a, b, 0.5);
    expect(length(m)).toBeCloseTo(1, 12);
    expect(m[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(m[1]).toBeCloseTo(-Math.SQRT1_2, 12);
  });

  it("bleibt bei Gegenrichtung ohne NaN und normiert", () => {
    for (const [u, v] of [
      [a, [0, 1, 0]],
      [
        [0, 0, 1],
        [0, 0, -1],
      ],
    ] as [Vec3, Vec3][]) {
      const m = slerp(u, v, 0.5);
      expect(m.every(Number.isFinite)).toBe(true);
      expect(length(m)).toBeCloseTo(1, 12);
      expect(Math.abs(m[0] * u[0] + m[1] * u[1] + m[2] * u[2])).toBeLessThan(1e-9);
    }
    // Arm down to arm up passes through the front.
    expect(slerp(a, [0, 1, 0], 0.5)[2]).toBeCloseTo(1, 12);
  });
});

describe("interpolate", () => {
  it("interpoliert Knochen, Wurzel und Gier über den kürzesten Bogen", () => {
    const a = upright();
    const b = upright();
    b.bones.leftUpperArm = [1, 0, 0];
    b.root = { pos: [0.2, -0.1, 0], yawDeg: -170 };
    a.root.yawDeg = 170;
    const m = interpolate(a, b, 0.5);
    expect(m.bones.leftUpperArm![0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(m.root.pos[0]).toBeCloseTo(0.1, 12);
    expect(Math.abs(angleDiff(m.root.yawDeg, 180))).toBeLessThan(1e-9);
    expect(interpolate(a, b, 0)).toEqual(a);
  });

  it("lässt Knochen weg, die auf einer Seite fehlen", () => {
    const a = upright();
    const b = upright();
    delete b.bones.rightShin;
    const m = interpolate(a, b, 0.3);
    expect(m.bones.rightShin).toBeUndefined();
    expect(m.bones.leftShin).toBeDefined();
  });
});

describe("mirror3d", () => {
  const flat = figure({ la: 150, ra: 30, re: 90, ll: 40, lk: 30, lean: -10 });
  const sk = fromLandmarks3d(figureTo3d(flat, 25));
  sk.root.pos = [0.1, -0.05, 0.2];

  it("ergibt zweimal angewendet das Original", () => {
    expect(mirror3d(mirror3d(sk))).toEqual(sk);
  });

  it("projiziert wie mirrorLandmarks der Projektion, auf dem Bildschirm gespiegelt", () => {
    const mirrored = project(mirror3d(sk));
    const expected = mirrorLandmarks(project(sk));
    for (let i = 0; i < 33; i++) {
      const p = mirrored[i]!,
        q = expected[i]!;
      expect(p[2]).toBe(q[2]);
      if (!q[2]) continue;
      expect(p[0]).toBeCloseTo(1 - q[0], 9);
      expect(p[1]).toBeCloseTo(q[1], 9);
    }
  });

  it("liefert dieselben Winkel wie mirrorChoreo (mirrorAngles)", () => {
    const original = computeAngles(project(sk));
    expectAnglesClose(computeAngles(project(mirror3d(sk))), mirrorAngles(original), 1e-6);
    expectAnglesClose(computeAngles(mirrorLandmarks(project(sk))), mirrorAngles(original), 1e-6);
  });
});

describe("fehlende Gelenke", () => {
  const flat = figure({ la: 135, ra: 45, le: 40, re: 70, ll: 20 });

  it("ein unsicherer Ellbogen nimmt Ober- und Unterarm und deren Winkel weg", () => {
    const lm = figureTo3d(flat);
    lm[13] = [lm[13]![0], lm[13]![1], lm[13]![2], 0.3];
    const sk = fromLandmarks3d(lm);
    expect(sk.bones.leftUpperArm).toBeUndefined();
    expect(sk.bones.leftForearm).toBeUndefined();
    const out = project(sk);
    expect(out[13]![2]).toBe(0);
    expect(out[15]![2]).toBe(0);
    const angles = computeAngles(out);
    expect(angles.leftShoulder).toBeUndefined();
    expect(angles.leftElbow).toBeUndefined();
    const { leftShoulder, leftElbow, ...rest } = computeAngles(flat);
    expectAnglesClose(angles, rest);
  });

  it("ohne Hüften fehlen Rumpf, Beine und Hüftwinkel, die Arme bleiben", () => {
    const lm = figureTo3d(flat).map((p, i): Landmark3d =>
      i === 23 || i === 24 ? [p[0], p[1], p[2], 0] : p,
    );
    const sk = fromLandmarks3d(lm);
    expect(sk.bones.torso).toBeUndefined();
    expect(sk.bones.hips).toBeUndefined();
    expect(sk.bones.leftThigh).toBeUndefined();
    const angles = computeAngles(project(sk));
    expect(Object.keys(angles).sort()).toEqual(
      ["leftElbow", "leftShoulder", "rightElbow", "rightShoulder"].sort(),
    );
    const full = computeAngles(flat);
    expect(Math.abs(angleDiff(angles.leftShoulder!, full.leftShoulder!))).toBeLessThan(1);
  });

  it("ohne Schultern und Hüften gibt es keine Knochen und keine Winkel", () => {
    const lm = figureTo3d(flat).map((p): Landmark3d => [p[0], p[1], p[2], 0.2]);
    const sk = fromLandmarks3d(lm);
    expect(sk.bones).toEqual({});
    expect(project(sk).every((p) => p[2] === 0)).toBe(true);
    expect(computeAngles(project(sk))).toEqual({});
  });
});
