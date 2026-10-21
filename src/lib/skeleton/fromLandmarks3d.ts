import type { Landmark3d } from "../types";
import { BONE_ANCHORS, BONE_IDS, type BoneAnchor, type Skeleton3D } from "./types";
import { add, normalize, rotateYaw, scale, sub, type Vec3 } from "./vec";

/**
 * One MediaPipe world landmark: metres, origin at the hip midpoint, x toward the right of the
 * camera image, y down, z away from the camera; optional visibility (default 1). Defined by
 * `Landmark3dSchema` (schema.ts), re-exported here for the skeleton API.
 */
export type { Landmark3d };

const DEG = 180 / Math.PI;

/** Yaw of the horizontal right-to-left axis, or null if the axis is (nearly) vertical. */
function yawOf(left: Vec3 | null, right: Vec3 | null): number | null {
  if (!left || !right) return null;
  const ax = left[0] - right[0],
    az = left[2] - right[2];
  if (Math.hypot(ax, az) < 1e-9) return null;
  // rotateYaw([1, 0, 0], yaw) = [cos, 0, -sin] must point along (ax, az).
  return Math.atan2(-az, ax) * DEG + 0;
}

/**
 * Builds a `Skeleton3D` from 33 MediaPipe world landmarks (other sources such as COCO-17 are
 * mapped onto these indices first). The body system has y up and x along the horizontal hip
 * axis (shoulder axis if the hips are not visible), so torso lean stays in the bones and the
 * root only carries position and yaw. Landmarks below `minVis` yield no bone.
 */
export function fromLandmarks3d(lm3d: readonly Landmark3d[], minVis = 0.5): Skeleton3D {
  // MediaPipe world (x right, y down, z away) to world (x dancer-left at yaw 0, y up, z to viewer).
  const pt = (i: number): Vec3 | null => {
    const p = lm3d[i];
    return p && (p[3] ?? 1) >= minVis ? [p[0], -p[1], -p[2]] : null;
  };
  const mid = (a: Vec3 | null, b: Vec3 | null) => (a && b ? scale(add(a, b), 0.5) : null);
  const lh = pt(23),
    rh = pt(24),
    ls = pt(11),
    rs = pt(12);
  const hipCenter = mid(lh, rh);
  const shoulderCenter = mid(ls, rs);
  const pos: Vec3 = hipCenter ?? [0, 0, 0];
  const yawDeg = yawOf(lh, rh) ?? yawOf(ls, rs);
  // Without a horizontal body axis there is no body system, so no bone can be expressed.
  if (yawDeg == null) return { root: { pos, yawDeg: 0 }, bones: {} };

  const at = (a: BoneAnchor) =>
    a === "hipCenter" ? hipCenter : a === "shoulderCenter" ? shoulderCenter : pt(a);
  const bones: Skeleton3D["bones"] = {};
  for (const id of BONE_IDS) {
    const [from, to] = BONE_ANCHORS[id];
    const a = at(from),
      b = at(to);
    if (!a || !b) continue;
    const dir = normalize(sub(b, a));
    if (dir) bones[id] = rotateYaw(dir, -yawDeg);
  }
  return { root: { pos, yawDeg }, bones };
}
