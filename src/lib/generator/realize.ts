import { computeAngles } from "../pose";
import { roundAngles, roundLandmark, roundSkeleton } from "../precision";
import { interpolate } from "../skeleton/interpolate";
import { project } from "../skeleton/project";
import { BONE_IDS, type Skeleton3D } from "../skeleton/types";
import type { Frame, MotionClip, MotionPack, Move } from "../types";
import { beatMsOf } from "./plan";
import { MIN_MOVE_ENERGY } from "./select";
import type { ClipRef, Plan } from "./types";

/**
 * Turns placed clips into choreography frames and moves. Every clip starts with its arrival in
 * its first keyframe; before that, the previous pose is held and blended into it over
 * BLEND_BEATS (eased). Frames lie on every keyframe and move, plus every FRAME_STEP_MS while
 * the pose changes; held poses need no frames in between (frameAt holds them).
 */

/** Beats of the eased blend from one clip into the next. */
export const BLEND_BEATS = 1;
/**
 * Frame spacing while the pose changes. Below DENSE_FRAME_GAP_MS, so frameAt interpolates
 * linearly in between and the eased blend sampled here stays one smooth curve.
 */
export const FRAME_STEP_MS = 100;

interface Key {
  t: number;
  pose: Skeleton3D;
  /** The segment ending at this key is a blend between clips (eased, not linear). */
  ease: boolean;
}

const smoothstep = (u: number) => u * u * (3 - 2 * u);

function samePose(a: Skeleton3D, b: Skeleton3D): boolean {
  if (a === b) return true;
  const eq = (x: readonly number[] | undefined, y: readonly number[] | undefined) =>
    x === y || (!!x && !!y && x.every((v, i) => v === y[i]));
  return (
    a.root.yawDeg === b.root.yawDeg &&
    eq(a.root.pos, b.root.pos) &&
    BONE_IDS.every((id) => eq(a.bones[id], b.bones[id]))
  );
}

/** Pose at time `t` on the key timeline (held before the first and after the last key). */
function poseOnTimeline(keys: readonly Key[], t: number): Skeleton3D {
  let lo = 0,
    hi = keys.length - 1;
  if (t <= keys[0]!.t) return keys[0]!.pose;
  if (t >= keys[hi]!.t) return keys[hi]!.pose;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (keys[m]!.t <= t) lo = m;
    else hi = m;
  }
  const a = keys[lo]!,
    b = keys[hi]!;
  if (samePose(a.pose, b.pose)) return a.pose;
  const u = (t - a.t) / (b.t - a.t);
  return interpolate(a.pose, b.pose, b.ease ? smoothstep(u) : u);
}

/** The keyframe pose of a clip at `beat` (between keyframes: as `poseAtBeat`, linear). */
function clipPoseAt(clip: MotionClip, beat: number): Skeleton3D {
  const kfs = clip.keyframes;
  if (beat <= kfs[0]!.beat) return kfs[0]!.pose3d;
  for (let i = 1; i < kfs.length; i++) {
    const a = kfs[i - 1]!,
      b = kfs[i]!;
    if (beat <= b.beat) return interpolate(a.pose3d, b.pose3d, (beat - a.beat) / (b.beat - a.beat));
  }
  return kfs[kfs.length - 1]!.pose3d;
}

/**
 * Rest pose for the intro: the calmest clip below MIN_MOVE_ENERGY sharing a style with `first`
 * (any style without clips).
 */
function restPose(pack: MotionPack, first: MotionClip | undefined): Skeleton3D | null {
  const rest = pack.clips
    .filter(
      (c) =>
        c.energy < MIN_MOVE_ENERGY && (!first || c.styles.some((s) => first.styles.includes(s))),
    )
    .sort((a, b) => a.energy - b.energy || (a.id < b.id ? -1 : 1))[0];
  return rest ? clipPoseAt(rest, rest.anchorBeat) : null;
}

/**
 * Builds the key timeline: the rest pose (or the first clip's anchor pose) from 0; each clip
 * starts `anchorBeat` before its move and keeps its keyframes until BLEND_BEATS before the next
 * clip starts (at least up to its anchor; the closing clip until the end of the song); between
 * clips the pose is held, then blended. Without clips the rest pose stands for the whole song.
 */
function buildTimeline(
  plan: Plan,
  clips: readonly ClipRef[],
  byId: ReadonlyMap<string, MotionClip>,
  pack: MotionPack,
): Key[] {
  const beatMs = beatMsOf(plan.bpm);
  const timeOf = (beat: number) => plan.beatPhaseMs + beat * beatMs;
  const keys: Key[] = [];
  const push = (t: number, pose: Skeleton3D, ease: boolean) => {
    const last = keys[keys.length - 1];
    if (!last || t > last.t) keys.push({ t, pose, ease });
  };
  const hold = (until: number) => {
    const last = keys[keys.length - 1];
    if (last) push(until, last.pose, false);
  };

  const first = clips[0] && byId.get(clips[0].clipId);
  const rest = restPose(pack, first);
  const startPose = rest ?? (first && clipPoseAt(first, first.anchorBeat));
  if (!startPose) return [];
  push(0, startPose, false);

  const startOf = (ref: ClipRef) => ref.beat - byId.get(ref.clipId)!.anchorBeat;
  clips.forEach((ref, i) => {
    const clip = byId.get(ref.clipId)!;
    const next = clips[i + 1];
    const start = startOf(ref);
    // Hold the previous pose, then blend into this clip's first keyframe.
    hold(timeOf(start + clip.keyframes[0]!.beat - BLEND_BEATS));
    const end = next
      ? Math.max(clip.anchorBeat, Math.min(clip.beats, startOf(next) - start - BLEND_BEATS))
      : Math.min(clip.beats, clip.anchorBeat + ref.lengthBeats);
    clip.keyframes.forEach((k, j) => {
      if (k.beat <= end) push(timeOf(start + k.beat), k.pose3d, j === 0);
    });
    if (clip.keyframes.every((k) => k.beat !== end) && end > clip.keyframes[0]!.beat)
      push(timeOf(start + end), clipPoseAt(clip, end), false);
  });
  hold(plan.durationMs);
  return keys;
}

/**
 * Realizes the placed clips: frames with `pose3d` (rounded like the video import), 2D
 * landmarks via `project` and angles via `computeAngles` (aspect 1, square space); moves on the
 * clip anchors with the clip's label and icon. Frame and move times are whole milliseconds.
 * Also usable without `planStructure`/`selectMoves` (fixed clip sequences, Etappe 14).
 */
export function realizeFrames(
  plan: Plan,
  clips: readonly ClipRef[],
  pack: MotionPack,
): { frames: Frame[]; moves: Move[] } {
  const byId = new Map(pack.clips.map((c) => [c.id, c]));
  for (const ref of clips)
    if (!byId.has(ref.clipId)) throw new Error(`Unbekannter Clip ${ref.clipId}`);
  const sorted = [...clips].sort((a, b) => a.beat - b.beat);
  const beatMs = beatMsOf(plan.bpm);
  const timeOf = (beat: number) => plan.beatPhaseMs + beat * beatMs;

  const moves: Move[] = sorted.map((ref) => {
    const clip = byId.get(ref.clipId)!;
    return {
      timeMs: Math.round(timeOf(ref.beat)),
      label: clip.label,
      iconId: clip.iconId ?? clip.id,
      gold: ref.gold,
    };
  });

  const keys = buildTimeline(plan, sorted, byId, pack);
  if (!keys.length) return { frames: [], moves };

  // Frame times (whole ms → exact time): samples first, so keys and moves win on collisions.
  const times = new Map<number, number>();
  const at = (t: number) => times.set(Math.round(t), t);
  keys.forEach((b, i) => {
    const a = keys[i - 1];
    if (!a || samePose(a.pose, b.pose)) return;
    for (let t = a.t + FRAME_STEP_MS; t < b.t - FRAME_STEP_MS / 2; t += FRAME_STEP_MS) at(t);
  });
  for (const k of keys) at(k.t);
  for (const ref of sorted) at(timeOf(ref.beat));

  const frames = [...times.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([timeMs, t]): Frame => {
      const pose3d = roundSkeleton(poseOnTimeline(keys, t));
      const landmarks = project(pose3d).map(roundLandmark);
      return {
        timeMs,
        landmarks,
        angles: roundAngles(computeAngles(landmarks, { aspect: 1 })),
        pose3d,
      };
    });
  return { frames, moves };
}
