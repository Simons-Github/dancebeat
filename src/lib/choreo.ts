import type { AngleKey, Angles, Choreography, Frame, Landmark } from "./types";

/** MediaPipe pose landmark pairs (left, right). Index 0 (nose) has no partner. */
const LR_PAIRS: [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];

const ANGLE_PAIRS: [AngleKey, AngleKey][] = [
  ["leftElbow", "rightElbow"],
  ["leftShoulder", "rightShoulder"],
  ["leftHip", "rightHip"],
  ["leftKnee", "rightKnee"],
];

/** Swaps left/right landmark labels; positions stay where they are on screen. */
export function mirrorLandmarks(lm: Landmark[]): Landmark[] {
  const out = lm.slice();
  for (const [l, r] of LR_PAIRS) {
    const pl = lm[l],
      pr = lm[r];
    if (pl && pr) {
      out[l] = pr;
      out[r] = pl;
    }
  }
  return out;
}

/** Swaps left/right angle keys and flips the lean direction (angles are anatomical). */
export function mirrorAngles(a: Angles): Angles {
  const out: Angles = {};
  for (const [l, r] of ANGLE_PAIRS) {
    const vl = a[l],
      vr = a[r];
    if (vr != null) out[l] = vr;
    if (vl != null) out[r] = vl;
  }
  if (a.torsoLean != null) out.torsoLean = a.torsoLean === 0 ? 0 : -a.torsoLean;
  return out;
}

/**
 * Mirrors a choreography: the player then does the reference dancer's movements as a mirror
 * image (their right arm for the dancer's left), which is how a recorded dancer facing the
 * camera is meant to be followed. Applying it twice restores the original.
 */
export function mirrorChoreo(c: Choreography): Choreography {
  const frame = (f: Frame): Frame => ({
    ...f,
    landmarks: mirrorLandmarks(f.landmarks),
    angles: mirrorAngles(f.angles),
  });
  return { ...c, frames: c.frames.map(frame) };
}
