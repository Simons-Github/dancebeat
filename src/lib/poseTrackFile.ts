/**
 * Raw pose track of a video import plus its settings, exported in dev mode for tuning the
 * import offline (`scripts/tune-video-choreo.ts`) without running MediaPipe again. Not part of the
 * library and never persisted; the file contains landmarks only, no image data.
 */
import { z } from "zod";

import { SHIPPED_MODELS } from "./mediapipe";
import { LandmarkSchema } from "./schema";
import { MOVE_PLACEMENTS, type PoseTrack, type VideoChoreoOptions } from "./videoChoreo";

export const POSE_TRACK_FORMAT = "dancebeat-pose-track";
export const POSE_TRACK_VERSION = 1;

export const PoseTrackFileSchema = z.object({
  format: z.literal(POSE_TRACK_FORMAT),
  version: z.literal(POSE_TRACK_VERSION),
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
      }),
    ),
  }),
});

export type PoseTrackFile = z.infer<typeof PoseTrackFileSchema>;

export function buildPoseTrackFile(
  input: Omit<PoseTrackFile, "format" | "version">,
): PoseTrackFile {
  return { format: POSE_TRACK_FORMAT, version: POSE_TRACK_VERSION, ...input };
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
      ...(file.movePlacement && { movePlacement: file.movePlacement }),
      now: file.exportedAt,
    },
  };
}
