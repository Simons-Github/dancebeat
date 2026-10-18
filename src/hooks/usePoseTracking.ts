import { useEffect, useRef, useState } from "react";

import { BRIGHTNESS_INTERVAL_MS, createBrightnessMeter, isLowLight } from "@/lib/brightness";
import {
  cameraError,
  checkCameraSupport,
  isOverconstrained,
  isStaleCameraError,
  mapCameraError,
  type CameraError,
} from "@/lib/cameraErrors";
import { FrameStats } from "@/lib/frameStats";
import { createMediaPipeEstimator } from "@/lib/mediapipePoseEstimator";
import type { PoseDelegate, PoseEstimator } from "@/lib/poseEstimator";
import type { Landmark } from "@/lib/types";

export type PoseStatus = "idle" | "loading" | "ready" | "error";

/** Latest detection: normalized landmarks plus the video aspect (width / height) they refer to. */
export interface PoseFrame {
  landmarks: Landmark[];
  aspect: number;
}

/** What the per-frame callback receives. `landmarks` is null when nobody is in the picture. */
export interface FrameInfo {
  landmarks: Landmark[] | null;
  aspect: number;
  /** Pixel size of the video the landmarks refer to. */
  videoWidth: number;
  videoHeight: number;
  /** performance.now() after the detection. */
  nowMs: number;
  /**
   * How old the picture is when this callback runs: from the camera capture (video-frame
   * metadata `captureTime`, if the browser reports a plausible one) or else from the start of
   * the detection, to `nowMs`. The game files the angles under the time of the picture.
   */
  frameAgeMs: number;
}

/** captureTime further back than this is treated as unreliable. */
const MAX_CAPTURE_AGE_MS = 300;

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface PoseStatsRef {
  stats: FrameStats;
  delegate: PoseDelegate | null;
  model: string;
}

export interface PoseTrackingOptions {
  /** Stored camera id; a stale id falls back to the default camera (see `onStaleCamera`). */
  cameraId?: string;
  /** Nothing starts (and no permission prompt appears) until this is true. */
  enabled: boolean;
  /** Bump to start over after an error. */
  retryKey?: number;
  /** Called from the detection loop for every processed frame. Never triggers a render. */
  onFrame?: (frame: FrameInfo) => void;
  /** The requested cameraId no longer exists and the default camera was used instead. */
  onStaleCamera?: () => void;
  /** `delegate` is set when the hook falls back to a specific delegate (CPU after GPU errors). */
  createEstimator?: (delegate?: PoseDelegate) => PoseEstimator;
}

const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

/** Detection errors in a row after which the GPU delegate is given up for CPU. */
const MAX_DETECT_ERRORS = 10;
/** Automatic restarts after the camera track ended (call, other app) before giving up. */
const MAX_AUTO_RESTARTS = 3;
/** Running this long without trouble earns the restarts back. */
const HEALTHY_MS = 10_000;

// Only `ideal`: a hard limit makes some cameras fail with OverconstrainedError.
const sizeConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
} as const;

/** `onStale` returns false when the request was cancelled meanwhile: then no other camera is opened. */
async function openCamera(
  cameraId: string | undefined,
  onStale: () => boolean,
): Promise<MediaStream> {
  const open = (video: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia({ video, audio: false });
  if (cameraId) {
    try {
      return await open({ deviceId: { exact: cameraId }, ...sizeConstraints });
    } catch (e) {
      if (!isStaleCameraError(e)) throw e;
      if (!onStale()) throw e;
    }
  }
  try {
    return await open({ facingMode: "user", ...sizeConstraints });
  } catch (e) {
    if (!isOverconstrained(e)) throw e;
    return open({ facingMode: "user" }); // once more without any size
  }
}

/**
 * Front camera + pose estimator. All per-frame work happens in a video-frame callback (or rAF
 * as fallback) and only writes refs; React state changes at most on status, light and device
 * changes. Everything is released on unmount, camera switch, retry and disable, also when an
 * async step finishes late.
 */
export function usePoseTracking(opts: PoseTrackingOptions) {
  const { cameraId, enabled, retryKey = 0 } = opts;
  const videoRef = useRef<HTMLVideoElement>(null);
  const poseRef = useRef<PoseFrame | null>(null);
  const statsRef = useRef<PoseStatsRef>({ stats: new FrameStats(), delegate: null, model: "" });
  const [status, setStatus] = useState<PoseStatus>("idle");
  const [error, setError] = useState<CameraError | null>(null);
  const [lowLight, setLowLight] = useState(false);
  const [delegate, setDelegate] = useState<PoseDelegate | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [aspect, setAspect] = useState(4 / 3);
  const [activeDeviceId, setActiveDeviceId] = useState("");
  // Bumped to restart internally (camera track ended); not part of the public retry.
  const [restartKey, setRestartKey] = useState(0);
  const autoRestarts = useRef(0);
  /** performance.now() of the last processed frame; 0 until the first one. */
  const lastFrameAtRef = useRef(0);

  // Latest callbacks without restarting the camera when the caller re-renders.
  const cbRef = useRef(opts);
  useEffect(() => {
    cbRef.current = opts;
  });

  // A change from outside starts with a fresh restart budget.
  useEffect(() => {
    autoRestarts.current = 0;
  }, [enabled, cameraId, retryKey]);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    // Every await below may finish after cleanup (StrictMode remount, camera switch, retry):
    // `cancelled` makes late results release themselves instead of leaking.
    let cancelled = false;
    let stream: MediaStream | null = null;
    let estimator: PoseEstimator | null = null;
    let frameCb = 0;
    let raf = 0;
    let removeWatchers = () => {};
    // The container takes the video's shape as soon as it is known (also when rotating).
    const syncAspect = () => {
      if (video?.videoHeight) setAspect(video.videoWidth / video.videoHeight);
    };
    video?.addEventListener("loadedmetadata", syncAspect);
    video?.addEventListener("resize", syncAspect);
    const shared = statsRef.current;
    const { stats } = shared;
    stats.reset();
    shared.delegate = null;
    lastFrameAtRef.current = 0;

    const fail = (e: CameraError) => {
      setStatus("error");
      setError(e);
    };

    const listCameras = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(
          all
            .filter((d) => d.kind === "videoinput")
            .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Kamera ${i + 1}` })),
        );
      } catch {
        /* the picker just stays hidden */
      }
    };

    // Release the camera (LED off) and report that detection is not available.
    const modelFailed = (v: HTMLVideoElement) => {
      stopStream(stream);
      stream = null;
      v.srcObject = null;
      fail(cameraError("model"));
    };

    const startLoop = (v: HTMLVideoElement, est: PoseEstimator, active: PoseDelegate) => {
      const meter = createBrightnessMeter();
      const startedAt = performance.now();
      let detectErrors = 0;
      let low = false;
      let lastTs = 0;
      let lastVideoTime = -1;
      let lastLight = -Infinity;
      let lastAspect = 0;
      const useVfc = typeof v.requestVideoFrameCallback === "function";

      const step = (_now?: number, meta?: VideoFrameCallbackMetadata) => {
        if (cancelled) return;
        schedule();
        // rAF fires faster than the camera delivers; skip repeats of the same picture.
        if (v.readyState < 2 || (!useVfc && v.currentTime === lastVideoTime)) return;
        lastVideoTime = v.currentTime;
        const t0 = performance.now();
        // The model needs strictly increasing timestamps.
        lastTs = t0 > lastTs ? t0 : lastTs + 1;
        let landmarks: Landmark[] | null = null;
        try {
          landmarks = est.detect(v, lastTs);
          detectErrors = 0;
        } catch {
          // Skip this frame. Errors in a row mean the delegate is broken (lost WebGL context).
          if (++detectErrors >= MAX_DETECT_ERRORS) {
            if (frameCb) v.cancelVideoFrameCallback?.(frameCb);
            cancelAnimationFrame(raf);
            est.close();
            estimator = null;
            if (active === "CPU") modelFailed(v);
            else void launch(v, "CPU");
          }
          return;
        }
        const t1 = performance.now();
        lastFrameAtRef.current = t1;
        if (autoRestarts.current > 0 && t1 - startedAt > HEALTHY_MS) autoRestarts.current = 0;
        stats.record(t1, t1 - t0);
        const a = v.videoHeight ? v.videoWidth / v.videoHeight : 1;
        poseRef.current = landmarks ? { landmarks, aspect: a } : null;
        if (a !== lastAspect) {
          lastAspect = a;
          setAspect(a);
        }
        const capture = meta?.captureTime;
        const capturedAt =
          capture != null && capture <= t0 && t0 - capture < MAX_CAPTURE_AGE_MS ? capture : t0;
        cbRef.current.onFrame?.({
          landmarks,
          aspect: a,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
          nowMs: t1,
          frameAgeMs: t1 - capturedAt,
        });
        if (t1 - lastLight > BRIGHTNESS_INTERVAL_MS) {
          lastLight = t1;
          const b = meter(v);
          if (b !== null) {
            low = isLowLight(b, low);
            setLowLight(low); // no re-render when unchanged
          }
        }
      };
      const schedule = () => {
        if (useVfc) frameCb = v.requestVideoFrameCallback(step);
        else raf = requestAnimationFrame(step);
      };
      schedule();
    };

    // Starts an estimator and, once it is up, the detection loop. Used for the first start and
    // for the CPU fallback.
    const launch = async (v: HTMLVideoElement, delegate?: PoseDelegate) => {
      const est = (cbRef.current.createEstimator ?? ((d) => createMediaPipeEstimator("lite", d)))(
        delegate,
      );
      estimator = est;
      let info: { delegate: PoseDelegate };
      try {
        info = await est.init();
      } catch {
        if (cancelled) return;
        est.close();
        return modelFailed(v); // no detection without the model
      }
      if (cancelled) {
        est.close();
        return;
      }
      statsRef.current.delegate = info.delegate;
      statsRef.current.model = est.name;
      setDelegate(info.delegate);
      setStatus("ready");
      startLoop(v, est, info.delegate);
    };

    // Background, lock screen and calls: iOS pauses the video and may end the camera track.
    const watchCamera = (v: HTMLVideoElement, s: MediaStream) => {
      const track = s.getVideoTracks()[0];
      const restart = () => {
        if (cancelled) return;
        if (autoRestarts.current >= MAX_AUTO_RESTARTS) {
          stopStream(stream);
          stream = null;
          v.srcObject = null;
          return fail(cameraError("interrupted"));
        }
        autoRestarts.current++;
        setRestartKey((k) => k + 1);
      };
      const onVisible = () => {
        if (document.visibilityState !== "visible" || cancelled) return;
        if (track?.readyState === "ended") restart();
        else void v.play().catch(() => {});
      };
      if (track) track.onended = restart;
      document.addEventListener("visibilitychange", onVisible);
      removeWatchers = () => {
        if (track) track.onended = null;
        document.removeEventListener("visibilitychange", onVisible);
      };
    };

    const init = async () => {
      setError(null);
      setLowLight(false);
      const unsupported = checkCameraSupport();
      if (unsupported) return fail(unsupported);
      if (!video) return fail(cameraError("unknown"));
      setStatus("loading");
      try {
        stream = await openCamera(cameraId, () => {
          if (cancelled) return false;
          cbRef.current.onStaleCamera?.();
          return true;
        });
      } catch (e: unknown) {
        if (!cancelled) fail(mapCameraError(e));
        return;
      }
      if (cancelled) {
        stopStream(stream);
        stream = null;
        return;
      }
      setActiveDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? "");
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (cancelled) return;
      void listCameras();

      watchCamera(video, stream);
      await launch(video);
    };
    void init();

    const onDeviceChange = () => void listCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

    return () => {
      cancelled = true;
      removeWatchers();
      video?.removeEventListener("loadedmetadata", syncAspect);
      video?.removeEventListener("resize", syncAspect);
      if (frameCb) video?.cancelVideoFrameCallback?.(frameCb);
      cancelAnimationFrame(raf);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      stopStream(stream);
      stream = null;
      if (video) video.srcObject = null;
      estimator?.close();
      estimator = null;
      poseRef.current = null;
      setAspect(4 / 3);
      setActiveDeviceId("");
      setDelegate(null);
      shared.delegate = null;
    };
  }, [enabled, cameraId, retryKey, restartKey]);

  return {
    videoRef,
    poseRef,
    statsRef,
    lastFrameAtRef,
    status: enabled ? status : ("idle" as const),
    error: enabled ? error : null,
    lowLight,
    delegate,
    cameras,
    activeDeviceId,
    aspect,
  };
}
