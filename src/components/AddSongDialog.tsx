import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { VIDEO_BEAT_MAX_BYTES, VideoChoreoPanel } from "@/components/add-song/VideoChoreoPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analyzeAudio, estimateBeatPhaseMs, type OnsetEnvelope } from "@/lib/beat";
import { parseChoreoFile } from "@/lib/library/choreoFile";
import {
  ARTIST_MAX,
  BPM_MAX,
  BPM_MIN,
  DURATION_MAX_S,
  DURATION_MIN_S,
  TITLE_MAX,
  buildNewSong,
  parseSpotifyTrackUri,
  parseYouTubeId,
  validateAudioUrl,
  validateNewSongFields,
  type NewSongChoreo,
  type NewSongSource,
} from "@/lib/library/newSong";
import { spotifyStatus, type SpotifyStatus } from "@/lib/audio/spotifyAuth";
import { StorageFullError, formatMb, requestPersistentStorage } from "@/lib/library/storage";
import type { VideoImportResult } from "@/lib/library/videoImport";
import { loadMotionPack } from "@/lib/motionPack";
import type { PoseModel } from "@/lib/mediapipe";
import type { PoseEstimator } from "@/lib/poseEstimator";
import type { ChoreoFile, Song } from "@/lib/types";
import { SONG_PALETTES } from "@/theme";

const BTN =
  "btn-pill h-12 gap-2 rounded-full px-6 text-base focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
const INPUT = "h-11 rounded-xl text-base md:text-base";
const ERROR =
  "rounded-xl bg-destructive px-3 py-2 text-base font-medium text-destructive-foreground";
const HINT = "text-sm text-muted-foreground";
const FIELD_ERROR = "text-sm font-medium text-destructive";
const TAB = "h-11 flex-1 text-base";

const AUDIO_ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg";

type Kind = "file" | "url" | "youtube" | "spotify";
type Difficulty = 1 | 2 | 3;
type AnalysisState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done" }
  | { status: "error"; message: string };

/** What decides the Datei tab's music: the audio file, or the dance video if switched on. */
interface MusicChoice {
  kind: Kind;
  video: boolean;
  fromVideo: boolean;
  videoFile: File | null;
  file: File | null;
}

interface AddSongDialogProps {
  /**
   * Stores the song (and the audio for local files, the dance video if kept); rejects with
   * StorageFullError when full.
   */
  onAdd: (song: Song, audio?: Blob, video?: Blob) => Promise<void>;
  /** Called after a successful add and after the dialog closed, e.g. to select the new song. */
  onAdded?: (song: Song) => void;
  /** Pose estimator for the video import; injected in tests. Default: MediaPipe. */
  createEstimator?: (model: PoseModel) => PoseEstimator;
}

const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, "");

/**
 * Add-song button plus dialog: audio file, direct URL, YouTube or Spotify; choreography generated,
 * imported from a file or built from a dance video.
 */
export function AddSongDialog({ onAdd, onAdded, createEstimator }: AddSongDialogProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("file");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle" });
  /** Onset envelope of the analyzed audio file; the video import reads the beat phase from it. */
  const [musicBeat, setMusicBeat] = useState<OnsetEnvelope | null>(null);
  const [urlLink, setUrlLink] = useState("");
  const [youtubeLink, setYoutubeLink] = useState("");
  const [spotifyLink, setSpotifyLink] = useState("");
  /** Read from sessionStorage when the Spotify tab opens (null: not checked yet). */
  const [spotifyState, setSpotifyState] = useState<SpotifyStatus | null>(null);
  const [durationClamped, setDurationClamped] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [bpm, setBpm] = useState("120");
  const [bpmEstimated, setBpmEstimated] = useState(false);
  const [durationS, setDurationS] = useState("180");
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [choreoMode, setChoreoMode] = useState<"auto" | "import" | "video">("auto");
  const [imported, setImported] = useState<ChoreoFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [videoResult, setVideoResult] = useState<VideoImportResult | null>(null);
  /** Video chosen in the video import; with `musicFromVideo` it is also the song's music. */
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [musicFromVideo, setMusicFromVideo] = useState(true);
  /** Keep the dance video as its own blob when the music comes from elsewhere (8h-2b-1). */
  const [keepVideo, setKeepVideo] = useState(true);
  const [titleTouched, setTitleTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against a slow analysis of a previous file overwriting the current one. */
  const analysisToken = useRef(0);
  /** File the current analysis belongs to (audio file, dance video or null). */
  const analyzedMusic = useRef<File | null>(null);
  const choreoToken = useRef(0);
  const kindRef = useRef(kind);
  useEffect(() => {
    kindRef.current = kind;
  });
  /** Fields the player typed in. Prefills (file name, analysis, imported choreography) skip these. */
  const edited = useRef({
    title: false,
    artist: false,
    difficulty: false,
    bpm: false,
    duration: false,
  });

  const reset = () => {
    analysisToken.current++;
    analyzedMusic.current = null;
    choreoToken.current++;
    edited.current = {
      title: false,
      artist: false,
      difficulty: false,
      bpm: false,
      duration: false,
    };
    setUrlLink("");
    setYoutubeLink("");
    setSpotifyLink("");
    setSpotifyState(null);
    setDurationClamped(false);
    setKind("file");
    setFile(null);
    setAnalysis({ status: "idle" });
    setMusicBeat(null);
    setTitle("");
    setArtist("");
    setBpm("120");
    setBpmEstimated(false);
    setDurationS("180");
    setDifficulty(2);
    setChoreoMode("auto");
    setImported(null);
    setImportError(null);
    setVideoResult(null);
    setVideoFile(null);
    setMusicFromVideo(true);
    setKeepVideo(true);
    setTitleTouched(false);
    setError(null);
  };

  const changeOpen = (next: boolean) => {
    if (busy) return; // never close while a write is running
    if (next) reset();
    setOpen(next);
  };

  const link = kind === "youtube" ? youtubeLink : kind === "spotify" ? spotifyLink : urlLink;
  const setLink =
    kind === "youtube" ? setYoutubeLink : kind === "spotify" ? setSpotifyLink : setUrlLink;

  // A missing connection does not block adding (it can be made later), but is pointed out.
  useEffect(() => {
    if (open && kind === "spotify") setSpotifyState(spotifyStatus());
  }, [open, kind]);
  const useImport = choreoMode === "import";
  const useVideo = choreoMode === "video";
  /** The dance video's audio track is the music (Datei tab): one file, video and music in sync. */
  const videoMusic = useVideo && musicFromVideo;
  /** File analyzed and stored as the song's audio: the chosen audio file or the dance video. */
  const musicFile = videoMusic ? videoFile : file;
  /**
   * "Video behalten" is offered when the dance video is not the music: Datei tab with the switch
   * off, URL and Spotify. YouTube shows its own video.
   */
  const canKeepVideo = useVideo && kind !== "youtube" && !(kind === "file" && musicFromVideo);
  const keptVideo = canKeepVideo && keepVideo ? videoFile : null;
  /** Same limit as for the video's music (8h-1): the stored blob is read whole when playing. */
  const keptVideoTooBig = keptVideo !== null && keptVideo.size > VIDEO_BEAT_MAX_BYTES;
  // The field accepts any decimal (step "any", so the browser never blocks the submit with its own
  // message); the song keeps 0.1 BPM like the estimate.
  const bpmNum = bpm.trim() === "" ? NaN : Math.round(Number(bpm) * 10) / 10;
  const durationNum = durationS.trim() === "" ? NaN : Number(durationS);
  const errors = validateNewSongFields({
    kind,
    title,
    link,
    bpm: bpmNum,
    durationS: durationNum,
    imported: useImport && imported !== null,
    video: useVideo,
  });
  const showTitleError = titleTouched && errors.title;
  const showLinkError = link.trim() !== "" && errors.link;
  const sourceReady =
    kind === "file"
      ? musicFile !== null && analysis.status !== "busy"
      : !errors.link && link.trim() !== "";
  const choreoReady = useImport ? imported !== null : useVideo ? videoResult !== null : true;
  const canSubmit =
    !busy &&
    sourceReady &&
    choreoReady &&
    !errors.title &&
    !errors.bpm &&
    !errors.duration &&
    !keptVideoTooBig &&
    (kind !== "file" || analysis.status !== "error");

  /** Analyzes the file that becomes the song's music; a newer call wins over a slower older one. */
  const analyzeMusic = async (chosen: File | null, fromVideo: boolean) => {
    const token = ++analysisToken.current;
    analyzedMusic.current = chosen;
    setMusicBeat(null);
    setBpmEstimated(false);
    if (!chosen) {
      setAnalysis({ status: "idle" });
      return;
    }
    if (!edited.current.title) setTitle(stripExtension(chosen.name).slice(0, TITLE_MAX));
    // Like the beat detection: the whole file and its decoded samples must fit in memory.
    if (fromVideo && chosen.size > VIDEO_BEAT_MAX_BYTES) {
      setAnalysis({
        status: "error",
        message: `Das Video ist zu groß, um seine Musik zu verwenden (höchstens ${formatMb(VIDEO_BEAT_MAX_BYTES)}). Bitte die Musik als Audiodatei wählen.`,
      });
      return;
    }
    setAnalysis({ status: "busy" });
    try {
      const result = await analyzeAudio(chosen);
      if (token !== analysisToken.current) return;
      if (!edited.current.bpm) setBpm(String(result.bpm));
      if (!edited.current.duration) {
        const seconds = Math.max(1, Math.round(result.durationMs / 1000));
        setDurationS(String(Math.min(seconds, DURATION_MAX_S)));
        setDurationClamped(seconds > DURATION_MAX_S);
      }
      setBpmEstimated(true);
      setMusicBeat(result.envelope);
      setAnalysis({ status: "done" });
    } catch (err) {
      if (token !== analysisToken.current) return;
      setAnalysis({
        status: "error",
        message: fromVideo
          ? "Der Ton des Videos kann nicht gelesen werden. Bitte die Musik als Audiodatei wählen."
          : err instanceof Error
            ? err.message
            : "Die Datei konnte nicht analysiert werden.",
      });
    }
  };

  /**
   * Keeps the analysis on the Datei tab's music after a change. The dance video is only read once
   * the Datei tab is open: with URL, YouTube or Spotify its sound is not the song's music.
   */
  const syncMusic = (change: Partial<MusicChoice>) => {
    const next = { kind, video: useVideo, fromVideo: musicFromVideo, videoFile, file, ...change };
    const fromVideo = next.video && next.fromVideo;
    const target = fromVideo ? next.videoFile : next.file;
    if (target === analyzedMusic.current) return;
    if (fromVideo && target && next.kind !== "file") return;
    void analyzeMusic(target, fromVideo);
  };

  const chooseAudio = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    syncMusic({ file: chosen });
  };

  const chooseChoreoMode = (mode: "auto" | "import" | "video") => {
    setChoreoMode(mode);
    // The panel starts without a video, so the video's music has nothing to analyze yet.
    setVideoFile(null);
    if (mode === "video") {
      // Preset: the video's own music, unless an audio file was chosen already.
      const fromVideo = file === null;
      setMusicFromVideo(fromVideo);
      syncMusic({ video: true, fromVideo, videoFile: null });
    } else {
      syncMusic({ video: false, videoFile: null });
    }
  };

  const chooseVideoFile = (chosen: File | null) => {
    setVideoFile(chosen);
    syncMusic({ videoFile: chosen });
  };

  const chooseChoreo = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    const token = ++choreoToken.current;
    setImported(null);
    setImportError(null);
    if (!chosen) return;
    try {
      const parsed = parseChoreoFile(await chosen.text());
      if (token !== choreoToken.current) return;
      setImported(parsed);
      if (!edited.current.title) setTitle(parsed.song.title);
      if (!edited.current.artist) setArtist(parsed.song.artist);
      if (!edited.current.difficulty) setDifficulty(parsed.song.difficulty);
      if (!edited.current.bpm) setBpm(String(parsed.song.bpm));
    } catch (err) {
      if (token !== choreoToken.current) return;
      setImportError(err instanceof Error ? err.message : "Die Datei konnte nicht gelesen werden.");
    }
  };

  /** BPM from the dance video's audio: only without an audio file and if not typed by hand. */
  const takeVideoBpm = (detected: number) => {
    // The decode may outlast a tab switch; read the current tab, not the one at click time.
    if (kindRef.current === "file" || edited.current.bpm) return;
    setBpm(String(detected));
    setBpmEstimated(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    let source: NewSongSource;
    if (kind === "file") source = { kind: "file" };
    else if (kind === "url") {
      const r = validateAudioUrl(link);
      if (!r.ok) return;
      source = { kind: "url", url: r.url };
    } else if (kind === "youtube") {
      const videoId = parseYouTubeId(link);
      if (!videoId) return;
      source = { kind: "youtube", videoId };
    } else {
      const trackUri = parseSpotifyTrackUri(link);
      if (!trackUri) return;
      source = { kind: "spotify", trackUri };
    }
    setBusy(true);
    setError(null);
    try {
      const palette =
        SONG_PALETTES[Math.floor(Math.random() * SONG_PALETTES.length)] ?? SONG_PALETTES[0];
      const choreo: NewSongChoreo =
        useImport && imported
          ? { type: "import", file: imported }
          : useVideo && videoResult
            ? {
                type: "video",
                choreo: videoResult.choreo,
                startOffsetMs: videoResult.startOffsetMs,
                keepVideo: keptVideo !== null,
              }
            : {
                type: "auto",
                pack: await loadMotionPack(),
                // The analysed audio file sets beat phase and energy; other sources go without.
                ...(kind === "file" &&
                  analysis.status === "done" &&
                  musicBeat && {
                    energy: musicBeat,
                    beatPhaseMs: estimateBeatPhaseMs(musicBeat, bpmNum, 0) ?? 0,
                  }),
              };
      const song = buildNewSong({
        source,
        title,
        artist,
        bpm: useImport && imported ? imported.song.bpm : bpmNum,
        difficulty,
        durationMs: Math.round(durationNum * 1000),
        colors: [palette.accent, palette.secondary],
        choreo,
      });
      void requestPersistentStorage().catch(() => {});
      await onAdd(
        song,
        kind === "file" ? (musicFile ?? undefined) : undefined,
        keptVideo ?? undefined,
      );
      setOpen(false);
      reset();
      onAdded?.(song);
    } catch (err) {
      setError(
        err instanceof StorageFullError ? err.message : "Der Song konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  const urlHost = (() => {
    const r = validateAudioUrl(link);
    return r.ok ? new URL(r.url).host : "der angegebenen Adresse";
  })();

  const numberField = (
    key: string,
    label: string,
    value: string,
    set: (v: string) => void,
    min: number,
    max: number,
    err: string | undefined,
    hint?: string,
  ) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-${key}`} className="text-base">
        {label}
      </Label>
      <Input
        id={`${id}-${key}`}
        type="number"
        inputMode={key === "bpm" ? "decimal" : "numeric"}
        step={key === "bpm" ? "any" : 1}
        min={min}
        max={max}
        value={value}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-${key}-err` : hint ? `${id}-${key}-hint` : undefined}
        onChange={(e) => {
          set(e.target.value);
          if (key === "bpm") {
            edited.current.bpm = true;
            setBpmEstimated(false);
          } else {
            edited.current.duration = true;
            setDurationClamped(false);
          }
        }}
        className={INPUT}
      />
      {err ? (
        <p id={`${id}-${key}-err`} className={FIELD_ERROR}>
          {err}
        </p>
      ) : hint ? (
        <p id={`${id}-${key}-hint`} className={HINT}>
          {hint}
        </p>
      ) : null}
    </div>
  );

  const timing = !(useImport && imported) && (
    <>
      {numberField(
        "bpm",
        "BPM",
        bpm,
        setBpm,
        BPM_MIN,
        BPM_MAX,
        errors.bpm,
        bpmEstimated ? "Geschätzt, bitte prüfen." : undefined,
      )}
      {!useVideo &&
        numberField(
          "duration",
          "Länge in Sekunden",
          durationS,
          setDurationS,
          DURATION_MIN_S,
          DURATION_MAX_S,
          errors.duration,
          durationClamped
            ? `Die Choreografie deckt die ersten ${DURATION_MAX_S / 60} Minuten ab.`
            : undefined,
        )}
    </>
  );

  const linkField = (label: string, placeholder: string, inputType: string, hint: string) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-link`} className="text-base">
        {label}
      </Label>
      <Input
        id={`${id}-link`}
        type={inputType}
        inputMode="url"
        value={link}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={showLinkError ? true : undefined}
        aria-describedby={showLinkError ? `${id}-link-err` : `${id}-link-hint`}
        onChange={(e) => setLink(e.target.value)}
        className={INPUT}
      />
      {showLinkError ? (
        <p id={`${id}-link-err`} className={FIELD_ERROR}>
          {errors.link}
        </p>
      ) : (
        <p id={`${id}-link-hint`} className={HINT}>
          {hint}
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          className="btn-pill h-12 min-w-0 flex-1 gap-2 px-5 text-base focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5"
        >
          <Plus aria-hidden />
          Song hinzufügen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>Song hinzufügen</DialogTitle>
          <DialogDescription>
            Wähle die Musik und lass die Choreografie erzeugen, importiere eine eigene oder erstelle
            sie aus einem Tanzvideo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <Tabs
            value={kind}
            onValueChange={(v) => {
              if (busy) return;
              setKind(v as Kind);
              syncMusic({ kind: v as Kind });
            }}
            className="flex flex-col gap-4"
          >
            <TabsList className="h-12 w-full">
              <TabsTrigger value="file" className={TAB}>
                Datei
              </TabsTrigger>
              <TabsTrigger value="url" className={TAB}>
                URL
              </TabsTrigger>
              <TabsTrigger value="youtube" className={TAB}>
                YouTube
              </TabsTrigger>
              <TabsTrigger value="spotify" className={TAB}>
                Spotify
              </TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="mt-0 flex flex-col gap-4">
              {useVideo && (
                <div className="flex flex-col gap-1">
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <Label htmlFor={`${id}-video-music`} className="text-base">
                      Musik aus dem Tanzvideo
                    </Label>
                    <Switch
                      id={`${id}-video-music`}
                      checked={musicFromVideo}
                      onCheckedChange={(on) => {
                        setMusicFromVideo(on);
                        syncMusic({ fromVideo: on });
                      }}
                      disabled={busy}
                      aria-describedby={`${id}-video-music-hint`}
                    />
                  </div>
                  <p id={`${id}-video-music-hint`} className={HINT}>
                    {musicFromVideo
                      ? "Gespielt wird der Ton des Videos unter „Aus Video“. Dafür wird das Video mit dem Song auf diesem Gerät gespeichert."
                      : "Einschalten, wenn das Tanzvideo die Musik schon enthält: dann braucht es keine eigene Audiodatei."}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {!videoMusic && (
                  <>
                    <Label htmlFor={`${id}-audio`} className="text-base">
                      Audiodatei
                    </Label>
                    <Input
                      id={`${id}-audio`}
                      type="file"
                      accept={AUDIO_ACCEPT}
                      aria-invalid={analysis.status === "error" ? true : undefined}
                      aria-describedby={`${id}-audio-msg`}
                      onChange={chooseAudio}
                      className={`${INPUT} h-auto min-h-11 py-2`}
                    />
                  </>
                )}
                <div id={`${id}-audio-msg`} aria-live="polite">
                  {analysis.status === "busy" && (
                    <p className={HINT}>
                      {videoMusic ? "Lese den Ton des Videos …" : "Analysiere …"}
                    </p>
                  )}
                  {analysis.status === "error" && (
                    <p role="alert" className={FIELD_ERROR}>
                      {analysis.message}
                    </p>
                  )}
                  {analysis.status === "idle" && (
                    <p className={HINT}>
                      {videoMusic
                        ? "Wähle unten unter „Aus Video“ ein Tanzvideo."
                        : "MP3, M4A, WAV oder OGG. Die Datei bleibt auf diesem Gerät."}
                    </p>
                  )}
                  {analysis.status === "done" && useVideo && !videoMusic && file && (
                    <p className={HINT}>Musik: {file.name}</p>
                  )}
                  {analysis.status === "done" && videoMusic && videoFile && (
                    <p className={HINT}>
                      Ton des Videos gelesen. Das Video belegt {formatMb(videoFile.size)} in der
                      Bibliothek.
                    </p>
                  )}
                </div>
              </div>
              {analysis.status === "done" && timing}
            </TabsContent>
            <TabsContent value="url" className="mt-0 flex flex-col gap-4">
              {linkField(
                "Adresse der Audiodatei",
                "https://…",
                "url",
                `Nur eigene oder private Quellen verwenden. Die Musik wird beim Spielen von ${urlHost} geladen.`,
              )}
              {timing}
            </TabsContent>
            <TabsContent value="youtube" className="mt-0 flex flex-col gap-4">
              {linkField(
                "YouTube-Link oder Video-ID",
                "https://youtu.be/…",
                "text",
                "Das Video wird beim Spielen über youtube-nocookie.com geladen.",
              )}
              {timing}
            </TabsContent>
            <TabsContent value="spotify" className="mt-0 flex flex-col gap-4">
              {linkField(
                "Spotify-Song-Link oder URI",
                "https://open.spotify.com/track/…",
                "text",
                "Braucht Spotify Premium. Beim Spielen spricht dein Gerät mit sdk.scdn.co, accounts.spotify.com und api.spotify.com.",
              )}
              {(spotifyState === "disconnected" || spotifyState === "expired") && (
                <p role="status" className={HINT}>
                  {spotifyState === "expired"
                    ? "Die Spotify-Anmeldung ist abgelaufen."
                    : "Noch nicht mit Spotify verbunden."}{" "}
                  Zum Spielen in den Einstellungen unter „Spotify“ verbinden.
                </p>
              )}
              {timing}
            </TabsContent>
          </Tabs>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium">Choreografie</legend>
            <div role="radiogroup" aria-label="Choreografie" className="flex flex-col gap-2">
              {(
                [
                  ["auto", "Automatisch erzeugen"],
                  ["import", "Aus Datei importieren"],
                  ["video", "Aus Video"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 text-base"
                >
                  <input
                    type="radio"
                    name={`${id}-choreo`}
                    value={value}
                    checked={choreoMode === value}
                    onChange={() => chooseChoreoMode(value)}
                    className="size-5 accent-current"
                  />
                  {label}
                </label>
              ))}
            </div>
            {useVideo && (
              <VideoChoreoPanel
                bpm={bpmNum}
                onChange={setVideoResult}
                musicBeat={kind === "file" ? musicBeat : null}
                onBpmDetected={takeVideoBpm}
                onVideoFile={chooseVideoFile}
                musicFromVideo={kind === "file" && videoMusic}
                keepVideo={canKeepVideo && keepVideo}
                {...(createEstimator && { createEstimator })}
              />
            )}
            {canKeepVideo && (
              <div className="flex flex-col gap-1">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor={`${id}-keep-video`} className="text-base">
                    Video behalten
                  </Label>
                  <Switch
                    id={`${id}-keep-video`}
                    checked={keepVideo}
                    onCheckedChange={setKeepVideo}
                    disabled={busy}
                    aria-invalid={keptVideoTooBig ? true : undefined}
                    aria-describedby={`${id}-keep-video-hint`}
                  />
                </div>
                <div id={`${id}-keep-video-hint`} aria-live="polite">
                  {keptVideoTooBig ? (
                    <p role="alert" className={FIELD_ERROR}>
                      Das Video ist zu groß, um es zu behalten (höchstens{" "}
                      {formatMb(VIDEO_BEAT_MAX_BYTES)}). Bitte „Video behalten“ ausschalten.
                    </p>
                  ) : (
                    <p className={HINT}>
                      {keepVideo
                        ? `Beim Spielen läuft das Video stumm statt des Coachs. Dafür wird es mit dem Song auf diesem Gerät gespeichert${videoFile ? ` und belegt ${formatMb(videoFile.size)} in der Bibliothek` : ""}.`
                        : "Einschalten, um das Video beim Spielen stumm statt des Coachs zu zeigen. Es wird dafür mit dem Song auf diesem Gerät gespeichert."}
                    </p>
                  )}
                </div>
              </div>
            )}
            {useImport && (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-choreo-file`} className="text-base">
                  Choreografie-Datei
                </Label>
                <Input
                  id={`${id}-choreo-file`}
                  type="file"
                  accept="application/json,.json"
                  aria-invalid={importError ? true : undefined}
                  aria-describedby={`${id}-choreo-msg`}
                  onChange={(e) => void chooseChoreo(e)}
                  className={`${INPUT} h-auto min-h-11 py-2`}
                />
                <div id={`${id}-choreo-msg`} aria-live="polite">
                  {importError && (
                    <p role="alert" className={FIELD_ERROR}>
                      {importError}
                    </p>
                  )}
                  {imported && <p className={HINT}>{imported.choreo.moves.length} Moves</p>}
                </div>
              </div>
            )}
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-title`} className="text-base">
              Titel
            </Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={TITLE_MAX}
              required
              autoComplete="off"
              aria-invalid={showTitleError ? true : undefined}
              aria-describedby={showTitleError ? `${id}-title-err` : undefined}
              onChange={(e) => {
                edited.current.title = true;
                setTitle(e.target.value);
              }}
              onBlur={() => setTitleTouched(true)}
              className={INPUT}
            />
            {showTitleError && (
              <p id={`${id}-title-err`} className={FIELD_ERROR}>
                {errors.title}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-artist`} className="text-base">
              Künstler
            </Label>
            <Input
              id={`${id}-artist`}
              value={artist}
              maxLength={ARTIST_MAX}
              autoComplete="off"
              onChange={(e) => {
                edited.current.artist = true;
                setArtist(e.target.value);
              }}
              className={INPUT}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-difficulty`} className="text-base">
              Schwierigkeit
            </Label>
            <select
              id={`${id}-difficulty`}
              value={difficulty}
              onChange={(e) => {
                edited.current.difficulty = true;
                setDifficulty(Number(e.target.value) as Difficulty);
              }}
              className="h-11 rounded-xl border border-input bg-transparent px-3 text-base"
            >
              <option value={1}>1 – Leicht</option>
              <option value={2}>2 – Mittel</option>
              <option value={3}>3 – Schwer</option>
            </select>
          </div>
          {error && (
            <p role="alert" className={ERROR}>
              {error}
            </p>
          )}
          <DialogFooter className="gap-3 sm:space-x-0">
            <Button type="submit" disabled={!canSubmit} className={BTN}>
              Hinzufügen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
