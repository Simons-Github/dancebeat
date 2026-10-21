// Evaluation bench for generated choreographies (run: `bun run eval-choreo`). Generates a
// choreography per BPM, difficulty and seed with the motion pack (src/data/motion-pack.json),
// measures them (src/lib/generator/metrics.ts) and compares with the old auto choreography as
// baseline. Prints a table and writes all runs as JSON (default eval-results/eval-choreo.json,
// ignored by git). Options: --seeds=N, --bpm=90,128, --noise=DEG, --miss=0..1, --out=path,
// --baseline-only. At the default 10° noise every move of both variants is PERFECT (the scorer
// keeps the best pose of ±250 ms); --noise=30 separates them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { legacyAutoChoreo } from "../src/data/demo.ts";
import { DEFAULT_STYLE, generateChoreo } from "../src/lib/generator/index.ts";
import { MotionPackSchema } from "../src/lib/schema.ts";
import {
  DEFAULT_BPMS,
  DEFAULT_SEEDS,
  DIFFICULTIES,
  DURATION_MS,
  SIM_MISS_RATE,
  SIM_NOISE_DEG,
  formatTable,
  groupRows,
  parseBpms,
  parseNumber,
  parseSeeds,
  runEval,
  type EvalParams,
} from "./evalChoreo.ts";

const { values } = parseArgs({
  options: {
    seeds: { type: "string" },
    bpm: { type: "string" },
    out: { type: "string" },
    "baseline-only": { type: "boolean" },
    noise: { type: "string" },
    miss: { type: "string" },
  },
});

const root = path.resolve(import.meta.dirname, "..");
const pack = MotionPackSchema.parse(
  JSON.parse(readFileSync(path.join(root, "src/data/motion-pack.json"), "utf8")),
);
const params: EvalParams = {
  bpms: values.bpm ? parseBpms(values.bpm) : DEFAULT_BPMS,
  seeds: values.seeds ? parseSeeds(values.seeds) : DEFAULT_SEEDS,
  durationMs: DURATION_MS,
  style: DEFAULT_STYLE,
  baselineOnly: values["baseline-only"] ?? false,
  noiseDeg: values.noise ? parseNumber(values.noise, "noise", 0, 180) : SIM_NOISE_DEG,
  missRate: values.miss ? parseNumber(values.miss, "miss", 0, 1) : SIM_MISS_RATE,
};
const colors: [string, string] = ["#FF2E93", "#00E5FF"];

const started = performance.now();
const rows = runEval(params, {
  pack,
  generate: (input) => generateChoreo(input, pack),
  baseline: (bpm, durationMs) => legacyAutoChoreo("Basislinie", bpm, durationMs, colors),
});
const groups = groupRows(rows);
const seconds = (performance.now() - started) / 1000;

console.log(
  `Messplatz: ${params.bpms.join(", ")} BPM, Stufen ${params.baselineOnly ? "–" : DIFFICULTIES.join(", ")}, ` +
    `${params.seeds} Seeds, ${params.durationMs / 1000} s, Spieler-Simulation ${params.noiseDeg}° Rauschen, ` +
    `${(params.missRate ?? SIM_MISS_RATE) * 100} % Ausfall\n`,
);
console.log(formatTable(groups));
console.log(
  "\nMittel über die Seeds; „max °/s“ ist der höchste, „min Score“ der niedrigste Wert eines Laufs.",
);

const out = path.resolve(values.out ?? path.join(root, "eval-results/eval-choreo.json"));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      params: { ...params, sim: { noiseDeg: params.noiseDeg, missRate: params.missRate } },
      aggregates: groups,
      runs: rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `\n${rows.length} Läufe in ${seconds.toFixed(1)} s → ${path.relative(process.cwd(), out)}`,
);
