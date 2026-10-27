import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import packJson from "@/data/motion-pack.json";
import { buildDemoChoreo } from "@/lib/demoBuild";
import { DemoManifestSchema, type DemoManifest } from "@/lib/demoManifest";
import { MotionPackSchema } from "@/lib/schema";
import type { MotionPack } from "@/lib/types";

import { formatDemoTable, runDemoEval } from "../../scripts/evalDemos";

const PACK: MotionPack = MotionPackSchema.parse(packJson);
const DEMO_DIR = path.resolve(__dirname, "../../src/data/demos");
const SLUGS = [
  "gold-in-my-pocket",
  "gold-on-the-glass",
  "lemonade-skies",
  "rise-until-the-morning",
];

const load = (slug: string): DemoManifest =>
  DemoManifestSchema.parse(
    JSON.parse(readFileSync(path.join(DEMO_DIR, `${slug}.manifest.json`), "utf8")),
  );

const deps = { pack: PACK, build: buildDemoChoreo };
const LEMONADE = load("lemonade-skies");

/** One cheap run over Lemonade Skies (the shortest demo), all three levels. */
const run = (params: Parameters<typeof runDemoEval>[1], m: DemoManifest = LEMONADE) =>
  runDemoEval([m], params, deps);

describe("runDemoEval", () => {
  it("is deterministic for the same seeds", () => {
    const a = run({ seeds: 2, noiseDeg: 30, missRate: 0.1 });
    const b = run({ seeds: 2, noiseDeg: 30, missRate: 0.1 });
    expect(a).toEqual(b);
    expect(a.map((g) => g.difficulty)).toEqual([1, 2, 3]);
    expect(a.filter((g) => g.current).map((g) => g.difficulty)).toEqual([LEMONADE.difficulty]);
  });

  it("a perfect player (no noise, no dropout) gets every move PERFECT and five stars", () => {
    for (const g of run({ seeds: 2, noiseDeg: 0, missRate: 0 })) {
      expect(g.error).toBeNull();
      expect(g.aggregate!.mean.perfectShare).toBe(1);
      expect(g.aggregate!.mean.simRatio).toBeCloseTo(1, 9);
      expect(g.minStars).toBe(5);
    }
  });

  it("builds with the overridden difficulty (level 3 denser, at most twice)", () => {
    const [one, two, three] = run({ seeds: 1, noiseDeg: 0, missRate: 0 });
    expect(two!.aggregate!.mean.moves).toBe(one!.aggregate!.mean.moves);
    // Level 3 halves the step (B8: 4 → 2 beats) except where a quiet section keeps 4 beats.
    const ratio = three!.aggregate!.mean.moves / one!.aggregate!.mean.moves;
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThanOrEqual(2.01);
  });

  it("minStars is the lowest run, not the mean, once noise makes runs differ", () => {
    const groups = run({ seeds: 6, noiseDeg: 120, missRate: 0.6 });
    for (const g of groups) {
      const stars = g.runs.map((r) => r.metrics.simStars);
      expect(g.minStars).toBe(Math.min(...stars));
      expect(g.aggregate!.minSimRatio).toBe(Math.min(...g.runs.map((r) => r.metrics.simRatio)));
    }
    const ratios = groups[0]!.runs.map((r) => r.metrics.simRatio);
    expect(new Set(ratios).size).toBeGreaterThan(1);
  });

  it("reports a level the manifest cannot be built at instead of throwing", () => {
    const star = PACK.clips.find((c) => c.id === "demo:star");
    expect(star?.difficulty).toBe(2);
    const hard: DemoManifest = {
      ...LEMONADE,
      phrases: { ...LEMONADE.phrases, chorus: [star!.id] },
    };
    const [easy, ...rest] = run({ seeds: 1 }, hard);
    expect(easy!.difficulty).toBe(1);
    expect(easy!.error).toMatch(/schwerer als der Song/);
    expect(easy!.runs).toEqual([]);
    expect(easy!.aggregate).toBeNull();
    for (const g of rest) expect(g.error).toBeNull();
    const table = formatDemoTable([easy!, ...rest]);
    expect(table).toMatch(/nicht baubar/);
    expect(table).toMatch(/Lemonade Skies, Stufe 1: .*schwerer als der Song/);
  });
});

describe("formatDemoTable", () => {
  it("lists every shipped song at all three levels and marks the shipped one", () => {
    const manifests = SLUGS.map(load);
    // No simulated player needed for the layout: a stub build keeps this fast.
    const groups = runDemoEval(
      manifests,
      { seeds: 1 },
      { pack: PACK, build: () => ({ frames: [], moves: [] }) },
    );
    const table = formatDemoTable(groups);
    for (const m of manifests) {
      const lines = table.split("\n").filter((l) => l.startsWith(m.title));
      expect(lines).toHaveLength(3);
      expect(lines.filter((l) => l.includes(`${m.difficulty}*`))).toHaveLength(1);
    }
  });
});
