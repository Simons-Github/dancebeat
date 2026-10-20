/**
 * Pure logic for the video import in "Song hinzufügen" (Etappe 8c): range checks and turning a
 * pose track into a choreography that lines up with the song's audio.
 *
 * Timeline assumption: video time equals audio time (same recording, both start at 0).
 */
import { ChoreographySchema } from "../schema";
import type { Choreography } from "../types";
import { choreoFromPoseTrack, type MovePlacement, type PoseTrack } from "../videoChoreo";

/** Shortest usable section. Shorter ones rarely give the two moves a choreography needs. */
export const VIDEO_RANGE_MIN_MS = 2000;
/** Same limit as the song length in the dialog. */
export const VIDEO_RANGE_MAX_MS = 600_000;
/**
 * Largest beat phase accepted in the form (ms, either sign). Generous because the detected phase
 * is the first beat after the section start, which may lie far into a long video.
 */
export const BEAT_PHASE_MAX_MS = 3_600_000;
/** Rounding slack between the shown end (0.1 s) and the real video duration. */
const END_TOLERANCE_MS = 100;

/**
 * "mirror"/"mirrored" and German "gespiegelt"/"spiegelverkehrt" as whole words, Korean 거울
 * ("mirror", as in 거울모드). Underscores and digits count as separators, unlike `\b`; camelCase
 * is split before the test. "ungespiegelt" and "nicht gespiegelt" do not match.
 */
const MIRRORED_NAME =
  /(?:^|[^a-z])mirror(?:ed)?(?![a-z])|(?<!nicht[ _-]?)(?:^|[^a-zäöüß])(?:gespiegelt|spiegelverkehrt)|거울/i;

/**
 * True if the file name says the video is already mirrored, like K-pop dance practice videos
 * titled "(Mirrored)" (yt-dlp keeps the title in the file name). Such videos must not be
 * mirrored again (`mirror: false`).
 */
export function looksMirrored(fileName: string): boolean {
  const name = fileName.normalize("NFC").replace(/([a-zäöüß])([A-ZÄÖÜ])/g, "$1 $2");
  return MIRRORED_NAME.test(name);
}

export interface VideoRange {
  startMs: number;
  endMs: number;
}

/** German message for an unusable range, null if it is fine. `durationMs` null = not known yet. */
export function validateVideoRange(range: VideoRange, durationMs: number | null): string | null {
  const { startMs, endMs } = range;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0) {
    return "Bitte Start und Ende in Sekunden angeben.";
  }
  if (endMs <= startMs) return "Das Ende muss nach dem Start liegen.";
  if (durationMs !== null && endMs > durationMs + END_TOLERANCE_MS) {
    return "Das Ende liegt hinter dem Videoende.";
  }
  if (endMs - startMs < VIDEO_RANGE_MIN_MS) {
    return `Der Abschnitt muss mindestens ${VIDEO_RANGE_MIN_MS / 1000} Sekunden lang sein.`;
  }
  if (endMs - startMs > VIDEO_RANGE_MAX_MS) {
    return `Der Abschnitt darf höchstens ${VIDEO_RANGE_MAX_MS / 60_000} Minuten lang sein. Bitte Start oder Ende anpassen.`;
  }
  return null;
}

/**
 * Video time in seconds ("12,5", "12.5", "90"), German or English decimal mark. Unlike the song
 * start offset there is no fixed upper limit: the range check compares with the video duration.
 * Empty means 0 when `emptyAs` is 0, else null; null if invalid.
 */
export function parseVideoSeconds(text: string, emptyAs: 0 | null = 0): number | null {
  const t = text.trim();
  if (t === "") return emptyAs;
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return null;
  const ms = Math.round(Number(t.replace(",", ".")) * 1000);
  return Number.isFinite(ms) ? ms : null;
}

/** Beat phase in whole ms, optionally negative ("-120"). Empty means 0; null if invalid. */
export function parseBeatPhaseMs(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (!/^[-−]?\d+$/.test(t)) return null;
  const ms = Number(t.replace("−", "-"));
  return Math.abs(ms) <= BEAT_PHASE_MAX_MS ? ms : null;
}

export interface VideoImportOptions {
  track: PoseTrack;
  title: string;
  bpm: number;
  /** Section in video time; must be the section the track was analyzed for. */
  range: VideoRange;
  /** Time of any beat in video (= audio) time. */
  beatPhaseMs: number;
  /** See VideoChoreoOptions.mirror. Default true. */
  mirror?: boolean;
  /** See VideoChoreoOptions.movePlacement. Default "grid". */
  movePlacement?: MovePlacement;
  colors?: [string, string];
  /** Video duration for the range check; null/omitted skips the end check. */
  durationMs?: number | null;
  now?: number;
}

export interface VideoImportStats {
  moves: number;
  gold: number;
  /** Samples in the range with a detected person / all samples in the range (0..1). */
  detectionRatio: number;
}

export interface VideoImportResult {
  choreo: Choreography;
  /** Where the audio starts (song.startOffsetMs): the range start. */
  startOffsetMs: number;
  stats: VideoImportStats;
}

const round1 = (v: number) => Math.round(v * 10) / 10 + 0;

/**
 * Builds the choreography for the chosen video section. The section is cut out and starts at
 * choreography time 0; `choreoFromPoseTrack` moves the beat phase into `offsetMs`. Adding the
 * range start to `offsetMs` puts every move back on its original video time, which (by the
 * timeline assumption) is its audio time: play time = audio − offsetMs. The song starts its audio
 * at the range start (`startOffsetMs`). Throws an Error with a German message if unusable.
 */
export function buildVideoChoreo(opts: VideoImportOptions): VideoImportResult {
  const { track, range } = opts;
  const rangeError = validateVideoRange(range, opts.durationMs ?? null);
  if (rangeError) throw new Error(rangeError);
  if (!Number.isFinite(opts.beatPhaseMs)) throw new Error("Ungültige Beat-Phase.");

  const base = choreoFromPoseTrack(track, {
    title: opts.title,
    bpm: opts.bpm,
    range,
    beatOffsetMs: opts.beatPhaseMs - range.startMs,
    ...(opts.mirror !== undefined && { mirror: opts.mirror }),
    ...(opts.movePlacement !== undefined && { movePlacement: opts.movePlacement }),
    ...(opts.colors && { colors: opts.colors }),
    ...(opts.now !== undefined && { now: opts.now }),
  });
  const choreo = ChoreographySchema.parse({
    ...base,
    offsetMs: round1(range.startMs + base.offsetMs),
  });

  const inRange = track.samples.filter((s) => s.timeMs >= range.startMs && s.timeMs <= range.endMs);
  const detected = inRange.filter((s) => s.landmarks !== null).length;
  return {
    choreo,
    startOffsetMs: range.startMs,
    stats: {
      moves: choreo.moves.length,
      gold: choreo.moves.filter((m) => m.gold).length,
      detectionRatio: inRange.length ? detected / inRange.length : 0,
    },
  };
}
