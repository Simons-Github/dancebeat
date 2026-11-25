import { describe, expect, it } from "vitest";

import { figure, type FigureParams } from "@/lib/pose";
import { buildPoseTrackFile, type PoseTrackFile } from "@/lib/poseTrackFile";
import type { Landmark } from "@/lib/types";
import type { PoseTrack } from "@/lib/videoChoreo";

import {
  DEFAULT_SIM,
  formatSummary,
  formatVideoTable,
  landmarksAt,
  runVideoEval,
  shownFrameTime,
  timeError,
  trueTrack,
  type EvalVideo,
} from "../../scripts/evalVideo";

const ASPECT = 9 / 16;

/** Square-space figure as a per-axis normalized portrait frame (inverse of toSquareSpace). */
const toVideo = (lm: Landmark[]): Landmark[] =>
  lm.map((p) => [0.5 + (p[0] - 0.5) / ASPECT, p[1], p[2] ?? 1]);

const waveDance = (t: number): FigureParams => ({
  la: 90 + 70 * Math.sin((2 * Math.PI * t) / 2000),
  ra: 90 - 60 * Math.sin((2 * Math.PI * t) / 1500),
  le: 40 + 30 * Math.sin((2 * Math.PI * t) / 1000),
  re: 20,
  ll: 10,
  rl: 10,
});

/** A clearly different dance: arms low and crossed, elbows bent the other way. */
const otherDance = (t: number): FigureParams => ({
  la: 20 + 15 * Math.sin((2 * Math.PI * t) / 1700),
  ra: 160 - 15 * Math.sin((2 * Math.PI * t) / 1300),
  le: -60,
  re: -70,
  ll: 25,
  rl: 5,
});

function file(
  dance: (t: number) => FigureParams,
  opts: { durationMs?: number; mirror?: boolean; edit?: (t: number) => boolean } = {},
): PoseTrackFile {
  const { durationMs = 12_000, mirror = true } = opts;
  const samples: PoseTrack["samples"] = [];
  for (let t = 0; t <= durationMs; t += 50) {
    const drop = opts.edit?.(t) ?? false;
    samples.push({ timeMs: t, landmarks: drop ? null : toVideo(figure(dance(t))) });
  }
  return buildPoseTrackFile({
    exportedAt: 1_760_000_000_000,
    video: "test.mp4",
    bpm: 120,
    beatPhaseMs: 0,
    range: { startMs: 0, endMs: durationMs },
    mirror,
    model: "full",
    movePlacement: "holds",
    track: { aspect: ASPECT, samples },
  });
}

const params = { seeds: 2, sim: DEFAULT_SIM, variants: ["One-Euro"] as const };

describe("shownFrameTime / trueTrack / timeError", () => {
  const frames30 = Array.from({ length: 31 }, (_, i) => (i * 1000) / 30);

  it("returns the frame whose display interval contains the time", () => {
    expect(shownFrameTime(frames30, 0)).toBe(0);
    expect(shownFrameTime(frames30, 50)).toBeCloseTo(100 / 3);
    expect(shownFrameTime(frames30, 100)).toBeCloseTo(100);
    expect(shownFrameTime(frames30, 99.9995)).toBeCloseTo(100);
  });

  it("relabels the samples and measures the error of the 50 ms grid at 30 fps", () => {
    const f = file(waveDance, { durationMs: 1000 });
    const t = trueTrack(f.track, frames30);
    expect(t.samples.map((s) => Math.round(s.timeMs))).toEqual([
      0, 33, 100, 133, 200, 233, 300, 333, 400, 433, 500, 533, 600, 633, 700, 733, 800, 833, 900,
      933, 1000,
    ]);
    const err = timeError({ name: "a", file: f, frameTimesMs: frames30 });
    expect(err?.maxMs).toBeCloseTo(50 / 3);
    expect(err?.meanMs).toBeCloseTo((10 * 50) / 3 / 21);
    expect(timeError({ name: "a", file: f })).toBeNull();
  });

  it("keeps the track without frame times", () => {
    const f = file(waveDance, { durationMs: 200 });
    expect(trueTrack(f.track)).toBe(f.track);
  });
});

describe("landmarksAt", () => {
  const lm = (x: number): Landmark[] => [[x, 0.5, 1]];
  const track: PoseTrack = {
    aspect: 1,
    samples: [
      { timeMs: 0, landmarks: lm(0) },
      { timeMs: 100, landmarks: lm(1) },
      { timeMs: 150, landmarks: null },
      { timeMs: 200, landmarks: lm(0) },
      { timeMs: 500, landmarks: lm(1) },
    ],
  };

  it("interpolates between neighbouring samples", () => {
    expect(landmarksAt(track, 25)?.[0]?.[0]).toBeCloseTo(0.25);
    expect(landmarksAt(track, 100)?.[0]?.[0]).toBeCloseTo(1);
  });

  it("gives null next to a missing person, across long gaps and outside the track", () => {
    expect(landmarksAt(track, 120)).toBeNull();
    expect(landmarksAt(track, 300)).toBeNull();
    expect(landmarksAt(track, -1)).toBeNull();
    expect(landmarksAt(track, 501)).toBeNull();
  });
});

describe("runVideoEval", () => {
  const videos: EvalVideo[] = [
    { name: "welle", file: file(waveDance) },
    { name: "anders", file: file(otherDance) },
  ];

  it("is deterministic for the same seeds", () => {
    expect(runVideoEval(videos, params)).toEqual(runVideoEval(videos, params));
  });

  it("rates the own dance near the maximum and another dance clearly lower", () => {
    const { groups, summaries } = runVideoEval(videos, params);
    const g = (video: string, scenario: string) =>
      groups.find((x) => x.video === video && x.scenario === scenario)!;
    expect(g("welle", "selbst").shares.PERFECT).toBeGreaterThan(0.9);
    expect(g("welle", "selbst").stars).toBe(5);
    expect(g("welle", "fremd").ratio).toBeLessThan(g("welle", "selbst").ratio - 0.3);
    // Late by half a beat costs more than a quarter beat, which costs at most a little.
    expect(g("welle", "+½ Beat").ratio).toBeLessThanOrEqual(g("welle", "+¼ Beat").ratio);
    const s = summaries.find((x) => x.video === "welle")!;
    expect(s.deterministic).toBe(true);
    expect(s.separation).toBeGreaterThan(0.3);
    expect(formatVideoTable(groups)).toContain("welle");
    expect(formatSummary(summaries)).toContain("ja");
  });

  it("follows the stored mirror setting for the player (selfie video)", () => {
    const selfie = [{ name: "selfie", file: file(waveDance, { mirror: false }) }];
    const { groups } = runVideoEval(selfie, params);
    expect(groups.find((x) => x.scenario === "selbst")!.shares.PERFECT).toBeGreaterThan(0.9);
  });

  it("skips the negative test with a single video", () => {
    const { groups, summaries } = runVideoEval(videos.slice(0, 1), params);
    expect(groups.map((x) => x.scenario)).toEqual(["selbst", "+¼ Beat", "+½ Beat"]);
    expect(summaries[0]!.separation).toBeNull();
  });

  it("compares the variants on the same simulated player", () => {
    const both = runVideoEval(videos.slice(0, 1), {
      ...params,
      variants: ["One-Euro", "ohne One-Euro"],
    });
    expect(new Set(both.groups.map((x) => x.variant))).toEqual(
      new Set(["One-Euro", "ohne One-Euro"]),
    );
  });
});
