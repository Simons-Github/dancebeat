import type { PoseEstimator } from "./poseEstimator";
import type { MultiPoseTrack } from "./targetPerson";
import type { Landmark } from "./types";

/**
 * Offline pose analysis of a video element: seeks through the video on a fixed time grid and
 * runs the estimator on every frame. The result keeps every detected person; `trackTarget`
 * (targetPerson.ts) turns it into the `PoseTrack` that feeds `choreoFromPoseTrack`.
 * Wall-clock time is only used for progress throttling; the samples carry video time.
 */

export type VideoAnalysisErrorCode =
  /** No video size or duration yet (metadata not loaded). */
  | "no-metadata"
  /** A seek did not finish within `seekTimeoutMs`. */
  | "seek-timeout"
  /** The media element reported an error (decode, network, unsupported format). */
  | "video-error"
  /** The requested range contains no time inside the video. */
  | "empty-range";

export class VideoAnalysisError extends Error {
  constructor(
    readonly code: VideoAnalysisErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "VideoAnalysisError";
  }
}

export interface AnalyzeVideoOptions {
  /** Grid spacing in video time. Default 50. */
  intervalMs?: number;
  /** Video section to analyze (video time). Clamped to the duration. Default: whole video. */
  range?: { startMs: number; endMs: number };
  signal?: AbortSignal;
  /** Fraction done (0..1), at most every `PROGRESS_INTERVAL_MS` and once with 1 at the end. */
  onProgress?: (fraction: number) => void;
  /** Maximum wait for one seek (including the frame callback). Default 5000. */
  seekTimeoutMs?: number;
  /** Wall clock for progress throttling (tests). Default performance.now. */
  now?: () => number;
}

export const DEFAULT_INTERVAL_MS = 50;
export const DEFAULT_SEEK_TIMEOUT_MS = 5000;
export const PROGRESS_INTERVAL_MS = 250;
/** Lower bound for matching a frame callback's mediaTime to the seek target (about one frame). */
const MIN_FRAME_TOLERANCE_MS = 40;
/**
 * After `seeked`, wait at most this long for a video-frame callback. Safari may still show the
 * previous frame at `seeked`; some browsers never fire the callback for a paused video.
 */
export const FRAME_FALLBACK_MS = 120;

/**
 * Last timestamp passed to each estimator. MediaPipe (VIDEO mode) needs strictly increasing
 * timestamps over the whole lifetime of a landmarker, also when it analyzes several videos or
 * ranges. Each run continues after the last timestamp, keeping the real video-time spacing.
 */
const lastTimestamps = new WeakMap<PoseEstimator, number>();

export const abortError = () => new DOMException("Die Analyse wurde abgebrochen.", "AbortError");

/** Seeks to `timeMs` and resolves once the frame is (very likely) decoded. */
function seekTo(
  video: HTMLVideoElement,
  timeMs: number,
  timeoutMs: number,
  /** Max distance between the presented frame's mediaTime and `timeMs`. */
  frameToleranceMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let frameHandle: number | undefined;
    const hasVfc = typeof video.requestVideoFrameCallback === "function";

    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(fallback);
      if (frameHandle !== undefined) video.cancelVideoFrameCallback?.(frameHandle);
      frameHandle = undefined;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = (e: unknown) => {
      cleanup();
      reject(e);
    };
    const onSeeked = () => {
      if (frameHandle === undefined) return done();
      // Frame callback still pending: give it a short moment, then go on anyway.
      fallback = setTimeout(done, Math.min(FRAME_FALLBACK_MS, timeoutMs));
    };
    const onError = () => fail(new VideoAnalysisError("video-error"));
    const onAbort = () => fail(abortError());

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    // Declared before any listener can fire: dispatch is asynchronous.
    const timer = setTimeout(() => fail(new VideoAnalysisError("seek-timeout")), timeoutMs);
    // Note: browsers do not fire video-frame callbacks for hidden, offscreen or detached videos.
    // Then every step costs FRAME_FALLBACK_MS, so the caller must keep the video in the DOM and
    // visible (the import dialog, 8c).
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      frameHandle = undefined;
      // A late frame of the previous seek may still arrive: wait for the one at the target.
      if (Math.abs(meta.mediaTime * 1000 - timeMs) > frameToleranceMs) {
        frameHandle = video.requestVideoFrameCallback(onFrame);
        return;
      }
      // seeked not there yet: keep waiting for it (the timeout still applies).
      if (fallback !== undefined) done();
    };
    if (hasVfc) {
      // Registered before the seek so the callback for the new frame cannot be missed.
      frameHandle = video.requestVideoFrameCallback(onFrame);
    }
    video.currentTime = timeMs / 1000;
  });
}

/**
 * Steps through `range` (default: the whole video) every `intervalMs`, seeks the paused video
 * there and records all people the estimator finds (`detectAll`, or `detect` wrapped as zero or
 * one person). Sample times are video time in ms (not relative to
 * the range). Rejects with an "AbortError" DOMException when `signal` aborts, and with
 * `VideoAnalysisError` for missing metadata, seek timeouts and media errors. Errors thrown by
 * `estimator.detect` / `detectAll` propagate unchanged.
 */
export async function analyzeVideo(
  video: HTMLVideoElement,
  estimator: PoseEstimator,
  opts: AnalyzeVideoOptions = {},
): Promise<MultiPoseTrack> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    signal,
    onProgress,
    seekTimeoutMs = DEFAULT_SEEK_TIMEOUT_MS,
    now = () => performance.now(),
  } = opts;
  if (signal?.aborted) throw abortError();
  if (video.error) throw new VideoAnalysisError("video-error");
  const durationMs = video.duration * 1000;
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(durationMs) || durationMs <= 0)
    throw new VideoAnalysisError("no-metadata");
  if (!(intervalMs > 0)) throw new RangeError("intervalMs must be positive");

  const aspect = video.videoWidth / video.videoHeight;
  const startMs = Math.max(0, opts.range?.startMs ?? 0);
  const endMs = Math.min(durationMs, opts.range?.endMs ?? durationMs);
  if (!(endMs >= startMs)) throw new VideoAnalysisError("empty-range");

  const frameToleranceMs = Math.max(intervalMs / 2, MIN_FRAME_TOLERANCE_MS);
  const steps = Math.floor((endMs - startMs) / intervalMs) + 1;
  const last = lastTimestamps.get(estimator);
  // Shift so the first timestamp lies one interval after the previous run's last one.
  const offset = last === undefined ? 0 : Math.max(0, last + intervalMs - startMs);

  video.pause();
  const samples: MultiPoseTrack["samples"] = [];
  let lastReport = -Infinity;
  for (let i = 0; i < steps; i++) {
    if (signal?.aborted) throw abortError();
    const timeMs = startMs + i * intervalMs;
    await seekTo(video, timeMs, seekTimeoutMs, frameToleranceMs, signal);
    if (signal?.aborted) throw abortError();
    const ts = offset + timeMs;
    lastTimestamps.set(estimator, ts);
    let poses: Landmark[][];
    if (estimator.detectAll) poses = estimator.detectAll(video, ts);
    else {
      const one = estimator.detect(video, ts);
      poses = one ? [one] : [];
    }
    samples.push({ timeMs, poses });
    if (onProgress) {
      const fraction = (i + 1) / steps;
      const t = now();
      if (fraction === 1 || t - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = t;
        onProgress(fraction);
      }
    }
  }
  return { aspect, samples };
}
