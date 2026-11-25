import type { PoseLandmarker } from "@mediapipe/tasks-vision";

// Runtime and model come from the app's own origin (no CDN): the WASM files are served/copied
// from the installed @mediapipe/tasks-vision by vite-plugins/mediapipeWasm.ts, the models are
// downloaded by scripts/fetch-models.ts into public/. Kept as a literal list (not imported from
// scripts/models.ts, which uses Node APIs); a test keeps both in sync. "lite" serves live
// tracking and the video import's default ("Schnell"), "full" only the video import ("Genau",
// Etappe 8g-4b). "heavy" must be added to scripts/models.ts and here before use.
export const SHIPPED_MODELS = ["lite", "full"] as const;
export type PoseModel = (typeof SHIPPED_MODELS)[number];

export const wasmBaseUrl = (): string => `${import.meta.env.BASE_URL}mediapipe/wasm`;
export const modelUrl = (v: PoseModel): string =>
  `${import.meta.env.BASE_URL}mediapipe/models/pose_landmarker_${v}.task`;

export async function createPoseLandmarker(opts: {
  mode: "VIDEO" | "IMAGE";
  model: PoseModel;
  numPoses?: number;
  /** Force one delegate (no fallback). Without it GPU is tried first, then CPU. */
  delegate?: "GPU" | "CPU";
}): Promise<{ landmarker: PoseLandmarker; delegate: "GPU" | "CPU" }> {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl());
  const make = (delegate: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl(opts.model), delegate },
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
