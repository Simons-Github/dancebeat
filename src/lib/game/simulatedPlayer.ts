import { frameAt } from "../pose";
import { gaussian } from "../random";
import type { AngleKey, Angles, Choreography } from "../types";

export { seededRandom } from "../random";

/**
 * Simulated player for tests and the dev-only simulation mode: the choreography's own angles at
 * time `t`, with Gaussian noise (`noiseDeg` = standard deviation) and a share of frames without any
 * pose (`missRate`, 1 = nobody in the picture). Never part of a production build: the play screen
 * only references it behind `import.meta.env.DEV`.
 */
export interface SimOptions {
  noiseDeg: number;
  missRate: number;
  /** Random numbers in [0, 1). Pass a seeded one for reproducible tests. */
  random?: () => number;
}

const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function simulatedAngles(
  choreo: Pick<Choreography, "frames">,
  t: number,
  opts: SimOptions,
): Angles | null {
  const random = opts.random ?? Math.random;
  if (opts.missRate > 0 && random() < opts.missRate) return null;
  const angles = frameAt(choreo.frames, t)?.angles;
  if (!angles) return null;
  const out: Angles = {};
  for (const k of Object.keys(angles) as AngleKey[]) {
    const v = angles[k];
    if (v == null) continue;
    out[k] = opts.noiseDeg > 0 ? wrap(v + gaussian(random) * opts.noiseDeg) : v;
  }
  return out;
}

/** Reads `?sim=1&noise=12&miss=0.2` style search params. Null when the mode is off. */
export function parseSimParams(search: Record<string, unknown>): SimOptions | null {
  const on = search["sim"];
  if (on !== 1 && on !== "1" && on !== true && on !== "true") return null;
  const num = (v: unknown, min: number, max: number, def: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return { noiseDeg: num(search["noise"], 0, 180, 0), missRate: num(search["miss"], 0, 1, 0) };
}
