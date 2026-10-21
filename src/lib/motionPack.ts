import { angleDiff } from "./angle";
import { ANGLE_SEGMENTS, computeAngles, figure3d, type FigureParams } from "./pose";
import { MOTION_PACK_VERSION, MotionPackSchema } from "./schema";
import { interpolate } from "./skeleton/interpolate";
import { mirror3d } from "./skeleton/mirror";
import { project } from "./skeleton/project";
import {
  BONE_ANCHORS,
  BONE_IDS,
  BONE_LENGTHS,
  type BoneId,
  type Skeleton3D,
} from "./skeleton/types";
import { dot, rotateYaw, type Vec3 } from "./skeleton/vec";
import type { AngleKey, MotionClip, MotionKeyframe, MotionPack } from "./types";

/**
 * Offline construction of the motion pack (docs/choreography-format.md#motion-paket): metrics,
 * playability filters, grouping of similar clips, mirror pairs and transition counts. Pure
 * logic without browser APIs; the sources are passed in (scripts/build-motion-pack.ts).
 */

/** Anchor poses closer than this (max bone angle) count as the same move and are merged. */
export const GROUP_MAX_DEG = 20;
/** A clip is the mirror of another if its anchor is this close to the mirrored anchor. */
export const MIRROR_MAX_DEG = 5;
/** Below half its length a projected segment is too foreshortened for a stable 2D angle. */
export const MIN_PROJECTED_FRACTION = 0.5;
/** Scoring needs at least half of the 8 limb angles at the anchor to tell moves apart. */
export const MIN_MEASURABLE_ANGLES = 4;
/** Beyond ±45° from frontal the far side of the body hides and the projection degenerates. */
export const MAX_YAW_DEG = 45;
/** Faster bones blur on a phone camera at 30 fps and are hard to copy from the coach. */
export const MAX_BONE_SPEED_DEG_PER_S = 720;
/** Tempo assumed for clips without `sourceBpm`: a fast pop tempo, so the check is conservative. */
export const FALLBACK_BPM = 150;
/** A leg bone this far from neutral makes a clip a leg move (difficulty 2). */
export const LEG_DIFFICULTY_DEG = 15;
/** Mean bone angle to neutral that counts as full energy. */
export const ENERGY_FULL_DEG = 90;
/** Torso more than 45° from upright (bone y below cos 45°): lying or bending to the floor. */
export const MIN_TORSO_UP = Math.SQRT1_2;
/** Mean knee height must be at least this far below the pelvis (metres); 0 = sitting. */
export const KNEE_MARGIN_M = 0.1;
/** Pelvis above the lowest ankle, as a fraction of leg length; kneeling gives 0.5, squat ~0.8. */
export const MIN_PELVIS_HEIGHT_FRACTION = 0.55;
/** Decimals of every number in the pack (as `pose3d` in choreography v2). */
export const PACK_DECIMALS = 3;

/** A clip before the metrics are computed (`buildMotionPack` adds them). */
export type RawClip = Omit<MotionClip, "energy" | "difficulty" | "playability" | "mirrorOf">;

export interface MotionSource {
  clips: RawClip[];
  /** Clip id sequences as they occur in the source, for the transition counts. */
  sequences: readonly (readonly string[])[];
  style: string;
}

type LimbKey = Exclude<AngleKey, "torsoLean">;
const LIMB_KEYS = Object.keys(ANGLE_SEGMENTS) as LimbKey[];
const LEG_BONES: readonly BoneId[] = ["leftThigh", "leftShin", "rightThigh", "rightShin"];
const DEG = 180 / Math.PI;

/** Angle between two unit vectors in degrees. */
const angleBetween = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  Math.acos(Math.max(-1, Math.min(1, dot([a[0], a[1], a[2]], [b[0], b[1], b[2]])))) * DEG;

/** Per-bone angle (degrees) for every bone present in both poses. */
function boneAngles(a: Skeleton3D, b: Skeleton3D): Partial<Record<BoneId, number>> {
  const out: Partial<Record<BoneId, number>> = {};
  for (const id of BONE_IDS) {
    const va = a.bones[id],
      vb = b.bones[id];
    if (va && vb) out[id] = angleBetween(va, vb);
  }
  return out;
}

/** Absolute facing difference of two poses in degrees (shortest arc). */
const yawDelta = (a: Skeleton3D, b: Skeleton3D) =>
  Math.abs(angleDiff(a.root.yawDeg, b.root.yawDeg));

/**
 * Distance of two poses: the largest angle between corresponding bone directions (degrees),
 * with the facing (root yaw) difference counted as one more term, so a turned pose is not equal
 * to the frontal one. The maximum, not the mean: disco-l and left-up differ mainly in one
 * forearm (~40°), a mean would merge them. Infinity unless all 12 bones are present in both.
 */
export function boneDistance(a: Skeleton3D, b: Skeleton3D): number {
  const angles = Object.values(boneAngles(a, b));
  return angles.length === BONE_IDS.length ? Math.max(yawDelta(a, b), ...angles) : Infinity;
}

/** Pose at `beat`, interpolated between the keyframes and held before the first/after the last. */
export function poseAtBeat(keyframes: readonly MotionKeyframe[], beat: number): Skeleton3D | null {
  const first = keyframes[0];
  if (!first) return null;
  if (beat <= first.beat) return first.pose3d;
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1]!,
      b = keyframes[i]!;
    if (beat <= b.beat) return interpolate(a.pose3d, b.pose3d, (beat - a.beat) / (b.beat - a.beat));
  }
  return keyframes[keyframes.length - 1]!.pose3d;
}

const anchorPose = (c: Pick<RawClip, "keyframes" | "anchorBeat">) =>
  poseAtBeat(c.keyframes, c.anchorBeat);

/** Bone whose landmark endpoints are the given angle segment. */
const boneOfSegment = (seg: readonly [number, number]): BoneId | undefined =>
  BONE_IDS.find((id) => BONE_ANCHORS[id][0] === seg[0] && BONE_ANCHORS[id][1] === seg[1]);

/** Projected length of a bone as a fraction of its standard length (frontal, orthographic). */
function projectedFraction(pose: Skeleton3D, bone: BoneId): number {
  const d = pose.bones[bone];
  if (!d) return 0;
  const v = rotateYaw(d, pose.root.yawDeg);
  return Math.hypot(v[0], v[1]);
}

/**
 * The limb angles of `pose` that are safely measurable in the frontal projection:
 * `computeAngles(project(pose))` (aspect 1) yields the angle, and both the segment and its
 * reference (torso for shoulder and hip) keep at least MIN_PROJECTED_FRACTION of their length.
 */
export function measurableAngles(pose: Skeleton3D): LimbKey[] {
  const angles = computeAngles(project(pose), { aspect: 1 });
  return LIMB_KEYS.filter((k) => {
    if (angles[k] == null) return false;
    const { ref, seg } = ANGLE_SEGMENTS[k];
    const bones = [boneOfSegment(seg), ref === "torso" ? "torso" : boneOfSegment(ref)];
    return bones.every((b) => b && projectedFraction(pose, b) >= MIN_PROJECTED_FRACTION);
  });
}

/** Fraction (0..1) of the 8 limb angles that are safely measurable; flat demo poses give 1. */
export const playability = (pose: Skeleton3D) => measurableAngles(pose).length / LIMB_KEYS.length;

/** Mean bone angle to the neutral pose / ENERGY_FULL_DEG, clamped to 0..1. */
export function energy(pose: Skeleton3D, neutral: Skeleton3D): number {
  const angles = Object.values(boneAngles(pose, neutral));
  if (!angles.length) return 0;
  const mean = angles.reduce((s, a) => s + a, 0) / angles.length;
  return Math.min(1, mean / ENERGY_FULL_DEG);
}

/**
 * 2 if a leg bone (thigh or shin) differs from neutral by more than LEG_DIFFICULTY_DEG, else 1.
 * Difficulty 3 is reserved for later sources (video tracks, AIST++).
 */
export function difficulty(pose: Skeleton3D, neutral: Skeleton3D): 1 | 2 {
  const angles = boneAngles(pose, neutral);
  return LEG_BONES.some((b) => (angles[b] ?? 0) > LEG_DIFFICULTY_DEG) ? 2 : 1;
}

// ---- Filters: each returns a reason (German, printed by the build script) or null. ----

/** (a) At least MIN_MEASURABLE_ANGLES arm and leg angles must be measurable at the anchor. */
export function checkMeasurable(clip: RawClip): string | null {
  const pose = anchorPose(clip);
  const n = pose ? measurableAngles(pose).length : 0;
  return n >= MIN_MEASURABLE_ANGLES
    ? null
    : `nur ${n} sicher messbare Winkel am Anker (mindestens ${MIN_MEASURABLE_ANGLES})`;
}

/** (b) Facing at most MAX_YAW_DEG from frontal at every keyframe. */
export function checkYaw(clip: RawClip): string | null {
  const worst = Math.max(
    ...clip.keyframes.map((k) => Math.abs(angleDiff(k.pose3d.root.yawDeg, 0))),
  );
  return worst <= MAX_YAW_DEG ? null : `Blickrichtung ${Math.round(worst)}° von frontal`;
}

/** The pose with its bones turned by the root yaw (world directions), yaw then 0. */
function toWorld(p: Skeleton3D): Skeleton3D {
  const bones: Skeleton3D["bones"] = {};
  for (const id of BONE_IDS) {
    const v = p.bones[id];
    if (v) bones[id] = rotateYaw(v, p.root.yawDeg);
  }
  return { root: { pos: p.root.pos, yawDeg: 0 }, bones };
}

/**
 * Heights relative to the pelvis centre (metres, up positive). The body system is only
 * yaw-rotated against the world (`fromLandmarks3d` rotates the bone directions about the
 * vertical by −yaw; `figure3d` is flat with yaw 0), so body y is world up and heights follow
 * from the bone y components and BONE_LENGTHS alone.
 */
function legHeights(pose: Skeleton3D) {
  const { hips, leftThigh, rightThigh, leftShin, rightShin } = pose.bones;
  const hipY = (hips?.[1] ?? 0) * BONE_LENGTHS.hips * 0.5;
  const knees: number[] = [];
  const ankles: number[] = [];
  const leg = (hy: number, thigh: Vec3 | undefined, shin: Vec3 | undefined) => {
    if (!thigh) return;
    const knee = hy + thigh[1] * BONE_LENGTHS.leftThigh;
    knees.push(knee);
    if (shin) ankles.push(knee + shin[1] * BONE_LENGTHS.leftShin);
  };
  leg(hipY, leftThigh, leftShin);
  leg(-hipY, rightThigh, rightShin);
  const meanKnee = knees.length ? knees.reduce((s, y) => s + y, 0) / knees.length : null;
  const lowestAnkle = ankles.length ? Math.min(...ankles) : null;
  return { meanKnee, lowestAnkle };
}

const LEG_LENGTH_M = BONE_LENGTHS.leftThigh + BONE_LENGTHS.leftShin;

/** Why `pose` counts as floor work, or null. Missing bones skip the respective check. */
function floorWorkReason(pose: Skeleton3D): string | null {
  const torso = pose.bones.torso;
  if (torso && torso[1] < MIN_TORSO_UP) return "Rumpf mehr als 45° geneigt";
  const { meanKnee, lowestAnkle } = legHeights(pose);
  if (meanKnee !== null && meanKnee > -KNEE_MARGIN_M) return "Knie nicht unter der Hüfte";
  if (lowestAnkle !== null && -lowestAnkle < MIN_PELVIS_HEIGHT_FRACTION * LEG_LENGTH_M)
    return "Hüfte zu tief über dem Boden";
  return null;
}

/**
 * (c) No floor work at any keyframe: the torso stays within 45° of upright (MIN_TORSO_UP), the
 * mean knee height is at least KNEE_MARGIN_M below the pelvis, and the pelvis stays at least
 * MIN_PELVIS_HEIGHT_FRACTION of the leg length above the lowest ankle.
 */
export function checkFloorWork(clip: RawClip): string | null {
  for (const k of clip.keyframes) {
    const reason = floorWorkReason(k.pose3d);
    if (reason) return `Bodenarbeit bei Beat ${k.beat}: ${reason}`;
  }
  return null;
}

/**
 * (d) The fastest bone between consecutive keyframes turns at most MAX_BONE_SPEED_DEG_PER_S,
 * with beats converted via `sourceBpm` (FALLBACK_BPM without). Bones are compared in the world
 * (body system turned by the root yaw), and the yaw change itself counts as a rotation too, so
 * a fast turn of the whole body is caught even where a bone lies on the vertical axis.
 */
export function checkSpeed(clip: RawClip): string | null {
  const secPerBeat = 60 / (clip.sourceBpm ?? FALLBACK_BPM);
  let worst = 0;
  for (let i = 1; i < clip.keyframes.length; i++) {
    const a = clip.keyframes[i - 1]!,
      b = clip.keyframes[i]!;
    const deg = Math.max(
      yawDelta(a.pose3d, b.pose3d),
      ...Object.values(boneAngles(toWorld(a.pose3d), toWorld(b.pose3d))),
    );
    worst = Math.max(worst, deg / ((b.beat - a.beat) * secPerBeat));
  }
  return worst <= MAX_BONE_SPEED_DEG_PER_S
    ? null
    : `Knochen dreht ${Math.round(worst)}°/s (höchstens ${MAX_BONE_SPEED_DEG_PER_S})`;
}

export const CLIP_FILTERS = [checkMeasurable, checkYaw, checkFloorWork, checkSpeed] as const;

// ---- Grouping, mirrors, transitions ----

/**
 * Merges clips with similar anchor poses: deterministic leader clustering (clips sorted by id,
 * each joins the first group whose leader is within `maxDeg`, else starts one). Only clips with
 * the same `beats` and the same set of `styles` can share a group, so a merge never changes a
 * clip's length or moves a transition to a clip without that style. Of each group
 * the medoid (smallest summed distance to the other members, ties by id) is kept. `idMap` maps
 * every input id to the id of its kept representative.
 */
export function groupClips<C extends RawClip>(
  clips: readonly C[],
  maxDeg = GROUP_MAX_DEG,
): { kept: C[]; idMap: Map<string, string> } {
  const sorted = [...clips].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups: { key: string; leader: Skeleton3D | null; members: C[] }[] = [];
  for (const c of sorted) {
    const pose = anchorPose(c);
    const key = JSON.stringify([c.beats, [...new Set(c.styles)].sort()]);
    const g =
      pose &&
      groups.find((g) => g.key === key && g.leader && boneDistance(g.leader, pose) <= maxDeg);
    if (g) g.members.push(c);
    else groups.push({ key, leader: pose, members: [c] });
  }
  const kept: C[] = [];
  const idMap = new Map<string, string>();
  for (const { members } of groups) {
    const poses = members.map(anchorPose);
    let best = members[0]!,
      bestSum = Infinity;
    members.forEach((m, i) => {
      const pi = poses[i];
      const sum = poses.reduce(
        (s, pj, j) => s + (i === j || !pi || !pj ? 0 : boneDistance(pi, pj)),
        0,
      );
      if (sum < bestSum) [best, bestSum] = [m, sum];
    });
    kept.push(best);
    for (const m of members) idMap.set(m.id, best.id);
  }
  return { kept, idMap };
}

/**
 * Sets `mirrorOf`: each clip's partner is the clip (same `beats`) whose anchor is closest to the
 * mirrored own anchor, within MIRROR_MAX_DEG. If that is the clip itself, it is symmetric and
 * gets none; only reciprocal pairs are kept. Existing `mirrorOf` values are replaced.
 */
export function assignMirrors<C extends RawClip>(
  clips: readonly C[],
): (C & { mirrorOf?: string })[] {
  const anchors = clips.map(anchorPose);
  const partner = clips.map((c, i) => {
    const own = anchors[i];
    if (!own) return -1;
    const mirrored = mirror3d(own);
    // The clip itself is checked first and wins ties, so symmetric clips stay unpaired.
    const order = [i, ...clips.keys()].filter((j, k) => k === 0 || j !== i);
    let best = -1,
      bestDeg = MIRROR_MAX_DEG;
    for (const j of order) {
      const other = anchors[j];
      if (!other || clips[j]!.beats !== c.beats) continue;
      const d = boneDistance(mirrored, other);
      if (d < bestDeg || (best < 0 && d <= bestDeg)) [best, bestDeg] = [j, d];
    }
    return best;
  });
  return clips.map((c, i) => {
    const { mirrorOf: _, ...rest } = c as C & { mirrorOf?: string };
    const j = partner[i]!;
    return j >= 0 && j !== i && partner[j] === i
      ? { ...rest, mirrorOf: clips[j]!.id }
      : { ...rest };
  }) as (C & { mirrorOf?: string })[];
}

export type TransitionCounts = Record<string, Record<string, number>>;

/**
 * Counts consecutive clip pairs in the sequences, mapped through `idMap` (group
 * representatives). A pair with an id missing from `idMap` (filtered out) is skipped, not
 * bridged, so no transition is invented that the source never had. `style` only names the
 * result's key.
 */
export function countTransitions(
  sequences: readonly (readonly string[])[],
  style: string,
  idMap: ReadonlyMap<string, string>,
): Record<string, TransitionCounts> {
  const counts: TransitionCounts = {};
  for (const seq of sequences) {
    for (let i = 1; i < seq.length; i++) {
      const a = idMap.get(seq[i - 1]!),
        b = idMap.get(seq[i]!);
      if (!a || !b) continue;
      const row = (counts[a] ??= {});
      row[b] = (row[b] ?? 0) + 1;
    }
  }
  return { [style]: counts };
}

// ---- Sources ----

export const demoClipId = (poseId: string) => `demo:${poseId}`;

/**
 * One clip per demo pose: a held pose of one beat, keyframes at beats 0 and 1 with the same
 * `figure3d` pose, anchor at beat 0. Convention: a clip starts at its arrival in the pose; the
 * blend from the previous move into it happens before the clip (the generator's job, 13f).
 * `neutral` is included too (low energy; the generator decides whether to use it).
 */
export function clipsFromPoses(
  poses: Readonly<Record<string, { label: string; p: FigureParams }>>,
): RawClip[] {
  return Object.entries(poses).map(([poseId, { label, p }]) => {
    const pose3d = figure3d(p);
    return {
      id: demoClipId(poseId),
      label,
      iconId: poseId,
      styles: ["party"],
      beats: 1,
      anchorBeat: 0,
      keyframes: [
        { beat: 0, pose3d },
        { beat: 1, pose3d },
      ],
      source: "demo",
    };
  });
}

/** The demo source of the motion pack: demo poses plus the demo song sequences (pose ids). */
export function demoMotionSource(
  poses: Readonly<Record<string, { label: string; p: FigureParams }>>,
  sequences: readonly (readonly string[])[],
): MotionSource {
  return {
    clips: clipsFromPoses(poses),
    sequences: sequences.map((s) => s.map(demoClipId)),
    style: "party",
  };
}

// ---- Build ----

const round = (x: number) => {
  const f = 10 ** PACK_DECIMALS;
  return Math.round(x * f) / f + 0; // + 0 turns -0 into 0
};

function roundPose(p: Skeleton3D): Skeleton3D {
  const bones: Skeleton3D["bones"] = {};
  for (const id of BONE_IDS) {
    const v = p.bones[id];
    if (v) bones[id] = [round(v[0]), round(v[1]), round(v[2])];
  }
  const [x, y, z] = p.root.pos;
  return { root: { pos: [round(x), round(y), round(z)], yawDeg: round(p.root.yawDeg) }, bones };
}

export interface BuildResult {
  pack: MotionPack;
  rejected: { id: string; reason: string }[];
}

/**
 * Builds the motion pack: metrics per clip, filters (CLIP_FILTERS), grouping, mirror pairs and
 * transition counts per style (summed over sources). Numbers are rounded to PACK_DECIMALS,
 * clips sorted by id; the result is validated with MotionPackSchema.
 */
export function buildMotionPack(input: {
  sources: readonly MotionSource[];
  neutral: Skeleton3D;
}): BuildResult {
  const rejected: BuildResult["rejected"] = [];
  const accepted: MotionClip[] = [];
  for (const src of input.sources) {
    for (const raw of src.clips) {
      const reason = CLIP_FILTERS.map((f) => f(raw)).find((r) => r !== null);
      if (reason) {
        rejected.push({ id: raw.id, reason });
        continue;
      }
      const pose = anchorPose(raw)!; // a clip passing checkMeasurable has an anchor
      accepted.push({
        ...raw,
        difficulty: difficulty(pose, input.neutral),
        energy: round(energy(pose, input.neutral)),
        playability: round(playability(pose)),
      });
    }
  }
  const { kept, idMap } = groupClips(accepted);
  const clips = assignMirrors(kept)
    .map((c) => ({
      ...c,
      keyframes: c.keyframes.map((k) => ({ ...k, pose3d: roundPose(k.pose3d) })),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const transitions: MotionPack["transitions"] = {};
  for (const src of input.sources) {
    for (const [style, rows] of Object.entries(countTransitions(src.sequences, src.style, idMap))) {
      const target = (transitions[style] ??= {});
      for (const [a, row] of Object.entries(rows)) {
        const t = (target[a] ??= {});
        for (const [b, n] of Object.entries(row)) t[b] = (t[b] ?? 0) + n;
      }
    }
  }
  const pack = MotionPackSchema.parse({ version: MOTION_PACK_VERSION, clips, transitions });
  return { pack, rejected };
}

// ---- Loading ----

let loading: Promise<MotionPack> | null = null;

/**
 * The shipped motion pack (src/data/motion-pack.json), loaded on first use via dynamic
 * `import()` and validated. Memoized; a failed load is retried on the next call.
 */
export function loadMotionPack(): Promise<MotionPack> {
  loading ??= import("../data/motion-pack.json")
    .then((m: { default: unknown }) => MotionPackSchema.parse(m.default))
    .catch((e: unknown) => {
      loading = null;
      throw e;
    });
  return loading;
}
