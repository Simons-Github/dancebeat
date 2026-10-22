import { z } from "zod";

import { buildPoseTrackFile, type PoseTrackFile } from "./poseTrackFile";
import { fromLandmarks3d } from "./skeleton/fromLandmarks3d";
import { project } from "./skeleton/project";
import { rotateYaw, type Vec3 } from "./skeleton/vec";
import type { Landmark, Landmark3d } from "./types";

/**
 * AIST++ motion capture as a motion-pack source (Etappe 13h, docs/choreography-format.md#aist).
 * Pure logic without browser APIs; only used by scripts/aist/to-pose-track.ts.
 *
 * Input is the neutral JSON of the Python converter (13h-2): `keypoints3d_optim` as COCO-17
 * joints per frame in centimetres, AIST world (y up, right-handed). The output is a pose track v2
 * as the video import exports it, so `videoMotionSource` (13e-2) cuts the clips: world landmarks
 * in MediaPipe convention, 2D landmarks in camera space like an unmirrored front video
 * (`mirror: true`). The depth is kept in the world landmarks; 2D only comes from `project`.
 */

/** Sample spacing of the track in ms, as in the video analysis (about 20 Hz). */
export const AIST_STEP_MS = 50;

/** Video name prefix of AIST++ tracks; motion-pack clips get the source `video:<prefix><clip>`. */
export const AIST_VIDEO_PREFIX = "AIST++ ";

/** COCO-17 joint index to MediaPipe-33 landmark index (COCO odd indices are the left side). */
export const COCO_TO_MEDIAPIPE: readonly (readonly [coco: number, mediapipe: number])[] = [
  [0, 0], // nose
  [1, 2], // left eye
  [2, 5], // right eye
  [3, 7], // left ear
  [4, 8], // right ear
  [5, 11], // left shoulder
  [6, 12], // right shoulder
  [7, 13], // left elbow
  [8, 14], // right elbow
  [9, 15], // left wrist
  [10, 16], // right wrist
  [11, 23], // left hip
  [12, 24], // right hip
  [13, 25], // left knee
  [14, 26], // right knee
  [15, 27], // left ankle
  [16, 28], // right ankle
];

/**
 * Genres with standing dance close to the Just Dance style: House, LA and Middle Hip-hop,
 * Locking, Waacking, Jazz Ballet. Break and Krump are left out (floor work, hard to detect).
 */
export const AIST_STANDING_GENRES = ["gHO", "gLH", "gMH", "gLO", "gWA", "gJB"] as const;

/** Genre code (first name token, e.g. "gHO") of an AIST clip name, null without one. */
export function aistGenre(name: string): string | null {
  return /^(g[A-Z]{2})_/.exec(name)?.[1] ?? null;
}

const joint = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).nullable();

/** Neutral JSON of the Python converter; a missing joint is null. */
export const AistKeypointsSchema = z.object({
  fps: z.number().positive().max(240),
  joints: z.array(z.array(joint).length(17)).min(1),
});
export type AistKeypoints = z.infer<typeof AistKeypointsSchema>;

/** One entry of the clip list next to the script (scripts/aist/). */
export const AistClipSchema = z.object({
  name: z
    .string()
    .max(80)
    .refine(
      (n) => (AIST_STANDING_GENRES as readonly string[]).includes(aistGenre(n) ?? ""),
      "Genre ohne stehenden Tanz oder kein AIST-Clipname",
    ),
  /** Tempo of the AIST music piece. */
  bpm: z.number().min(30).max(300),
  /** Time of any beat in clip time; 0 until measured against the music. */
  beatPhaseMs: z.number().finite().optional(),
});
export type AistClip = z.infer<typeof AistClipSchema>;

export const AistClipListSchema = z
  .array(AistClipSchema)
  .refine((list) => new Set(list.map((c) => c.name)).size === list.length, "Clipnamen doppelt");

const MISSING: Landmark3d = [0, 0, 0, 0];

/**
 * One frame of COCO-17 joints (AIST world, cm) as 33 MediaPipe world landmarks: metres, origin at
 * the hip midpoint (shoulder midpoint without both hips), x unchanged, y down, z away from the
 * camera. Points without a COCO joint get visibility 0, so they are skipped, never scored. Null
 * when neither the hips nor the shoulders are complete.
 */
export function cocoToWorld(joints: readonly (Vec3 | null)[]): Landmark3d[] | null {
  const at = (i: number) => joints[i] ?? null;
  const mid = (a: Vec3 | null, b: Vec3 | null): Vec3 | null =>
    a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null;
  const origin = mid(at(11), at(12)) ?? mid(at(5), at(6));
  if (!origin) return null;
  const out: Landmark3d[] = Array.from({ length: 33 }, () => [...MISSING]);
  for (const [coco, mp] of COCO_TO_MEDIAPIPE) {
    const p = at(coco);
    if (!p) continue;
    // AIST (y up, right-handed) to MediaPipe (y down, z away): a 180° turn about x, no mirroring.
    out[mp] = [
      (p[0] - origin[0]) / 100 + 0,
      -(p[1] - origin[1]) / 100 + 0,
      -(p[2] - origin[2]) / 100 + 0,
      1,
    ];
  }
  return out;
}

const DEG = 180 / Math.PI;

/**
 * Facing of a clip: circular mean of the per-frame yaw (`fromLandmarks3d`) over the frames with a
 * body axis; null if there is none. One value per clip, so turns within the clip stay visible.
 */
export function clipYawDeg(frames: readonly (Landmark3d[] | null)[]): number | null {
  let sx = 0,
    sy = 0,
    n = 0;
  for (const f of frames) {
    if (!f) continue;
    const sk = fromLandmarks3d(f);
    // fromLandmarks3d returns no bones exactly when it found no body axis.
    if (Object.keys(sk.bones).length === 0) continue;
    sx += Math.cos(sk.root.yawDeg / DEG);
    sy += Math.sin(sk.root.yawDeg / DEG);
    n++;
  }
  return n === 0 ? null : Math.atan2(sy, sx) * DEG + 0;
}

/** Turns MediaPipe world points about the vertical by `deg` (world yaw convention). */
function turnWorld(frame: Landmark3d[], deg: number): Landmark3d[] {
  return frame.map((p) => {
    // MediaPipe (y down, z away) and the world system (y up, z toward the viewer) share x.
    const [x, y, z] = rotateYaw([p[0], -p[1], -p[2]], deg);
    return [x + 0, -y + 0, -z + 0, p[3] ?? 1];
  });
}

/** Camera space of an unmirrored front video: `project` draws mirror space, so x → 1 − x. */
const toCamera = (lm: Landmark[]): Landmark[] =>
  lm.map((p): Landmark => (p.length === 3 ? [1 - p[0], p[1], p[2]] : [1 - p[0], p[1]]));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Pose track v2 of an AIST clip, resampled to one sample per `stepMs` (nearest source frame). The
 * world points are turned by the clip's mean facing so the dancer faces the camera on average.
 * Warnings (German) for a face pointing backwards in most frames (hint at swapped axes) and for
 * more than half the samples without a pose. Throws if no sample has a pose.
 */
export function aistPoseTrack(
  data: AistKeypoints,
  clip: AistClip,
  opts: { now: number; stepMs?: number },
): { file: PoseTrackFile; warnings: string[] } {
  const stepMs = opts.stepMs ?? AIST_STEP_MS;
  const frames: { timeMs: number; world: Landmark3d[] | null }[] = [];
  for (let k = 0; ; k++) {
    const timeMs = k * stepMs;
    const index = Math.round((timeMs * data.fps) / 1000);
    const joints = data.joints[index];
    if (!joints) break;
    frames.push({ timeMs, world: cocoToWorld(joints) });
  }
  const yaw = clipYawDeg(frames.map((f) => f.world));
  if (yaw === null) throw new Error(`${clip.name}: kein Bild mit erkennbarer Körperachse`);

  const forward: number[] = [];
  let empty = 0;
  const samples = frames.map(({ timeMs, world }) => {
    if (!world) {
      empty++;
      return { timeMs, landmarks: null, world: null };
    }
    const turned = turnWorld(world, -yaw);
    const sk = fromLandmarks3d(turned);
    if (sk.bones.neck) forward.push(sk.bones.neck[2]);
    return { timeMs, landmarks: toCamera(project(sk)), world: turned };
  });

  const warnings: string[] = [];
  if (forward.length > 0 && median(forward) < 0)
    warnings.push(
      `${clip.name}: Gesicht meist nach hinten, Achsen gespiegelt oder vertauscht (y nach oben, rechtshändig)?`,
    );
  if (empty * 2 > samples.length)
    warnings.push(`${clip.name}: ${empty} von ${samples.length} Proben ohne Pose`);

  // buildPoseTrackFile rounds the world points like the video export.
  const file = buildPoseTrackFile({
    exportedAt: opts.now,
    video: `${AIST_VIDEO_PREFIX}${clip.name}`,
    bpm: clip.bpm,
    beatPhaseMs: clip.beatPhaseMs ?? 0,
    range: { startMs: 0, endMs: samples.at(-1)?.timeMs ?? 0 },
    mirror: true,
    movePlacement: "holds",
    track: { aspect: 1, samples },
  });
  return { file, warnings };
}
