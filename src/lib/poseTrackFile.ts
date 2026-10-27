/**
 * Raw pose track of a video import plus its settings, exported in dev mode for tuning the
 * import offline (`scripts/tune-video-choreo.ts`) without running MediaPipe again. Not part of the
 * library and never persisted; the file contains landmarks only, no image data.
 *
 * Version 2 (Etappe 13c) adds optional world landmarks (`world`) per sample; version 1 files
 * stay readable and must not contain them.
 */
import { z } from "zod";

import { SHIPPED_MODELS } from "./mediapipe";
import { Landmark3dSchema, LandmarkSchema } from "./schema";
import type { Landmark3d } from "./types";
import { MOVE_PLACEMENTS, type PoseTrack, type VideoChoreoOptions } from "./videoChoreo";

export const POSE_TRACK_FORMAT = "dancebeat-pose-track";
export const POSE_TRACK_VERSION = 2;

export const PoseTrackFileSchema = z
  .object({
    format: z.literal(POSE_TRACK_FORMAT),
    version: z.union([z.literal(1), z.literal(POSE_TRACK_VERSION)]),
    exportedAt: z.number().int().nonnegative(),
    /** File name of the source video, for the tuning report. */
    video: z.string().max(200),
    bpm: z.number().min(30).max(300),
    /** Time of any beat in video time (as in the import dialog). */
    beatPhaseMs: z.number().finite(),
    range: z.object({ startMs: z.number().finite().nonnegative(), endMs: z.number().finite() }),
    mirror: z.boolean(),
    /** Pose model of the analysis (Etappe 8g-4b). Missing in older exports (they used "lite"). */
    model: z.enum(SHIPPED_MODELS).optional(),
    /** Move placement chosen in the dialog (Etappe 8g-4c). Missing in older exports ("grid"). */
    movePlacement: z.enum(MOVE_PLACEMENTS).optional(),
    track: z.object({
      aspect: z.number().positive(),
      samples: z.array(
        z.object({
          timeMs: z.number().finite(),
          landmarks: z.array(LandmarkSchema).max(33).nullable(),
          /** World landmarks of the same person (version 2 only). */
          world: z.array(Landmark3dSchema).max(33).nullable().optional(),
          /** Seek target without a confirmed frame time (Etappe 8i-2; optional, older files lack it). */
          fallback: z.literal(true).optional(),
        }),
      ),
    }),
  })
  .superRefine((file, ctx) => {
    if (file.version === 1 && file.track.samples.some((s) => s.world !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Version 1 kennt keine Weltpunkte.",
        path: ["track", "samples"],
      });
    }
  });

export type PoseTrackFile = z.infer<typeof PoseTrackFileSchema>;

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/** World coordinates to 0.1 mm (keeps the file small); visibility stays as it is. */
const roundWorld = (p: Landmark3d): Landmark3d =>
  p.length === 4
    ? [round4(p[0]), round4(p[1]), round4(p[2]), p[3]]
    : [round4(p[0]), round4(p[1]), round4(p[2])];

/** Current-version file; world coordinates rounded to 4 decimals. */
export function buildPoseTrackFile(
  input: Omit<PoseTrackFile, "format" | "version" | "track"> & { track: PoseTrack },
): PoseTrackFile {
  const { track } = input;
  return {
    format: POSE_TRACK_FORMAT,
    version: POSE_TRACK_VERSION,
    ...input,
    track: {
      aspect: track.aspect,
      samples: track.samples.map((s) => (s.world ? { ...s, world: s.world.map(roundWorld) } : s)),
    },
  };
}

/** Throws a ZodError (or SyntaxError) for anything that is not a valid pose track file. */
export function parsePoseTrackFile(json: string): PoseTrackFile {
  return PoseTrackFileSchema.parse(JSON.parse(json));
}

/** Track and choreography options as `buildVideoChoreo` derives them from the dialog values. */
export function importOptions(file: PoseTrackFile): { track: PoseTrack; opts: VideoChoreoOptions } {
  return {
    track: file.track,
    opts: {
      title: file.video,
      bpm: file.bpm,
      range: file.range,
      beatOffsetMs: file.beatPhaseMs - file.range.startMs,
      mirror: file.mirror,
      // Older exports predate the placement choice and were built on the fixed grid.
      movePlacement: file.movePlacement ?? "grid",
      now: file.exportedAt,
    },
  };
}
