import { createHash } from "node:crypto";

/**
 * Pose models served from the app's own origin (`public/mediapipe/models/`, not committed).
 * "lite" (live tracking, video import "Schnell") and "full" (video import "Genau") are shipped;
 * "heavy" would need an entry here (URL + SHA-256) and in SHIPPED_MODELS before use.
 */
export interface ModelSpec {
  file: string;
  url: string;
  sha256: string;
}

export const MODELS: readonly ModelSpec[] = [
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
  },
  {
    // ~9 MB; loaded only when the video import runs with "Genau".
    file: "pose_landmarker_full.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    sha256: "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
  },
];

export const MODELS_DIR = "public/mediapipe/models";

/** Model files from MODELS for which `exists` returns false (checked before the build). */
export function missingModels(
  exists: (file: string) => boolean,
  models: readonly ModelSpec[] = MODELS,
): string[] {
  return models.map((m) => m.file).filter((f) => !exists(f));
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** True if no file exists yet or its content does not match the expected hash. */
export function needsDownload(existing: Uint8Array | null, expectedSha256: string): boolean {
  return existing === null || sha256Hex(existing) !== expectedSha256;
}

/** Throws a clear error if downloaded bytes do not match the pinned hash. */
export function verifyModel(spec: ModelSpec, data: Uint8Array): void {
  const actual = sha256Hex(data);
  if (actual !== spec.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${spec.file}: expected ${spec.sha256}, got ${actual}. ` +
        `The file at ${spec.url} changed; check it and update the pinned hash deliberately.`,
    );
  }
}
