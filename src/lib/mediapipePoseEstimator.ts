import type {
  Landmark as MpLandmark,
  NormalizedLandmark,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";

import { createPoseLandmarker, type PoseModel } from "./mediapipe";
import type { PoseDelegate, PoseEstimator } from "./poseEstimator";
import type { Landmark, Landmark3d } from "./types";

const toLandmarks = (pose: NormalizedLandmark[]): Landmark[] =>
  pose.map((q) => [q.x, q.y, q.visibility ?? 1] as Landmark);

const toLandmarks3d = (pose: MpLandmark[]): Landmark3d[] =>
  pose.map((q): Landmark3d => [q.x, q.y, q.z, q.visibility ?? 1]);

/**
 * MediaPipe Pose Landmarker in VIDEO mode. "lite" is the live model; GPU falls back to CPU.
 * `numPoses` > 1 only for the video import (target person, Etappe 8f); live play keeps 1.
 */
export function createMediaPipeEstimator(
  model: PoseModel = "lite",
  delegate?: PoseDelegate,
  numPoses = 1,
): PoseEstimator {
  let landmarker: PoseLandmarker | null = null;
  let closed = false;

  return {
    name: `MediaPipe Pose (${model})`,
    async init() {
      const made = await createPoseLandmarker({
        mode: "VIDEO",
        model,
        numPoses,
        ...(delegate ? { delegate } : {}),
      });
      // close() may have been called while the model was loading.
      if (closed) {
        made.landmarker.close();
        throw new Error("Estimator closed during init");
      }
      landmarker = made.landmarker;
      return { delegate: made.delegate satisfies PoseDelegate };
    },
    detect(video, timestampMs) {
      const pose = landmarker?.detectForVideo(video, timestampMs).landmarks[0];
      return pose ? toLandmarks(pose) : null;
    },
    detectAll(video, timestampMs) {
      return landmarker?.detectForVideo(video, timestampMs).landmarks.map(toLandmarks) ?? [];
    },
    detectAllWorld(video, timestampMs) {
      const result = landmarker?.detectForVideo(video, timestampMs);
      if (!result) return [];
      return result.landmarks.map((pose, i) => {
        const world = result.worldLandmarks[i];
        return { landmarks: toLandmarks(pose), world: world ? toLandmarks3d(world) : null };
      });
    },
    close() {
      closed = true;
      landmarker?.close();
      landmarker = null;
    },
  };
}
