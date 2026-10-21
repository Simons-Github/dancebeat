import type { Landmark } from "../types";
import { BONE_LENGTHS, FIGURE_UNITS_PER_METER, type BoneId, type Skeleton3D } from "./types";
import { add, rotateYaw, scale, type Vec3 } from "./vec";

/** Screen position of the pelvis centre at `root.pos` = 0, as in `figure()`. */
export const PROJECT_HIP: readonly [number, number] = [0.5, 0.58];

export interface ProjectView {
  /** Extra turn of the dancer in place (degrees, added to `root.yawDeg`); 90 = side view. */
  yawDeg?: number;
}

/**
 * Frontal orthographic projection of a skeleton with the standard bone lengths into the square
 * landmark space (mirror space: the dancer's left appears on the left of the screen at yaw 0).
 * Scale and centre follow `figure()`. Returns 33 landmarks; points that cannot be placed
 * (missing bone or parent) get visibility 0. Depth is dropped.
 */
export function project(sk: Skeleton3D, view: ProjectView = {}): Landmark[] {
  const yaw = sk.root.yawDeg + (view.yawDeg ?? 0);
  const pts: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  const set = (i: number, p: Vec3) =>
    (pts[i] = [
      PROJECT_HIP[0] - p[0] * FIGURE_UNITS_PER_METER,
      PROJECT_HIP[1] - p[1] * FIGURE_UNITS_PER_METER,
      1,
    ]);
  /** World point at `from` plus `f` times the bone's standard length along its direction. */
  const along = (from: Vec3 | null, bone: BoneId, f = 1): Vec3 | null => {
    const d = sk.bones[bone];
    return from && d ? add(from, scale(rotateYaw(d, yaw), BONE_LENGTHS[bone] * f)) : null;
  };

  const hipCenter = sk.root.pos;
  const joint = (i: number, p: Vec3 | null) => {
    if (p) set(i, p);
    return p;
  };
  const lh = joint(23, along(hipCenter, "hips", 0.5));
  const rh = joint(24, along(hipCenter, "hips", -0.5));
  // Without hips (and hence no torso) the shoulders are anchored upright above the pelvis. That
  // only places them; computeAngles then uses the image vertical anyway and leaves the
  // torso-based angles out. With hips but no torso the anchor would invent a torso axis, so
  // the upper body stays unplaced.
  const shoulderCenter =
    along(hipCenter, "torso") ??
    (sk.bones.hips ? null : add(hipCenter, [0, BONE_LENGTHS.torso, 0]));
  const ls = joint(11, along(shoulderCenter, "shoulders", 0.5));
  const rs = joint(12, along(shoulderCenter, "shoulders", -0.5));
  if (ls) joint(0, along(shoulderCenter, "neck"));

  const chain = (start: Vec3 | null, upper: BoneId, mid: number, lower: BoneId, end: number) =>
    joint(end, along(joint(mid, along(start, upper)), lower));
  chain(ls, "leftUpperArm", 13, "leftForearm", 15);
  chain(rs, "rightUpperArm", 14, "rightForearm", 16);
  chain(lh, "leftThigh", 25, "leftShin", 27);
  chain(rh, "rightThigh", 26, "rightShin", 28);
  return pts;
}
