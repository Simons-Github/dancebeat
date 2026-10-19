import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useReducedMotion } from "framer-motion";
import { ArrowLeft, Home, Pause } from "lucide-react";

import { Hud } from "@/components/play/Hud";
import {
  BlockedOverlay,
  CountdownOverlay,
  GAME_BTN,
  MessageOverlay,
  PauseMenu,
  PreparingOverlay,
} from "@/components/play/Overlays";
import { PiktoBar } from "@/components/play/PiktoBar";
import { RatingPopup } from "@/components/play/RatingPopup";
import { CameraErrorPanel } from "@/components/setup/CameraErrorPanel";
import { Button } from "@/components/ui/button";
import { useAudioClock } from "@/hooks/useAudioClock";
import { usePoseTracking, type FrameInfo } from "@/hooks/usePoseTracking";
import { useScoring } from "@/hooks/useScoring";
import { claimSharedElement } from "@/lib/audio/unlock";
import { scrimCss } from "@/lib/contrast";
import { beatPulse } from "@/lib/game/beat";
import { GameController, type GameState } from "@/lib/game/controller";
import { drawCoach, drawPiktos, drawSkeleton } from "@/lib/game/draw";
import { coachPose, coachView, flashSchedule, moveFigures, piktoLayout } from "@/lib/game/pikto";
import { recordResultSafely } from "@/lib/game/results";
import { disarmAutoStart, setLastResult } from "@/lib/game/session";
import { simulatedAngles, type SimOptions } from "@/lib/game/simulatedPlayer";
import { songRepository } from "@/lib/library/repository";
import { MOVE_WINDOW_MS } from "@/lib/scorer";
import { computeAngles } from "@/lib/pose";
import { getSettings, useSettings } from "@/lib/settings";
import { setSfxVolume, sfx } from "@/lib/sfx";
import type { Song } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GAME, SCRIM } from "@/theme";

/** After the last move, the game ends this long later at the latest (if the audio runs on). */
export const END_TAIL_MS = 2000;
/** "Gold Move" appears this long before a gold move. */
const GOLD_NOTICE_MS = 2500;
/** Simulated frames per second in the dev simulation mode. */
const SIM_FRAME_MS = 33;

const INITIAL: GameState = {
  phase: "preparing",
  count: null,
  pauseReason: null,
  bodyMissing: false,
};

/**
 * Gameplay: camera picture, pictogram bar, coach, HUD, popups, countdown and pause. All per-frame
 * work (scoring tick, pictograms, coach, skeleton, beat pulse) runs in one rAF loop and the
 * detection callback and draws to canvases; React renders only on phase changes and judgements.
 *
 * `sim` (dev builds only) replaces the camera with the choreography's own angles plus noise.
 */
export function GameScreen({ song, sim }: { song: Song; sim: SimOptions | null }) {
  const navigate = useNavigate();
  const [settings, saveSettings] = useSettings();
  const reducedMotion = useReducedMotion() ?? false;
  const choreo = song.choreo;
  const [game, setGame] = useState<GameState>(INITIAL);
  const [goldSoon, setGoldSoon] = useState(false);
  const [visible, setVisible] = useState(true);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const controllerRef = useRef<GameController | null>(null);
  const startedRef = useRef(false);

  const skeletonRef = useRef<HTMLCanvasElement>(null);
  const piktoRef = useRef<HTMLCanvasElement>(null);
  const coachRef = useRef<HTMLCanvasElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const isYouTube = song.source.type === "youtube";
  const pulseRef = useRef<HTMLDivElement>(null);
  // Latest toggles for the loops, without restarting them.
  const showSkeleton = useRef(settings.skeleton);
  showSkeleton.current = settings.skeleton;
  const pulseOn = useRef(settings.beatPulse && !reducedMotion);
  pulseOn.current = settings.beatPulse && !reducedMotion;

  const audio = useAudioClock(song, {
    latencyMs: settings.latencyMs,
    volume: settings.volume,
    element: claimSharedElement,
    container: () => ytHostRef.current,
    onEnded: () => controllerRef.current?.finish(),
    onExternalStart: () => controllerRef.current?.externalStart(),
  });
  const scoring = useScoring(choreo, settings.difficulty);
  const timeMs = audio.timeMs;

  useEffect(() => setSfxVolume(settings.volume), [settings.volume]);
  // The stored camera is read once, then the camera starts (no restart when settings load).
  useEffect(() => setCameraId(getSettings().cameraId), []);

  // Detection loop callback: angles of the picture, filed under the time it was taken.
  const onFrame = useCallback((f: FrameInfo) => {
    const angles = f.landmarks ? computeAngles(f.landmarks, { aspect: f.aspect }) : null;
    controllerRef.current?.pushFrame(angles, f.frameAgeMs);
    const canvas = skeletonRef.current;
    if (!canvas) return;
    if (f.videoWidth && (canvas.width !== f.videoWidth || canvas.height !== f.videoHeight)) {
      canvas.width = f.videoWidth;
      canvas.height = f.videoHeight;
    }
    drawSkeleton(canvas, showSkeleton.current ? f.landmarks : null);
  }, []);

  const camera = usePoseTracking({
    enabled: !sim && cameraId !== null,
    ...(cameraId ? { cameraId } : {}),
    retryKey,
    onFrame,
    onStaleCamera: () => saveSettings({ cameraId: "" }),
  });
  const cameraReady = !!sim || camera.status === "ready";

  // What the end of the game hands to the result screen. The best result is stored in the song
  // first; a storage error or a slow save is logged and never keeps the player from the result.
  // GameController.finish() runs onEnd only once, so no extra guard is needed here.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const finishRef = useRef(() => {});
  finishRef.current = () => {
    const snap = scoring.getSnapshot();
    const toResult = () => void navigate({ to: "/result/$songId", params: { songId: song.id } });
    if (!snap) {
      toResult();
      return;
    }
    void recordResultSafely(songRepository, song.id, snap.score, snap.stars).then(
      ({ newHighscore }) => {
        // Left the game while saving (e.g. back button): stay where the player went.
        if (!mountedRef.current) return;
        setLastResult({
          songId: song.id,
          score: snap.score,
          stars: snap.stars,
          mega: snap.mega,
          counts: snap.counts,
          maxCombo: snap.maxCombo,
          newHighscore,
        });
        toResult();
      },
    );
  };

  const endMs = (choreo.moves.at(-1)?.timeMs ?? 0) + MOVE_WINDOW_MS + END_TAIL_MS;
  useEffect(() => {
    const src = () => audio.source.current;
    const ctl = new GameController({
      audio: {
        play: () => src()?.play() ?? Promise.reject(new Error("Keine Audioquelle")),
        pause: () => src()?.pause(),
        seek: (ms) => src()?.seek(ms),
      },
      timeMs: audio.timeMs,
      scoring,
      startOffsetMs: song.startOffsetMs,
      endMs,
      rate: song.playbackRate ?? 1,
      onState: setGame,
      onEnd: () => finishRef.current(),
      onBeep: (n) => sfx.beep(n === 0),
    });
    controllerRef.current = ctl;
    startedRef.current = false;
    return () => {
      ctl.dispose();
      if (controllerRef.current === ctl) controllerRef.current = null;
    };
    // The controller lives as long as this song; scoring callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id]);

  // Auto-start: as soon as audio and camera are up (and the page is visible).
  useEffect(() => {
    if (startedRef.current || !visible) return;
    if (game.phase !== "preparing" || audio.state !== "ready" || !cameraReady) return;
    startedRef.current = true;
    controllerRef.current?.start();
  }, [game.phase, audio.state, cameraReady, visible]);

  // Background tab, lock screen, app switch: pause.
  useEffect(() => {
    const onVis = () => {
      const v = document.visibilityState === "visible";
      setVisible(v);
      if (!v) controllerRef.current?.pause("hidden");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Camera lost (track ended and restarting, or failed): pause.
  useEffect(() => {
    if (!cameraReady && startedRef.current) controllerRef.current?.pause("camera");
  }, [cameraReady]);

  // Escape pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") controllerRef.current?.pause("user");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const figures = useMemo(() => moveFigures(choreo), [choreo]);
  const flashes = useMemo(() => flashSchedule(choreo.moves), [choreo]);
  const view = useMemo(() => coachView(choreo.frames), [choreo]);

  // One loop for everything that moves.
  useEffect(() => {
    let raf = 0;
    let lastSim = -Infinity;
    let gold = false;
    const colors = { accent: choreo.accentColor, secondary: choreo.secondaryColor };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const ctl = controllerRef.current;
      const t = timeMs();
      if (
        import.meta.env.DEV &&
        sim &&
        ctl?.state.phase === "playing" &&
        t - lastSim >= SIM_FRAME_MS
      ) {
        lastSim = t;
        ctl.pushFrame(simulatedAngles(choreo, t, sim), 0);
        const canvas = skeletonRef.current;
        if (canvas) {
          if (canvas.width !== 720) canvas.width = canvas.height = 720;
          drawSkeleton(canvas, showSkeleton.current ? (coachPose(choreo.frames, t) ?? null) : null);
        }
      }
      ctl?.tick();
      if (piktoRef.current)
        drawPiktos(
          piktoRef.current,
          piktoLayout(choreo.moves, t, { flashes, reducedMotion }),
          figures,
          colors,
        );
      if (coachRef.current)
        drawCoach(coachRef.current, coachPose(choreo.frames, t), view, choreo.accentColor);
      if (pulseRef.current) {
        const playing = ctl?.state.phase === "playing";
        pulseRef.current.style.opacity = String(
          playing && pulseOn.current ? beatPulse(t, song.bpm) * GAME.pulse : 0,
        );
      }
      const g = choreo.moves.some(
        (m) => m.gold && m.timeMs - t > 0 && m.timeMs - t < GOLD_NOTICE_MS,
      );
      if (g !== gold) {
        gold = g;
        setGoldSoon(g);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [timeMs, choreo, figures, flashes, view, reducedMotion, sim, song.bpm]);

  // The music broke (load or runtime error): stop timers and playback; the overlay explains.
  useEffect(() => {
    if (audio.state === "error") controllerRef.current?.cancel();
  }, [audio.state]);

  const cancel = () => {
    controllerRef.current?.cancel();
    disarmAutoStart(song.id);
    void navigate({ to: "/setup/$songId", params: { songId: song.id } });
  };
  const quit = () => void navigate({ to: "/" });

  const style = {
    "--song": choreo.accentColor,
    "--song-2": choreo.secondaryColor,
    "--hud-scrim": scrimCss(SCRIM.ink, GAME.hudScrim),
  } as CSSProperties;
  const vignette = `radial-gradient(ellipse at center, transparent 50%, ${scrimCss(SCRIM.ink, GAME.vignette)} 100%)`;
  const { phase } = game;
  const backToSetup = (
    <Button asChild size="lg" className={GAME_BTN}>
      <Link to="/setup/$songId" params={{ songId: song.id }}>
        <ArrowLeft aria-hidden />
        Zur Aufstellhilfe
      </Link>
    </Button>
  );
  const toLibrary = (
    <Button asChild size="lg" variant="secondary" className={GAME_BTN}>
      <Link to="/">
        <Home aria-hidden />
        Zur Bibliothek
      </Link>
    </Button>
  );

  let overlay = null;
  if (audio.state === "error") {
    overlay = (
      <MessageOverlay
        title={
          startedRef.current ? "Die Musik ist abgebrochen" : "Die Musik konnte nicht geladen werden"
        }
        actions={toLibrary}
      >
        <p className="text-base">{audio.error}</p>
      </MessageOverlay>
    );
  } else if (!sim && camera.error && phase !== "paused") {
    overlay = (
      <MessageOverlay title="Ohne Kamera geht es nicht" actions={backToSetup}>
        <CameraErrorPanel error={camera.error} onRetry={() => setRetryKey((k) => k + 1)} />
      </MessageOverlay>
    );
  } else if (phase === "preparing") {
    overlay = <PreparingOverlay onCancel={cancel} />;
  } else if (phase === "countdown" && game.count !== null) {
    overlay = <CountdownOverlay count={game.count} onCancel={cancel} />;
  } else if (phase === "blocked") {
    overlay = (
      <BlockedOverlay
        onTap={() => controllerRef.current?.tap()}
        {...(isYouTube ? { hint: "Falls nichts passiert, tippe direkt auf das Video." } : {})}
      />
    );
  } else if (phase === "paused") {
    overlay = (
      <PauseMenu
        reason={game.pauseReason}
        canResume={cameraReady && visible}
        cameraError={sim ? null : camera.error}
        skeleton={settings.skeleton}
        beatPulse={settings.beatPulse}
        onResume={() => controllerRef.current?.resume()}
        onRestart={() => controllerRef.current?.restart()}
        onQuit={quit}
        onRetryCamera={() => setRetryKey((k) => k + 1)}
        onSkeleton={(v) => saveSettings({ skeleton: v })}
        onBeatPulse={(v) => saveSettings({ beatPulse: v })}
      />
    );
  }

  const snap = scoring.snapshot;
  return (
    <main
      className="fixed inset-0 z-50 select-none overflow-hidden bg-ink text-white"
      style={style}
      aria-label={`Spiel: ${song.title}`}
    >
      {/* Camera picture (mirrored like a mirror) with skeleton. */}
      <div className={cn("absolute inset-0", settings.mirror && "-scale-x-100")}>
        {!sim && (
          <video
            ref={camera.videoRef}
            muted
            playsInline
            aria-label="Live-Bild deiner Kamera"
            className="size-full object-cover"
          />
        )}
        <canvas
          ref={skeletonRef}
          aria-hidden
          className={cn("absolute inset-0 size-full", sim ? "object-contain" : "object-cover")}
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: choreo.accentColor, opacity: GAME.tint }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: vignette }}
      />
      <div
        ref={pulseRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: `inset 0 0 8vmin ${choreo.accentColor}`, opacity: 0 }}
      />

      {/* No z-index here: it would make a stacking context, and the YouTube host could not rise
          above the blocked layer (z-30). Tree order already puts this above the tints. */}
      <div className="safe-pad relative flex h-full flex-col gap-3">
        <div className="flex items-start gap-2">
          <Hud
            score={snap?.score ?? 0}
            combo={snap?.combo ?? 0}
            stars={snap?.stars ?? 0}
            mega={snap?.mega ?? false}
            ratio={snap?.ratio ?? 0}
          />
          <Button
            size="icon"
            variant="secondary"
            aria-label="Pause"
            disabled={phase !== "playing" && phase !== "countdown"}
            onClick={() => controllerRef.current?.pause("user")}
            className="bg-(--hud-scrim) size-12 shrink-0 rounded-full border border-white/15 text-white shadow-pop focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-6"
          >
            <Pause aria-hidden />
          </Button>
        </div>
        <PiktoBar canvasRef={piktoRef} goldSoon={goldSoon} />
        <div className="relative min-h-0 flex-1">
          {game.bodyMissing && phase === "playing" && (
            <p
              role="status"
              className="bg-(--hud-scrim) absolute inset-x-0 top-8 mx-auto w-fit max-w-full rounded-2xl px-4 py-2 text-center text-base font-bold"
            >
              Wir sehen dich nicht. Stell dich wieder ganz ins Bild.
            </p>
          )}
          <RatingPopup judgement={scoring.last} />
          {isYouTube ? (
            <div
              ref={ytHostRef}
              aria-label="YouTube-Video"
              className={cn(
                "absolute bottom-0 left-0 size-[max(200px,min(38vw,28dvh))] overflow-hidden rounded-2xl landscape:size-[max(200px,min(26vw,42dvh))]",
                // Blocked: above the layer and tappable, the tap in the iframe starts YouTube.
                phase === "blocked" ? "pointer-events-auto z-40" : "pointer-events-none z-20",
              )}
            />
          ) : (
            <canvas
              ref={coachRef}
              aria-label="Coach"
              role="img"
              className="absolute bottom-0 left-0 size-[min(38vw,28dvh)] landscape:size-[min(26vw,42dvh)]"
            />
          )}
        </div>
      </div>
      {import.meta.env.DEV && sim && (
        <p className="absolute bottom-2 right-3 z-20 rounded-full bg-black/70 px-3 py-1 text-xs font-bold">
          SIMULATION · Rauschen {sim.noiseDeg}° · Ausfall {Math.round(sim.missRate * 100)} %
        </p>
      )}
      {overlay}
      <span hidden data-testid="phase">
        {phase}
      </span>
    </main>
  );
}
