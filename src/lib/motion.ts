import type { Difficulty } from "./scoring";
import type { Move, Rating } from "./types";

/**
 * Movement mode tuning (stage 6). Thresholds are mean linear acceleration in m/s² within a move
 * window. Starting values, to be tuned on a device.
 */
export const MOTION = {
  /** Minimum rating thresholds, highest first. Below OK: X. */
  thresholds: { PERFECT: 6, SUPER: 4, GOOD: 2.5, OK: 1.2 },
  /** Threshold multiplier per difficulty. */
  difficulty: { leicht: 0.7, normal: 1, schwer: 1.4 } satisfies Record<Difficulty, number>,
  /** Gold moves need this much more movement. */
  goldFactor: 1.25,
  /** Fewer measurements in a window: no value, the move is X. */
  minSamples: 3,
  /** Low-pass factor for the gravity estimate when only `accelerationIncludingGravity` exists. */
  gravityAlpha: 0.8,
  /** Ring buffer size (~10 s at 60 Hz); older measurements are dropped. */
  bufferSize: 600,
  /** After "granted": wait this long for a first real measurement before calling the sensor missing. */
  probeTimeoutMs: 1000,
} as const;

/** One axis triple as delivered by `DeviceMotionEvent` (axes may be null). */
export interface Vec3 {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface MotionSample {
  /** `event.acceleration` (without gravity). */
  linear: Vec3 | null;
  /** `event.accelerationIncludingGravity`, used with a high-pass when `linear` is missing. */
  withGravity: Vec3 | null;
}

const complete = (v: Vec3 | null): [number, number, number] | null =>
  v &&
  v.x != null &&
  v.y != null &&
  v.z != null &&
  Number.isFinite(v.x) &&
  Number.isFinite(v.y) &&
  Number.isFinite(v.z)
    ? [v.x, v.y, v.z]
    : null;

/**
 * Collects acceleration magnitudes filed under game time and averages them per window. The caller
 * stamps each measurement with the game clock; when that clock jumps back (seek, restart), the
 * caller must `reset()`.
 */
export class MotionMeter {
  private times: number[] = [];
  private values: number[] = [];
  private gravity: [number, number, number] | null = null;
  private last = -Infinity;

  /** Game time of the last accepted measurement (-Infinity before the first). */
  get lastSampleMs(): number {
    return this.last;
  }

  push(t: number, sample: MotionSample) {
    if (!Number.isFinite(t)) return;
    const g = complete(sample.withGravity);
    // Keep the gravity estimate current so a switch to the fallback has no spike.
    if (g) {
      const a = MOTION.gravityAlpha;
      const prev = this.gravity ?? g;
      this.gravity = [
        a * prev[0] + (1 - a) * g[0],
        a * prev[1] + (1 - a) * g[1],
        a * prev[2] + (1 - a) * g[2],
      ];
    }
    let v = complete(sample.linear);
    if (!v && g && this.gravity) {
      v = [g[0] - this.gravity[0], g[1] - this.gravity[1], g[2] - this.gravity[2]];
    }
    if (!v) return;
    this.times.push(t);
    this.values.push(Math.hypot(v[0], v[1], v[2]));
    if (this.times.length > MOTION.bufferSize) {
      this.times.shift();
      this.values.shift();
    }
    this.last = Math.max(this.last, t);
  }

  /** Mean magnitude in [fromMs, toMs]; null with fewer than `MOTION.minSamples` measurements. */
  intensity(fromMs: number, toMs: number): number | null {
    let sum = 0,
      n = 0;
    this.times.forEach((t, i) => {
      if (t < fromMs || t > toMs) return;
      sum += this.values[i] ?? 0;
      n++;
    });
    return n < MOTION.minSamples ? null : sum / n;
  }

  reset() {
    this.times = [];
    this.values = [];
    this.gravity = null;
    this.last = -Infinity;
  }
}

/** Rating for a window's mean intensity; null (not enough data) is X. */
export function judgeIntensity(
  value: number | null,
  difficulty: Difficulty = "normal",
  gold = false,
): Rating {
  if (value == null) return "X";
  const f = MOTION.difficulty[difficulty] * (gold ? MOTION.goldFactor : 1);
  const th = MOTION.thresholds;
  if (value >= th.PERFECT * f) return "PERFECT";
  if (value >= th.SUPER * f) return "SUPER";
  if (value >= th.GOOD * f) return "GOOD";
  if (value >= th.OK * f) return "OK";
  return "X";
}

/**
 * The game controller's `motion` dependency, backed by a meter. `difficulty` is read on every
 * rating (settings may load after the controller is created).
 */
export function motionScoring(meter: MotionMeter, difficulty: () => Difficulty) {
  return {
    rating: (move: Move, fromMs: number, toMs: number) =>
      judgeIntensity(meter.intensity(fromMs, toMs), difficulty(), move.gold),
    lastSampleMs: () => meter.lastSampleMs,
  };
}

export type MotionPermission = "granted" | "denied" | "unsupported";

interface IOSDeviceMotionEvent {
  requestPermission?: () => Promise<PermissionState>;
}

/**
 * Asks for sensor access. Call only from an event handler: iOS requires a user gesture for
 * `DeviceMotionEvent.requestPermission`, which is called synchronously here.
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof DeviceMotionEvent === "undefined") return "unsupported";
  const request = (DeviceMotionEvent as unknown as IOSDeviceMotionEvent).requestPermission;
  if (typeof request !== "function") return "granted";
  try {
    return (await request.call(DeviceMotionEvent)) === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export type PlayMode = "camera" | "motion";

/** Reads `?mode=motion` from the play route's search (production builds too). */
export function parsePlayMode(search: Record<string, unknown>): PlayMode {
  return search["mode"] === "motion" ? "motion" : "camera";
}

/**
 * Resolves true as soon as a `devicemotion` event carries a usable measurement, false after
 * `timeoutMs` without one (desktop, Android without sensor: no permission prompt, but no data).
 * Call only from event handlers, after `requestMotionPermission()`.
 */
export function probeMotionSensor(timeoutMs: number = MOTION.probeTimeoutMs): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      window.removeEventListener("devicemotion", onMotion);
      resolve(ok);
    };
    const onMotion = (e: DeviceMotionEvent) => {
      if (complete(e.acceleration ?? null) || complete(e.accelerationIncludingGravity ?? null))
        done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    window.addEventListener("devicemotion", onMotion);
  });
}
