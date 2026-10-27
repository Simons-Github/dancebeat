// Evaluation bench for the video import (run: `bun run eval-video [a.posetrack.json …]`). Builds the
// choreography of every raw pose-track export like the import dialog and scores it with a
// simulated player (scripts/evalVideo.ts): self test, ¼ and ½ beat late, another video. Without
// arguments it reads every *.posetrack.json in $DANCEBEAT_POSETRACK_DIR (default Rohdaten/).
// The videos themselves stay outside the repo: with $DANCEBEAT_VIDEO_DIR (e.g. in .env.local,
// which bun loads and git ignores) and ffprobe installed, the frame times of each source video
// are read, so the player sees the frames the browser really showed. Options: --seeds=N,
// --noise=IMAGE_HEIGHTS, --jitter=MS, --miss=0..1, --fps=N, --variant=One-Euro|ohne One-Euro,
// --out=path (default eval-results/eval-video.json, ignored by git).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { parsePoseTrackFile } from "../src/lib/poseTrackFile.ts";
import { parseNumber, parseSeeds } from "./evalChoreo.ts";
import {
  DEFAULT_SIM,
  DEFAULT_VIDEO_SEEDS,
  VARIANTS,
  formatSummary,
  formatTimeErrors,
  formatVideoTable,
  runVideoEval,
  timeError,
  type EvalVideo,
  type EvalVideoParams,
  type VariantName,
} from "./evalVideo.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seeds: { type: "string" },
    noise: { type: "string" },
    jitter: { type: "string" },
    miss: { type: "string" },
    fps: { type: "string" },
    variant: { type: "string" },
    out: { type: "string" },
  },
});

const root = path.resolve(import.meta.dirname, "..");
const trackDir = path.resolve(root, process.env["DANCEBEAT_POSETRACK_DIR"] ?? "Rohdaten");
const files = positionals.length
  ? positionals.map((p) => path.resolve(p))
  : existsSync(trackDir)
    ? readdirSync(trackDir)
        .filter((f) => f.endsWith(".posetrack.json"))
        .sort()
        .map((f) => path.join(trackDir, f))
    : [];
if (!files.length) {
  console.error(
    "Keine Rohdaten: bun run eval-video <datei.posetrack.json> … oder DANCEBEAT_POSETRACK_DIR setzen.",
  );
  process.exit(1);
}

const videoDir = process.env["DANCEBEAT_VIDEO_DIR"];

/** Presentation times of the first video stream in ms, or undefined (no dir, file or ffprobe). */
function frameTimes(video: string): number[] | undefined {
  if (!videoDir) return undefined;
  const file = path.join(videoDir, path.basename(video));
  if (!existsSync(file)) {
    console.warn(`Video nicht gefunden: ${file} (Zeitfehler werden nicht gemessen)`);
    return undefined;
  }
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "frame=pts_time",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return out
      .split("\n")
      .map((l) => Number.parseFloat(l) * 1000)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  } catch {
    console.warn("ffprobe nicht verfügbar: Zeitfehler werden nicht gemessen.");
    return undefined;
  }
}

const videos: EvalVideo[] = files.map((f) => {
  const file = parsePoseTrackFile(readFileSync(f, "utf8"));
  const times = frameTimes(file.video);
  return {
    name: path.basename(f, ".posetrack.json"),
    file,
    ...(times ? { frameTimesMs: times } : {}),
  };
});

const variantArg = values.variant;
if (variantArg !== undefined && !(variantArg in VARIANTS)) {
  console.error(`Unbekannte Variante „${variantArg}“: ${Object.keys(VARIANTS).join(", ")}`);
  process.exit(1);
}
const params: EvalVideoParams = {
  seeds: values.seeds ? parseSeeds(values.seeds) : DEFAULT_VIDEO_SEEDS,
  sim: {
    fps: values.fps ? parseNumber(values.fps, "fps", 1, 240) : DEFAULT_SIM.fps,
    noise: values.noise ? parseNumber(values.noise, "noise", 0, 1) : DEFAULT_SIM.noise,
    jitterMs: values.jitter ? parseNumber(values.jitter, "jitter", 0, 1000) : DEFAULT_SIM.jitterMs,
    missRate: values.miss ? parseNumber(values.miss, "miss", 0, 1) : DEFAULT_SIM.missRate,
  },
  variants: variantArg ? [variantArg as VariantName] : (Object.keys(VARIANTS) as VariantName[]),
};

const started = performance.now();
const { rows, groups, summaries } = runVideoEval(videos, params);
const errors = videos.map(timeError).filter((e) => e !== null);
const seconds = (performance.now() - started) / 1000;

const { sim } = params;
console.log(
  `Video-Messplatz: ${videos.length} Videos, ${params.seeds} Seeds, Spieler ${sim.fps} fps, ` +
    `Rauschen ${sim.noise} Bildhöhen, Zeitfehler ${sim.jitterMs} ms, ${sim.missRate * 100} % Ausfall\n`,
);
console.log(formatVideoTable(groups));
console.log("\nAnteile der Urteile über alle Seeds; Sterne, Quote und Score gemittelt.\n");
console.log(formatSummary(summaries));
console.log("\nTrennschärfe = Quote „selbst“ − Quote „fremd“ (höher = besser).");
if (errors.length) {
  console.log("\nZeitstempel gegen das gezeigte Bild (ffprobe):\n");
  console.log(formatTimeErrors(errors));
}

const out = path.resolve(values.out ?? path.join(root, "eval-results/eval-video.json"));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    { params, summaries, timeErrors: errors, aggregates: groups, runs: rows },
    null,
    2,
  ) + "\n",
);
console.log(
  `\n${rows.length} Läufe in ${seconds.toFixed(1)} s → ${path.relative(process.cwd(), out)}`,
);
