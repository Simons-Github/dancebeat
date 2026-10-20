import { describe, expect, it } from "vitest";

import { buildPoseTrackFile, type PoseTrackFile } from "@/lib/poseTrackFile";
import { figure } from "@/lib/pose";
import type { Landmark } from "@/lib/types";

import {
  CURRENT,
  DEFAULT_GRID,
  formatFileReport,
  formatOverall,
  gridPoints,
  overall,
  parseList,
  parsePlacements,
  sameParams,
  tuneFile,
} from "../../scripts/tuning";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 8 s of a waving figure every 50 ms with landmark noise (square video, aspect 1). */
function noisyFile(noise: number, seed: number, video = "tanz.mp4"): PoseTrackFile {
  const rand = rng(seed);
  const samples = Array.from({ length: 161 }, (_, i) => {
    const t = i * 50;
    const lm = figure({
      la: 90 + 60 * Math.sin((2 * Math.PI * t) / 2000),
      ra: 60,
      le: 20,
      re: 10,
      ll: 5,
      rl: 5,
    }).map((p): Landmark => [
      p[0] + (rand() - 0.5) * 2 * noise,
      p[1] + (rand() - 0.5) * 2 * noise,
      0.9,
    ]);
    return { timeMs: t, landmarks: lm };
  });
  return buildPoseTrackFile({
    exportedAt: 1_760_000_000_000,
    video,
    bpm: 120,
    beatPhaseMs: 0,
    range: { startMs: 0, endMs: 8000 },
    mirror: true,
    track: { aspect: 1, samples },
  });
}

describe("tuning", () => {
  it("baut das Raster als Kreuzprodukt", () => {
    const points = gridPoints({
      minCutoff: [1, 2],
      beta: [5, 10, 20],
      maxGapMs: [250],
      beatsPerMove: [2],
      placement: ["grid"],
    });
    expect(points).toHaveLength(6);
    expect(points.some((p) => sameParams(p, CURRENT))).toBe(true);
  });

  it("bevorzugt bei starkem Rauschen Glättung vor keiner (minCutoff 1000 Hz)", () => {
    const points = gridPoints({
      minCutoff: [1, 1000],
      beta: [10],
      maxGapMs: [250],
      beatsPerMove: [2],
      placement: ["grid"],
    });
    const rows = tuneFile(noisyFile(0.02, 5), points);
    expect(rows[0]!.params.minCutoff).toBe(1);
    expect(rows[0]!.score).toBe(rows[0]!.metrics.holdoutDeg);
    expect(rows[1]!.metrics.jitterSmoothDeg!).toBeGreaterThan(rows[0]!.metrics.jitterSmoothDeg!);
  });

  it("mittelt über alle Videos und markiert die aktuellen Werte", () => {
    const points = gridPoints({
      minCutoff: [1, 2],
      beta: [10],
      maxGapMs: [250],
      beatsPerMove: [2],
      placement: ["grid"],
    });
    const a = noisyFile(0.01, 1, "a.mp4");
    const b = noisyFile(0.02, 2, "b.mp4");
    const results = [tuneFile(a, points), tuneFile(b, points)];
    const ranking = overall(results);
    expect(ranking).toHaveLength(2);
    expect(ranking[0]!.score).toBeLessThanOrEqual(ranking[1]!.score);
    const report = formatFileReport(a, results[0]!);
    expect(report).toContain("## a.mp4");
    expect(formatFileReport({ ...a, model: "full" }, results[0]!)).toContain(
      "## a.mp4 (Modell full)",
    );
    expect(report).toContain("← aktuell");
    expect(formatOverall(ranking)).toContain("← aktuell");
  });

  it("vergleicht die Move-Platzierung und zeigt die Bewegung an den Moves", () => {
    expect(CURRENT.placement).toBe("grid");
    expect(DEFAULT_GRID.placement).toEqual(["grid"]);
    const points = gridPoints({
      minCutoff: [1],
      beta: [10],
      maxGapMs: [250],
      beatsPerMove: [2],
      placement: ["grid", "holds"],
    });
    expect(points.map((p) => p.placement)).toEqual(["grid", "holds"]);
    expect(sameParams(points[0]!, points[1]!)).toBe(false);
    const file = noisyFile(0.002, 3);
    const rows = tuneFile(file, points);
    const grid = rows.find((r) => r.params.placement === "grid")!.metrics;
    const holds = rows.find((r) => r.params.placement === "holds")!.metrics;
    // The waving arm is still on odd beats (500, 1500, … ms), the grid sits on even ones.
    expect(holds.moveMotionDegPerS!).toBeLessThan(grid.moveMotionDegPerS!);
    expect(holds.moves).toBe(grid.moves);
    const report = formatFileReport(file, rows);
    expect(report).toContain("Bew. °/s");
    expect(report).toContain(grid.moveMotionDegPerS!.toFixed(2));
    expect(report).toContain("Beats/Move 2, holds");
    expect(report).toMatch(/Beats\/Move 2, grid ← aktuell/);
  });

  it("lehnt ungültige Platzierungen ab", () => {
    expect(parsePlacements("grid, holds")).toEqual(["grid", "holds"]);
    expect(() => parsePlacements("grid,raster")).toThrow("--placement");
    expect(() => parsePlacements("")).toThrow("--placement");
  });

  it("lehnt ungültige Listen ab", () => {
    expect(parseList("0.5, 1,2", "beta")).toEqual([0.5, 1, 2]);
    expect(() => parseList("1,x", "beta")).toThrow("--beta");
    expect(() => parseList("0", "beta")).toThrow();
  });
});
