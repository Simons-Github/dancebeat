// Playability bench of the shipped demo songs (run: `bun run eval-demos`). Builds every manifest in
// src/data/demos at difficulty 1, 2 and 3 with the motion pack (src/data/motion-pack.json), scores
// each build with a simulated player per seed (src/lib/generator/metrics.ts) and prints a table;
// "*" marks the difficulty the manifest ships with. Writes all runs as JSON (default
// eval-results/eval-demos.json, ignored by git). Options: --seeds=N, --noise=DEG, --miss=0..1,
// --out=path, --pack=path (motion pack, default src/data/motion-pack.json). The sim stars follow
// the noise, not the song or level (the simulated error does not depend on the movement, see
// docs/scoring.md); density and speed columns are what tells the levels apart.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { buildDemoChoreo } from "../src/lib/demoBuild.ts";
import { DemoManifestSchema } from "../src/lib/demoManifest.ts";
import { MotionPackSchema } from "../src/lib/schema.ts";
import { SIM_MISS_RATE, SIM_NOISE_DEG, parseNumber, parseSeeds } from "./evalChoreo.ts";
import {
  DEFAULT_DEMO_SEEDS,
  DEMO_DIFFICULTIES,
  formatDemoTable,
  runDemoEval,
  type DemoEvalParams,
} from "./evalDemos.ts";

const { values } = parseArgs({
  options: {
    seeds: { type: "string" },
    out: { type: "string" },
    noise: { type: "string" },
    miss: { type: "string" },
    pack: { type: "string" },
  },
});

const root = path.resolve(import.meta.dirname, "..");
const pack = MotionPackSchema.parse(
  JSON.parse(
    readFileSync(path.resolve(values.pack ?? path.join(root, "src/data/motion-pack.json")), "utf8"),
  ),
);
const demoDir = path.join(root, "src/data/demos");
const manifests = readdirSync(demoDir)
  .filter((f) => f.endsWith(".manifest.json"))
  .sort()
  .map((f) => DemoManifestSchema.parse(JSON.parse(readFileSync(path.join(demoDir, f), "utf8"))));
const params: DemoEvalParams = {
  seeds: values.seeds ? parseSeeds(values.seeds) : DEFAULT_DEMO_SEEDS,
  noiseDeg: values.noise ? parseNumber(values.noise, "noise", 0, 180) : SIM_NOISE_DEG,
  missRate: values.miss ? parseNumber(values.miss, "miss", 0, 1) : SIM_MISS_RATE,
};

const started = performance.now();
const groups = runDemoEval(manifests, params, { pack, build: buildDemoChoreo });
const seconds = (performance.now() - started) / 1000;

console.log(
  `Demo-Messplatz: ${manifests.length} Songs, Stufen ${DEMO_DIFFICULTIES.join(", ")}, ` +
    `${params.seeds} Seeds, Spieler-Simulation ${params.noiseDeg}° Rauschen, ` +
    `${(params.missRate ?? SIM_MISS_RATE) * 100} % Ausfall\n`,
);
console.log(formatDemoTable(groups));
console.log(
  "\n* = Stufe des Manifests. Mittel über die Seeds; „min Quote“ und „min Sterne“ sind der " +
    "niedrigste Wert eines Laufs. Der Build ist je Stufe fest, die Seeds variieren nur den Spieler.",
);

const out = path.resolve(values.out ?? path.join(root, "eval-results/eval-demos.json"));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ params, groups }, null, 2) + "\n");
const runs = groups.reduce((n, g) => n + g.runs.length, 0);
console.log(`\n${runs} Läufe in ${seconds.toFixed(1)} s → ${path.relative(process.cwd(), out)}`);
