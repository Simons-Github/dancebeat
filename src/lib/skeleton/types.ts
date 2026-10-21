import type { Vec3 } from "./vec";

/**
 * The 12 bones of `Skeleton3D`. Limb bones point away from the body (shoulder to elbow, ...),
 * `torso` from pelvis centre to shoulder centre, `neck` from shoulder centre to the nose, and
 * the two axes `shoulders`/`hips` from the right to the left joint.
 */
export type BoneId =
  | "torso"
  | "neck"
  | "shoulders"
  | "hips"
  | "leftUpperArm"
  | "leftForearm"
  | "rightUpperArm"
  | "rightForearm"
  | "leftThigh"
  | "leftShin"
  | "rightThigh"
  | "rightShin";

export const BONE_IDS: readonly BoneId[] = [
  "torso",
  "neck",
  "shoulders",
  "hips",
  "leftUpperArm",
  "leftForearm",
  "rightUpperArm",
  "rightForearm",
  "leftThigh",
  "leftShin",
  "rightThigh",
  "rightShin",
];

/** Bone endpoints: MediaPipe landmark index, or the hip/shoulder midpoint. */
export type BoneAnchor = number | "hipCenter" | "shoulderCenter";

export const BONE_ANCHORS: Record<BoneId, [from: BoneAnchor, to: BoneAnchor]> = {
  torso: ["hipCenter", "shoulderCenter"],
  neck: ["shoulderCenter", 0],
  shoulders: [12, 11],
  hips: [24, 23],
  leftUpperArm: [11, 13],
  leftForearm: [13, 15],
  rightUpperArm: [12, 14],
  rightForearm: [14, 16],
  leftThigh: [23, 25],
  leftShin: [25, 27],
  rightThigh: [24, 26],
  rightShin: [26, 28],
};

/** Left/right bone pairs, used for mirroring. */
export const BONE_PAIRS: [BoneId, BoneId][] = [
  ["leftUpperArm", "rightUpperArm"],
  ["leftForearm", "rightForearm"],
  ["leftThigh", "rightThigh"],
  ["leftShin", "rightShin"],
];

/**
 * A body pose as bone directions.
 * - `root.pos`: pelvis centre in metres relative to the start point, world system (x toward
 *   the dancer's left at yaw 0, y up, z toward the viewer).
 * - `root.yawDeg`: facing direction about the vertical; 0 = facing the viewer, positive = turned
 *   toward the dancer's own left.
 * - `bones`: unit vectors in the body system (x left of the dancer, y up, z forward). A missing
 *   entry means the bone is unknown (joint not visible), never a zero vector.
 */
export interface Skeleton3D {
  root: { pos: Vec3; yawDeg: number };
  bones: Partial<Record<BoneId, Vec3>>;
}

/** Figure units (square landmark space) per metre; torso 0.22 in `figure()` = 0.5 m. */
export const FIGURE_UNITS_PER_METER = 0.44;

const m = (figureUnits: number) => figureUnits / FIGURE_UNITS_PER_METER;

/** Standard bone lengths in metres, with the proportions of `figure()` in `src/lib/pose.ts`. */
export const BONE_LENGTHS: Record<BoneId, number> = {
  torso: m(0.22),
  neck: m(0.09),
  shoulders: m(0.16),
  hips: m(0.1),
  leftUpperArm: m(0.13),
  leftForearm: m(0.13),
  rightUpperArm: m(0.13),
  rightForearm: m(0.13),
  leftThigh: m(0.17),
  leftShin: m(0.17),
  rightThigh: m(0.17),
  rightShin: m(0.17),
};
