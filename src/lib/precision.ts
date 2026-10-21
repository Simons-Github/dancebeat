import { BONE_IDS, type Skeleton3D } from "./skeleton/types";
import type { Vec3 } from "./skeleton/vec";
import type { Angles, Landmark } from "./types";

/** Storage precision of choreography frames (video import and generator). */

export const roundTo = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f + 0; // + 0 turns -0 into 0
};

/**
 * Landmark to 4 decimals. Visibility is rounded down so a point below the 0.5 threshold never
 * becomes visible in the stored data. From 0.99 on it is dropped: `[x, y]` means fully visible
 * and keeps files small.
 */
export function roundLandmark(p: Landmark): Landmark {
  const x = roundTo(p[0], 4),
    y = roundTo(p[1], 4);
  if (p.length < 3) return [x, y];
  const v = Math.floor((p[2] as number) * 100) / 100;
  return v >= 0.99 ? [x, y] : [x, y, v];
}

/** Angles to 0.1°. */
export function roundAngles(angles: Angles): Angles {
  const a: Angles = {};
  for (const [k, v] of Object.entries(angles) as [keyof Angles, number][]) a[k] = roundTo(v, 1);
  return a;
}

/** `pose3d` rounded for storage: positions and bone directions to 3 decimals, yaw to 0.1°. */
export function roundSkeleton(sk: Skeleton3D): Skeleton3D {
  const rn = (v: Vec3, d: number): Vec3 => [roundTo(v[0], d), roundTo(v[1], d), roundTo(v[2], d)];
  const bones: Skeleton3D["bones"] = {};
  for (const id of BONE_IDS) {
    const v = sk.bones[id];
    if (v) bones[id] = rn(v, 3);
  }
  return { root: { pos: rn(sk.root.pos, 3), yawDeg: roundTo(sk.root.yawDeg, 1) }, bones };
}
