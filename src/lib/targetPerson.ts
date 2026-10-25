/**
 * Target person for the video import (Etappe 8f): the analysis keeps every detected person per
 * sample, the player picks one afterwards, and `trackTarget` follows that person through the
 * track. Pure logic, no React.
 *
 * Distances are measured in units of the image height: x is scaled by the aspect (as in
 * `computeAngles`), y stays as it is.
 */
import { isVisible, L } from "./pose";
import type { Landmark, Landmark3d } from "./types";
import type { PoseTrack } from "./videoChoreo";

/** People the video analysis detects per sample (MediaPipe numPoses). Live play keeps 1. */
export const VIDEO_MAX_POSES = 3;

/** Raw analysis result: every detected person per sample, in model order (which may change). */
export interface MultiPoseTrack {
  /** Source video width / height. Landmarks are normalized per axis (MediaPipe). */
  aspect: number;
  /**
   * Sorted by timeMs (video time). Empty array = no person detected. `worlds` (Etappe 13c) holds
   * the world landmarks parallel to `poses` (same index = same person, null if the model gave
   * none); absent when the estimator does not provide world landmarks. Person selection uses the
   * 2D poses only. `fallback` (Etappe 8i-2): no frame callback confirmed the frame, `timeMs` is
   * the seek target and the analyzed frame may be a neighbour.
   */
  samples: {
    timeMs: number;
    poses: Landmark[][];
    worlds?: (Landmark3d[] | null)[];
    fallback?: true;
  }[];
}

type MultiSample = MultiPoseTrack["samples"][number];
type TargetSample = PoseTrack["samples"][number];

/** Target sample with pose `poseIndex` of `s` (null = none), carrying its world if recorded. */
function targetSample(s: MultiSample, poseIndex: number | null): TargetSample {
  const landmarks = poseIndex === null ? null : (s.poses[poseIndex] ?? null);
  const mark = s.fallback ? { fallback: true as const } : {};
  if (!s.worlds) return { timeMs: s.timeMs, landmarks, ...mark };
  const world = poseIndex === null || !landmarks ? null : (s.worlds[poseIndex] ?? null);
  return { timeMs: s.timeMs, landmarks, world, ...mark };
}

/** The chosen person: pose `poseIndex` of sample `sampleIndex`. */
export interface TargetSeed {
  sampleIndex: number;
  poseIndex: number;
}

export interface Point {
  x: number;
  y: number;
}

// Start values, check on device: how far (image heights) the target's torso center may move
// between two samples where it is seen. The limit grows with the time the target was not seen
// and is capped so a long gap never jumps over to a person standing next to it.
/** Allowed jump between consecutive samples (50 ms apart in the analysis). */
export const TARGET_JUMP_BASE = 0.12;
/** Additional allowance per second since the target was last seen. */
export const TARGET_JUMP_PER_S = 0.6;
/** Upper bound of the allowed jump, whatever the gap. */
export const TARGET_JUMP_MAX = 0.5;
/** A tap within this distance (image heights) of a torso center picks that person. */
export const PICK_RADIUS = 0.15;

const TORSO = [L.lShoulder, L.rShoulder, L.lHip, L.rHip] as const;

/** Mean of the visible shoulders and hips, in image heights; null if none is visible. */
export function poseCenter(lm: Landmark[], aspect: number): Point | null {
  let x = 0,
    y = 0,
    n = 0;
  for (const i of TORSO) {
    const p = lm[i];
    if (!p || !isVisible(p)) continue;
    x += p[0] * aspect;
    y += p[1];
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/** Box around all visible landmarks, in image heights; null if none is visible. */
function poseBox(lm: Landmark[], aspect: number) {
  const vis = lm.filter((p) => isVisible(p));
  if (!vis.length) return null;
  const xs = vis.map((p) => p[0] * aspect);
  const ys = vis.map((p) => p[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** Body size: the longer side of the visible landmarks' box, in image heights (0 if none). */
export function poseSize(lm: Landmark[], aspect: number): number {
  const b = poseBox(lm, aspect);
  return b ? Math.max(b.right - b.left, b.bottom - b.top) : 0;
}

// Start values, check on device: a second person must show up in enough samples before the
// import offers a choice. A single stray detection (reflection, poster, a passer-by for a
// moment) keeps the exact single-person mapping.
/** Samples with at least two usable people needed for the multi-person mode. */
export const MIN_MULTI_SAMPLES = 5;
/** ... and their share of all samples with any pose. */
export const MIN_MULTI_RATIO = 0.05;
/** The seed prefers a sample that starts this many consecutive multi-person samples. */
export const SEED_RUN = 3;

/** People with a visible torso (the ones `trackTarget` can follow) in each sample. */
const usableCounts = (track: MultiPoseTrack) =>
  track.samples.map((s) => s.poses.filter((lm) => poseCenter(lm, track.aspect) !== null).length);

/**
 * Whether the track has several people often enough to offer a choice: at least
 * `MIN_MULTI_SAMPLES` samples, and `MIN_MULTI_RATIO` of the samples with any pose, with two or
 * more usable people. Otherwise the import behaves as before 8f.
 */
export function hasMultiplePersons(track: MultiPoseTrack): boolean {
  const counts = usableCounts(track);
  const multi = counts.filter((c) => c >= 2).length;
  const withPose = track.samples.filter((s) => s.poses.length > 0).length;
  return multi >= MIN_MULTI_SAMPLES && multi >= MIN_MULTI_RATIO * withPose;
}

/**
 * People the import works with: the most usable people in a sample in the multi-person mode,
 * else 1 if any sample has a pose, else 0.
 */
export function maxPersons(track: MultiPoseTrack): number {
  if (hasMultiplePersons(track)) return usableCounts(track).reduce((m, c) => Math.max(m, c), 0);
  return track.samples.some((s) => s.poses.length > 0) ? 1 : 0;
}

/**
 * Starting point for the selection. In the multi-person mode: the first sample that starts
 * `SEED_RUN` consecutive samples with the most people (judged by the fewest in that run, so a
 * one-off extra detection does not count), falling back to the first sample with two usable
 * people; there the largest usable person (usually the one closest to the camera). Otherwise
 * the first sample with a pose. Null if there is none.
 */
export function defaultTarget(track: MultiPoseTrack): TargetSeed | null {
  if (!hasMultiplePersons(track)) {
    const sampleIndex = track.samples.findIndex((s) => s.poses.length > 0);
    return sampleIndex < 0 ? null : { sampleIndex, poseIndex: 0 };
  }
  const counts = usableCounts(track);
  let sampleIndex = -1;
  let bestRun = 1;
  for (let i = 0; i + SEED_RUN <= counts.length; i++) {
    const run = Math.min(...counts.slice(i, i + SEED_RUN));
    if (run > bestRun) {
      bestRun = run;
      sampleIndex = i;
    }
  }
  if (sampleIndex < 0) sampleIndex = counts.findIndex((c) => c >= 2);
  const s = track.samples[sampleIndex];
  if (!s) return null;
  let best: { poseIndex: number; size: number } | null = null;
  for (const [poseIndex, lm] of s.poses.entries()) {
    if (poseCenter(lm, track.aspect) === null) continue;
    const size = poseSize(lm, track.aspect);
    if (!best || size > best.size) best = { poseIndex, size };
  }
  return best ? { sampleIndex, poseIndex: best.poseIndex } : null;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Allowed jump of the target center after not being seen for `gapMs`. */
export const jumpLimit = (gapMs: number) =>
  Math.min(TARGET_JUMP_BASE + (TARGET_JUMP_PER_S * Math.abs(gapMs)) / 1000, TARGET_JUMP_MAX);

/**
 * Follows the chosen person from the seed sample forward and backward: per sample the pose whose
 * torso center is nearest to the last known target center, if it lies within `jumpLimit` of the
 * time since the target was last seen. Otherwise the sample has no person (null); another person
 * is never taken instead. The returned landmarks are the track's own arrays (no copies). If the
 * track has world landmarks, each sample carries the world of the chosen pose (`world`).
 *
 * Outside the multi-person mode (`hasMultiplePersons`) the track maps 1:1 (first pose or null),
 * as before 8f, whatever the seed.
 */
export function trackTarget(track: MultiPoseTrack, seed: TargetSeed | null): PoseTrack {
  const { aspect, samples } = track;
  if (!hasMultiplePersons(track)) {
    return {
      aspect,
      samples: samples.map((s) => targetSample(s, 0)),
    };
  }
  const out = samples.map((s) => targetSample(s, null));
  const seedPose = seed ? samples[seed.sampleIndex]?.poses[seed.poseIndex] : undefined;
  const seedCenter = seedPose ? poseCenter(seedPose, aspect) : null;
  if (!seed || !seedPose || !seedCenter) return { aspect, samples: out };
  out[seed.sampleIndex] = targetSample(samples[seed.sampleIndex]!, seed.poseIndex);

  const follow = (dir: 1 | -1) => {
    let last = { center: seedCenter, timeMs: samples[seed.sampleIndex]!.timeMs };
    for (let i = seed.sampleIndex + dir; i >= 0 && i < samples.length; i += dir) {
      const s = samples[i]!;
      const limit = jumpLimit(s.timeMs - last.timeMs);
      let best: { poseIndex: number; center: Point; d: number } | null = null;
      for (const [poseIndex, lm] of s.poses.entries()) {
        const center = poseCenter(lm, aspect);
        if (!center) continue;
        const d = dist(center, last.center);
        if (d <= limit && (!best || d < best.d)) best = { poseIndex, center, d };
      }
      if (!best) continue;
      out[i] = targetSample(s, best.poseIndex);
      last = { center: best.center, timeMs: s.timeMs };
    }
  };
  follow(1);
  follow(-1);
  return { aspect, samples: out };
}

/** Index of the sample closest in time to `timeMs`; -1 for an empty track. */
export function nearestSampleIndex(track: MultiPoseTrack, timeMs: number): number {
  let best = -1;
  for (const [i, s] of track.samples.entries()) {
    const b = track.samples[best];
    if (!b || Math.abs(s.timeMs - timeMs) < Math.abs(b.timeMs - timeMs)) best = i;
  }
  return best;
}

/**
 * Hit test for a tap at `point` (normalized 0..1 per axis, like the landmarks): among the poses
 * whose visible landmarks' box contains the point, or whose torso center lies within
 * `PICK_RADIUS`, the one with the nearest torso center. Null if none.
 */
export function pickPoseAt(poses: Landmark[][], point: Point, aspect: number): number | null {
  const p = { x: point.x * aspect, y: point.y };
  let best: { i: number; d: number } | null = null;
  for (const [i, lm] of poses.entries()) {
    const center = poseCenter(lm, aspect);
    const box = poseBox(lm, aspect);
    if (!center || !box) continue;
    const d = dist(center, p);
    const inside = p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
    if ((inside || d <= PICK_RADIUS) && (!best || d < best.d)) best = { i, d };
  }
  return best?.i ?? null;
}

/**
 * Indices of the poses with a torso center, ordered left to right on screen: the numbering
 * "Person 1 … N" in the picker. Unmirrored image coordinates (as the preview shows them).
 */
export function personOrder(poses: Landmark[][], aspect: number): number[] {
  return poses
    .map((lm, i) => ({ i, c: poseCenter(lm, aspect) }))
    .filter((e): e is { i: number; c: Point } => e.c !== null)
    .sort((a, b) => a.c.x - b.c.x)
    .map((e) => e.i);
}
