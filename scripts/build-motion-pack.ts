// Builds the motion pack (run: `bun run build-motion-pack`). Writes src/data/motion-pack.json
// from the demo poses and demo song sequences; prints the clip count and rejected clips.
// Logic: src/lib/motionPack.ts. Rerun after changing the poses, the sources or the thresholds
// (the test src/test/motionPack.test.ts fails while the committed file is stale).
import { writeFileSync } from "node:fs";
import path from "node:path";

import { DEMO_POSES, DEMO_SEQUENCES } from "../src/data/demo.ts";
import { buildMotionPack, demoMotionSource } from "../src/lib/motionPack.ts";
import { figure3d } from "../src/lib/pose.ts";

const neutral = DEMO_POSES["neutral"];
if (!neutral) throw new Error("Demo-Pose 'neutral' fehlt");

const { pack, rejected } = buildMotionPack({
  sources: [demoMotionSource(DEMO_POSES, DEMO_SEQUENCES)],
  neutral: figure3d(neutral.p),
});

const out = path.resolve(import.meta.dirname, "../src/data/motion-pack.json");
writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
console.log(`${pack.clips.length} Clips → ${path.relative(process.cwd(), out)}`);
if (rejected.length) {
  console.log(`${rejected.length} verworfen:`);
  for (const r of rejected) console.log(`  ${r.id}: ${r.reason}`);
} else console.log("Keine Clips verworfen.");
