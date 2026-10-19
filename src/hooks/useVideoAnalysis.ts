import { useCallback, useEffect, useRef, useState } from "react";

import type { PoseModel } from "@/lib/mediapipe";
import { createMediaPipeEstimator } from "@/lib/mediapipePoseEstimator";
import type { PoseEstimator } from "@/lib/poseEstimator";
import { analyzeVideo, VideoAnalysisError, type AnalyzeVideoOptions } from "@/lib/videoAnalysis";
import type { PoseTrack } from "@/lib/videoChoreo";

export type VideoAnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "running"; progress: number }
  | { status: "done"; track: PoseTrack }
  | { status: "error"; message: string }
  | { status: "aborted" };

export interface VideoAnalysisStartOptions extends Omit<
  AnalyzeVideoOptions,
  "signal" | "onProgress"
> {
  /** Pose model for the analysis. Default "lite". */
  model?: PoseModel;
}

export interface VideoAnalysisHookOptions {
  /** Injected in tests. Default: MediaPipe in VIDEO mode. */
  createEstimator?: (model: PoseModel) => PoseEstimator;
}

const MESSAGES = {
  model: "Das Pose-Modell konnte nicht geladen werden.",
  video: "Das Video kann nicht gelesen werden.",
  timeout: "Das Video reagiert nicht mehr (Zeitüberschreitung beim Spulen).",
  range: "Der gewählte Abschnitt liegt außerhalb des Videos.",
  unexpected: "Die Analyse wurde unerwartet abgebrochen.",
} as const;

function analysisMessage(e: unknown): string {
  if (e instanceof VideoAnalysisError) {
    switch (e.code) {
      case "no-metadata":
      case "video-error":
        return MESSAGES.video;
      case "seek-timeout":
        return MESSAGES.timeout;
      case "empty-range":
        return MESSAGES.range;
    }
  }
  return MESSAGES.unexpected;
}

interface Run {
  controller: AbortController;
  estimator: PoseEstimator | null;
}

/**
 * Runs `analyzeVideo` with a fresh estimator per start. Only the latest run may change state;
 * a new start, `cancel`, `reset` and unmount abort the running one and release its estimator.
 * Progress updates come from the throttled `onProgress`, never per frame.
 */
export function useVideoAnalysis(hookOpts: VideoAnalysisHookOptions = {}) {
  const [state, setState] = useState<VideoAnalysisState>({ status: "idle" });
  const runRef = useRef<Run | null>(null);
  const mountedRef = useRef(true);
  const factoryRef = useRef(hookOpts.createEstimator);
  useEffect(() => {
    factoryRef.current = hookOpts.createEstimator;
  });

  /** Aborts and releases the current run. Returns whether there was one. */
  const stop = useCallback(() => {
    const run = runRef.current;
    if (!run) return false;
    runRef.current = null;
    run.controller.abort();
    run.estimator?.close();
    run.estimator = null;
    return true;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  const start = useCallback(
    async (video: HTMLVideoElement, opts: VideoAnalysisStartOptions = {}) => {
      if (!mountedRef.current) return; // never create an estimator nobody would release
      stop();
      const { model = "lite", ...analyzeOpts } = opts;
      const controller = new AbortController();
      const run: Run = { controller, estimator: null };
      runRef.current = run;
      const current = () => runRef.current === run && mountedRef.current;
      const finish = (next: VideoAnalysisState) => {
        if (!current()) return;
        runRef.current = null;
        run.estimator?.close();
        run.estimator = null;
        setState(next);
      };

      setState({ status: "loading" });
      try {
        const factory = factoryRef.current ?? ((m: PoseModel) => createMediaPipeEstimator(m));
        run.estimator = factory(model);
        await run.estimator.init();
      } catch {
        // A stale run was already released by stop(); finish() ignores it.
        finish({ status: "error", message: MESSAGES.model });
        return;
      }
      const estimator = run.estimator;
      if (!current() || !estimator) return; // superseded meanwhile, already released

      setState({ status: "running", progress: 0 });
      try {
        const track = await analyzeVideo(video, estimator, {
          ...analyzeOpts,
          signal: controller.signal,
          onProgress: (progress) => {
            if (current()) setState({ status: "running", progress });
          },
        });
        finish({ status: "done", track });
      } catch (e) {
        finish({ status: "error", message: analysisMessage(e) });
      }
    },
    [stop],
  );

  const cancel = useCallback(() => {
    if (stop() && mountedRef.current) setState({ status: "aborted" });
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    if (mountedRef.current) setState({ status: "idle" });
  }, [stop]);

  return { state, start, cancel, reset };
}
