import { useEffect, useRef, useState } from "react";

import { BRIGHTNESS_INTERVAL_MS, createBrightnessMeter, isLowLight } from "@/lib/brightness";
import {
  cameraError,
  checkCameraSupport,
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
  /** performance.now() after the detection. */
  nowMs: number;
}

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
  createEstimator?: () => PoseEstimator;
}

const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

const sizeConstraints = {
  width: { ideal: 1280, max: 1280 },
  height: { ideal: 720, max: 720 },
} as const;

async function openCamera(cameraId: string | undefined, onStale: () => void): Promise<MediaStream> {
  const open = (video: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia({ video, audio: false });
  if (cameraId) {
    try {
      return await open({ deviceId: { exact: cameraId }, ...sizeConstraints });
    } catch (e) {
      if (!isStaleCameraError(e)) throw e;
      onStale();
    }
  }
  return open({ facingMode: "user", ...sizeConstraints });
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

  // Latest callbacks without restarting the camera when the caller re-renders.
  const cbRef = useRef(opts);
  useEffect(() => {
    cbRef.current = opts;
  });

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
    const { stats } = statsRef.current;
    stats.reset();
    statsRef.current.delegate = null;

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

    const startLoop = (v: HTMLVideoElement, est: PoseEstimator) => {
      const meter = createBrightnessMeter();
      let lastTs = 0;
      let lastVideoTime = -1;
      let lastLight = -Infinity;
      let lastAspect = 0;
      const useVfc = typeof v.requestVideoFrameCallback === "function";

      const step = () => {
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
        } catch {
          return; // skip this frame
        }
        const t1 = performance.now();
        stats.record(t1, t1 - t0);
        const a = v.videoHeight ? v.videoWidth / v.videoHeight : 1;
        poseRef.current = landmarks ? { landmarks, aspect: a } : null;
        if (a !== lastAspect) {
          lastAspect = a;
          setAspect(a);
        }
        cbRef.current.onFrame?.({ landmarks, aspect: a, nowMs: t1 });
        if (t1 - lastLight > BRIGHTNESS_INTERVAL_MS) {
          lastLight = t1;
          const b = meter(v);
          if (b !== null) setLowLight(isLowLight(b)); // no re-render when unchanged
        }
      };
      const schedule = () => {
        if (useVfc) frameCb = v.requestVideoFrameCallback(step);
        else raf = requestAnimationFrame(step);
      };
      schedule();
    };

    const init = async () => {
      setError(null);
      setLowLight(false);
      const unsupported = checkCameraSupport();
      if (unsupported) return fail(unsupported);
      setStatus("loading");
      try {
        stream = await openCamera(cameraId, () => cbRef.current.onStaleCamera?.());
      } catch (e: unknown) {
        if (!cancelled) fail(mapCameraError(e));
        return;
      }
      if (cancelled || !video) {
        stopStream(stream);
        stream = null;
        return;
      }
      setActiveDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? "");
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (cancelled) return;
      void listCameras();

      const est = (cbRef.current.createEstimator ?? (() => createMediaPipeEstimator("lite")))();
      estimator = est;
      let info: { delegate: PoseDelegate };
      try {
        info = await est.init();
      } catch {
        if (cancelled) return;
        // No detection without the model: release the camera so its LED goes off.
        stopStream(stream);
        stream = null;
        video.srcObject = null;
        est.close();
        return fail(cameraError("model"));
      }
      if (cancelled) {
        est.close();
        return;
      }
      statsRef.current.delegate = info.delegate;
      statsRef.current.model = est.name;
      setDelegate(info.delegate);
      setStatus("ready");
      startLoop(video, est);
    };
    void init();

    const onDeviceChange = () => void listCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

    return () => {
      cancelled = true;
      if (frameCb) video?.cancelVideoFrameCallback?.(frameCb);
      cancelAnimationFrame(raf);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      stopStream(stream);
      stream = null;
      if (video) video.srcObject = null;
      estimator?.close();
      estimator = null;
      poseRef.current = null;
    };
  }, [enabled, cameraId, retryKey]);

  return {
    videoRef,
    poseRef,
    statsRef,
    status: enabled ? status : ("idle" as const),
    error: enabled ? error : null,
    lowLight,
    delegate,
    cameras,
    activeDeviceId,
    aspect,
  };
}
