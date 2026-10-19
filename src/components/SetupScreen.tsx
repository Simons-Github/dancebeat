import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Camera, Gauge, Loader2, Play } from "lucide-react";

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
import { clearOverlay, drawOverlay } from "@/lib/overlay";
import type { SourceSpec } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getSettings, useSettings } from "@/lib/settings";

const PANEL =
  "bg-(--scrim-banner) shadow-pop flex flex-col gap-4 rounded-3xl border border-white/15 p-5 text-white backdrop-blur-md";
const BTN =
  "btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";

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
        started ? "flex-col landscape:flex-row" : "items-center justify-center",
      )}
    >
      {!started ? (
        <div className={cn(PANEL, "max-w-xl overflow-y-auto")}>
          <h1 className="font-title text-stroke text-3xl">Aufstellhilfe</h1>
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
        </div>
      ) : (
        <>
          <div className="relative grid min-h-0 min-w-0 flex-1 place-items-center [container-type:size]">
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

          <div
            className={cn(
              PANEL,
              "min-h-0 shrink-0 overflow-y-auto landscape:w-80 landscape:shrink",
            )}
          >
            {error ? (
              <CameraErrorPanel error={error} onRetry={retry} />
            ) : (
              <>
                <h1 className="font-title text-stroke text-2xl">Stell dich auf</h1>
                <BodyChecklist rows={rows} />
                <p role="status" className="text-base font-bold">
                  {status === "ready"
                    ? (body?.hint ?? "Stell dich vor die Kamera.")
                    : "Einen Moment, die Kamera startet."}
                </p>
                {lowLight && <p className="text-base">{LIGHT_HINT}</p>}
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
