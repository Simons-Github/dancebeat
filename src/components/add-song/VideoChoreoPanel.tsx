import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useVideoAnalysis } from "@/hooks/useVideoAnalysis";
import { useWakeLock } from "@/hooks/useWakeLock";
import {
  BEAT_PHASE_WINDOW_MS,
  analyzeAudio,
  estimateBeatPhaseMs,
  type OnsetEnvelope,
} from "@/lib/beat";
import { BPM_MAX, BPM_MIN } from "@/lib/library/newSong";
import {
  VIDEO_RANGE_MAX_MS,
  buildVideoChoreo,
  parseBeatPhaseMs,
  parseVideoSeconds,
  validateVideoRange,
  type VideoImportResult,
  type VideoRange,
} from "@/lib/library/videoImport";
import type { PoseModel } from "@/lib/mediapipe";
import type { PoseEstimator } from "@/lib/poseEstimator";
import { formatStartOffsetSeconds } from "@/lib/sync";

const BTN = "h-11 rounded-full px-4 text-base focus-visible:ring-4 focus-visible:ring-gold";
const INPUT = "h-11 rounded-xl text-base md:text-base";
const HINT = "text-sm text-muted-foreground";
const FIELD_ERROR = "text-sm font-medium text-destructive";

const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/*,.mp4,.mov";

/**
 * Largest video whose audio track is decoded for the beat detection. Decoding reads the whole
 * file into memory plus the decoded samples; beyond this, phones risk running out of memory.
 */
export const VIDEO_BEAT_MAX_BYTES = 250 * 1024 * 1024;
/** Longest video decoded for the beat detection: the decoded samples grow with the duration. */
export const VIDEO_BEAT_MAX_MS = 15 * 60_000;

const BEAT_HAND_HINT = "Bitte die Beat-Phase von Hand eintragen.";

/** Where the automatic beat phase comes from; null = typed by hand. */
type BeatSource = { kind: "music" } | { kind: "video"; envelope: OnsetEnvelope };
type BeatStatus = { status: "idle" | "busy" } | { status: "error"; message: string };

/** First beat at or after the section start, judged on the start of the section only. */
const phaseInRange = (env: OnsetEnvelope, bpm: number, range: VideoRange) =>
  estimateBeatPhaseMs(
    env,
    bpm,
    range.startMs,
    Math.min(range.endMs - range.startMs, BEAT_PHASE_WINDOW_MS),
  );

interface VideoChoreoPanelProps {
  /** BPM from the form (NaN while invalid). Changing it only recomputes, no new analysis. */
  bpm: number;
  /** Ready-to-save result, or null while there is none (no video, stale, error, …). */
  onChange: (result: VideoImportResult | null) => void;
  /** Onset envelope of the song's audio file (Datei tab, analyzed), else null. */
  musicBeat?: OnsetEnvelope | null;
  /** BPM estimated from the video's audio track; the dialog decides whether to take it. */
  onBpmDetected?: (bpm: number) => void;
  /** Injected in tests. Default: MediaPipe. */
  createEstimator?: (model: PoseModel) => PoseEstimator;
}

/** Seconds text with one decimal, rounded down (never past the given time). */
const formatFloor = (ms: number) => formatStartOffsetSeconds(Math.floor(ms / 100) * 100);

const sameRange = (a: VideoRange, b: VideoRange | null) =>
  b !== null && a.startMs === b.startMs && a.endMs === b.endMs;

/**
 * Choreography from a dance video: file, preview, range, mirroring, beat phase and the pose
 * analysis. The video stays in memory only (object URL, revoked on change and unmount); the
 * preview must stay visible during the analysis (video-frame callbacks).
 */
export function VideoChoreoPanel({
  bpm,
  onChange,
  musicBeat = null,
  onBpmDetected,
  createEstimator,
}: VideoChoreoPanelProps) {
  const id = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [startText, setStartText] = useState("0");
  const [endText, setEndText] = useState("");
  const [selfie, setSelfie] = useState(false);
  const [phaseText, setPhaseText] = useState("0");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [beatSource, setBeatSource] = useState<BeatSource | null>(null);
  const [beatStatus, setBeatStatus] = useState<BeatStatus>({ status: "idle" });
  /** Guards against a slow audio decode of a previous video overwriting the current one. */
  const beatToken = useRef(0);
  /** Range of the last started analysis; the track only covers this section. */
  const [analyzed, setAnalyzed] = useState<VideoRange | null>(null);
  const { state, start, cancel, reset } = useVideoAnalysis(
    createEstimator ? { createEstimator } : {},
  );
  const busy = state.status === "loading" || state.status === "running";
  useWakeLock(busy);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const startMs = parseVideoSeconds(startText);
  const endMs = parseVideoSeconds(endText, null);
  const range = startMs !== null && endMs !== null ? { startMs, endMs } : null;
  const ready = url !== null && durationMs !== null;
  const rangeError = !ready
    ? null
    : range
      ? validateVideoRange(range, durationMs)
      : "Bitte Start und Ende in Sekunden angeben, z. B. 12,5.";
  const bpmValid = Number.isFinite(bpm) && bpm >= BPM_MIN && bpm <= BPM_MAX;
  const beatEnvelope = beatSource?.kind === "music" ? musicBeat : (beatSource?.envelope ?? null);
  // The detected phase follows BPM and range changes until the player types a value.
  const autoPhaseMs = useMemo(
    () =>
      beatEnvelope && bpmValid && startMs !== null && endMs !== null && endMs > startMs
        ? phaseInRange(beatEnvelope, bpm, { startMs, endMs })
        : null,
    [beatEnvelope, bpmValid, bpm, startMs, endMs],
  );
  const phaseAuto = autoPhaseMs !== null;
  // Detected, but not computable right now (music file gone, BPM or range invalid): never fall
  // back silently to an old typed value.
  const phaseLost = beatSource !== null && !phaseAuto;
  const phaseMs = phaseAuto ? autoPhaseMs : phaseLost ? null : parseBeatPhaseMs(phaseText);
  const track = state.status === "done" ? state.track : null;
  const stale = track !== null && (range === null || !sameRange(range, analyzed));

  const built = useMemo(() => {
    if (!track || !analyzed || stale || !bpmValid || phaseMs === null) return null;
    try {
      const result = buildVideoChoreo({
        track,
        title: "Video", // replaced by the form title in buildNewSong
        bpm,
        range: analyzed,
        beatPhaseMs: phaseMs,
        mirror: !selfie,
        durationMs,
        now: 0, // buildNewSong sets the timestamps
      });
      return { ok: true as const, result };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Aus dem Video ließ sich kein Tanz bauen.";
      return { ok: false as const, message };
    }
  }, [track, analyzed, stale, bpmValid, phaseMs, bpm, selfie, durationMs]);
  const result = built?.ok ? built.result : null;

  useEffect(() => {
    onChangeRef.current(result);
  }, [result]);

  const chooseVideo = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    reset();
    beatToken.current++;
    setVideoFile(chosen);
    if (beatSource?.kind === "video") setBeatSource(null);
    setBeatStatus({ status: "idle" });
    setAnalyzed(null);
    setDurationMs(null);
    setVideoError(null);
    setStartText("0");
    setEndText("");
    setUrl(chosen ? URL.createObjectURL(chosen) : null);
  };

  const onMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const d = video.duration * 1000;
    if (!Number.isFinite(d) || d <= 0) {
      setVideoError("Die Länge des Videos ist unbekannt. Bitte eine andere Datei wählen.");
      return;
    }
    setDurationMs(d);
    setStartText("0");
    setEndText(formatFloor(Math.min(d, VIDEO_RANGE_MAX_MS)));
  };

  const fromCurrent = (set: (v: string) => void, floor: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    const ms = Math.max(0, video.currentTime * 1000);
    set(floor ? formatFloor(ms) : formatStartOffsetSeconds(ms));
  };

  const analyze = () => {
    const video = videoRef.current;
    if (!video || !range || rangeError || busy) return;
    // Frame callbacks only fire for visible videos; the preview is sticky while busy.
    if (typeof video.scrollIntoView === "function") {
      video.scrollIntoView({ block: "nearest" });
    }
    setAnalyzed(range);
    void start(video, { range });
  };

  /** Beat phase from the song's audio file if there is one, else from the video's audio track. */
  const detectBeat = async () => {
    if (!range || rangeError || beatStatus.status === "busy") return;
    if (musicBeat) {
      if (bpmValid && phaseInRange(musicBeat, bpm, range) === null) {
        setBeatStatus({
          status: "error",
          message: `Im Abschnitt ist kein Takt erkennbar. ${BEAT_HAND_HINT}`,
        });
        return;
      }
      setBeatSource({ kind: "music" });
      setBeatStatus({ status: "idle" });
      return;
    }
    if (!videoFile) return;
    if (videoFile.size > VIDEO_BEAT_MAX_BYTES) {
      setBeatStatus({
        status: "error",
        message: `Das Video ist zu groß für die Takterkennung (höchstens ${VIDEO_BEAT_MAX_BYTES / 1024 / 1024} MB). ${BEAT_HAND_HINT}`,
      });
      return;
    }
    if (durationMs !== null && durationMs > VIDEO_BEAT_MAX_MS) {
      setBeatStatus({
        status: "error",
        message: `Das Video ist zu lang für die Takterkennung (höchstens ${VIDEO_BEAT_MAX_MS / 60_000} Minuten). ${BEAT_HAND_HINT}`,
      });
      return;
    }
    const token = ++beatToken.current;
    setBeatStatus({ status: "busy" });
    try {
      const audio = await analyzeAudio(videoFile);
      if (token !== beatToken.current) return;
      if (phaseInRange(audio.envelope, audio.bpm, range) === null) {
        setBeatStatus({
          status: "error",
          message: `Im Ton des Videos ist kein Takt erkennbar. ${BEAT_HAND_HINT}`,
        });
        return;
      }
      onBpmDetected?.(audio.bpm);
      setBeatSource({ kind: "video", envelope: audio.envelope });
      setBeatStatus({ status: "idle" });
    } catch {
      if (token !== beatToken.current) return;
      setBeatStatus({
        status: "error",
        message: `Der Ton des Videos lässt sich nicht auswerten. ${BEAT_HAND_HINT}`,
      });
    }
  };

  const typePhase = (text: string) => {
    setPhaseText(text);
    setBeatSource(null);
    setBeatStatus({ status: "idle" });
  };

  const progress = state.status === "running" ? Math.round(state.progress * 100) : 0;
  const rangeField = (key: "start" | "end", label: string, value: string, button: string) => (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={`${id}-${key}`} className="text-base">
        {label}
      </Label>
      <Input
        id={`${id}-${key}`}
        value={value}
        inputMode="decimal"
        autoComplete="off"
        disabled={busy}
        aria-invalid={rangeError ? true : undefined}
        aria-describedby={rangeError ? `${id}-range-err` : undefined}
        onChange={(e) => (key === "start" ? setStartText : setEndText)(e.target.value)}
        className={INPUT}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={busy || !ready}
        onClick={() => fromCurrent(key === "start" ? setStartText : setEndText, key === "end")}
        className={BTN}
      >
        {button}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-video`} className="text-base">
          Tanzvideo
        </Label>
        <Input
          id={`${id}-video`}
          type="file"
          accept={VIDEO_ACCEPT}
          disabled={busy}
          aria-describedby={`${id}-video-hint`}
          onChange={chooseVideo}
          className={`${INPUT} h-auto min-h-11 py-2`}
        />
        <p id={`${id}-video-hint`} className={HINT}>
          MP4 oder MOV, gleiche Aufnahme wie die Musik (ab Sekunde 0). Das Video bleibt auf diesem
          Gerät und wird nach dem Hinzufügen verworfen; die Erkennung läuft im Browser ohne externe
          Abrufe.
        </p>
      </div>

      {url && (
        <div
          className={
            busy
              ? "sticky top-0 z-10 flex flex-col gap-3 bg-background pb-2"
              : "flex flex-col gap-3"
          }
        >
          <video
            ref={videoRef}
            src={url}
            playsInline
            muted
            controls={!busy}
            preload="auto"
            aria-label="Videovorschau"
            onLoadedMetadata={onMetadata}
            onError={() => {
              if (!busy) setVideoError("Das Video kann nicht gelesen werden. Bitte MP4 oder MOV.");
            }}
            className={`${busy ? "max-h-[35dvh]" : "max-h-[40dvh]"} w-full rounded-xl bg-black object-contain`}
          />
          {busy && (
            <div className="flex flex-col gap-2" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <p className="text-base">
                  {state.status === "loading" ? "Lade Pose-Modell …" : `Analysiere … ${progress} %`}
                </p>
                <Button type="button" variant="secondary" onClick={cancel} className={BTN}>
                  Abbrechen
                </Button>
              </div>
              <Progress
                value={progress}
                aria-label="Analysefortschritt"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          )}
        </div>
      )}
      {videoError && (
        <p role="alert" className={FIELD_ERROR}>
          {videoError}
        </p>
      )}

      {ready && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {rangeField("start", "Start (Sekunden)", startText, "Ab hier")}
            {rangeField("end", "Ende (Sekunden)", endText, "Bis hier")}
          </div>
          {rangeError && (
            <p id={`${id}-range-err`} className={FIELD_ERROR}>
              {rangeError}
            </p>
          )}

          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor={`${id}-selfie`} className="text-base">
              Video ist gespiegelt (Selfie-Aufnahme)
            </Label>
            <Switch
              id={`${id}-selfie`}
              checked={selfie}
              onCheckedChange={setSelfie}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-phase`} className="text-base">
              Beat-Phase (ms)
            </Label>
            <Input
              id={`${id}-phase`}
              value={phaseAuto ? String(autoPhaseMs) : phaseLost ? "" : phaseText}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={phaseMs === null ? true : undefined}
              aria-describedby={phaseMs === null ? `${id}-phase-err` : `${id}-phase-hint`}
              onChange={(e) => typePhase(e.target.value)}
              className={INPUT}
            />
            {phaseMs === null ? (
              <p id={`${id}-phase-err`} className={FIELD_ERROR}>
                {phaseLost
                  ? "Der erkannte Takt lässt sich gerade nicht berechnen (BPM, Bereich oder Musikdatei fehlen). Bitte neu erkennen oder von Hand eintragen."
                  : "Bitte ganze Millisekunden eingeben, z. B. 0 oder 250."}
              </p>
            ) : (
              <p id={`${id}-phase-hint`} className={HINT}>
                {phaseAuto
                  ? `Erster Beat ab Start, erkannt aus ${beatSource?.kind === "music" ? "der Musikdatei" : "dem Ton des Videos"}. Bitte im Sync-Test prüfen.`
                  : "Zeitpunkt eines Beats im Video. Die Feinabstimmung folgt später im Sync-Test."}
              </p>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={!range || rangeError !== null || beatStatus.status === "busy"}
              onClick={() => void detectBeat()}
              className={BTN}
            >
              {beatStatus.status === "busy" ? "Werte den Ton aus …" : "Takt erkennen"}
            </Button>
            <div aria-live="polite">
              {beatStatus.status === "error" && (
                <p role="alert" className={FIELD_ERROR}>
                  {beatStatus.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3" aria-live="polite">
            {!busy && (
              <Button
                type="button"
                variant="secondary"
                disabled={!range || rangeError !== null}
                onClick={analyze}
                className={BTN}
              >
                {track ? "Neu analysieren" : "Video analysieren"}
              </Button>
            )}
            {state.status === "error" && (
              <p role="alert" className={FIELD_ERROR}>
                {state.message}
              </p>
            )}
            {state.status === "aborted" && <p className={HINT}>Analyse abgebrochen.</p>}
            {stale && (
              <p role="status" className={FIELD_ERROR}>
                Der Zeitbereich hat sich geändert. Bitte das Video neu analysieren.
              </p>
            )}
            {track && !stale && !bpmValid && (
              <p className={HINT}>Bitte gültige BPM eintragen, dann entstehen die Moves.</p>
            )}
            {built && !built.ok && (
              <p role="alert" className={FIELD_ERROR}>
                {built.message}
              </p>
            )}
            {result && (
              <p className={HINT}>
                {result.stats.moves} Moves, davon {result.stats.gold} Gold Moves, Person in{" "}
                {Math.round(result.stats.detectionRatio * 100)} % der Bilder erkannt.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
