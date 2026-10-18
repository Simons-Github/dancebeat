import type { PoseLandmarker } from "@mediapipe/tasks-vision";

/** Must equal the exact version in package.json (guarded by a test): JS and WASM have to match. */
export const TASKS_VISION_VERSION = "1.1.1";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL = (v: "lite" | "full" | "heavy") =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`;

export async function createPoseLandmarker(opts: {
  mode: "VIDEO" | "IMAGE";
  model: "lite" | "full" | "heavy";
  numPoses?: number;
  /** Force one delegate (no fallback). Without it GPU is tried first, then CPU. */
  delegate?: "GPU" | "CPU";
}): Promise<{ landmarker: PoseLandmarker; delegate: "GPU" | "CPU" }> {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL(opts.model), delegate },
      runningMode: opts.mode,
      numPoses: opts.numPoses ?? 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  if (opts.delegate) return { landmarker: await make(opts.delegate), delegate: opts.delegate };
  try {
    return { landmarker: await make("GPU"), delegate: "GPU" };
  } catch {
    return { landmarker: await make("CPU"), delegate: "CPU" };
  }
}
