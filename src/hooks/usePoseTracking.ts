import { useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPoseLandmarker } from "@/lib/mediapipe";
import type { Landmark } from "@/lib/types";

export type PoseStatus = "idle" | "loading" | "ready" | "denied" | "nocamera" | "error";

/** Latest detection: normalized landmarks plus the video aspect (width / height) they refer to. */
export interface PoseFrame {
  landmarks: Landmark[];
  aspect: number;
}

const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

/** Frontkamera + MediaPipe Pose (VIDEO-Modus, ~30 FPS). Alles lokal. */
export function usePoseTracking(opts: { cameraId?: string; enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const poseRef = useRef<PoseFrame | null>(null);
  const [status, setStatus] = useState<PoseStatus>("idle");
  const [error, setError] = useState<string>("");
  const [lowLight, setLowLight] = useState(false);
  const [tick, setTick] = useState(0);
  const { cameraId, enabled } = opts;

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    // Every await below may finish after cleanup (StrictMode remount, camera switch, disable):
    // `cancelled` makes late results release themselves instead of leaking.
    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: PoseLandmarker | null = null;

    const init = async () => {
      setStatus("loading");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId
            ? { deviceId: { exact: cameraId } }
            : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          setStatus("denied");
          setError(
            "Kamera-Zugriff verweigert. Erlaube die Kamera in den Browser-Einstellungen oder nutze den Bewegungsmodus.",
          );
        } else {
          setStatus("nocamera");
          setError("Keine Kamera gefunden.");
        }
        return;
      }
      if (cancelled || !video) {
        stopStream(stream);
        stream = null;
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (cancelled) return;

      let lm: PoseLandmarker;
      try {
        lm = await createPoseLandmarker({ mode: "VIDEO", model: "full" });
      } catch {
        if (cancelled) return;
        setStatus("error");
        setError(
          "Die Posen-Erkennung konnte nicht geladen werden. Prüfe deine Internetverbindung beim ersten Start.",
        );
        return;
      }
      if (cancelled) {
        lm.close();
        return;
      }
      landmarker = lm;
      setStatus("ready");
    };
    void init();

    let raf = 0,
      last = 0,
      lightCheck = 0;
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 12;
    const cctx = canvas.getContext("2d", { willReadFrequently: true });
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const lm = landmarker;
      if (!video || !lm || video.readyState < 2 || now - last < 33) return;
      last = now;
      try {
        const r = lm.detectForVideo(video, now);
        const p = r.landmarks[0];
        const aspect = video.videoHeight ? video.videoWidth / video.videoHeight : 1;
        poseRef.current = p
          ? { landmarks: p.map((q) => [q.x, q.y, q.visibility ?? 1] as Landmark), aspect }
          : null;
        setTick((t) => (t + 1) % 1e6);
      } catch {
        /* Frame überspringen */
      }
      if (now - lightCheck > 2000 && cctx) {
        lightCheck = now;
        cctx.drawImage(video, 0, 0, 16, 12);
        const d = cctx.getImageData(0, 0, 16, 12).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i],
            g = d[i + 1],
            b = d[i + 2];
          if (r !== undefined && g !== undefined && b !== undefined) s += r + g + b;
        }
        setLowLight(s / (d.length / 4) / 3 < 45);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopStream(stream);
      stream = null;
      if (video) video.srcObject = null;
      landmarker?.close();
      landmarker = null;
      poseRef.current = null;
    };
  }, [enabled, cameraId]);

  return { videoRef, poseRef, status, error, lowLight, tick };
}
