import type { MotionSource, RawClip } from "./motionPack";
import { frameAt } from "./pose";
import { importOptions, type PoseTrackFile } from "./poseTrackFile";
import type { MotionKeyframe } from "./types";
import { choreoFromPoseTrack } from "./videoChoreo";

/**
 * Motion-pack source from a video pose track (Etappe 13e-2, docs/choreography-format.md#motion-paket).
 * Pure logic without browser APIs; only used by scripts/build-motion-pack.ts, so the app bundle
 * does not grow.
 *
 * Segmentation: the track is imported like in the app with hold-point placement ("holds"), so
 * the moves sit on the stillest beats. Each clip is the movement from one hold point to the
 * next: it starts at the previous hold and ends with its anchor on the own hold
 * (anchorBeat = beats). The anchor is at the end because a hold point is where the dancer
 * arrives and rests; the way there is the clip's motion, and the generator places the anchor on
 * the slot beat and plays the run-up before it.
 */

/** Keyframe spacing of video clips in beats (a quarter beat; 125 ms at 120 BPM). */
export const VIDEO_KEYFRAME_STEP_BEATS = 0.25;

const MAX_SLUG = 40;
const MAX_ID = 80;
const MAX_LABEL = 60;

const slug = (video: string) =>
  video
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "") || "video";

/** Clip id `video:<slug>:<n>`; slug lowercase, non-alphanumerics as "-", at most 40 chars. */
export function videoClipId(video: string, n: number): string {
  return `video:${slug(video)}:${n}`.slice(0, MAX_ID);
}

/** Video file name without extension, shortened so that `${name} ${n}` fits the label limit. */
function videoLabel(video: string, n: number): string {
  const name = video.replace(/\.[^./\\]+$/, "").trim() || "Video";
  const suffix = ` ${n}`;
  return name.slice(0, Math.max(1, MAX_LABEL - suffix.length)).trimEnd() + suffix;
}

export interface VideoSourceResult {
  source: MotionSource;
  /** Clips dropped during segmentation (German reason); the pack filters come later. */
  rejected: { id: string; reason: string }[];
}

/**
 * Clips between consecutive hold points of the track's hold-point choreography, keyframes every
 * VIDEO_KEYFRAME_STEP_BEATS from the frames' `pose3d`. Rejects gaps outside 1–4 beats and clips
 * without a 3D pose at the start or the anchor. The sequence lists all clip ids in order,
 * rejected ones included, so `countTransitions` never bridges a dropped clip. Errors of the
 * import (`choreoFromPoseTrack`) propagate.
 */
export function videoMotionSource(file: PoseTrackFile, style = "party"): VideoSourceResult {
  const { track, opts } = importOptions(file);
  const choreo = choreoFromPoseTrack(track, { ...opts, movePlacement: "holds" });
  const beatMs = 60000 / file.bpm;
  const beatIndex = choreo.moves.map((m) => Math.round(m.timeMs / beatMs));
  const steps = Math.round(1 / VIDEO_KEYFRAME_STEP_BEATS);
  const source = `video:${file.video || "video"}`;

  const clips: RawClip[] = [];
  const rejected: VideoSourceResult["rejected"] = [];
  const ids: string[] = [];
  for (let n = 1; n < beatIndex.length; n++) {
    const start = beatIndex[n - 1]!;
    const beats = beatIndex[n]! - start;
    const id = videoClipId(file.video, n);
    ids.push(id);
    if (beats < 1 || beats > 4) {
      rejected.push({ id, reason: `Abstand der Haltepunkte ${beats} Beats (erlaubt 1–4)` });
      continue;
    }
    const keyframes: MotionKeyframe[] = [];
    let missingEnd: number | null = null;
    for (let k = 0; k <= beats * steps; k++) {
      // k / steps is exact for the quarter step (no accumulated float drift).
      const beat = k / steps;
      const pose3d = frameAt(choreo.frames, (start + beat) * beatMs)?.pose3d;
      if (pose3d) keyframes.push({ beat, pose3d });
      else if (k === 0 || k === beats * steps) missingEnd ??= beat;
    }
    if (missingEnd !== null) {
      rejected.push({ id, reason: `keine 3D-Pose bei Beat ${missingEnd} (Haltepunkt)` });
      continue;
    }
    clips.push({
      id,
      label: videoLabel(file.video, n),
      styles: [style],
      beats,
      anchorBeat: beats,
      keyframes,
      sourceBpm: file.bpm,
      source,
    });
  }
  return { source: { clips, sequences: [ids], style }, rejected };
}
