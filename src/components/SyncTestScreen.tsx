import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Check, Play, RotateCcw, Square } from "lucide-react";

import { PrivacyNote } from "@/components/setup/PrivacyNote";
import { Button } from "@/components/ui/button";
import { useAudioClock } from "@/hooks/useAudioClock";
import { useWakeLock } from "@/hooks/useWakeLock";
import { gameTimeMs } from "@/lib/audio/clock";
import { effectivePlaybackRate } from "@/lib/audio/rate";
import { PlayRefusedError } from "@/lib/audio/errors";
import { isLowPrecision } from "@/lib/audio/sources";
import { claimSharedElement } from "@/lib/audio/unlock";
import { StorageFullError } from "@/lib/library/storage";
import { useSettings } from "@/lib/settings";
import {
  SYNC_DISCARD_TAPS,
  SYNC_MIN_TAPS,
  beatDeviationMs,
  beatFlashDivisor,
  beatFlashLevel,
  computeSyncOffset,
  formatOffsetMs,
  isUneven,
  nudgeSyncOffset,
  tapAudioMs,
} from "@/lib/sync";
import { SYNC_PREVIEW } from "@/theme";
import type { Song } from "@/lib/types";
import { cn } from "@/lib/utils";

const CARD =
  "bg-(--scrim-banner) shadow-pop flex flex-col gap-4 rounded-3xl border border-white/15 p-5 text-white backdrop-blur-md";
const BTN =
  "btn-pill h-12 gap-2 rounded-full px-6 text-base focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
const HINT = "text-sm text-white/85";
const ERROR =
  "rounded-xl bg-destructive px-3 py-2 text-base font-medium text-destructive-foreground";
/** Deviations shown in the live list (newest first). */
const SHOWN_TAPS = 8;
/** Fine-tuning steps (ms) with their button labels. */
const NUDGES = [
  { delta: -10, label: "−10 ms", aria: "Offset um 10 ms verringern" },
  { delta: -1, label: "−1 ms", aria: "Offset um 1 ms verringern" },
  { delta: 1, label: "+1 ms", aria: "Offset um 1 ms erhöhen" },
  { delta: 10, label: "+10 ms", aria: "Offset um 10 ms erhöhen" },
] as const;

type Phase = "idle" | "starting" | "playing" | "ended";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="font-title text-stroke text-2xl">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Per-song sync test: the song plays from its start offset, the player taps along to the beat
 * (tap area or Space), and the taps' audio positions give a proposed `syncOffsetMs`
 * (`computeSyncOffset`, src/lib/sync.ts). Only taps while the music plays count.
 *
 * Fine-tuning works on a candidate value (starts at the saved offset; "Vorschlag übernehmen" or
 * the ±1/±10 ms buttons change it). While the music plays a beat light flashes on the game clock
 * computed with the candidate, so the player can compare it with the beat they hear; "Speichern"
 * writes the candidate. The light runs in its own rAF loop that writes `style` directly; React
 * renders once per tap or button press, never per frame.
 *
 * Playback starts with `play()` synchronously inside the "Start" tap, which is the gesture iOS
 * needs for the (shared) audio element and YouTube.
 */
export function SyncTestScreen({
  song,
  onSave,
}: {
  song: Song;
  onSave: (song: Song) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [phase, setPhase] = useState<Phase>("idle");
  const [taps, setTaps] = useState<number[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidate, setCandidate] = useState(song.syncOffsetMs);
  /** Candidate for the rAF loop (no effect restart per nudge). */
  const candidateRef = useRef(candidate);
  candidateRef.current = candidate;
  const lightRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(false);
  const mountedRef = useRef(true);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const isYouTube = song.source.type === "youtube";
  const lowPrecision = isLowPrecision(song);

  // Spotify playback arrives with stage 10; no source is created for it here.
  const isSpotify = song.source.type === "spotify";
  const audio = useAudioClock(isSpotify ? null : song, {
    latencyMs: settings.latencyMs,
    volume: settings.volume,
    element: claimSharedElement,
    container: () => ytHostRef.current,
    onEnded: () => {
      playingRef.current = false;
      setPhase("ended");
    },
    onExternalStart: () => {
      playingRef.current = true;
      setStartError(null);
      setPhase("playing");
    },
    // Paused in the YouTube player itself: stop like the stop button.
    onExternalPause: () => {
      playingRef.current = false;
      setPhase("idle");
    },
  });
  const source = audio.source;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (audio.state === "error") playingRef.current = false;
  }, [audio.state]);

  const start = () => {
    const s = source.current;
    if (!s || audio.state !== "ready" || phase === "starting" || phase === "playing") return;
    setStartError(null);
    setNotice(null);
    setPhase("starting");
    // play() runs synchronously in this tap (user gesture).
    s.seek(song.startOffsetMs);
    const run = s.play();
    run
      .then(() => {
        if (!mountedRef.current) return;
        playingRef.current = true;
        setPhase("playing");
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        setPhase("idle");
        // Only a refused start is fixed by tapping again; other errors are shown as they are.
        setStartError(
          !(e instanceof PlayRefusedError) && e instanceof Error
            ? e.message
            : isYouTube
              ? "Der Start wurde blockiert. Tippe direkt auf das Video."
              : "Die Musik ließ sich nicht starten. Tippe noch einmal auf „Start“.",
        );
      });
  };

  const stop = () => {
    source.current?.pause();
    playingRef.current = false;
    setPhase("idle");
  };

  const rate = effectivePlaybackRate(song);
  /** Records a tap; `eventTimeStamp` is the input event's `timeStamp` (dispatch delay is removed). */
  const tap = useCallback(
    (eventTimeStamp: number) => {
      if (!playingRef.current) return;
      const s = source.current;
      if (!s) return;
      const t = tapAudioMs(s.getTimeMs(), performance.now() - eventTimeStamp, rate);
      setTaps((ts) => [...ts, t]);
    },
    [source, rate],
  );

  // Space taps too, but only while the music plays (otherwise it keeps working on buttons).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (!playingRef.current) return;
      e.preventDefault();
      if (!e.repeat) tap(e.timeStamp);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap]);

  const playing = phase === "playing";
  // Keep the screen on while the test runs (no touch input besides the taps).
  useWakeLock(phase === "starting" || phase === "playing");
  const { bpm } = song;
  const latencyMs = settings.latencyMs;
  const choreoOffsetMs = song.choreo.offsetMs;

  // Beat light: brightness from the game clock with the candidate offset, written straight to
  // the element once per frame (no React state). Reduced motion: opacity only, no scale.
  useEffect(() => {
    const el = lightRef.current;
    if (!el) return;
    const idle = () => {
      el.style.opacity = "0";
      el.style.transform = "";
    };
    if (!playing) {
      idle();
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The limit is about real time: at playbackRate r the beats come r times as fast.
    const divisor = beatFlashDivisor(bpm * rate);
    let raf = 0;
    const frame = () => {
      const s = source.current;
      const level = s
        ? beatFlashLevel(
            gameTimeMs(s.getTimeMs(), {
              latencyMs,
              syncOffsetMs: candidateRef.current,
              choreoOffsetMs,
              rate,
            }),
            bpm,
            divisor,
            SYNC_PREVIEW.decayMs,
          )
        : 0;
      el.style.opacity = String(level);
      if (!still) el.style.transform = `scale(${1 + (SYNC_PREVIEW.scale - 1) * level})`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      idle();
    };
  }, [playing, source, bpm, rate, latencyMs, choreoOffsetMs]);

  const offsets = {
    latencyMs: settings.latencyMs,
    syncOffsetMs: candidate,
    choreoOffsetMs: song.choreo.offsetMs,
    rate,
  };
  const deviations = taps
    .slice(-SHOWN_TAPS)
    .reverse()
    .map((t) => Math.round(beatDeviationMs(t, song.bpm, offsets)) || 0);
  const proposal = useMemo(
    () => computeSyncOffset(taps, song.bpm, settings.latencyMs, song.choreo.offsetMs, rate),
    [taps, song.bpm, settings.latencyMs, song.choreo.offsetMs, rate],
  );
  const remaining = Math.max(0, SYNC_MIN_TAPS + SYNC_DISCARD_TAPS - taps.length);

  const write = async (syncOffsetMs: number) => {
    setBusy(true);
    setSaveError(null);
    setNotice(null);
    try {
      await onSave({ ...song, syncOffsetMs });
      return true;
    } catch (e) {
      if (mountedRef.current)
        setSaveError(
          e instanceof StorageFullError
            ? e.message
            : "Speichern hat nicht geklappt. Versuch es noch einmal.",
        );
      return false;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };
  const saveCandidate = async () => {
    if (busy || candidate === song.syncOffsetMs) return;
    if (await write(candidate)) void navigate({ to: "/" });
  };
  const resetToZero = async () => {
    if (busy) return;
    setCandidate(0);
    if (song.syncOffsetMs === 0) return; // already saved, only the working value changes
    if ((await write(0)) && mountedRef.current) setNotice("Sync-Offset auf 0 ms gesetzt.");
  };

  const audioError = audio.state === "error";

  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-240 flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-title text-stroke min-w-0 text-3xl sm:text-4xl">Sync-Test</h1>
          <Button asChild size="lg" variant="secondary" className={BTN}>
            <Link to="/">
              <ArrowLeft aria-hidden />
              Abbrechen
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 landscape:grid-cols-2">
          <Card title={song.title}>
            <p className="text-base">
              Tippe im Takt der Musik auf die Fläche oder drücke die Leertaste, genau dann, wenn du
              den Beat hörst. Nach {SYNC_MIN_TAPS + SYNC_DISCARD_TAPS} Taps schlägt DanceBeat einen
              Sync-Offset vor; die ersten {SYNC_DISCARD_TAPS} zählen nicht.
            </p>
            <p className="text-base">
              Gespeicherter Sync-Offset:{" "}
              <strong data-testid="saved-offset" className="tabular-nums">
                {formatOffsetMs(song.syncOffsetMs)}
              </strong>
            </p>
            {lowPrecision && (
              <p role="note" className="flex items-start gap-2 text-base font-medium">
                <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
                <span>
                  Bei {isYouTube ? "YouTube" : "Spotify"} ist die Zeitmessung ungenauer als bei
                  einer Audiodatei. Der Wert kann um einige Millisekunden schwanken.
                </span>
              </p>
            )}
            {isYouTube && (
              <div
                ref={ytHostRef}
                aria-label="YouTube-Video"
                className="aspect-video w-full max-w-80 overflow-hidden rounded-2xl bg-black"
              />
            )}
            <PrivacyNote source={song.source} camera={false} />
            {isSpotify ? (
              <p role="alert" className={ERROR}>
                Sync-Test für Spotify folgt mit Etappe 10.
              </p>
            ) : audioError ? (
              <p role="alert" className={ERROR}>
                Die Musik konnte nicht geladen werden. {audio.error}
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {playing ? (
                  <Button size="lg" variant="secondary" onClick={stop} className={BTN}>
                    <Square aria-hidden />
                    Stopp
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    disabled={audio.state !== "ready" || phase === "starting"}
                    onClick={start}
                    className={BTN}
                  >
                    <Play aria-hidden />
                    {audio.state === "loading" ? "Musik lädt …" : "Start"}
                  </Button>
                )}
              </div>
            )}
            {startError && (
              <p role="alert" className={ERROR}>
                {startError}
              </p>
            )}
            {phase === "ended" && <p className="text-base">Der Song ist zu Ende.</p>}
          </Card>

          <div className="flex flex-col gap-4">
            <button
              type="button"
              aria-label="Im Takt tippen"
              aria-disabled={!playing}
              onPointerDown={(e) => {
                e.preventDefault();
                tap(e.timeStamp);
              }}
              className={cn(
                "shadow-pop flex h-48 w-full touch-none select-none flex-col items-center justify-center gap-1 rounded-3xl border-4 bg-(--scrim-banner) text-white transition-[filter] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold landscape:h-36",
                playing ? "border-song active:brightness-150" : "border-white/30 opacity-70",
              )}
            >
              <span className="font-title text-stroke text-3xl">
                {playing ? "Tipp!" : "Erst „Start“ drücken"}
              </span>
              <span className="text-base tabular-nums" data-testid="tap-count">
                {taps.length} Taps
                {remaining > 0 ? ` · noch ${remaining}` : ""}
              </span>
            </button>

            <Card title="Ergebnis">
              {deviations.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className={HINT}>
                    Abweichung deiner letzten Taps vom Beat (mit eingestelltem Offset):
                  </p>
                  <ul aria-label="Abweichung pro Tap" className="flex flex-wrap gap-1.5">
                    {deviations.map((d, i) => (
                      <li
                        key={taps.length - i}
                        className="rounded-full bg-white/15 px-2.5 py-0.5 text-sm tabular-nums"
                      >
                        {formatOffsetMs(d)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal ? (
                <div className="flex flex-col gap-1" role="status">
                  <p className="text-lg">
                    Vorschlag:{" "}
                    <strong data-testid="proposed-offset" className="tabular-nums">
                      {formatOffsetMs(proposal.offsetMs)}
                    </strong>
                  </p>
                  <p className={HINT}>
                    Streuung ±{proposal.spreadMs} ms aus {proposal.count} Taps
                  </p>
                  {isUneven(proposal) && (
                    <p className="flex items-start gap-2 text-base font-medium">
                      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
                      Ungleichmäßig, nochmal versuchen.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-base">
                  {taps.length === 0
                    ? "Noch keine Taps."
                    : `Noch ${remaining} Taps bis zum Vorschlag.`}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  disabled={!proposal || proposal.offsetMs === candidate}
                  onClick={() => proposal && setCandidate(proposal.offsetMs)}
                  className={BTN}
                >
                  <Check aria-hidden />
                  Vorschlag übernehmen
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  disabled={taps.length === 0}
                  onClick={() => setTaps([])}
                  className={BTN}
                >
                  <RotateCcw aria-hidden />
                  Nochmal
                </Button>
              </div>
            </Card>

            <Card title="Feinjustierung">
              <div className="flex items-center gap-4">
                <div
                  aria-hidden
                  className="flex size-16 shrink-0 items-center justify-center rounded-full border-4 border-song"
                >
                  <div
                    ref={lightRef}
                    data-testid="beat-light"
                    className="size-10 rounded-full bg-song"
                    style={{ opacity: 0 }}
                  />
                </div>
                <p className="text-lg">
                  Offset:{" "}
                  <strong data-testid="candidate-offset" className="tabular-nums">
                    {formatOffsetMs(candidate)}
                  </strong>
                </p>
              </div>
              <p className={HINT}>
                Das Licht blinkt im Takt mit dem eingestellten Offset. Passt es zum Beat, den du
                hörst, speichere.
              </p>
              <div className="flex flex-wrap gap-2">
                {NUDGES.map((n) => (
                  <Button
                    key={n.delta}
                    size="lg"
                    variant="secondary"
                    aria-label={n.aria}
                    onClick={() => setCandidate((c) => nudgeSyncOffset(c, n.delta))}
                    className={cn(BTN, "px-4 tabular-nums")}
                  >
                    {n.label}
                  </Button>
                ))}
              </div>
              {saveError && (
                <p role="alert" className={ERROR}>
                  {saveError}
                </p>
              )}
              {notice && (
                <p role="status" className="text-base">
                  {notice}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  disabled={busy || candidate === song.syncOffsetMs}
                  onClick={() => void saveCandidate()}
                  className={BTN}
                >
                  Speichern
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  disabled={busy || (song.syncOffsetMs === 0 && candidate === 0)}
                  onClick={() => void resetToZero()}
                  className={BTN}
                >
                  Auf 0 zurücksetzen
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
