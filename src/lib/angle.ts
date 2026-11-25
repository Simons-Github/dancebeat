/**
 * Angle helpers without dependencies, so both `pose` and `skeleton` can use them without an
 * import cycle. Re-exported from `pose`.
 */

/** Shortest signed difference a - b in degrees, in [-180, 180). */
export const angleDiff = (a: number, b: number) => ((((a - b + 180) % 360) + 360) % 360) - 180;

/** Interpolates along the shortest arc and returns a value in (-180, 180]. */
export function lerpAngle(a: number, b: number, t: number) {
  const r = a + angleDiff(b, a) * t;
  return r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
}
