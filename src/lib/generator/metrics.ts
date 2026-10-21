import { measurableAngles } from "../motionPack";
import { ANGLE_SEGMENTS, angleDiff, frameAt } from "../pose";
import { seededRandom } from "../random";
import { MOVE_WINDOW_MS, Scorer, type ScoreSnapshot } from "../scorer";
import { simulatedAngles } from "../game/simulatedPlayer";
import type { AngleKey, Angles, Choreography, MotionPack } from "../types";

/**
 * Metrics of a choreography for the evaluation bench (Etappe 13g, scripts/eval-choreo.ts):
 * playability, variety, coverage of the motion pack, speed and the score of a simulated player.
 * Pure logic without browser APIs; works for generated (with `pose3d`) and legacy (flat 2D)
 * choreographies alike.
 */

/** Consecutive move targets closer than this (max limb angle difference) count as a repeat. */
export const REPEAT_MAX_DEG = 5;
/** Pack clips below this energy are rest poses (neutral) and do not count for the coverage. */
export const REST_ENERGY = 0.1;
/** Sampling step of the angular speed (ms); fine enough to resolve a blend of a few beats. */
export const SPEED_STEP_MS = 20;
/** Percentile of the per-sample peak speed reported next to the noisy maximum. */
export const SPEED_PERCENTILE = 0.95;
/** Sampling step of the simulated player (ms): 30 fps like a phone camera. */
export const SIM_STEP_MS = 1000 / 30;

type ChoreoLike = Pick<Choreography, "frames" | "moves">;
type LimbKey = Exclude<AngleKey, "torsoLean">;
const LIMB_KEYS = Object.keys(ANGLE_SEGMENTS) as LimbKey[];

/** Simulated player of `simulateScore`: noise and dropout as in `simulatedAngles`, seeded. */
export interface SimParams {
  /** Standard deviation of the angle noise (degrees). */
  noiseDeg: number;
  /** Share of samples without any pose (0..1). */
  missRate: number;
  /** Seed of the noise, e.g. `hashSeed(generatorSeed)`. */
  seed: number;
}

export interface MetricsOptions {
  /** The pack the coverage is measured against. */
  pack: MotionPack;
  sim: SimParams;
}

export interface ChoreoMetrics {
  /** Number of moves. */
  moves: number;
  /** Moves per minute between the first and the last move: (moves − 1) / span; 0 below 2 moves. */
  movesPerMin: number;
  /** Number of gold moves. */
  golds: number;
  /** Mean over moves of the share (0..1) of the 8 limb angles safely measurable at the move. */
  measurableShare: number;
  /** Mean over consecutive move pairs of the mean |angle difference| of their targets (degrees). */
  meanStepDeg: number;
  /** Share (0..1) of consecutive move pairs whose targets differ by less than REPEAT_MAX_DEG. */
  repeatRate: number;
  /** Share (0..1) of the pack's non-rest clips (by `iconId`) used by at least one move. */
  coverage: number;
  /** Highest angular speed of any limb angle (degrees per second), sampled every SPEED_STEP_MS. */
  maxSpeedDegPerS: number;
  /** SPEED_PERCENTILE of the per-sample peak limb speed (degrees per second). */
  p95SpeedDegPerS: number;
  /** Score of the simulated player relative to the reference maximum (1 = all PERFECT at ×2). */
  simRatio: number;
  /** Stars (0..5) of the simulated player. */
  simStars: number;
  /** Share (0..1) of moves the simulated player gets PERFECT. */
  perfectShare: number;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Target angles of every move: the choreography's angles at the move time. */
const moveTargets = (c: ChoreoLike): Angles[] =>
  c.moves.map((m) => frameAt(c.frames, m.timeMs)?.angles ?? {});

/** |angle difference| (degrees) per limb angle present in both, in LIMB_KEYS order. */
function limbDiffs(a: Angles, b: Angles): number[] {
  const out: number[] = [];
  for (const k of LIMB_KEYS) {
    const va = a[k],
      vb = b[k];
    if (va != null && vb != null) out.push(Math.abs(angleDiff(va, vb)));
  }
  return out;
}

/** (moves − 1) per minute between the first and the last move; 0 below 2 moves or a zero span. */
export function movesPerMinute(c: ChoreoLike): number {
  const first = c.moves[0],
    last = c.moves[c.moves.length - 1];
  const span = first && last ? last.timeMs - first.timeMs : 0;
  return span > 0 ? ((c.moves.length - 1) * 60_000) / span : 0;
}

/**
 * Mean over moves of the measurable share of the 8 limb angles at the move time: with `pose3d`
 * `measurableAngles` (foreshortening in the frontal projection), else (flat legacy frames) the
 * limb angles present in the frame's `angles`. 0 without moves.
 */
export function measurableShare(c: ChoreoLike): number {
  return mean(
    c.moves.map((m) => {
      const f = frameAt(c.frames, m.timeMs);
      if (!f) return 0;
      const n = f.pose3d
        ? measurableAngles(f.pose3d).length
        : LIMB_KEYS.filter((k) => f.angles[k] != null).length;
      return n / LIMB_KEYS.length;
    }),
  );
}

/** Limb angle differences of every consecutive move pair with at least one common angle. */
function stepDiffs(c: ChoreoLike): number[][] {
  const targets = moveTargets(c);
  const out: number[][] = [];
  for (let i = 1; i < targets.length; i++) {
    const d = limbDiffs(targets[i - 1]!, targets[i]!);
    if (d.length) out.push(d);
  }
  return out;
}

/** Mean over consecutive move pairs of the mean |angle difference| of their targets (degrees). */
export const meanStepDeg = (c: ChoreoLike) => mean(stepDiffs(c).map(mean));

/** Share of consecutive move pairs whose largest limb angle difference is below REPEAT_MAX_DEG. */
export function repeatRate(c: ChoreoLike): number {
  const steps = stepDiffs(c);
  return steps.length
    ? steps.filter((d) => Math.max(...d) < REPEAT_MAX_DEG).length / steps.length
    : 0;
}

/**
 * Distinct move `iconId`s matching a pack clip, divided by the number of distinct `iconId`s of
 * pack clips with energy ≥ REST_ENERGY (rest poses excluded). 0 for a pack without such clips.
 */
export function coverage(c: ChoreoLike, pack: MotionPack): number {
  const usable = new Set(
    pack.clips.filter((cl) => cl.energy >= REST_ENERGY && cl.iconId).map((cl) => cl.iconId),
  );
  const used = new Set(c.moves.map((m) => m.iconId).filter((id) => usable.has(id)));
  return usable.size ? used.size / usable.size : 0;
}

/**
 * Peak limb angular speed (degrees per second) per sample step: `frameAt` every SPEED_STEP_MS
 * from the first to the last frame, the largest |Δangle| / Δt over limb angles present at both
 * ends of the step. Steps without a common angle are left out.
 */
export function speedSamples(c: Pick<Choreography, "frames">): number[] {
  const first = c.frames[0],
    last = c.frames[c.frames.length - 1];
  if (!first || !last) return [];
  const steps = Math.floor((last.timeMs - first.timeMs) / SPEED_STEP_MS);
  const out: number[] = [];
  let prev = frameAt(c.frames, first.timeMs)?.angles ?? {};
  for (let i = 1; i <= steps; i++) {
    const cur = frameAt(c.frames, first.timeMs + i * SPEED_STEP_MS)?.angles ?? {};
    const d = limbDiffs(prev, cur);
    if (d.length) out.push((Math.max(...d) * 1000) / SPEED_STEP_MS);
    prev = cur;
  }
  return out;
}

/** Nearest-rank percentile `p` (0..1) of `xs`; 0 for an empty list. */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

/**
 * Runs a `Scorer` (difficulty "normal") with the simulated player (`simulatedAngles`, seeded
 * with `sim.seed`) sampled every SIM_STEP_MS from 0 until every move window has closed.
 */
export function simulateScore(c: ChoreoLike, sim: SimParams): ScoreSnapshot {
  const scorer = new Scorer(c, "normal");
  const random = seededRandom(sim.seed);
  const opts = { noiseDeg: sim.noiseDeg, missRate: sim.missRate, random };
  const end = (c.moves[c.moves.length - 1]?.timeMs ?? 0) + MOVE_WINDOW_MS + SIM_STEP_MS;
  for (let i = 0; i * SIM_STEP_MS <= end; i++) {
    const t = i * SIM_STEP_MS;
    scorer.sample(t, simulatedAngles(c, t, opts));
  }
  return scorer.snapshot();
}

/** All metrics of one choreography, see `ChoreoMetrics`. */
export function choreoMetrics(c: ChoreoLike, opts: MetricsOptions): ChoreoMetrics {
  const speeds = speedSamples(c);
  const snap = simulateScore(c, opts.sim);
  const moves = c.moves.length;
  return {
    moves,
    movesPerMin: movesPerMinute(c),
    golds: c.moves.filter((m) => m.gold).length,
    measurableShare: measurableShare(c),
    meanStepDeg: meanStepDeg(c),
    repeatRate: repeatRate(c),
    coverage: coverage(c, opts.pack),
    maxSpeedDegPerS: speeds.length ? Math.max(...speeds) : 0,
    p95SpeedDegPerS: percentile(speeds, SPEED_PERCENTILE),
    simRatio: snap.ratio,
    simStars: snap.stars,
    perfectShare: moves ? snap.counts.PERFECT / moves : 0,
  };
}

export interface MetricsAggregate {
  /** Number of aggregated runs. */
  runs: number;
  /** Mean of every metric over the runs (0 for no runs). */
  mean: ChoreoMetrics;
  /** Lowest `simRatio` of any run: the worst case for the player. */
  minSimRatio: number;
  /** Highest `maxSpeedDegPerS` of any run (degrees per second). */
  maxSpeedDegPerS: number;
}

const METRIC_KEYS: readonly (keyof ChoreoMetrics)[] = [
  "moves",
  "movesPerMin",
  "golds",
  "measurableShare",
  "meanStepDeg",
  "repeatRate",
  "coverage",
  "maxSpeedDegPerS",
  "p95SpeedDegPerS",
  "simRatio",
  "simStars",
  "perfectShare",
];

/** Means over runs, plus the worst simulated score and the highest speed of any run. */
export function aggregate(rows: readonly ChoreoMetrics[]): MetricsAggregate {
  const meanRow = {} as ChoreoMetrics;
  for (const k of METRIC_KEYS) meanRow[k] = mean(rows.map((r) => r[k]));
  return {
    runs: rows.length,
    mean: meanRow,
    minSimRatio: rows.length ? Math.min(...rows.map((r) => r.simRatio)) : 0,
    maxSpeedDegPerS: rows.length ? Math.max(...rows.map((r) => r.maxSpeedDegPerS)) : 0,
  };
}
