import { angleDiff, lerpAngle } from "./angle";
import { interpolate } from "./skeleton/interpolate";
import { project } from "./skeleton/project";
import { FIGURE_UNITS_PER_METER, type Skeleton3D } from "./skeleton/types";
import { normalize, type Vec3 } from "./skeleton/vec";
import type { AngleKey, Angles, Frame, Landmark } from "./types";

export const L = {
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  nose: 0,
};

export const BONES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

/**
 * Signed joint angles. Each angle is the rotation from a reference direction `ref` to a limb
 * segment `seg` ([from, to] landmark indices), in degrees within (-180, 180]. The reference is
 * either a segment or the torso axis (shoulder midpoint to hip midpoint).
 * - Shoulder/hip: 0 = limb along the torso axis, positive = away from the body (abduction).
 * - Elbow/knee: 0 = straight; the sign tells the bend direction, mirrored per side.
 * Signs are anatomical: they follow the body's own left/right axis, not the screen, so a raw
 * camera frame and its mirror image yield the same angles.
 */
export const ANGLE_SEGMENTS: Record<
  Exclude<AngleKey, "torsoLean">,
  { ref: [number, number] | "torso"; seg: [number, number]; side: 1 | -1 }
> = {
  leftShoulder: { ref: "torso", seg: [11, 13], side: 1 },
  rightShoulder: { ref: "torso", seg: [12, 14], side: -1 },
  leftElbow: { ref: [11, 13], seg: [13, 15], side: 1 },
  rightElbow: { ref: [12, 14], seg: [14, 16], side: -1 },
  leftHip: { ref: "torso", seg: [23, 25], side: 1 },
  rightHip: { ref: "torso", seg: [24, 26], side: -1 },
  leftKnee: { ref: [23, 25], seg: [25, 27], side: 1 },
  rightKnee: { ref: [24, 26], seg: [26, 28], side: -1 },
};

export const ARM_KEYS: AngleKey[] = ["leftElbow", "rightElbow", "leftShoulder", "rightShoulder"];
export const LEG_KEYS: AngleKey[] = ["leftHip", "rightHip", "leftKnee", "rightKnee"];

const vis = (p?: Landmark) => (p ? (p.length > 2 ? (p[2] as number) : 1) : 0);
export const isVisible = (p?: Landmark, min = 0.5) => !!p && vis(p) >= min;

const DEG = 180 / Math.PI;

export { angleDiff, lerpAngle };

export interface AngleOptions {
  /**
   * Source image width / height. Landmarks are normalized per axis (x by width, y by height),
   * so x must be stretched by this factor before measuring angles. Choreography landmarks
   * are stored in square space (aspect 1).
   */
  aspect?: number;
  minVis?: number;
}

/** Winkel sind skaleninvariant: Abstand zur Kamera spielt keine Rolle. Unsichtbare Gelenke fehlen. */
export function computeAngles(lm: Landmark[], opts: AngleOptions = {}): Angles {
  const aspect = opts.aspect ?? 1;
  const minVis = opts.minVis ?? 0.5;
  const out: Angles = {};
  const pt = (i: number): [number, number] | null => {
    const p = lm[i];
    return p && isVisible(p, minVis) ? [p[0] * aspect, p[1]] : null;
  };
  const ls = pt(11),
    rs = pt(12),
    lh = pt(23),
    rh = pt(24);
  // Body orientation needs both shoulders; without it no signed angle is defined.
  if (!ls || !rs) return out;
  const sx = (ls[0] + rs[0]) / 2,
    sy = (ls[1] + rs[1]) / 2;
  // Torso "down" axis; image down when the hips are not visible.
  const down: [number, number] =
    lh && rh ? [(lh[0] + rh[0]) / 2 - sx, (lh[1] + rh[1]) / 2 - sy] : [0, 1];
  const lateral: [number, number] = [ls[0] - rs[0], ls[1] - rs[1]];
  const turn = down[0] * lateral[1] - down[1] * lateral[0];
  if (turn === 0) return out;
  const h = Math.sign(turn);

  for (const [k, { ref, seg, side }] of Object.entries(ANGLE_SEGMENTS)) {
    const s0 = pt(seg[0]),
      s1 = pt(seg[1]);
    // Missing or low-visibility landmarks: the angle is unavailable and omitted.
    if (!s0 || !s1) continue;
    let rx = down[0],
      ry = down[1];
    if (ref !== "torso") {
      const r0 = pt(ref[0]),
        r1 = pt(ref[1]);
      if (!r0 || !r1) continue;
      rx = r1[0] - r0[0];
      ry = r1[1] - r0[1];
    }
    const vx = s1[0] - s0[0],
      vy = s1[1] - s0[1];
    const a = Math.atan2(rx * vy - ry * vx, rx * vx + ry * vy) * DEG * h * side;
    out[k as AngleKey] = (a <= -180 ? a + 360 : a) + 0; // + 0 turns -0 into 0
  }
  if (lh && rh) {
    // Positive = leaning toward the body's left side.
    out.torsoLean = Math.atan2(-down[0], down[1]) * DEG * -h + 0;
  }
  return out;
}

/** Zentriert auf Hüftmitte und skaliert nach Rumpflänge. */
export function normalizeLandmarks(lm: Landmark[]): Landmark[] {
  const lh = lm[23],
    rh = lm[24],
    ls = lm[11],
    rs = lm[12];
  if (!lh || !rh || !ls || !rs) return lm;
  const hx = (lh[0] + rh[0]) / 2,
    hy = (lh[1] + rh[1]) / 2;
  const sx = (ls[0] + rs[0]) / 2,
    sy = (ls[1] + rs[1]) / 2;
  const s = Math.hypot(sx - hx, sy - hy) || 1;
  return lm.map((p) => [(p[0] - hx) / s, (p[1] - hy) / s, vis(p)] as Landmark);
}

export function bodyCheck(lm: Landmark[] | null) {
  const ok = (i: number) => !!lm && isVisible(lm[i]);
  return {
    shoulders: ok(11) && ok(12),
    hips: ok(23) && ok(24),
    knees: ok(25) && ok(26),
    ankles: ok(27) && ok(28),
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Frames at most this far apart are interpolated linearly. Easing (smoothstep) suits sparse key
 * poses (demo choreos, ≥ 240 ms apart); on dense frames (video import every 50 ms, generator
 * every 100 ms) it would stop the motion at every frame, a visible 10–20 Hz stutter.
 */
export const DENSE_FRAME_GAP_MS = 150;

/** Interpolation weight for fraction `k` of a gap of `gapMs`: smoothstep, linear on dense frames. */
const easeFor = (k: number, gapMs: number) =>
  gapMs <= DENSE_FRAME_GAP_MS ? k : k * k * (3 - 2 * k);

/**
 * `pose3d` at time `t` between frames `lo` and `lo + 1`: interpolated (eased like the
 * landmarks) between the nearest frames with a 3D pose, which may skip at most one frame without
 * (the video import stores `pose3d` on every second frame). Otherwise there is none.
 */
function pose3dAt(frames: Frame[], lo: number, t: number): Skeleton3D | null {
  const a = frames[lo]?.pose3d ? frames[lo] : frames[lo - 1];
  const b = frames[lo + 1]?.pose3d ? frames[lo + 1] : frames[lo + 2];
  // Each side skips at most one frame, but together they may bridge only one.
  if (!a?.pose3d || !b?.pose3d || (a !== frames[lo] && b !== frames[lo + 1])) return null;
  const k = Math.max(0, Math.min(1, (t - a.timeMs) / (b.timeMs - a.timeMs || 1)));
  // On a frame with pose3d it is returned as is (interpolate would drop bones b lacks).
  if (k === 0) return a.pose3d;
  if (k === 1) return b.pose3d;
  return interpolate(a.pose3d, b.pose3d, easeFor(k, b.timeMs - a.timeMs));
}

export function frameAt(frames: Frame[], t: number): Frame | null {
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last) return null;
  if (t <= first.timeMs) return first;
  if (t >= last.timeMs) return last;
  let lo = 0,
    hi = frames.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    const fm = frames[m];
    if (!fm) return null;
    if (fm.timeMs <= t) lo = m;
    else hi = m;
  }
  const a = frames[lo],
    b = frames[hi];
  if (!a || !b) return null;
  const k = (t - a.timeMs) / (b.timeMs - a.timeMs || 1);
  const e = easeFor(k, b.timeMs - a.timeMs); // weiche Coach-Bewegung zwischen Schlüsselposen
  const landmarks = a.landmarks.map((p, i) => {
    const q = b.landmarks[i] ?? p;
    return [lerp(p[0], q[0], e), lerp(p[1], q[1], e), Math.min(vis(p), vis(q))] as Landmark;
  });
  const angles: Angles = {};
  for (const key of Object.keys(a.angles) as AngleKey[]) {
    const va = a.angles[key],
      vb = b.angles[key];
    if (va != null && vb != null) angles[key] = lerpAngle(va, vb, e);
  }
  const frame: Frame = { timeMs: t, landmarks, angles };
  const pose3d = pose3dAt(frames, lo, t);
  if (pose3d) frame.pose3d = pose3d;
  return frame;
}

/** Einfache Strichfigur aus Gliedmaßen-Winkeln (für eingebaute Demo-Choreos). */
export interface FigureParams {
  la: number;
  ra: number;
  le?: number;
  re?: number;
  ll?: number;
  rl?: number;
  lk?: number;
  rk?: number;
  lean?: number;
  dy?: number;
}

/**
 * The stick figure of `FigureParams` as a flat `Skeleton3D` (z = 0, facing the viewer). Limb
 * angles are measured in the screen plane from straight down, outward positive; `lean` tilts
 * the torso toward the dancer's right on screen, `dy` lowers the pelvis (square landmark units).
 */
export function figure3d(p: FigureParams): Skeleton3D {
  const rad = (d: number) => (d * Math.PI) / 180;
  // Screen direction (x right, y down, mirror space) to the body system (x dancer-left, y up).
  const dir = (sx: number, sy: number): Vec3 => normalize([0 - sx, 0 - sy, 0]) ?? [0, -1, 0]; // 0 − x avoids −0
  const lean = rad(p.lean ?? 0);
  const limb = (ang: number, bend: number, side: -1 | 1): [Vec3, Vec3] => {
    const a = rad(ang) * side;
    const b = a + rad(bend) * side;
    return [dir(Math.sin(a), Math.cos(a)), dir(Math.sin(b), Math.cos(b))];
  };
  const [leftUpperArm, leftForearm] = limb(p.la, p.le ?? 0, -1);
  const [rightUpperArm, rightForearm] = limb(p.ra, p.re ?? 0, 1);
  const [leftThigh, leftShin] = limb(p.ll ?? 5, -(p.lk ?? 0), -1);
  const [rightThigh, rightShin] = limb(p.rl ?? 5, -(p.rk ?? 0), 1);
  return {
    root: { pos: [0, 0 - (p.dy ?? 0) / FIGURE_UNITS_PER_METER, 0], yawDeg: 0 },
    bones: {
      torso: dir(Math.sin(lean), -Math.cos(lean)),
      // Nose 0.09 above the shoulder centre, shifted along the lean (as in the old 2D figure;
      // with the fixed neck length the nose moves by < 0.002 up to 10° lean, ~0.0024 at 15°).
      neck: dir(Math.sin(lean) * 0.08, -0.09),
      shoulders: [1, 0, 0],
      hips: [1, 0, 0],
      leftUpperArm,
      leftForearm,
      rightUpperArm,
      rightForearm,
      leftThigh,
      leftShin,
      rightThigh,
      rightShin,
    },
  };
}

/** 2D landmarks of `figure3d(p)` (frontal projection, hip centre at y = 0.58 + dy). */
export const figure = (p: FigureParams): Landmark[] => project(figure3d(p));
