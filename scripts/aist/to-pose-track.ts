// Turns AIST++ keypoint files into pose tracks v2 (Etappe 13h-1, run: `bun run aist-track
// --list=clips.json a.aist.json ...`). Input is the neutral JSON of the Python converter
// (`<clip name>.aist.json`, `{fps, joints}`, COCO-17 in cm); the clip list gives BPM and beat
// phase per clip name. Writes `<clip name>.posetrack.json` to eval-results/aist/ by default (both
// file types are ignored by git), ready for `bun run build-motion-pack -- eval-results/aist/*`.
// Logic: src/lib/aist.ts, format: docs/choreography-format.md#aist.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { AistClipListSchema, AistKeypointsSchema, aistPoseTrack } from "../../src/lib/aist.ts";

const { values, positionals } = parseArgs({
  options: { list: { type: "string" }, out: { type: "string" } },
  allowPositionals: true,
});

if (!values.list || positionals.length === 0) {
  console.error("Aufruf: bun run aist-track --list=clips.json [--out=Ordner] a.aist.json ...");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.resolve(values.out ?? path.join(root, "eval-results/aist"));
const describe = (e: unknown) =>
  e instanceof z.ZodError
    ? e.issues.map((i) => `${i.path.join(".") || "Datei"}: ${i.message}`).join("; ")
    : e instanceof Error
      ? e.message
      : String(e);

let clips;
try {
  clips = AistClipListSchema.parse(JSON.parse(readFileSync(values.list, "utf8")));
} catch (e) {
  console.error(`${values.list}: ${describe(e)}`);
  process.exit(1);
}
const byName = new Map(clips.map((c) => [c.name, c]));

mkdirSync(outDir, { recursive: true });
let failed = 0;
const written = new Set<string>();
for (const input of positionals) {
  const name = path.basename(input).replace(/\.aist\.json$/, "");
  // The output is named after the clip; a second input of the same clip would overwrite it.
  if (written.has(name)) {
    console.error(`${input}: ${name} schon umgewandelt, übersprungen`);
    failed++;
    continue;
  }
  written.add(name);
  const clip = byName.get(name);
  if (!clip) {
    console.error(`${input}: ${name} fehlt in der Clip-Liste, übersprungen`);
    failed++;
    continue;
  }
  try {
    const data = AistKeypointsSchema.parse(JSON.parse(readFileSync(input, "utf8")));
    const { file, warnings } = aistPoseTrack(data, clip, { now: Date.now() });
    const out = path.join(outDir, `${name}.posetrack.json`);
    writeFileSync(out, JSON.stringify(file));
    console.log(`${input}: ${file.track.samples.length} Proben, ${clip.bpm} BPM → ${out}`);
    for (const w of warnings) console.log(`  Warnung: ${w}`);
  } catch (e) {
    console.error(`${input}: ${describe(e)}`);
    failed++;
  }
}
if (failed > 0) process.exit(1);
