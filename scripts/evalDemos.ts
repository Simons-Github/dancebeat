/**
 * Playability bench of the shipped demo songs (Etappe 14c-2): builds every demo manifest at each
 * difficulty 1..3 (the manifest's own and the two others as overrides) and scores the result with
 * a seeded simulated player per seed. Pure logic; the CLI is eval-demos.ts. The build is passed
 * in, so this module needs neither the pack file nor the manifests on disk.
 *
 * The demo build is deterministic (seeded with the manifest id), so every seed only varies the
 * simulated player; speed, density and golds are the same for all seeds of a level.
 */
import type { DemoManifest } from "../src/lib/demoManifest.ts";
import {
  aggregate,
  choreoMetrics,
  type ChoreoMetrics,
  type MetricsAggregate,
} from "../src/lib/generator/metrics.ts";
import type { Choreography, MotionPack } from "../src/lib/types.ts";
import { seedName, simFor } from "./evalChoreo.ts";

type ChoreoLike = Pick<Choreography, "frames" | "moves">;
type Difficulty = DemoManifest["difficulty"];

export const DEMO_DIFFICULTIES: readonly Difficulty[] = [1, 2, 3];
export const DEFAULT_DEMO_SEEDS = 20;

export interface DemoEvalParams {
  seeds: number;
  /** Simulated player; defaults SIM_NOISE_DEG and SIM_MISS_RATE of evalChoreo.ts. */
  noiseDeg?: number;
  missRate?: number;
}

export interface DemoEvalDeps {
  pack: MotionPack;
  /** Build of a manifest, normally `buildDemoChoreo`; may throw for a level it cannot build. */
  build: (m: DemoManifest, pack: MotionPack) => ChoreoLike;
}

export interface DemoEvalRun {
  seed: string;
  metrics: ChoreoMetrics;
}

/** One manifest at one difficulty: its runs, or why it could not be built. */
export interface DemoEvalGroup {
  manifestId: string;
  title: string;
  difficulty: Difficulty;
  /** True for the difficulty the manifest ships with. */
  current: boolean;
  /** Build error (e.g. a fixed clip harder than the level); then `runs` is empty. */
  error: string | null;
  runs: DemoEvalRun[];
  /** null when not buildable. */
  aggregate: MetricsAggregate | null;
  /** Lowest stars of any run; null when not buildable. */
  minStars: number | null;
}

/**
 * Every manifest (in the given order) at every difficulty: built once with the difficulty
 * overridden, scored with each seed's simulated player. Build errors are reported, not thrown.
 */
export function runDemoEval(
  manifests: readonly DemoManifest[],
  params: DemoEvalParams,
  deps: DemoEvalDeps,
): DemoEvalGroup[] {
  const seeds = Array.from({ length: params.seeds }, (_, i) => seedName(i));
  const groups: DemoEvalGroup[] = [];
  for (const m of manifests) {
    for (const difficulty of DEMO_DIFFICULTIES) {
      const head = {
        manifestId: m.id,
        title: m.title,
        difficulty,
        current: difficulty === m.difficulty,
      };
      let choreo: ChoreoLike;
      try {
        choreo = deps.build({ ...m, difficulty }, deps.pack);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        groups.push({ ...head, error, runs: [], aggregate: null, minStars: null });
        continue;
      }
      const runs = seeds.map((seed) => ({
        seed,
        metrics: choreoMetrics(choreo, { pack: deps.pack, sim: simFor(seed, params) }),
      }));
      groups.push({
        ...head,
        error: null,
        runs,
        aggregate: aggregate(runs.map((r) => r.metrics)),
        minStars: runs.length ? Math.min(...runs.map((r) => r.metrics.simStars)) : null,
      });
    }
  }
  return groups;
}

interface Column {
  head: string;
  cell: (g: DemoEvalGroup, a: MetricsAggregate) => string;
}

const fix = (v: number, d: number) => v.toFixed(d);

/** Metric columns; means over the seeds, except "min Quote" and "min Sterne" (lowest run). */
const COLUMNS: readonly Column[] = [
  { head: "Läufe", cell: (_, a) => String(a.runs) },
  { head: "Moves", cell: (_, a) => fix(a.mean.moves, 0) },
  { head: "Moves/min", cell: (_, a) => fix(a.mean.movesPerMin, 1) },
  { head: "Gold", cell: (_, a) => fix(a.mean.golds, 0) },
  { head: "p95 °/s", cell: (_, a) => fix(a.mean.p95SpeedDegPerS, 0) },
  { head: "Quote sim", cell: (_, a) => fix(a.mean.simRatio, 3) },
  { head: "min Quote", cell: (_, a) => fix(a.minSimRatio, 3) },
  { head: "Perfekt", cell: (_, a) => fix(a.mean.perfectShare, 2) },
  { head: "Sterne", cell: (_, a) => fix(a.mean.simStars, 2) },
  { head: "min Sterne", cell: (g) => fix(g.minStars ?? 0, 0) },
];

/**
 * Plain-text table, one row per song and difficulty. The shipped difficulty is marked with "*";
 * levels that cannot be built show "nicht baubar" and their reason below the table.
 */
export function formatDemoTable(groups: readonly DemoEvalGroup[]): string {
  const heads = ["Song", "Stufe", ...COLUMNS.map((c) => c.head)];
  const notes: string[] = [];
  const rows = groups.map((g) => {
    const lead = [g.title, `${g.difficulty}${g.current ? "*" : ""}`];
    if (!g.aggregate) {
      notes.push(`${g.title}, Stufe ${g.difficulty}: ${g.error ?? "unbekannter Fehler"}`);
      return [...lead, "nicht baubar", ...COLUMNS.slice(1).map(() => "–")];
    }
    const a = g.aggregate;
    return [...lead, ...COLUMNS.map((c) => c.cell(g, a))];
  });
  const cells = [heads, ...rows];
  const widths = heads.map((_, i) => Math.max(...cells.map((row) => row[i]!.length)));
  const line = (row: string[]) =>
    row.map((s, i) => (i === 0 ? s.padEnd(widths[i]!) : s.padStart(widths[i]!))).join(" | ");
  const table = [line(heads), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(line)];
  return [...table, ...(notes.length ? ["", "Nicht baubar:", ...notes] : [])].join("\n");
}
