import type { PoseLandmarker } from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL = (v: "lite" | "full" | "heavy") =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`;

export async function createPoseLandmarker(opts: {
  mode: "VIDEO" | "IMAGE";
  model: "lite" | "full" | "heavy";
  numPoses?: number;
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
  try {
    return { landmarker: await make("GPU"), delegate: "GPU" };
  } catch {
    return { landmarker: await make("CPU"), delegate: "CPU" };
  }
}
