/** Small 3D vector helpers for the skeleton core (no external math library). */
export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
const EPS = 1e-6;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Unit vector in the direction of `a`, or null for a (near) zero vector. */
export function normalize(a: Vec3): Vec3 | null {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : null;
}

/** cos and sin of an angle in degrees, exact for multiples of 90° (side and back views). */
function cosSin(deg: number): [number, number] {
  const q = deg / 90;
  if (Number.isInteger(q)) {
    const k = ((q % 4) + 4) % 4;
    return k === 0 ? [1, 0] : k === 1 ? [0, 1] : k === 2 ? [-1, 0] : [0, -1];
  }
  return [Math.cos(deg * DEG), Math.sin(deg * DEG)];
}

/**
 * Rotates `v` about the vertical y axis by `deg` (right-hand rule, y up). With the body system
 * (x left, y up, z forward), +90° turns the forward axis onto +x, i.e. toward the body's left.
 */
export function rotateYaw(v: Vec3, deg: number): Vec3 {
  const [c, s] = cosSin(deg);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/**
 * Spherical interpolation between unit vectors. Endpoints are returned exactly. For opposite
 * directions the rotation plane is undefined; the path then passes through the forward axis
 * (z) where possible, otherwise through the up axis, so the result never contains NaN.
 */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t <= 0) return [a[0], a[1], a[2]];
  if (t >= 1) return [b[0], b[1], b[2]];
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d > 1 - EPS) return normalize(lerp3(a, b, t)) ?? [a[0], a[1], a[2]];
  if (d < -1 + EPS) {
    const pick = (axis: Vec3) => normalize(sub(axis, scale(a, dot(axis, a))));
    const m = pick([0, 0, 1]) ?? pick([0, 1, 0]) ?? [1, 0, 0];
    const th = Math.PI * t;
    return normalize(add(scale(a, Math.cos(th)), scale(m, Math.sin(th)))) ?? m;
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const v = add(scale(a, Math.sin((1 - t) * th) / s), scale(b, Math.sin(t * th) / s));
  return normalize(v) ?? [a[0], a[1], a[2]];
}
