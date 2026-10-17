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

export const ANGLE_DEFS: Record<Exclude<AngleKey, "torsoLean">, [number, number, number]> = {
  leftElbow: [11, 13, 15],
  rightElbow: [12, 14, 16],
  leftShoulder: [23, 11, 13],
  rightShoulder: [24, 12, 14],
  leftHip: [11, 23, 25],
  rightHip: [12, 24, 26],
  leftKnee: [23, 25, 27],
  rightKnee: [24, 26, 28],
};

export const ARM_KEYS: AngleKey[] = ["leftElbow", "rightElbow", "leftShoulder", "rightShoulder"];
export const LEG_KEYS: AngleKey[] = ["leftHip", "rightHip", "leftKnee", "rightKnee"];

const vis = (p?: Landmark) => (p ? (p.length > 2 ? (p[2] as number) : 1) : 0);
export const isVisible = (p?: Landmark, min = 0.5) => !!p && vis(p) >= min;

function angleAt(a: Landmark, b: Landmark, c: Landmark) {
  const v1x = a[0] - b[0],
    v1y = a[1] - b[1],
    v2x = c[0] - b[0],
    v2y = c[1] - b[1];
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180) / Math.PI;
}

/** Winkel sind skaleninvariant: Abstand zur Kamera spielt keine Rolle. Unsichtbare Gelenke fehlen. */
export function computeAngles(lm: Landmark[], minVis = 0.5): Angles {
  const out: Angles = {};
  for (const [k, [a, b, c]] of Object.entries(ANGLE_DEFS)) {
    const pa = lm[a],
      pb = lm[b],
      pc = lm[c];
    // Missing or low-visibility landmarks: the angle is unavailable and omitted.
    if (pa && pb && pc && isVisible(pa, minVis) && isVisible(pb, minVis) && isVisible(pc, minVis))
      out[k as AngleKey] = angleAt(pa, pb, pc);
  }
  const ls = lm[11],
    rs = lm[12],
    lh = lm[23],
    rh = lm[24];
  if (ls && rs && lh && rh && [ls, rs, lh, rh].every((p) => isVisible(p, minVis))) {
    const sx = (ls[0] + rs[0]) / 2,
      sy = (ls[1] + rs[1]) / 2;
    const hx = (lh[0] + rh[0]) / 2,
      hy = (lh[1] + rh[1]) / 2;
    out.torsoLean = (Math.atan2(sx - hx, hy - sy) * 180) / Math.PI;
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
  const e = k * k * (3 - 2 * k); // smoothstep für weiche Coach-Bewegung
  const landmarks = a.landmarks.map((p, i) => {
    const q = b.landmarks[i] ?? p;
    return [lerp(p[0], q[0], e), lerp(p[1], q[1], e), Math.min(vis(p), vis(q))] as Landmark;
  });
  const angles: Angles = {};
  for (const key of Object.keys(a.angles) as AngleKey[]) {
    const va = a.angles[key],
      vb = b.angles[key];
    if (va != null && vb != null) angles[key] = lerp(va, vb, e);
  }
  return { timeMs: t, landmarks, angles };
}

/** Einfache 2D-Strichfigur aus Gliedmaßen-Winkeln (für eingebaute Demo-Choreos). */
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
export function figure(p: FigureParams): Landmark[] {
  const rad = (d: number) => (d * Math.PI) / 180;
  const lean = rad(p.lean ?? 0);
  const dy = p.dy ?? 0;
  const pts: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  const hipY = 0.58 + dy;
  const hipC: [number, number] = [0.5, hipY];
  const torso = 0.22;
  const shC: [number, number] = [
    hipC[0] + Math.sin(lean) * torso,
    hipC[1] - Math.cos(lean) * torso,
  ];
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
    const o = pts[from];
    if (!o) return;
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
