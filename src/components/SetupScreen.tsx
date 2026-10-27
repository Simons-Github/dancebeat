import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Camera, Gauge, Loader2, Play, Smartphone } from "lucide-react";

import { BodyChecklist } from "@/components/setup/BodyChecklist";
import { CameraErrorPanel } from "@/components/setup/CameraErrorPanel";
import { DiagnosticsPanel } from "@/components/setup/DiagnosticsPanel";
import { PrivacyNote } from "@/components/setup/PrivacyNote";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePoseTracking, type FrameInfo } from "@/hooks/usePoseTracking";
import {
  LIGHT_HINT,
  createBodyTracker,
  createStatusSmoother,
  statusKey,
  statusRows,
  type BodyStatus,
} from "@/lib/bodyTracker";
import { unlockAudio } from "@/lib/audio/unlock";
import { isAutoStartArmed, rearmAutoStart } from "@/lib/game/session";
import { probeMotionSensor, requestMotionPermission, type MotionPermission } from "@/lib/motion";
import { clearOverlay, drawOverlay } from "@/lib/overlay";
import type { SourceSpec } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getSettings, useSettings } from "@/lib/settings";

const PANEL = "glass flex flex-col gap-4 rounded-3xl p-5 text-white";
const BTN =
  "btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";

const MOTION_REFUSED: Record<Exclude<MotionPermission, "granted">, string> = {
  denied:
    "Bewegungssensor nicht erlaubt. Erlaube den Zugriff in den Browser-Einstellungen und versuche es noch einmal.",
  unsupported: "Dieses Gerät hat keinen Bewegungssensor.",
};

/** No frame for this long means the detection stalled (background, lock, ended track). */
const STALL_MS = 500;
const HEARTBEAT_MS = 250;

/**
 * Setup screen: explains, then (after a tap) starts the camera, shows the mirrored picture with
 * stance guide and skeleton, and unlocks "Los geht's" once the whole body was seen for 1 s.
 * The unlock sticks until camera or status change: walking to the phone must not lock it again.
 *
 * Once unlocked, the game starts on its own (the play route counts down). After "Abbrechen" in
 * that countdown, auto-start stays off for this song until "Los geht's" is tapped. The tap on
 * "Kamera starten" also unlocks audio playback for iOS (src/lib/audio/unlock.ts).
 *
 * "Ohne Kamera spielen" (before the camera starts, and next to a camera error) asks for the motion
 * sensor and starts the movement mode (`?mode=motion`).
 */
export function SetupScreen({
  songId,
  songTitle,
  songSource,
}: {
  songId: string;
  songTitle: string;
  songSource: SourceSpec;
}) {
  const navigate = useNavigate();
  const [settings, saveSettings] = useSettings();
  const [started, setStarted] = useState(false);
  const [cameraId, setCameraId] = useState<string | undefined>(undefined);
  const [retryKey, setRetryKey] = useState(0);
  const [showDiag, setShowDiag] = useState(false);
  const [body, setBody] = useState<BodyStatus | null>(null);
  const [reached, setReached] = useState(false);
  const [autoStart] = useState(() => getSettings().autoStart && isAutoStartArmed(songId));
  const [motionError, setMotionError] = useState<string | null>(null);
  const [motionChecking, setMotionChecking] = useState(false);
  // The sensor check takes up to a second; leaving meanwhile must not navigate afterwards.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tracker] = useState(() => createBodyTracker());
  const [smoother] = useState(() => createStatusSmoother());
  const lastKey = useRef("");
  const reachedRef = useRef(false);

  const resetBody = useCallback(() => {
    tracker.reset();
    smoother.reset();
    lastKey.current = "";
    setBody(null);
  }, [tracker, smoother]);

  // Runs in the detection loop: draws straight to the canvas, renders only when the checklist changes.
  const onFrame = useCallback(
    ({ landmarks, videoWidth, videoHeight, nowMs }: FrameInfo) => {
      const status = tracker.update(landmarks, nowMs);
      const canvas = canvasRef.current;
      if (canvas) {
        if (videoWidth && (canvas.width !== videoWidth || canvas.height !== videoHeight)) {
          canvas.width = videoWidth;
          canvas.height = videoHeight;
        }
        drawOverlay(canvas, landmarks, { ready: status.ready });
      }
      if (status.ready && !reachedRef.current) {
        reachedRef.current = true;
        setReached(true);
      }
      // The checklist only follows a state that stayed the same for a moment.
      const shown = smoother.next(status, nowMs);
      const key = statusKey(shown);
      if (key !== lastKey.current) {
        lastKey.current = key;
        setBody(shown);
      }
    },
    [tracker, smoother],
  );

  const {
    videoRef,
    statsRef,
    lastFrameAtRef,
    status,
    error,
    lowLight,
    cameras,
    activeDeviceId,
    fallback,
    aspect,
  } = usePoseTracking({
    enabled: started,
    ...(cameraId ? { cameraId } : {}),
    retryKey,
    onFrame,
    onStaleCamera: () => saveSettings({ cameraId: "" }),
  });

  // Camera not delivering (loading, error, switched): nothing may count as "seen", and the
  // unlock starts over.
  useEffect(() => {
    if (status !== "ready") resetBody();
    if (canvasRef.current) clearOverlay(canvasRef.current);
    reachedRef.current = false;
    setReached(false);
  }, [status, cameraId, resetBody]);

  // Heartbeat: when frames stop (tab in background, screen lock, ended track) the last body
  // state must not stay on screen. The unlock stays.
  useEffect(() => {
    if (status !== "ready") return;
    const id = setInterval(() => {
      if (performance.now() - lastFrameAtRef.current > STALL_MS) {
        resetBody();
        const canvas = canvasRef.current;
        if (canvas) drawOverlay(canvas, null, { ready: false });
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [status, lastFrameAtRef, resetBody]);

  const start = () => {
    // Synchronously inside the tap: the countdown start later is no user gesture.
    unlockAudio();
    setCameraId(getSettings().cameraId || undefined);
    setStarted(true);
  };
  const retry = () => setRetryKey((k) => k + 1);
  const pickCamera = (id: string) => {
    // The same camera again (it failed before): the id does not change, so start over explicitly.
    if (id === cameraId) retry();
    setCameraId(id);
    saveSettings({ cameraId: id });
  };

  const ready = status === "ready" && reached;

  const play = useCallback(() => {
    void navigate({ to: "/play/$songId", params: { songId } });
  }, [navigate, songId]);
  const playNow = () => {
    unlockAudio();
    rearmAutoStart(songId);
    play();
  };
  const playWithoutCamera = () => {
    // Both synchronously inside the tap: iOS needs the gesture for audio and for the sensor.
    unlockAudio();
    const permission = requestMotionPermission();
    setMotionError(null);
    setMotionChecking(true);
    void permission.then(async (p) => {
      // "granted" comes without a prompt also on desktops and phones without a sensor: wait for
      // a first real measurement.
      const refused = p !== "granted" ? p : (await probeMotionSensor()) ? null : "unsupported";
      if (!mounted.current) return;
      setMotionChecking(false);
      if (refused) {
        setMotionError(MOTION_REFUSED[refused]);
        return;
      }
      rearmAutoStart(songId);
      void navigate({ to: "/play/$songId", params: { songId }, search: { mode: "motion" } });
    });
  };
  const withoutCamera = (
    <div className="flex flex-col gap-2">
      <p className="text-base text-white/90">
        Ohne Kamera: Halte das Handy fest in der Hand und beweg dich im Takt. Bewertet wird, wie
        kräftig du dich bewegst.
      </p>
      <Button
        size="lg"
        variant="secondary"
        onClick={playWithoutCamera}
        disabled={motionChecking}
        className={cn(BTN, "self-start")}
      >
        <Smartphone aria-hidden />
        Ohne Kamera spielen
      </Button>
      {motionChecking && (
        <p role="status" className="text-base">
          Bewegungssensor wird geprüft …
        </p>
      )}
      {motionError && (
        <p role="alert" className="text-base font-bold">
          {motionError}
        </p>
      )}
    </div>
  );
  // Auto-start: setting "autoStart" and not cancelled during the countdown of this song.
  useEffect(() => {
    if (ready && autoStart) play();
  }, [ready, autoStart, play]);
  const rows = statusRows(body, lowLight);
  const mirror = settings.mirror;

  return (
    <main
      className={cn(
        "safe-pad flex min-h-0 flex-1 gap-3",
        // Pre-start: main scrolls; the card's auto margins center it only while it fits, so its
        // top never slides under the header (unlike justify-center).
        started ? "flex-col landscape:flex-row" : "flex-col items-center overflow-y-auto",
      )}
    >
      {!started ? (
        <div className={cn(PANEL, "my-auto w-full max-w-xl shrink-0 landscape:gap-3")}>
          <h1 className="font-title text-3xl landscape:text-2xl">Aufstellhilfe</h1>
          <p className="text-base text-white/90">
            Gleich tanzt du zu „{songTitle}“. Die Kamera sieht dich, damit DanceBeat deine
            Bewegungen bewerten kann.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-base">
            <li>Stell das Handy fest auf, zum Beispiel angelehnt an eine Wand.</li>
            <li>Geh zwei bis drei Schritte zurück, bis du von Kopf bis Fuß im Bild bist.</li>
            <li>Sorge für genug Licht, am besten von vorne.</li>
          </ol>
          <PrivacyNote source={songSource} />
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={start} className={BTN}>
              <Camera aria-hidden />
              Kamera starten
            </Button>
            <Button asChild size="lg" variant="secondary" className={BTN}>
              <Link to="/">
                <ArrowLeft aria-hidden />
                Zurück
              </Link>
            </Button>
          </div>
          <div className="border-t border-white/20 pt-4 landscape:pt-3">{withoutCamera}</div>
        </div>
      ) : (
        <>
          <div className="relative grid min-h-0 min-w-0 flex-1 place-items-center [container-type:size] portrait:min-h-[35dvh]">
            <div
              className="relative overflow-hidden rounded-3xl border border-white/20 bg-black shadow-pop"
              style={{ aspectRatio: aspect, width: `min(100cqw, calc(100cqh * ${aspect}))` }}
            >
              <div className={cn("absolute inset-0", mirror && "-scale-x-100")}>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  aria-label="Live-Bild deiner Kamera"
                  className="size-full object-cover"
                />
                <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
              </div>
              {status === "loading" && (
                <div
                  role="status"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-4 text-center text-white"
                >
                  <Loader2 aria-hidden className="size-8 motion-safe:animate-spin" />
                  <p className="text-base font-medium">Kamera und Erkennung werden gestartet …</p>
                  <p className="text-sm text-white/90">Beim ersten Mal kann das etwas dauern.</p>
                </div>
              )}
            </div>
          </div>

          {/* Shrinks and scrolls when its content outgrows the space (diagnostics, camera
              select); in portrait the video keeps at least 35dvh. */}
          <div className={cn(PANEL, "min-h-0 overflow-y-auto landscape:w-80")}>
            {error ? (
              <>
                <CameraErrorPanel error={error} onRetry={retry} />
                {withoutCamera}
              </>
            ) : (
              <>
                <h1 className="font-title text-2xl">Stell dich auf</h1>
                <BodyChecklist rows={rows} />
                <p role="status" className="text-base font-bold">
                  {status === "ready"
                    ? (body?.hint ?? "Stell dich vor die Kamera.")
                    : "Einen Moment, die Kamera startet."}
                </p>
                {lowLight && <p className="text-base">{LIGHT_HINT}</p>}
                {fallback && (
                  <p className="text-base">
                    Die gespeicherte Kamera ist nicht erreichbar, es läuft die Standardkamera.
                  </p>
                )}
                {autoStart ? (
                  <p className="text-base">Sobald alles passt, geht es von selbst los.</p>
                ) : settings.autoStart ? (
                  <p className="text-base">
                    Automatischer Start ist aus, weil du abgebrochen hast. Tippe auf „Los
                    geht&apos;s“, wenn du bereit bist.
                  </p>
                ) : (
                  <p className="text-base">Tippe auf „Los geht&apos;s“, wenn du bereit bist.</p>
                )}
              </>
            )}

            {cameras.length > 1 && (
              <div className="flex flex-col gap-1">
                <label htmlFor="camera-select" className="text-sm text-white/90">
                  Kamera
                </label>
                <Select value={activeDeviceId} onValueChange={pickCamera}>
                  <SelectTrigger id="camera-select" className="h-12 bg-white/10 text-base">
                    <SelectValue placeholder="Kamera wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {cameras.map((c) => (
                      <SelectItem key={c.deviceId} value={c.deviceId}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showDiag && <DiagnosticsPanel statsRef={statsRef} />}
            <PrivacyNote source={songSource} />

            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" disabled={!ready} onClick={playNow} className={BTN}>
                <Play aria-hidden />
                Los geht&apos;s
              </Button>
              <Button asChild size="lg" variant="secondary" className={BTN}>
                <Link to="/">
                  <ArrowLeft aria-hidden />
                  Zurück
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-pressed={showDiag}
                aria-label="Diagnose ein- oder ausblenden"
                onClick={() => setShowDiag((v) => !v)}
                className="size-12 rounded-full text-white hover:bg-white/15 focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-6"
              >
                <Gauge aria-hidden />
              </Button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
