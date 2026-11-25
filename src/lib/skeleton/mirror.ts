import { BONE_PAIRS, type Skeleton3D } from "./types";
import type { Vec3 } from "./vec";

const neg = (v: number) => -v + 0; // + 0 turns -0 into 0

/**
 * Mirrors a pose at the body's sagittal plane: left and right bones swap, x is negated and the
 * yaw reversed, so a move with the left arm becomes the same move with the right arm. Like
 * `mirrorChoreo`, the left/right labels swap and the angles become `mirrorAngles` of the
 * original; unlike it, the projected figure is also reflected on screen (x → 1 − x), so the
 * moved side stays where mirror space expects it. Applying it twice restores the original.
 */
export function mirror3d(sk: Skeleton3D): Skeleton3D {
  const flip = (v: Vec3): Vec3 => [neg(v[0]), v[1], v[2]];
  // The axes run from the right to the left joint; after swapping the joints they point the
  // other way, so the mirrored axis is -flip(v).
  const flipAxis = (v: Vec3): Vec3 => [v[0], neg(v[1]), neg(v[2])];
  const bones: Skeleton3D["bones"] = {};
  const { torso, neck, shoulders, hips } = sk.bones;
  if (torso) bones.torso = flip(torso);
  if (neck) bones.neck = flip(neck);
  if (shoulders) bones.shoulders = flipAxis(shoulders);
  if (hips) bones.hips = flipAxis(hips);
  for (const [l, r] of BONE_PAIRS) {
    const vl = sk.bones[l],
      vr = sk.bones[r];
    if (vr) bones[l] = flip(vr);
    if (vl) bones[r] = flip(vl);
  }
  const [x, y, z] = sk.root.pos;
  return { root: { pos: [neg(x), y, z], yawDeg: neg(sk.root.yawDeg) }, bones };
}
