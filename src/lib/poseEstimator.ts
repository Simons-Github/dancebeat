import type { Landmark } from "./types";

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
  /** Releases the model. Safe to call at any time, also while `init` is still pending. */
  close(): void;
}
