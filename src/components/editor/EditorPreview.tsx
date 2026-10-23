import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Play, Settings, SkipForward, Square } from "lucide-react";

import { PrivacyNote } from "@/components/setup/PrivacyNote";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAudioClock } from "@/hooks/useAudioClock";
import { useWakeLock } from "@/hooks/useWakeLock";
import { PlayRefusedError } from "@/lib/audio/errors";
import { effectivePlaybackRate } from "@/lib/audio/rate";
import { claimSharedElement } from "@/lib/audio/unlock";
import { formatMoveTime } from "@/lib/choreoEditor";
import {
  SEEK_TICK_EPSILON_MS,
  currentMoveIndex,
  dueMoves,
  previewStartAudioMs,
  tickTimeMs,
} from "@/lib/editorPreview";
import { createVideoFollower } from "@/lib/game/videoFollower";
import { videoTargetMs } from "@/lib/game/videoSync";
import { useSettings } from "@/lib/settings";
import { resumeSfx, setSfxVolume, sfx } from "@/lib/sfx";
import type { Song } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BTN, Card, ERROR, HINT } from "./parts";

type Phase = "idle" | "starting" | "playing";

/** Shown before the first playback. */
const NO_TIME = "--:--,-";

/**
 * Audio preview of the editor (stage 8d-2b). Plays the working copy's song from its start offset
 * or two beats before the selected move. A rAF loop reports the current move via `onNow` only
 * when it changes (game clock of `useAudioClock`, same offsets as the game, like the pictograms),
 * clicks every move that becomes due on the audio position (`tickTimeMs`: the click is audio and
 * shares the music's output delay; gold sounds different) and writes the music time straight into
 * the DOM. Moves and offsets come from the latest render (refs), so edits apply while it plays.
 *
 * The source's `playbackRate` is fixed when it is created: the parent keys this component by the
 * tempo, so a tempo change stops playback and builds a new source. Playback stops when the page is
 * hidden, when the song ends and on unmount (the hook destroys the source).
 *
 * A dance video (8h-2b-2b-1, `videoUrl` from the parent so the tempo remount keeps it) runs muted
 * on the game's time axis, like in the game: game time plus the live `choreo.offsetMs`, so offset
 * edits show while it plays. The same loop keeps it in step; stopped, it stays paused.
 */
export function EditorPreview({
  song,
  selected,
  onNow,
  click,
  onClickChange,
  videoUrl,
  onVideoError,
}: {
  song: Song;
  /** Index of the selected move ("Ab Move N abspielen"). */
  selected: number;
  /** Index of the move that is currently due, null when none (stopped or before the first). */
  onNow: (index: number | null) => void;
  /** "Klick bei jedem Move"; kept by the parent so it survives the tempo remount. */
  click: boolean;
  onClickChange: (on: boolean) => void;
  /** Object URL of the dance video (`useDanceVideo`), null when there is none. */
  videoUrl: string | null;
  /** The video failed to load or play; the parent drops the URL. */
  onVideoError: () => void;
}) {
  const id = useId();
  const [settings] = useSettings();
  const [phase, setPhase] = useState<Phase>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const timeRef = useRef<HTMLSpanElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(true);
  /** Bumped by every stop, so a late `play()` resolution of an older start is ignored. */
  const runRef = useRef(0);
  /**
   * Tick time of the last start/seek target, consumed by the next frame: the tick interval then
   * begins just before it, so a move right at the start clicks but nothing skipped by the jump.
   */
  const seekRef = useRef<number | null>(null);
  const isYouTube = song.source.type === "youtube";
  const isSpotify = song.source.type === "spotify";
  const rate = effectivePlaybackRate(song);
  const showVideo = videoUrl !== null && settings.danceVideo && !isYouTube;

  const audio = useAudioClock(song, {
    latencyMs: settings.latencyMs,
    volume: settings.volume,
    element: claimSharedElement,
    container: () => ytHostRef.current,
    onEnded: () => {
      runRef.current++;
      setPhase("idle");
      setEnded(true);
    },
    onExternalStart: () => {
      seekRef.current = null;
      setStartError(null);
      setEnded(false);
      setPhase("playing");
    },
    // Paused in the YouTube player (or another Spotify app): stop like the stop button.
    onExternalPause: () => {
      runRef.current++;
      setPhase("idle");
    },
  });
  const { source, timeMs } = audio;
  const ready = audio.state === "ready";
  const playing = phase === "playing" && audio.state === "ready";

  /** Latest edit state for the frame loop. */
  const live = useRef({ moves: song.choreo.moves, choreoOffsetMs: song.choreo.offsetMs, click });
  live.current = { moves: song.choreo.moves, choreoOffsetMs: song.choreo.offsetMs, click };

  useEffect(() => {
    mountedRef.current = true;
    if (timeRef.current) timeRef.current.textContent = NO_TIME;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => setSfxVolume(settings.volume), [settings.volume]);
  useWakeLock(phase === "starting" || playing);

  // Background tab, lock screen, app switch: stop.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "hidden") return;
      runRef.current++;
      source.current?.pause();
      setPhase("idle");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [source]);

  // Frame loop: ticks, current move, time display. No React state per frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prevTick: number | null = null;
    let lastOffset = live.current.choreoOffsetMs;
    let last: number | null | undefined;
    const follower = createVideoFollower();
    /** Last video element the loop moved; paused when the loop ends. */
    let video: HTMLVideoElement | null = null;
    const frame = (frameNow?: number) => {
      const s = source.current;
      if (s) {
        const { moves, choreoOffsetMs, click: tick } = live.current;
        const tickMs = tickTimeMs(s.getTimeMs(), choreoOffsetMs);
        const t = timeMs();
        const seek = seekRef.current;
        if (seek !== null) {
          seekRef.current = null;
          prevTick = seek - SEEK_TICK_EPSILON_MS;
        } else if (choreoOffsetMs !== lastOffset) {
          // Offset edit: the moves jumped against the music; skipped moves stay silent.
          prevTick = null;
        }
        lastOffset = choreoOffsetMs;
        if (tick)
          for (const i of dueMoves(moves, prevTick, tickMs)) {
            if (moves[i]?.gold) sfx.beep(true);
            else sfx.click();
          }
        prevTick = tickMs;
        const i = currentMoveIndex(moves, t);
        const now = i >= 0 ? i : null;
        if (now !== last) {
          last = now;
          onNow(now);
        }
        if (timeRef.current) timeRef.current.textContent = formatMoveTime(t + choreoOffsetMs);
        const v = videoRef.current;
        if (v) {
          video = v;
          follower.step(v, {
            nowMs: frameNow ?? 0,
            targetMs: videoTargetMs(t, choreoOffsetMs),
            playing: true,
            rate,
          });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      // Stop button, song end, hidden page, unmount: the video stops with the music.
      video?.pause();
      onNow(null);
    };
  }, [playing, source, timeMs, onNow, rate]);

  const start = (index?: number) => {
    const s = source.current;
    if (!s || !ready || phase === "starting") return;
    const pos = previewStartAudioMs(song, settings.latencyMs, index);
    seekRef.current = tickTimeMs(pos, song.choreo.offsetMs);
    if (phase === "playing") {
      s.seek(pos);
      return;
    }
    // YouTube after a refused start: keep "Tippe direkt auf das Video" visible while waiting.
    if (!isYouTube) setStartError(null);
    setEnded(false);
    setPhase("starting");
    const run = ++runRef.current;
    // Everything below runs synchronously in the tap (user gesture, needed by iOS and YouTube).
    resumeSfx();
    s.seek(pos);
    s.play()
      .then(() => {
        if (!mountedRef.current) return;
        if (run !== runRef.current) {
          s.pause();
          return;
        }
        setStartError(null);
        setPhase("playing");
      })
      .catch((e: unknown) => {
        if (!mountedRef.current || run !== runRef.current) return;
        setPhase("idle");
        // Only a refused start is fixed by tapping again; other errors are shown as they are.
        setStartError(
          !(e instanceof PlayRefusedError) && e instanceof Error
            ? e.message
            : isYouTube
              ? "Der Start wurde blockiert. Tippe direkt auf das Video."
              : "Die Musik ließ sich nicht starten. Tippe noch einmal auf „Abspielen“.",
        );
      });
  };

  const stop = () => {
    runRef.current++;
    source.current?.pause();
    setPhase("idle");
  };

  const busy = phase === "starting";
  return (
    <Card title="Vorschau">
      {isYouTube && (
        <div
          ref={ytHostRef}
          aria-label="YouTube-Video"
          className="aspect-video min-h-50 w-full min-w-50 max-w-90 overflow-hidden rounded-2xl bg-black"
        />
      )}
      {showVideo && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          aria-label="Tanzvideo"
          // Broken or unplayable: hidden (one state change in the parent).
          onError={onVideoError}
          className="aspect-video min-h-50 w-full min-w-50 max-w-90 rounded-2xl bg-black object-contain"
        />
      )}
      <PrivacyNote source={song.source} camera={false} />
      {audio.state === "error" && (
        <p role="alert" className={ERROR}>
          Die Musik konnte nicht geladen werden. {audio.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {phase !== "idle" ? (
          <Button size="lg" variant="secondary" onClick={stop} className={BTN}>
            <Square aria-hidden />
            Stopp
          </Button>
        ) : (
          <Button size="lg" disabled={!ready || busy} onClick={() => start()} className={BTN}>
            <Play aria-hidden />
            {audio.state === "loading" ? "Musik lädt …" : "Abspielen"}
          </Button>
        )}
        <Button
          size="lg"
          variant="secondary"
          disabled={!ready || busy}
          onClick={() => start(selected)}
          className={BTN}
        >
          <SkipForward aria-hidden />
          Ab Move {selected + 1} abspielen
        </Button>
        <p className="text-lg">
          Musikzeit:{" "}
          <span ref={timeRef} data-testid="preview-time" className="font-medium tabular-nums" />
        </p>
      </div>
      {startError && (
        <p role="alert" className={ERROR}>
          {startError}
        </p>
      )}
      {/* Most Spotify failures (not connected, session expired) are fixed there. */}
      {isSpotify && (audio.state === "error" || startError) && (
        <Button asChild size="lg" variant="secondary" className={cn(BTN, "self-start")}>
          <Link to="/settings">
            <Settings aria-hidden />
            Zu den Einstellungen
          </Link>
        </Button>
      )}
      {ended && <p className="text-base">Der Song ist zu Ende.</p>}
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={`${id}-click`} className="text-lg font-medium">
          Klick bei jedem Move
        </label>
        <Switch id={`${id}-click`} checked={click} onCheckedChange={onClickChange} />
      </div>
      <p className={HINT}>
        Die Markierung kommt wie im Spiel, mit deiner Verzögerung und dem Sync-Offset; der Klick
        sitzt direkt auf der Musik. Die Musikzeit entspricht den Zeiten der Moves. „Ab Move“ startet
        zwei Beats vorher.
      </p>
    </Card>
  );
}
