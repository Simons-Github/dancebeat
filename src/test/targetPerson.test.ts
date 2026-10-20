import { describe, expect, it } from "vitest";

import {
  defaultTarget,
  hasMultiplePersons,
  jumpLimit,
  maxPersons,
  nearestSampleIndex,
  personOrder,
  pickPoseAt,
  poseCenter,
  TARGET_JUMP_BASE,
  TARGET_JUMP_MAX,
  trackTarget,
  type MultiPoseTrack,
} from "@/lib/targetPerson";
import type { Landmark } from "@/lib/types";
import { figureLandmarks, shiftedFigure } from "./videoAnalysisFakes";

const ASPECT = 16 / 9;
const STEP = 50;

/** Track from 0 to `durationMs` every STEP ms; `poses` gives all people at time t. */
function makeTrack(
  poses: (t: number, i: number) => Landmark[][],
  durationMs = 3000,
): MultiPoseTrack {
  const samples: MultiPoseTrack["samples"] = [];
  for (let t = 0, i = 0; t <= durationMs; t += STEP, i++)
    samples.push({ timeMs: t, poses: poses(t, i) });
  return { aspect: ASPECT, samples };
}

/** Torso center x (per-axis normalized) of the landmarks at sample i, or null. */
const centerX = (lm: Landmark[] | null) => {
  const c = lm ? poseCenter(lm, ASPECT) : null;
  return c ? c.x / ASPECT : null;
};

const left = (t: number) => shiftedFigure(t, { dx: -0.2 });
const right = (t: number) => shiftedFigure(t + 700, { dx: 0.2 });

describe("trackTarget", () => {
  it("bleibt bei der Zielperson, auch wenn die Modell-Reihenfolge jedes Bild wechselt", () => {
    const track = makeTrack((t, i) => (i % 2 ? [right(t), left(t)] : [left(t), right(t)]));
    // Person on the right, chosen in sample 0 (model index 1 there).
    const out = trackTarget(track, { sampleIndex: 0, poseIndex: 1 });
    expect(out.aspect).toBe(ASPECT);
    for (const s of out.samples) expect(centerX(s.landmarks)).toBeCloseTo(0.7, 5);
  });

  it("folgt der Person beim langsamen Kreuzen (vorne/hinten versetzt)", () => {
    const durationMs = 4000;
    const pos = (t: number) => -0.25 + (0.5 * t) / durationMs;
    // A walks left → right in front (lower, larger), B right → left behind.
    const a = (t: number) => shiftedFigure(t, { dx: pos(t), dy: 0.08, scale: 1.1 });
    const b = (t: number) => shiftedFigure(t + 700, { dx: -pos(t), dy: -0.08, scale: 0.9 });
    const track = makeTrack((t, i) => (i % 3 ? [a(t), b(t)] : [b(t), a(t)]), durationMs);
    const seed = defaultTarget(track);
    // The larger person is A; sample 0 has model order [b, a].
    expect(seed).toEqual({ sampleIndex: 0, poseIndex: 1 });
    const out = trackTarget(track, seed);
    for (const s of out.samples) expect(centerX(s.landmarks)).toBeCloseTo(0.5 + pos(s.timeMs), 5);
  });

  it("verdeckte Zielperson wird null, nie die andere Person; danach wieder erkannt", () => {
    const hidden = (t: number) => t >= 1000 && t < 2000;
    const track = makeTrack((t) => (hidden(t) ? [right(t)] : [left(t), right(t)]));
    const out = trackTarget(track, { sampleIndex: 0, poseIndex: 0 });
    for (const s of out.samples) {
      if (hidden(s.timeMs)) expect(s.landmarks).toBeNull();
      else expect(centerX(s.landmarks)).toBeCloseTo(0.3, 5);
    }
  });

  it("findet die Person nach der Verdeckung auch etwas versetzt wieder, rückwärts ebenso", () => {
    // Hidden 1 s, then 0.1 image heights further right; chosen after the occlusion.
    const dx = (t: number) => (t < 1000 ? -0.2 : -0.2 + 0.1 / ASPECT);
    const track = makeTrack((t) =>
      t >= 1000 && t < 2000 ? [right(t)] : [right(t), shiftedFigure(t, { dx: dx(t) })],
    );
    const last = track.samples.length - 1;
    const out = trackTarget(track, { sampleIndex: last, poseIndex: 1 });
    expect(centerX(out.samples[0]!.landmarks)).toBeCloseTo(0.3, 5);
    expect(centerX(out.samples[last]!.landmarks)).toBeCloseTo(0.3 + 0.1 / ASPECT, 5);
    expect(out.samples.filter((s) => s.landmarks === null)).toHaveLength(20);
  });

  it("übernimmt bei nur einer Person die alte Zuordnung unverändert", () => {
    const track = makeTrack((t) => (t === 500 ? [] : [figureLandmarks(t, ASPECT)]));
    const expected = {
      aspect: ASPECT,
      samples: track.samples.map((s) => ({ timeMs: s.timeMs, landmarks: s.poses[0] ?? null })),
    };
    expect(hasMultiplePersons(track)).toBe(false);
    expect(trackTarget(track, defaultTarget(track))).toEqual(expected);
    // The seed does not matter, and the landmarks are the analysis' own arrays.
    const out = trackTarget(track, null);
    expect(out).toEqual(expected);
    expect(out.samples[0]!.landmarks).toBe(track.samples[0]!.poses[0]);
  });

  it("liefert ohne gültigen Startpunkt keine Person", () => {
    const track = makeTrack((t) => [left(t), right(t)], 200);
    expect(trackTarget(track, null).samples.every((s) => s.landmarks === null)).toBe(true);
    expect(
      trackTarget(track, { sampleIndex: 0, poseIndex: 5 }).samples.every(
        (s) => s.landmarks === null,
      ),
    ).toBe(true);
  });
});

describe("Hilfsfunktionen Zielperson", () => {
  it("defaultTarget nimmt die größte Person zu Beginn einer Folge mit den meisten Personen", () => {
    const small = shiftedFigure(0, { dx: -0.25, scale: 0.6 });
    const big = shiftedFigure(0, { dx: 0.25, scale: 1.2 });
    const mid = shiftedFigure(0, { scale: 0.9 });
    const poses = [[], [small, big], [small, big], [small, mid, big], [big, mid, small]];
    const track: MultiPoseTrack = {
      aspect: ASPECT,
      samples: [...poses, ...poses.slice(3), poses[4]!].map((p, i) => ({
        timeMs: i * 50,
        poses: p,
      })),
    };
    expect(maxPersons(track)).toBe(3);
    // Samples 3..6 have three people; sample 3 starts that run, the big one is index 2 there.
    expect(defaultTarget(track)).toEqual({ sampleIndex: 3, poseIndex: 2 });
    expect(defaultTarget({ aspect: 1, samples: [{ timeMs: 0, poses: [] }] })).toBeNull();
    expect(
      defaultTarget({
        aspect: 1,
        samples: [
          { timeMs: 0, poses: [] },
          { timeMs: 50, poses: [small] },
        ],
      }),
    ).toEqual({ sampleIndex: 1, poseIndex: 0 });
  });

  it("eine einzelne Zweiterkennung schaltet nicht in den Mehrpersonen-Modus", () => {
    const track = makeTrack((t) =>
      t === 1000 ? [figureLandmarks(t, ASPECT), right(t)] : [figureLandmarks(t, ASPECT)],
    );
    expect(hasMultiplePersons(track)).toBe(false);
    expect(maxPersons(track)).toBe(1);
    const expected = {
      aspect: ASPECT,
      samples: track.samples.map((s) => ({ timeMs: s.timeMs, landmarks: s.poses[0] ?? null })),
    };
    expect(trackTarget(track, defaultTarget(track))).toEqual(expected);
    expect(defaultTarget(track)).toEqual({ sampleIndex: 0, poseIndex: 0 });
    // Four multi-person samples are still too few (MIN_MULTI_SAMPLES).
    const four = makeTrack((t, i) => (i < 4 ? [left(t), right(t)] : [left(t)]));
    expect(hasMultiplePersons(four)).toBe(false);
    // Five samples, but under 5 % of the samples with a pose (MIN_MULTI_RATIO).
    const rare = makeTrack((t, i) => (i % 25 === 0 ? [left(t), right(t)] : [left(t)]), 6000);
    expect(rare.samples.filter((s) => s.poses.length > 1)).toHaveLength(5);
    expect(hasMultiplePersons(rare)).toBe(false);
    expect(hasMultiplePersons(makeTrack((t, i) => (i < 5 ? [left(t), right(t)] : [left(t)])))).toBe(
      true,
    );
  });

  it("eine einmalige größere Fehlerkennung wird nie Startpunkt", () => {
    const stray = shiftedFigure(0, { dx: 0.3, scale: 1.6 });
    const track = makeTrack((t, i) =>
      i === 2 ? [left(t), stray, right(t)] : [left(t), shiftedFigure(t, { dx: 0.2, scale: 0.9 })],
    );
    const seed = defaultTarget(track)!;
    expect(seed.sampleIndex).not.toBe(2);
    expect(seed).toEqual({ sampleIndex: 0, poseIndex: 0 });
    expect(trackTarget(track, seed).samples[2]!.landmarks).toBe(track.samples[2]!.poses[0]);
  });

  it("Sprunggrenze wächst mit der Lücke und ist gedeckelt", () => {
    expect(jumpLimit(0)).toBeCloseTo(TARGET_JUMP_BASE);
    expect(jumpLimit(50)).toBeCloseTo(TARGET_JUMP_BASE + 0.03);
    expect(jumpLimit(-50)).toBeCloseTo(jumpLimit(50));
    expect(jumpLimit(10_000)).toBe(TARGET_JUMP_MAX);
  });

  it("poseCenter überspringt unsichere Punkte", () => {
    const lm = figureLandmarks(0, 1).map((p, i): Landmark => (i === 11 ? [0, 0, 0.2] : p));
    const c = poseCenter(lm, 1)!;
    // Mean of right shoulder and both hips only.
    expect(c.x).toBeCloseTo((lm[12]![0] + lm[23]![0] + lm[24]![0]) / 3, 10);
    expect(
      poseCenter(
        lm.map((p) => [p[0], p[1], 0.1]),
        1,
      ),
    ).toBeNull();
  });

  it("pickPoseAt trifft die angetippte Person, daneben keine", () => {
    const poses = [left(0), right(0)];
    expect(pickPoseAt(poses, { x: 0.3, y: 0.5 }, ASPECT)).toBe(0);
    expect(pickPoseAt(poses, { x: 0.72, y: 0.6 }, ASPECT)).toBe(1);
    // Inside the box (raised hand), far from the torso center.
    const hand = right(0)[16]!;
    expect(pickPoseAt(poses, { x: hand[0], y: hand[1] }, ASPECT)).toBe(1);
    expect(pickPoseAt(poses, { x: 0.5, y: 0.02 }, ASPECT)).toBeNull();
    expect(pickPoseAt([], { x: 0.5, y: 0.5 }, ASPECT)).toBeNull();
  });

  it("personOrder nummeriert von links nach rechts", () => {
    expect(personOrder([right(0), left(0)], ASPECT)).toEqual([1, 0]);
    const blind = left(0).map((p): Landmark => [p[0], p[1], 0]);
    expect(personOrder([blind, right(0)], ASPECT)).toEqual([1]);
  });

  it("nearestSampleIndex findet das zeitlich nächste Sample", () => {
    const track = makeTrack(() => [], 100);
    expect(nearestSampleIndex(track, 74)).toBe(1);
    expect(nearestSampleIndex(track, 76)).toBe(2);
    expect(nearestSampleIndex(track, -10)).toBe(0);
    expect(nearestSampleIndex(track, 9999)).toBe(2);
    expect(nearestSampleIndex({ aspect: 1, samples: [] }, 0)).toBe(-1);
  });
});
