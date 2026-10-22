// Builds the motion pack (run: `bun run build-motion-pack`). Without arguments it writes
// src/data/motion-pack.json from the demo poses and demo song sequences; prints the clip count
// and rejected clips. Rerun after changing the poses, the sources or the thresholds (the test
// src/test/motionPack.test.ts fails while the committed file is stale).
//
// Video tracks (Etappe 13e-2): `bun run build-motion-pack [--style=party] [--out=path]
// a.posetrack.json ...` adds clips cut from dev-exported pose tracks (src/lib/motionPackVideo.ts)
// to the demo source and writes eval-results/motion-pack.video.json by default (ignored by git;
// test it with `bun run eval-choreo --pack=...`). Such a pack is never written to src/data: the
// rights to third-party choreographies are unclear, shipping video clips needs a decision.
// Logic: src/lib/motionPack.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { DEMO_POSES, DEMO_SEQUENCES } from "../src/data/demo.ts";
import { buildMotionPack, demoMotionSource, type MotionSource } from "../src/lib/motionPack.ts";
import { videoMotionSource } from "../src/lib/motionPackVideo.ts";
import { figure3d } from "../src/lib/pose.ts";
import { parsePoseTrackFile } from "../src/lib/poseTrackFile.ts";

const { values, positionals } = parseArgs({
  options: { style: { type: "string", default: "party" }, out: { type: "string" } },
  allowPositionals: true,
});

const root = path.resolve(import.meta.dirname, "..");
const shipped = path.join(root, "src/data/motion-pack.json");
const withVideo = positionals.length > 0;
const out = path.resolve(
  values.out ?? (withVideo ? path.join(root, "eval-results/motion-pack.video.json") : shipped),
);
if (withVideo && out === shipped) {
  console.error(
    "Video-Clips werden nicht nach src/data/motion-pack.json geschrieben: die Rechte an fremden " +
      "Choreografien sind ungeklärt, das Ausliefern braucht eine ausdrückliche Entscheidung.",
  );
  process.exit(1);
}

const neutral = DEMO_POSES["neutral"];
if (!neutral) throw new Error("Demo-Pose 'neutral' fehlt");

const sources: MotionSource[] = [demoMotionSource(DEMO_POSES, DEMO_SEQUENCES)];
const videoIds = new Set<string>();
const seenIds = new Set<string>();
for (const file of positionals) {
  try {
    const track = parsePoseTrackFile(readFileSync(file, "utf8"));
    if (!track.track.samples.some((s) => s.world))
      console.log(`${file}: Spur ohne Weltpunkte (Version ${track.version}), keine 3D-Posen`);
    const { source, rejected } = videoMotionSource(track, values.style);
    // Clip ids derive from the video name; a second track of the same video would collide.
    const ids = source.sequences.flat();
    if (ids.some((id) => seenIds.has(id))) {
      console.error(`${file}: Clip-IDs schon vergeben (gleicher Videoname), übersprungen`);
      continue;
    }
    for (const id of ids) seenIds.add(id);
    sources.push(source);
    for (const c of source.clips) videoIds.add(c.id);
    console.log(
      `${file}: ${source.clips.length + rejected.length} Clips geschnitten, ` +
        `${rejected.length} beim Schneiden verworfen`,
    );
    for (const r of rejected) console.log(`  ${r.id}: ${r.reason}`);
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join(".") || "Datei"}: ${i.message}`).join("; ")
        : e instanceof Error
          ? e.message
          : String(e);
    console.error(`${file}: ${message}`);
  }
}

const { pack, rejected } = buildMotionPack({ sources, neutral: figure3d(neutral.p) });

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
console.log(`${pack.clips.length} Clips → ${path.relative(process.cwd(), out)}`);

if (!withVideo) {
  if (rejected.length) {
    console.log(`${rejected.length} verworfen:`);
    for (const r of rejected) console.log(`  ${r.id}: ${r.reason}`);
  } else console.log("Keine Clips verworfen.");
} else {
  // Reasons grouped with their numbers replaced by "#".
  const byReason = new Map<string, number>();
  for (const r of rejected) {
    const key = r.reason.replace(/-?\d+(\.\d+)?/g, "#");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  console.log(`${rejected.length} von den Filtern verworfen`);
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1]))
    console.log(`  ${n}× ${reason}`);
  const video = pack.clips.filter((c) => videoIds.has(c.id));
  const pairs = video.filter((c) => c.mirrorOf && videoIds.has(c.mirrorOf)).length / 2;
  console.log(`Behalten: ${pack.clips.length} Clips, davon ${video.length} aus Video`);
  console.log(`Spiegelpaare unter den Video-Clips: ${pairs}`);
  for (const [style, rows] of Object.entries(pack.transitions)) {
    const pairs = Object.values(rows).flatMap((row) => Object.values(row));
    const total = pairs.reduce((s, w) => s + w, 0);
    console.log(`Übergänge ${style}: ${pairs.length} Paare, ${total} gesamt`);
  }
}
