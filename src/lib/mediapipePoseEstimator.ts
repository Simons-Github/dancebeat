import type { PoseLandmarker } from "@mediapipe/tasks-vision";

import { createPoseLandmarker, type PoseModel } from "./mediapipe";
import type { PoseDelegate, PoseEstimator } from "./poseEstimator";
import type { Landmark } from "./types";

/** MediaPipe Pose Landmarker in VIDEO mode. "lite" is the live model; GPU falls back to CPU. */
export function createMediaPipeEstimator(
  model: PoseModel = "lite",
  delegate?: PoseDelegate,
): PoseEstimator {
  let landmarker: PoseLandmarker | null = null;
  let closed = false;

  return {
    name: `MediaPipe Pose (${model})`,
    async init() {
      const made = await createPoseLandmarker({
        mode: "VIDEO",
        model,
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
      return pose ? pose.map((q) => [q.x, q.y, q.visibility ?? 1] as Landmark) : null;
    },
    close() {
      closed = true;
      landmarker?.close();
      landmarker = null;
    },
  };
}
