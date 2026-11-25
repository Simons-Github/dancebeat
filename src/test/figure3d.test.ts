import { describe, expect, it } from "vitest";
import { DEMO_POSES } from "@/data/demo";
import { angleDiff, computeAngles, figure, figure3d, type FigureParams } from "@/lib/pose";
import { BONE_IDS, length } from "@/lib/skeleton";
import type { Landmark } from "@/lib/types";

/**
 * Frozen copy of the 2D `figure()` before Etappe 13b (reference for the refactoring onto
 * `project(figure3d(p))`). Do not change.
 */
function legacyFigure(p: FigureParams): Landmark[] {
  const rad = (d: number) => (d * Math.PI) / 180;
  const lean = rad(p.lean ?? 0);
  const dy = p.dy ?? 0;
  const pts: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  const hipC: [number, number] = [0.5, 0.58 + dy];
  const shC: [number, number] = [hipC[0] + Math.sin(lean) * 0.22, hipC[1] - Math.cos(lean) * 0.22];
  const set = (i: number, x: number, y: number) => (pts[i] = [x, y, 1]);
  set(11, shC[0] - 0.08, shC[1]);
  set(12, shC[0] + 0.08, shC[1]);
  set(23, hipC[0] - 0.05, hipC[1]);
  set(24, hipC[0] + 0.05, hipC[1]);
  set(0, shC[0] + Math.sin(lean) * 0.08, shC[1] - 0.09);
  const limb = (
    from: number,
    mid: number,
    end: number,
    ang: number,
    bend: number,
    side: -1 | 1,
    len: number,
  ) => {
    const a = rad(ang) * side;
    const o = pts[from]!;
    const m: [number, number] = [o[0] + Math.sin(a) * len, o[1] + Math.cos(a) * len];
    const b = a + rad(bend) * side;
    set(mid, m[0], m[1]);
    set(end, m[0] + Math.sin(b) * len, m[1] + Math.cos(b) * len);
  };
  limb(11, 13, 15, p.la, p.le ?? 0, -1, 0.13);
  limb(12, 14, 16, p.ra, p.re ?? 0, 1, 0.13);
  limb(23, 25, 27, p.ll ?? 5, -(p.lk ?? 0), -1, 0.17);
  limb(24, 26, 28, p.rl ?? 5, -(p.rk ?? 0), 1, 0.17);
  return pts;
}

const EXTRA: FigureParams[] = [
  { la: 135, ra: 45, le: 40, re: 70, lean: 12 },
  { la: -90, ra: 0, le: -90, lean: -15 },
  { la: 160, ra: 20, re: 60, lean: 10 },
];
/** [id, params, nose tolerance]: demo poses must keep the nose within 0.002. */
const CASES: [string, FigureParams, number][] = [
  ...Object.entries(DEMO_POSES).map(([id, pose]): [string, FigureParams, number] => [
    id,
    pose.p,
    0.002,
  ]),
  ...EXTRA.map((p, i): [string, FigureParams, number] => [`extra-${i}`, p, 0.0025]),
];

describe("figure() über Skeleton3D", () => {
  // Only the nose moves: the old figure set it 0.09 above the shoulders plus a lean offset, the
  // skeleton has a fixed neck length.
  it.each(CASES)("%s: Landmarks wie vor 13b (Nase ±%f, Rest exakt)", (_id, p, noseTol) => {
    const now = figure(p);
    const ref = legacyFigure(p);
    expect(now).toHaveLength(33);
    now.forEach((pt, i) => {
      const r = ref[i]!;
      expect(pt[2]).toBe(r[2]);
      if (r[2] === 0) return;
      const tol = i === 0 ? noseTol : 1e-9;
      expect(Math.abs(pt[0] - r[0])).toBeLessThanOrEqual(tol);
      expect(Math.abs(pt[1] - r[1])).toBeLessThanOrEqual(tol);
    });
  });

  it.each(CASES)("%s: Winkel wie vor 13b (±0,5°)", (_id, p) => {
    const now = computeAngles(figure(p));
    const ref = computeAngles(legacyFigure(p));
    expect(Object.keys(now).sort()).toEqual(Object.keys(ref).sort());
    for (const [k, v] of Object.entries(ref) as [keyof typeof ref, number][]) {
      expect(Math.abs(angleDiff(now[k]!, v))).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("figure3d", () => {
  it.each(CASES)("%s: flach, frontal, alle 12 Knochen als Einheitsvektoren", (_id, p) => {
    const sk = figure3d(p);
    expect(sk.root.yawDeg).toBe(0);
    expect(sk.root.pos[2]).toBe(0);
    for (const id of BONE_IDS) {
      const b = sk.bones[id];
      expect(b, id).toBeDefined();
      expect(length(b!)).toBeCloseTo(1, 9);
      expect(b![2]).toBe(0);
    }
  });

  it("hebt die linke Körperseite nach +x und oben nach +y", () => {
    const sk = figure3d({ la: 90, ra: 170 });
    // Left arm straight out to the dancer's left, right arm almost straight up.
    expect(sk.bones.leftUpperArm![0]).toBeCloseTo(1, 9);
    expect(sk.bones.rightUpperArm![1]).toBeGreaterThan(0.98);
    expect(sk.bones.torso).toEqual([0, 1, 0]);
  });

  it("legt dy als tiefere Wurzel ab", () => {
    expect(figure3d({ la: 0, ra: 0, dy: 0.06 }).root.pos[1]).toBeLessThan(0);
    expect(Object.is(figure3d({ la: 0, ra: 0 }).root.pos[1], 0)).toBe(true);
    expect(figure({ la: 0, ra: 0, dy: 0.06 })[23]![1]).toBeCloseTo(0.64, 9);
  });
});
