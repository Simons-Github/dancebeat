import { lerpAngle } from "../pose";
import { BONE_IDS, type Skeleton3D } from "./types";
import { lerp3, slerp } from "./vec";

/**
 * Interpolates two skeletons (`t` clamped to 0..1): slerp per bone, root position linear,
 * yaw along the shortest arc. A bone missing on either side is missing in the result.
 */
export function interpolate(a: Skeleton3D, b: Skeleton3D, t: number): Skeleton3D {
  const k = Math.max(0, Math.min(1, t));
  const bones: Skeleton3D["bones"] = {};
  for (const id of BONE_IDS) {
    const va = a.bones[id],
      vb = b.bones[id];
    if (va && vb) bones[id] = slerp(va, vb, k);
  }
  return {
    root: {
      pos: lerp3(a.root.pos, b.root.pos, k),
      yawDeg: lerpAngle(a.root.yawDeg, b.root.yawDeg, k),
    },
    bones,
  };
}
