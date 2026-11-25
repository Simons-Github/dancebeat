import { lerpAngle } from "../angle";
import { BONE_IDS, type BoneId, type Skeleton3D } from "./types";
import { lerp3, rotateBetween, slerp } from "./vec";

/** Child bones interpolated relative to their parent: forearm to upper arm, shin to thigh. */
const PARENT: Partial<Record<BoneId, BoneId>> = {
  leftForearm: "leftUpperArm",
  rightForearm: "rightUpperArm",
  leftShin: "leftThigh",
  rightShin: "rightThigh",
};

/**
 * Interpolates two skeletons (`t` clamped to 0..1): slerp per bone, root position linear,
 * yaw along the shortest arc. Forearms and shins move relative to their parent bone: the child's
 * direction in b is first turned back by the parent's rotation from a to b, slerped in that
 * frame and then turned along with the interpolated parent. So the elbow and knee bend evenly
 * instead of the forearm taking its own shortest path (with arm and forearm turning the opposite
 * way, that path folds the joint through itself). Without the parent on both sides the child is
 * slerped on its own. A bone missing on either side is missing in the result.
 */
export function interpolate(a: Skeleton3D, b: Skeleton3D, t: number): Skeleton3D {
  const k = Math.max(0, Math.min(1, t));
  const bones: Skeleton3D["bones"] = {};
  for (const id of BONE_IDS) {
    const va = a.bones[id],
      vb = b.bones[id];
    if (!va || !vb) continue;
    const parent = PARENT[id];
    const pa = parent && a.bones[parent],
      pb = parent && b.bones[parent];
    if (pa && pb) {
      const pt = slerp(pa, pb, k);
      bones[id] = rotateBetween(pa, pt, slerp(va, rotateBetween(pb, pa, vb), k));
    } else bones[id] = slerp(va, vb, k);
  }
  return {
    root: {
      pos: lerp3(a.root.pos, b.root.pos, k),
      yawDeg: lerpAngle(a.root.yawDeg, b.root.yawDeg, k),
    },
    bones,
  };
}
