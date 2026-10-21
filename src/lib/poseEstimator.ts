import type { Landmark, Landmark3d } from "./types";

/** One detected person: image landmarks plus MediaPipe world landmarks (metres, if available). */
export interface PoseDetection {
  landmarks: Landmark[];
  /** World landmarks of the same person (`Landmark3d`), null if the model gave none. */
  world: Landmark3d[] | null;
}

export type PoseDelegate = "GPU" | "CPU";

/**
 * Pose model behind a small interface so the model can be swapped (e.g. for comparison on a
 * device) without touching hooks or screens. Landmarks follow the MediaPipe 33-point topology
 * (indices in `L` in pose.ts), normalized 0..1 per axis, with visibility as third value.
 */
export interface PoseEstimator {
  readonly name: string;
  /** Loads model and runtime. Resolves with the delegate that is actually in use. */
  init(): Promise<{ delegate: PoseDelegate }>;
  /**
   * Synchronous detection on the current video frame. `timestampMs` must increase with every
   * call. Returns null when no person is found.
   */
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null;
  /**
   * Like `detect`, but returns every detected person (empty array if none), in model order.
   * Optional: estimators without it are treated as finding at most one person.
   */
  detectAll?(video: HTMLVideoElement, timestampMs: number): Landmark[][];
  /**
   * Like `detectAll`, plus the world landmarks of each person (same index = same person). Used by
   * the video import only (Etappe 13c); live play keeps `detect` and gets no world landmarks
   * before Etappe 16. Optional: without it the import records no world landmarks.
   */
  detectAllWorld?(video: HTMLVideoElement, timestampMs: number): PoseDetection[];
  /** Releases the model. Safe to call at any time, also while `init` is still pending. */
  close(): void;
}
