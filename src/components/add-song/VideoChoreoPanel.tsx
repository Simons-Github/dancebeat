import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";

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
  looksMirrored,
  parseBeatPhaseMs,
  parseVideoSeconds,
  validateVideoRange,
  type VideoImportResult,
  type VideoRange,
} from "@/lib/library/videoImport";
import type { PoseModel } from "@/lib/mediapipe";
import { buildPoseTrackFile } from "@/lib/poseTrackFile";
import { drawPersonPicker } from "@/lib/overlay";
import type { PoseEstimator } from "@/lib/poseEstimator";
import { formatStartOffsetSeconds } from "@/lib/sync";
import { DEFAULT_INTERVAL_MS } from "@/lib/videoAnalysis";
import { MOVE_PLACEMENTS, type MovePlacement } from "@/lib/videoChoreo";
import {
  defaultTarget,
  hasMultiplePersons,
  nearestSampleIndex,
  personOrder,
  pickPoseAt,
  trackTarget,
  type MultiPoseTrack,
  type TargetSeed,
} from "@/lib/targetPerson";

import { VideoImportDiagnostics } from "./VideoImportDiagnostics";

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

/** Longer side of the person-picker still (canvas pixels). */
const STILL_MAX_PX = 640;

const BEAT_HAND_HINT = "Bitte die Beat-Phase von Hand eintragen.";

/** Pose models offered for the analysis; live camera tracking always uses "lite". */
const MODEL_CHOICES = ["lite", "full"] as const satisfies readonly PoseModel[];
const MODEL_LABELS: Record<PoseModel, string> = { lite: "Schnell", full: "Genau" };
/** Move placement; rebuilt from the existing analysis, like the target person. */
const PLACEMENT_LABELS: Record<MovePlacement, string> = {
  grid: "Fester Takt",
  holds: "Haltepunkte",
};

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

/** Target person and shown still, valid only for the analysis (`track`) they were made for. */
interface PersonPick {
  track: MultiPoseTrack;
  seed: TargetSeed | null;
  /** Sample shown in the picker still. */
  still: number;
}

/**
 * Choreography from a dance video: file, preview, range, mirroring, beat phase, the pose
 * analysis and, with several people in the video, the target person. The video stays in memory
 * only (object URL, revoked on change and unmount); the preview must stay visible during the
 * analysis (video-frame callbacks).
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
  /** Switch was turned on from the file name and not touched since. */
  const [selfieFromName, setSelfieFromName] = useState(false);
  const [phaseText, setPhaseText] = useState("0");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [beatSource, setBeatSource] = useState<BeatSource | null>(null);
  const [beatStatus, setBeatStatus] = useState<BeatStatus>({ status: "idle" });
  /** Guards against a slow audio decode of a previous video overwriting the current one. */
  const beatToken = useRef(0);
  /** Range of the last started analysis; the track only covers this section. */
  const [analyzed, setAnalyzed] = useState<VideoRange | null>(null);
  /** Model of the next analysis, and the one the last started analysis used. */
  const [model, setModel] = useState<PoseModel>("lite");
  const [analyzedModel, setAnalyzedModel] = useState<PoseModel | null>(null);
  const [placement, setPlacement] = useState<MovePlacement>("grid");
  /** Dev diagnostics only: duration of the last finished analysis. */
  const [analysisMs, setAnalysisMs] = useState<number | null>(null);
  const analysisToken = useRef(0);
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
  const rangeStale = track !== null && (range === null || !sameRange(range, analyzed));
  const modelStale = track !== null && model !== analyzedModel;
  const stale = rangeStale || modelStale;

  // Target person: chosen after the analysis, a new analysis starts again from the default.
  const multi = useMemo(() => track !== null && hasMultiplePersons(track), [track]);
  const defaultSeed = useMemo(() => (track ? defaultTarget(track) : null), [track]);
  const [pick, setPick] = useState<PersonPick | null>(null);
  const currentPick = track && pick?.track === track ? pick : null;
  const seed = currentPick ? currentPick.seed : defaultSeed;
  const target = useMemo(() => (track ? trackTarget(track, seed) : null), [track, seed]);
  const stillIndex = currentPick ? currentPick.still : (defaultSeed?.sampleIndex ?? 0);
  const stillSample = track && multi && !stale ? track.samples[stillIndex] : undefined;
  const stillPoses = useMemo(() => stillSample?.poses ?? [], [stillSample]);
  const people = useMemo(
    () =>
      track
        ? personOrder(stillPoses, track.aspect).map((index, k) => ({ index, number: k + 1 }))
        : [],
    [track, stillPoses],
  );
  const targetLm = target?.samples[stillIndex]?.landmarks ?? null;
  const selectedIndex = targetLm ? stillPoses.indexOf(targetLm) : -1;
  const selected = people.find((p) => p.index === selectedIndex) ?? null;

  const built = useMemo(() => {
    if (!target || !analyzed || stale || !bpmValid || phaseMs === null) return null;
    try {
      const result = buildVideoChoreo({
        track: target,
        title: "Video", // replaced by the form title in buildNewSong
        bpm,
        range: analyzed,
        beatPhaseMs: phaseMs,
        mirror: !selfie,
        movePlacement: placement,
        durationMs,
        now: 0, // buildNewSong sets the timestamps
      });
      return { ok: true as const, result };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Aus dem Video ließ sich kein Tanz bauen.";
      return { ok: false as const, message };
    }
  }, [target, analyzed, stale, bpmValid, phaseMs, bpm, selfie, placement, durationMs]);
  const result = built?.ok ? built.result : null;

  // Dev diagnostics: the exact input of buildVideoChoreo, as a raw-data file for tuning.
  const diagnosticsFile = useMemo(
    () =>
      import.meta.env.DEV && result && target && analyzed && phaseMs !== null
        ? buildPoseTrackFile({
            exportedAt: 0, // set on export
            video: videoFile?.name ?? "video",
            bpm,
            beatPhaseMs: phaseMs,
            range: analyzed,
            mirror: !selfie,
            ...(analyzedModel && { model: analyzedModel }),
            movePlacement: placement,
            track: target,
          })
        : null,
    [result, target, analyzed, phaseMs, videoFile, bpm, selfie, analyzedModel, placement],
  );

  useEffect(() => {
    onChangeRef.current(result);
  }, [result]);

  // Person-picker still: the preview frame at the shown sample, grabbed once per sample into an
  // offscreen canvas; skeletons and numbers are redrawn on top when the choice changes.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Grabbed frame and the sample it belongs to (frame null without a 2D context). */
  const frameRef = useRef<{
    track: MultiPoseTrack;
    timeMs: number;
    frame: HTMLCanvasElement | null;
  } | null>(null);
  const aspect = track?.aspect ?? 1;
  const stillW = Math.round(aspect >= 1 ? STILL_MAX_PX : STILL_MAX_PX * aspect);
  const stillH = Math.round(aspect >= 1 ? STILL_MAX_PX / aspect : STILL_MAX_PX);
  const stillTimeMs = stillSample?.timeMs ?? null;
  const redraw = useRef(() => {});
  useEffect(() => {
    redraw.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cached = frameRef.current;
      const frame =
        cached && cached.track === track && cached.timeMs === stillTimeMs ? cached.frame : null;
      drawPersonPicker(
        canvas,
        frame,
        stillPoses,
        people,
        selectedIndex >= 0 ? selectedIndex : null,
      );
    };
    redraw.current();
  }, [track, stillTimeMs, stillPoses, people, selectedIndex, stillW, stillH]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !track || stillTimeMs === null) return;
    const cached = frameRef.current;
    // Already grabbed (e.g. the range went stale and back): no seek, the position stays.
    if (cached && cached.track === track && cached.timeMs === stillTimeMs) return;
    const first = track.samples[0]?.timeMs ?? 0;
    const interval = (track.samples[1]?.timeMs ?? first + DEFAULT_INTERVAL_MS) - first;
    const tolerance = Math.max(interval / 2, 40);
    const near = (ms: number) => Math.abs(video.currentTime * 1000 - ms) <= tolerance;
    // The player's position: restored after the grab so "Ab hier" / "Bis hier" never read a
    // position they did not choose.
    const userMs = video.currentTime * 1000;
    let pending = false;
    const restore = () => {
      if (Math.abs(userMs - stillTimeMs) >= 1) video.currentTime = userMs / 1000;
    };
    const grab = () => {
      pending = false;
      // The player scrubbed meanwhile: this is not our frame, and their position wins.
      if (!near(stillTimeMs)) return;
      const frame = document.createElement("canvas");
      frame.width = stillW;
      frame.height = stillH;
      const ctx = frame.getContext("2d");
      ctx?.drawImage(video, 0, 0, stillW, stillH);
      frameRef.current = { track, timeMs: stillTimeMs, frame: ctx ? frame : null };
      redraw.current();
      restore();
    };
    if (Math.abs(video.currentTime * 1000 - stillTimeMs) < 1) grab();
    else {
      pending = true;
      video.addEventListener("seeked", grab, { once: true });
      video.currentTime = stillTimeMs / 1000;
    }
    return () => {
      video.removeEventListener("seeked", grab);
      if (pending && near(stillTimeMs)) restore();
    };
  }, [track, stillTimeMs, stillW, stillH]);

  const choosePerson = (poseIndex: number) => {
    if (!track) return;
    setPick({ track, seed: { sampleIndex: stillIndex, poseIndex }, still: stillIndex });
  };

  /** Shows the sample at the preview's position, e.g. where the people stand apart. */
  const showCurrentFrame = () => {
    const video = videoRef.current;
    if (!video || !track) return;
    video.pause();
    const still = nearestSampleIndex(track, video.currentTime * 1000);
    if (still >= 0) setPick({ track, seed, still });
  };

  const tapStill = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!track) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    const hit = pickPoseAt(stillPoses, point, track.aspect);
    if (hit !== null) choosePerson(hit);
  };

  const chooseVideo = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    reset();
    beatToken.current++;
    setVideoFile(chosen);
    if (beatSource?.kind === "video") setBeatSource(null);
    setBeatStatus({ status: "idle" });
    setAnalyzed(null);
    setAnalyzedModel(null);
    setDurationMs(null);
    setVideoError(null);
    setStartText("0");
    setEndText("");
    // A new video is a new decision: preset from its name, like the range starts over.
    const named = chosen !== null && looksMirrored(chosen.name);
    setSelfie(named);
    setSelfieFromName(named);
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
    setAnalyzedModel(model);
    if (!import.meta.env.DEV) {
      void start(video, { range, model });
      return;
    }
    // Dev diagnostics: wall-clock analysis time (not game time); only the latest run counts.
    const token = ++analysisToken.current;
    const t0 = performance.now();
    setAnalysisMs(null);
    void start(video, { range, model }).then(() => {
      if (token === analysisToken.current) setAnalysisMs(performance.now() - t0);
    });
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

          <div className="flex flex-col gap-1">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor={`${id}-selfie`} className="text-base">
                Video ist gespiegelt (Selfie-Aufnahme)
              </Label>
              <Switch
                id={`${id}-selfie`}
                checked={selfie}
                onCheckedChange={(on) => {
                  setSelfie(on);
                  setSelfieFromName(false);
                }}
                disabled={busy}
                aria-describedby={`${id}-selfie-hint`}
              />
            </div>
            <p id={`${id}-selfie-hint`} className={HINT}>
              {selfieFromName
                ? "Eingeschaltet, weil der Dateiname auf ein gespiegeltes Video hinweist. "
                : ""}
              Einschalten bei Selfie-Aufnahmen und Dance-Practice-Videos mit „Mirrored“ im Titel:
              Dort sind links und rechts schon vertauscht.
            </p>
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

          <div className="flex flex-col gap-2">
            <span id={`${id}-model`} className="text-base font-medium">
              Modell
            </span>
            <div role="group" aria-labelledby={`${id}-model`} className="flex gap-2">
              {MODEL_CHOICES.map((m) => (
                <Button
                  key={m}
                  type="button"
                  aria-pressed={model === m}
                  variant={model === m ? "default" : "secondary"}
                  disabled={busy}
                  onClick={() => setModel(m)}
                  className={`${BTN} flex-1 px-2`}
                >
                  {MODEL_LABELS[m]}
                </Button>
              ))}
            </div>
            <p className={HINT}>
              Genau erkennt Posen zuverlässiger, die Analyse dauert aber länger. Beim ersten Mal
              werden ca. 9 MB geladen.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span id={`${id}-placement`} className="text-base font-medium">
              Moves
            </span>
            <div role="group" aria-labelledby={`${id}-placement`} className="flex gap-2">
              {MOVE_PLACEMENTS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  aria-pressed={placement === p}
                  variant={placement === p ? "default" : "secondary"}
                  disabled={busy}
                  onClick={() => setPlacement(p)}
                  className={`${BTN} flex-1 px-2`}
                >
                  {PLACEMENT_LABELS[p]}
                </Button>
              ))}
            </div>
            <p className={HINT}>
              Haltepunkte: Moves auf Beats, an denen die Pose kurz steht (etwa gleich viele Moves).
            </p>
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
                {rangeStale && modelStale
                  ? "Zeitbereich und Modell haben sich geändert."
                  : rangeStale
                    ? "Der Zeitbereich hat sich geändert."
                    : "Das Modell hat sich geändert."}{" "}
                Bitte das Video neu analysieren.
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
                {selected && `Person ${selected.number} von ${people.length}: `}
                {result.stats.moves} Moves, davon {result.stats.gold} Gold Moves, Person in{" "}
                {Math.round(result.stats.detectionRatio * 100)} % der Bilder erkannt.
                {analyzedModel && ` Modell: ${MODEL_LABELS[analyzedModel]}.`}
                {` Moves: ${PLACEMENT_LABELS[placement]}.`}
              </p>
            )}
            {import.meta.env.DEV && diagnosticsFile && (
              <VideoImportDiagnostics file={diagnosticsFile} analysisMs={analysisMs} />
            )}
          </div>

          {stillSample && (
            <section aria-labelledby={`${id}-persons`} className="flex flex-col gap-3">
              <h3 id={`${id}-persons`} className="text-base font-medium">
                Mehrere Personen erkannt
              </h3>
              <p className={HINT}>Tippe auf die Person, deren Bewegungen du übernehmen willst.</p>
              <canvas
                ref={canvasRef}
                width={stillW}
                height={stillH}
                aria-hidden="true"
                onClick={tapStill}
                className="mx-auto block h-auto max-h-[40dvh] w-auto max-w-full cursor-pointer rounded-xl bg-black"
              />
              <div role="group" aria-label="Zielperson" className="flex flex-wrap gap-2">
                {people.map((p) => (
                  <Button
                    key={p.index}
                    type="button"
                    aria-pressed={p.index === selectedIndex}
                    variant={p.index === selectedIndex ? "default" : "secondary"}
                    onClick={() => choosePerson(p.index)}
                    className={BTN}
                  >
                    Person {p.number}
                  </Button>
                ))}
              </div>
              {!selected && (
                <p className={HINT}>
                  Die gewählte Person ist in diesem Bild nicht erkannt. Wähle eine Person oder ein
                  anderes Bild.
                </p>
              )}
              <Button type="button" variant="secondary" onClick={showCurrentFrame} className={BTN}>
                Aktuelles Bild
              </Button>
              <p className={HINT}>
                Zeigt das Bild an der Stelle der Videovorschau, z. B. wo die Personen gut getrennt
                stehen.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
