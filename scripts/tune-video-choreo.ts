// Parameter search for the video import (run: `bun run tune-video <a.posetrack.json> …`).
// The files come from "Rohdaten exportieren" in the dev-mode video import; they stay local.
// Options (comma lists): --min-cutoff, --beta, --max-gap, --beats-per-move, --placement
// (grid,holds; compare the column "Bew. °/s"), --top.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { parsePoseTrackFile } from "../src/lib/poseTrackFile.ts";
import {
  DEFAULT_GRID,
  formatFileReport,
  formatOverall,
  gridPoints,
  overall,
  parseList,
  parsePlacements,
  tuneFile,
} from "./tuning.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "min-cutoff": { type: "string" },
    beta: { type: "string" },
    "max-gap": { type: "string" },
    "beats-per-move": { type: "string" },
    placement: { type: "string" },
    top: { type: "string" },
  },
});

if (!positionals.length) {
  console.error("Aufruf: bun run tune-video <datei.posetrack.json> [weitere …] [--beta=5,10,20]");
  process.exit(1);
}

const list = (key: keyof typeof values, fallback: number[]) => {
  const v = values[key];
  return typeof v === "string" ? parseList(v, key) : fallback;
};
const points = gridPoints({
  minCutoff: list("min-cutoff", DEFAULT_GRID.minCutoff),
  beta: list("beta", DEFAULT_GRID.beta),
  maxGapMs: list("max-gap", DEFAULT_GRID.maxGapMs),
  beatsPerMove: list("beats-per-move", DEFAULT_GRID.beatsPerMove),
  placement:
    typeof values.placement === "string"
      ? parsePlacements(values.placement)
      : DEFAULT_GRID.placement,
});
const top = list("top", [10])[0] ?? 10;

const results = positionals.map((p) => {
  const file = parsePoseTrackFile(readFileSync(path.resolve(p), "utf8"));
  const rows = tuneFile(file, points);
  console.log(formatFileReport(file, rows, top) + "\n");
  return rows;
});
if (results.length > 1) console.log(formatOverall(overall(results), top));
