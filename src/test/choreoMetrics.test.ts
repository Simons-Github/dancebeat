import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { legacyAutoChoreo } from "@/data/demo";
import {
  aggregate,
  choreoMetrics,
  coverage,
  measurableShare,
  meanStepDeg,
  movesPerMinute,
  percentile,
  repeatRate,
  simulateScore,
  speedSamples,
  type ChoreoMetrics,
} from "@/lib/generator/metrics";
import { computeAngles, figure, figure3d, type FigureParams } from "@/lib/pose";
import { MotionPackSchema } from "@/lib/schema";
import { accuracyPoints, referenceMax } from "@/lib/scoring";
import type { Choreography, Frame, MotionClip, MotionPack, Move } from "@/lib/types";

import {
  formatTable,
  groupRows,
  parseBpms,
  parseSeeds,
  runEval,
  type EvalParams,
} from "../../scripts/evalChoreo";

type ChoreoLike = Pick<Choreography, "frames" | "moves">;

/** A flat frame of a figure pose; with `yawDeg` it also carries the turned `pose3d`. */
function frame(timeMs: number, p: FigureParams, yawDeg?: number): Frame {
  const landmarks = figure(p);
  const f: Frame = { timeMs, landmarks, angles: computeAngles(landmarks) };
  if (yawDeg !== undefined) {
    const pose3d = figure3d(p);
    f.pose3d = { ...pose3d, root: { ...pose3d.root, yawDeg } };
  }
  return f;
}

const move = (timeMs: number, iconId = "x", gold = false): Move => ({
  timeMs,
  label: iconId,
  iconId,
  gold,
});

/** One frame and one move per pose, `stepMs` apart. */
function choreoOf(poses: FigureParams[], stepMs = 1000): ChoreoLike {
  const frames = poses.map((p, i) => frame(i * stepMs, p));
  return { frames, moves: frames.map((f) => move(f.timeMs)) };
}

/** Star ratio when every move is PERFECT: accuracy points without combo, so exactly 1. */
function allPerfectRatio(moves: readonly Move[]) {
  const accuracy = moves.reduce((s, m) => s + accuracyPoints("PERFECT", m.gold), 0);
  return accuracy / referenceMax([...moves]);
}

function clip(id: string, energy: number, iconId?: string): MotionClip {
  const pose3d = figure3d({ la: 10, ra: 10 });
  return {
    id,
    label: id,
    ...(iconId !== undefined ? { iconId } : {}),
    styles: ["party"],
    difficulty: 1,
    energy,
    beats: 1,
    anchorBeat: 0,
    keyframes: [{ beat: 0, pose3d }],
    playability: 1,
    source: "test",
  };
}

const NO_NOISE = { noiseDeg: 0, missRate: 0, seed: 1 };
const shippedPack = (): MotionPack =>
  MotionPackSchema.parse(
    JSON.parse(readFileSync(path.resolve(__dirname, "../data/motion-pack.json"), "utf8")),
  );

describe("movesPerMinute", () => {
  it("counts the intervals between the first and the last move", () => {
    // 4 moves at 0, 1, 2, 3 s: 3 intervals in 3 s = 60 per minute.
    expect(
      movesPerMinute(
        choreoOf([
          { la: 0, ra: 0 },
          { la: 0, ra: 0 },
          { la: 0, ra: 0 },
          { la: 0, ra: 0 },
        ]),
      ),
    ).toBe(60);
    expect(movesPerMinute(choreoOf([{ la: 0, ra: 0 }]))).toBe(0);
  });
});

describe("measurableShare", () => {
  it("uses the angles present in a flat frame without pose3d", () => {
    const c = choreoOf([{ la: 90, ra: 90 }]);
    expect(measurableShare(c)).toBe(1);
    const f = c.frames[0]!;
    // Legs missing (e.g. out of the picture in a recorded track): 4 of 8.
    f.angles = { leftShoulder: 90, rightShoulder: 90, leftElbow: 0, rightElbow: 0 };
    expect(measurableShare(c)).toBe(0.5);
  });

  it("uses measurableAngles of pose3d, so a turned pose has fewer measurable angles", () => {
    const p = { la: 90, ra: 90 };
    const at = (yawDeg: number) => ({ frames: [frame(0, p, yawDeg)], moves: [move(0)] });
    expect(measurableShare(at(0))).toBe(1);
    // Turned by 70°: the horizontal arms keep cos 70° ≈ 0.34 of their length (< 0.5), so both
    // shoulder and elbow angles drop out; hips and knees stay.
    expect(measurableShare(at(70))).toBe(0.5);
    // Side view: both shoulders project onto one point, no angle is defined.
    expect(measurableShare(at(90))).toBe(0);
    // Mean over moves.
    const two = { frames: [frame(0, p, 0), frame(1000, p, 90)], moves: [move(0), move(1000)] };
    expect(measurableShare(two)).toBe(0.5);
  });
});

describe("meanStepDeg and repeatRate", () => {
  const a = { la: 30, ra: 30 };
  const b = { la: 90, ra: 30 };

  it("averages the limb angle differences of consecutive targets", () => {
    // Only the left shoulder differs (60°): mean over 8 limb angles = 7.5°.
    expect(meanStepDeg(choreoOf([a, b]))).toBeCloseTo(7.5, 6);
    // Pairs a→b (7.5°) and b→b (0°).
    expect(meanStepDeg(choreoOf([a, b, b]))).toBeCloseTo(3.75, 6);
  });

  it("counts consecutive pairs with practically the same target", () => {
    expect(repeatRate(choreoOf([a, b, b]))).toBe(0.5);
    expect(repeatRate(choreoOf([a, b, a]))).toBe(0);
    // 4° is below REPEAT_MAX_DEG (5°).
    expect(repeatRate(choreoOf([a, { la: 34, ra: 30 }]))).toBe(1);
    expect(repeatRate(choreoOf([a]))).toBe(0);
  });
});

describe("coverage", () => {
  const pack: MotionPack = {
    version: 1,
    clips: [clip("rest", 0, "neutral"), clip("a", 0.5, "a"), clip("b", 0.4, "b")],
    transitions: {},
  };

  it("divides the used non-rest icons by the pack's non-rest icons", () => {
    const c = (...ids: string[]) => ({
      frames: [frame(0, { la: 0, ra: 0 })],
      moves: ids.map((id, i) => move(i * 1000, id)),
    });
    // "neutral" is a rest pose, "x" is not in the pack: only "a" counts, 1 of 2.
    expect(coverage(c("a", "neutral", "x", "a"), pack)).toBe(0.5);
    expect(coverage(c("a", "b"), pack)).toBe(1);
    expect(coverage(c("a"), { ...pack, clips: [clip("rest", 0, "neutral")] })).toBe(0);
  });
});

describe("angular speed", () => {
  // Left shoulder 0° → 90° between two frames 1000 ms apart.
  const c = { frames: [frame(0, { la: 0, ra: 0 }), frame(1000, { la: 90, ra: 0 })], moves: [] };

  it("averages to the linear speed but peaks at 1.5× because frameAt uses smoothstep", () => {
    const s = speedSamples(c);
    expect(s).toHaveLength(50);
    expect(s.reduce((x, y) => x + y, 0) / s.length).toBeCloseTo(90, 6);
    // smoothstep' (0.5) = 1.5; over a 20 ms step 134.9°/s instead of 135.
    expect(Math.max(...s)).toBeCloseTo(135, 0);
    const m = choreoMetrics(
      { ...c, moves: [move(0)] },
      {
        pack: { version: 1, clips: [], transitions: {} },
        sim: NO_NOISE,
      },
    );
    expect(m.maxSpeedDegPerS).toBeCloseTo(135, 0);
    expect(m.p95SpeedDegPerS).toBeGreaterThan(90);
    expect(m.p95SpeedDegPerS).toBeLessThanOrEqual(m.maxSpeedDegPerS);
  });

  it("percentile uses the nearest rank", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 0.95)).toBe(19);
    expect(percentile(xs, 1)).toBe(20);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe("simulateScore", () => {
  const c = choreoOf(
    [
      { la: 90, ra: 90 },
      { la: 30, ra: 30 },
      { la: 150, ra: 60 },
    ],
    500,
  );

  it("rates every move PERFECT without noise and dropout", () => {
    const snap = simulateScore(c, NO_NOISE);
    expect(snap.counts.PERFECT).toBe(3);
    expect(snap.judged).toBe(3);
    // 3 × 1000 accuracy points against 3 × 1000; the combo does not count for the stars.
    expect(snap.ratio).toBeCloseTo(1, 9);
    expect(snap.ratio).toBeCloseTo(allPerfectRatio(c.moves), 9);
  });

  it("is deterministic for a seed", () => {
    const sim = { noiseDeg: 25, missRate: 0.3, seed: 42 };
    expect(simulateScore(c, sim)).toEqual(simulateScore(c, sim));
  });
});

describe("aggregate", () => {
  const row = (simRatio: number, maxSpeedDegPerS: number, moves: number): ChoreoMetrics => ({
    moves,
    movesPerMin: 0,
    golds: 0,
    measurableShare: 1,
    meanStepDeg: 0,
    repeatRate: 0,
    coverage: 0,
    maxSpeedDegPerS,
    p95SpeedDegPerS: 0,
    simRatio,
    simStars: 0,
    perfectShare: 0,
  });

  it("means every metric, with the lowest score and the highest speed", () => {
    const agg = aggregate([row(0.8, 300, 10), row(0.6, 500, 20)]);
    expect(agg.runs).toBe(2);
    expect(agg.mean.moves).toBe(15);
    expect(agg.mean.simRatio).toBeCloseTo(0.7, 9);
    expect(agg.minSimRatio).toBe(0.6);
    expect(agg.maxSpeedDegPerS).toBe(500);
    expect(aggregate([]).runs).toBe(0);
  });
});

describe("baseline: legacy auto choreography", () => {
  const pack = shippedPack();
  const legacy = legacyAutoChoreo("Basis", 128, 180_000, ["#FF2E93", "#00E5FF"]);

  it("has plausible numbers", () => {
    const m = choreoMetrics(legacy, { pack, sim: NO_NOISE });
    expect(m.moves).toBeGreaterThan(0);
    // One move every 2 beats at 128 BPM.
    expect(m.movesPerMin).toBeCloseTo(64, 6);
    expect(m.golds).toBe(3);
    expect(m.measurableShare).toBe(1);
    // All 11 non-neutral demo poses appear.
    expect(m.coverage).toBe(1);
    expect(m.meanStepDeg).toBeGreaterThan(10);
    expect(m.perfectShare).toBe(1);
    expect(m.simRatio).toBeCloseTo(allPerfectRatio(legacy.moves), 9);
    expect(m.maxSpeedDegPerS).toBeGreaterThan(m.p95SpeedDegPerS);
  });

  it("runs on the bench without a generator, deterministic per seed", () => {
    const params: EvalParams = {
      bpms: [128],
      seeds: 2,
      durationMs: 60_000,
      style: "party",
      baselineOnly: true,
    };
    const deps = {
      pack,
      baseline: (bpm: number, ms: number) => legacyAutoChoreo("B", bpm, ms, ["#000000", "#FFFFFF"]),
    };
    const rows = runEval(params, deps);
    expect(rows.map((r) => [r.source, r.bpm, r.difficulty, r.seed])).toEqual([
      ["baseline", 128, null, "seed-0"],
      ["baseline", 128, null, "seed-1"],
    ]);
    expect(runEval(params, deps)).toEqual(rows);
    const groups = groupRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.aggregate.runs).toBe(2);
    const table = formatTable(groups).split("\n");
    expect(table).toHaveLength(3);
    expect(table[0]).toMatch(/^Quelle +\| +BPM \| Stufe \|/);
    expect(table[2]).toMatch(/^alt +\| +128 \| +– \|/);
    // Aligned: every line has the same length.
    expect(new Set(table.map((l) => l.length)).size).toBe(1);
  });

  it("runs the generator per difficulty and seed with beat phase 0", () => {
    const inputs: unknown[] = [];
    const rows = runEval(
      { bpms: [100], seeds: 1, durationMs: 10_000, style: "party", baselineOnly: false },
      {
        pack,
        baseline: () => choreoOf([{ la: 0, ra: 0 }]),
        generate: (input) => {
          inputs.push(input);
          return choreoOf([{ la: 0, ra: 0 }]);
        },
      },
    );
    expect(rows.map((r) => r.difficulty)).toEqual([null, 1, 2, 3]);
    expect(inputs[0]).toEqual({
      bpm: 100,
      beatPhaseMs: 0,
      durationMs: 10_000,
      style: "party",
      difficulty: 1,
      seed: "seed-0",
    });
  });
});

describe("CLI parsing", () => {
  it("parses BPM lists and seed counts", () => {
    expect(parseBpms("90, 128")).toEqual([90, 128]);
    expect(() => parseBpms("90,abc")).toThrow();
    expect(() => parseBpms("20")).toThrow();
    expect(parseSeeds("5")).toBe(5);
    expect(() => parseSeeds("0")).toThrow();
    expect(() => parseSeeds("1.5")).toThrow();
  });
});
