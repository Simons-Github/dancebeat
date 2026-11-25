// Builds the choreographies of the demo songs (run: `bun run build-demo src/data/demos/*.manifest.json`):
// reads each manifest, builds the choreography with the motion pack (src/lib/demoBuild.ts) and
// writes <slug>.choreo.json next to it (compact JSON, checked against ChoreographySchema).
// Options: --pack=path (motion pack, default src/data/motion-pack.json).
// See docs/choreography-format.md#demo-pipeline.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { buildDemoChoreo } from "../src/lib/demoBuild.ts";
import { DemoManifestSchema } from "../src/lib/demoManifest.ts";
import { ChoreographySchema, MotionPackSchema } from "../src/lib/schema.ts";

/**
 * Target size of one shipped choreography. Raised from 1 MB in Etappe 14e: AIST++ clips have more
 * keyframes and repeat less (about 170–280 kB gzip per song instead of 25–120 kB).
 */
const MAX_BYTES = 2_000_000;
const MANIFEST_SUFFIX = ".manifest.json";

const { values, positionals } = parseArgs({
  options: { pack: { type: "string" } },
  allowPositionals: true,
});
if (!positionals.length) {
  console.error("Aufruf: bun run build-demo <manifest.json …> [--pack=path]");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const pack = MotionPackSchema.parse(
  JSON.parse(
    readFileSync(path.resolve(values.pack ?? path.join(root, "src/data/motion-pack.json")), "utf8"),
  ),
);

let failed = false;
for (const file of positionals) {
  if (!file.endsWith(MANIFEST_SUFFIX)) {
    console.error(`${file}: keine ${MANIFEST_SUFFIX}-Datei`);
    failed = true;
    continue;
  }
  try {
    const manifest = DemoManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    const choreo = ChoreographySchema.parse(buildDemoChoreo(manifest, pack));
    const out = file.slice(0, -MANIFEST_SUFFIX.length) + ".choreo.json";
    const json = JSON.stringify(choreo);
    writeFileSync(out, json);
    const bytes = Buffer.byteLength(json);
    const gold = choreo.moves.filter((m) => m.gold).length;
    console.log(
      `${path.relative(root, out)}: ${choreo.moves.length} Moves (${gold} Gold), ` +
        `${choreo.frames.length} Frames, ${(bytes / 1e6).toFixed(2)} MB`,
    );
    if (bytes > MAX_BYTES) console.warn(`  Warnung: größer als ${MAX_BYTES / 1e6} MB`);
  } catch (e) {
    console.error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
  }
}
if (failed) process.exit(1);
