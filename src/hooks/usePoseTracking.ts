import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPoseLandmarker } from "@/lib/mediapipe";
import type { Landmark } from "@/lib/types";

export type PoseStatus = "idle" | "loading" | "ready" | "denied" | "nocamera" | "error";

/** Frontkamera + MediaPipe Pose (VIDEO-Modus, ~30 FPS). Alles lokal. */
export function usePoseTracking(opts: { cameraId?: string; enabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarksRef = useRef<Landmark[] | null>(null);
  const [status, setStatus] = useState<PoseStatus>("idle");
  const [error, setError] = useState<string>("");
  const [lowLight, setLowLight] = useState(false);
  const [tick, setTick] = useState(0);
  const lmRef = useRef<PoseLandmarker | null>(null);

  const start = useCallback(async () => {
    setStatus("loading");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: opts.cameraId
          ? { deviceId: { exact: opts.cameraId } }
          : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e: any) {
      if (e?.name === "NotAllowedError") {
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
    const v = videoRef.current!;
    v.srcObject = stream;
    await v.play().catch(() => {});
    try {
      lmRef.current = await createPoseLandmarker({ mode: "VIDEO", model: "full" });
    } catch {
      setStatus("error");
      setError(
        "Die Posen-Erkennung konnte nicht geladen werden. Prüfe deine Internetverbindung beim ersten Start.",
      );
      return;
    }
    setStatus("ready");
  }, [opts.cameraId]);

  useEffect(() => {
    if (!opts.enabled) return;
    start();
    let raf = 0,
      last = 0,
      lightCheck = 0;
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 12;
    const cctx = canvas.getContext("2d", { willReadFrequently: true });
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current,
        lm = lmRef.current;
      if (!v || !lm || v.readyState < 2 || now - last < 33) return;
      last = now;
      try {
        const r = lm.detectForVideo(v, now);
        const p = r.landmarks[0];
        landmarksRef.current = p ? p.map((q) => [q.x, q.y, q.visibility ?? 1] as Landmark) : null;
        setTick((t) => (t + 1) % 1e6);
      } catch {
        /* Frame überspringen */
      }
      if (now - lightCheck > 2000 && cctx) {
        lightCheck = now;
        cctx.drawImage(v, 0, 0, 16, 12);
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
      cancelAnimationFrame(raf);
      (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      lmRef.current?.close();
      lmRef.current = null;
    };
  }, [opts.enabled, start]);

  return { videoRef, landmarksRef, status, error, lowLight, tick };
}
