/**
 * Evaluation bench for generated choreographies (Etappe 13g): runs `choreoMetrics` over a grid of
 * BPM, difficulty and seeds, plus the old auto choreography as baseline. Pure logic; the CLI is
 * eval-choreo.ts. Generator and baseline are passed in, so this module needs neither.
 */
import type { GenerationInput } from "../src/lib/generator/types.ts";
import {
  aggregate,
  choreoMetrics,
  type ChoreoMetrics,
  type MetricsAggregate,
  type SimParams,
} from "../src/lib/generator/metrics.ts";
import { hashSeed } from "../src/lib/random.ts";
import type { Choreography, MotionPack } from "../src/lib/types.ts";

type ChoreoLike = Pick<Choreography, "frames" | "moves">;
type Difficulty = GenerationInput["difficulty"];

export const DEFAULT_BPMS = [90, 110, 128, 150];
export const DIFFICULTIES: readonly Difficulty[] = [1, 2, 3];
export const DEFAULT_SEEDS = 20;
export const DURATION_MS = 180_000;
/** Simulated player of the bench: 10° noise, every tenth sample without a pose. */
export const SIM_NOISE_DEG = 10;
export const SIM_MISS_RATE = 0.1;

export interface EvalParams {
  bpms: number[];
  seeds: number;
  durationMs: number;
  style: string;
  /** Skip the generator (baseline only, e.g. before the generator exists). */
  baselineOnly: boolean;
  /** Simulated player; defaults SIM_NOISE_DEG and SIM_MISS_RATE. */
  noiseDeg?: number;
  missRate?: number;
}

export interface EvalRow {
  source: "generator" | "baseline";
  bpm: number;
  /** null for the baseline (it has no difficulty). */
  difficulty: Difficulty | null;
  seed: string;
  metrics: ChoreoMetrics;
}

export interface EvalGroup {
  source: EvalRow["source"];
  bpm: number;
  difficulty: Difficulty | null;
  aggregate: MetricsAggregate;
}

export interface EvalDeps {
  pack: MotionPack;
  generate?: (input: GenerationInput) => ChoreoLike;
  baseline: (bpm: number, durationMs: number) => ChoreoLike;
}

export const seedName = (i: number) => `seed-${i}`;

/** Simulated player for a run; its noise seed follows the generator seed. */
export const simFor = (
  seed: string,
  params: Pick<EvalParams, "noiseDeg" | "missRate"> = {},
): SimParams => ({
  noiseDeg: params.noiseDeg ?? SIM_NOISE_DEG,
  missRate: params.missRate ?? SIM_MISS_RATE,
  seed: hashSeed(seed),
});

/**
 * All runs: per BPM the baseline (built once, scored with every seed's simulated player) and,
 * unless `baselineOnly`, the generator per difficulty and seed (beat phase 0).
 */
export function runEval(params: EvalParams, deps: EvalDeps): EvalRow[] {
  const seeds = Array.from({ length: params.seeds }, (_, i) => seedName(i));
  const rows: EvalRow[] = [];
  for (const bpm of params.bpms) {
    const base = deps.baseline(bpm, params.durationMs);
    for (const seed of seeds) {
      const metrics = choreoMetrics(base, { pack: deps.pack, sim: simFor(seed, params) });
      rows.push({ source: "baseline", bpm, difficulty: null, seed, metrics });
    }
    if (params.baselineOnly || !deps.generate) continue;
    for (const difficulty of DIFFICULTIES) {
      for (const seed of seeds) {
        const choreo = deps.generate({
          bpm,
          beatPhaseMs: 0,
          durationMs: params.durationMs,
          style: params.style,
          difficulty,
          seed,
        });
        const metrics = choreoMetrics(choreo, { pack: deps.pack, sim: simFor(seed, params) });
        rows.push({ source: "generator", bpm, difficulty, seed, metrics });
      }
    }
  }
  return rows;
}

/** Rows grouped by source, BPM and difficulty (in first-seen order) and aggregated. */
export function groupRows(rows: readonly EvalRow[]): EvalGroup[] {
  const groups = new Map<string, { head: EvalRow; metrics: ChoreoMetrics[] }>();
  for (const r of rows) {
    const key = `${r.source}|${r.bpm}|${r.difficulty ?? "-"}`;
    const g = groups.get(key);
    if (g) g.metrics.push(r.metrics);
    else groups.set(key, { head: r, metrics: [r.metrics] });
  }
  return [...groups.values()].map(({ head, metrics }) => ({
    source: head.source,
    bpm: head.bpm,
    difficulty: head.difficulty,
    aggregate: aggregate(metrics),
  }));
}

interface Column {
  head: string;
  cell: (g: EvalGroup) => string;
}

const fix = (v: number, d: number) => v.toFixed(d);

/** Table columns: means over the seeds, except "max °/s" (highest) and "min Quote" (lowest). */
const COLUMNS: readonly Column[] = [
  { head: "Quelle", cell: (g) => (g.source === "baseline" ? "alt" : "Generator") },
  { head: "BPM", cell: (g) => String(g.bpm) },
  { head: "Stufe", cell: (g) => (g.difficulty === null ? "–" : String(g.difficulty)) },
  { head: "Läufe", cell: (g) => String(g.aggregate.runs) },
  { head: "Moves", cell: (g) => fix(g.aggregate.mean.moves, 1) },
  { head: "Moves/min", cell: (g) => fix(g.aggregate.mean.movesPerMin, 1) },
  { head: "Gold", cell: (g) => fix(g.aggregate.mean.golds, 1) },
  { head: "Messbar", cell: (g) => fix(g.aggregate.mean.measurableShare, 2) },
  { head: "Schritt °", cell: (g) => fix(g.aggregate.mean.meanStepDeg, 1) },
  { head: "Wiederh.", cell: (g) => fix(g.aggregate.mean.repeatRate, 2) },
  { head: "Abdeckung", cell: (g) => fix(g.aggregate.mean.coverage, 2) },
  { head: "max °/s", cell: (g) => fix(g.aggregate.maxSpeedDegPerS, 0) },
  { head: "p95 °/s", cell: (g) => fix(g.aggregate.mean.p95SpeedDegPerS, 0) },
  { head: "Quote sim", cell: (g) => fix(g.aggregate.mean.simRatio, 3) },
  { head: "min Quote", cell: (g) => fix(g.aggregate.minSimRatio, 3) },
  { head: "Perfekt", cell: (g) => fix(g.aggregate.mean.perfectShare, 2) },
  { head: "Sterne", cell: (g) => fix(g.aggregate.mean.simStars, 2) },
];

/** Plain-text table with right-aligned columns (first column left-aligned). */
export function formatTable(groups: readonly EvalGroup[]): string {
  const cells = [COLUMNS.map((c) => c.head), ...groups.map((g) => COLUMNS.map((c) => c.cell(g)))];
  const widths = COLUMNS.map((_, i) => Math.max(...cells.map((row) => row[i]!.length)));
  const line = (row: string[]) =>
    row.map((s, i) => (i === 0 ? s.padEnd(widths[i]!) : s.padStart(widths[i]!))).join(" | ");
  return [
    line(cells[0]!),
    widths.map((w) => "-".repeat(w)).join("-|-"),
    ...cells.slice(1).map(line),
  ].join("\n");
}

/** "90,128" → [90, 128]; throws on anything that is not a list of BPM within 30..300. */
export function parseBpms(text: string): number[] {
  const values = text.split(",").map((s) => Number(s.trim()));
  if (!values.length || values.some((v) => !Number.isFinite(v) || v < 30 || v > 300)) {
    throw new Error("--bpm: erwartet BPM-Werte zwischen 30 und 300, durch Kommas getrennt.");
  }
  return values;
}

/** "5" → 5; throws unless a whole number ≥ 1. */
export function parseSeeds(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new Error("--seeds: erwartet eine ganze Zahl ≥ 1.");
  return n;
}

/** A number option within [min, max]; German error otherwise. */
export function parseNumber(text: string, name: string, min: number, max: number): number {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n) || n < min || n > max)
    throw new Error(`--${name}: erwartet eine Zahl von ${min} bis ${max}.`);
  return n;
}
