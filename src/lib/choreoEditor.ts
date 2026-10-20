import type { Choreography, Move, Song } from "./types";
import { poseUsableAt, suggestGoldMoves } from "./videoChoreo";

/**
 * Pure, immutable edit operations for the choreography editor (stages 8d-1 and 8d-2a). No React,
 * no browser APIs. The data format does not change: only `moves[].gold`, `moves[].timeMs`, the
 * move list (deletions and insertions), `choreo.offsetMs` and the song's `playbackRate` are
 * edited. Frames stay untouched; a move's pose is interpolated from them at its time.
 */

/** A choreography keeps at least this many moves (same rule as the video import). */
export const MIN_MOVES = 2;
/** The editor moves `offsetMs` at most this far away from its anchor (the saved value). */
export const OFFSET_SHIFT_LIMIT_MS = 10_000;
/** Tempo choices offered by the editor. 1 means "no field" (`playbackRate` is removed). */
export const TEMPO_OPTIONS = [0.75, 1, 1.25] as const;

/**
 * Minimum distance between two moves: a playability limit that keeps the order strict and allows
 * one-beat spacing up to 200 BPM. Overlapping judging windows (±MOVE_WINDOW_MS) are fine, as the
 * scorer tracks the best deviation per move.
 */
export const MIN_MOVE_GAP_MS = 300;

/** Length of one beat in ms. */
export const beatLengthMs = (bpm: number) => 60_000 / bpm;

/** Move times are kept to 0.1 ms (like the video import), so half beats do not drift. */
const roundTime = (v: number) => Math.round(v * 10) / 10 + 0;

/**
 * Whether a move may sit at `timeMs` between `prev` and `next` (either may be missing):
 * nonnegative, not before audio time 0, inside the recorded frames with a usable target pose
 * there (same rule as the video import) and at least `MIN_MOVE_GAP_MS` away from both neighbors.
 */
function fitsAt(
  choreo: Choreography,
  timeMs: number,
  prev: Move | undefined,
  next: Move | undefined,
): boolean {
  const first = choreo.frames[0];
  const last = choreo.frames[choreo.frames.length - 1];
  if (!first || !last || !Number.isFinite(timeMs) || timeMs < 0) return false;
  if (timeMs + choreo.offsetMs < 0) return false;
  if (timeMs < first.timeMs || timeMs > last.timeMs) return false;
  if (prev && timeMs - prev.timeMs < MIN_MOVE_GAP_MS) return false;
  if (next && next.timeMs - timeMs < MIN_MOVE_GAP_MS) return false;
  return poseUsableAt(choreo.frames, timeMs);
}

/** New time of the move at `index` after shifting by `deltaMs`, or null when not allowed. */
function shiftedTime(choreo: Choreography, index: number, deltaMs: number): number | null {
  const move = choreo.moves[index];
  if (!move || !Number.isInteger(index) || !Number.isFinite(deltaMs)) return null;
  const t = roundTime(move.timeMs + deltaMs);
  if (t === move.timeMs) return null;
  return fitsAt(choreo, t, choreo.moves[index - 1], choreo.moves[index + 1]) ? t : null;
}

/** Whether `shiftMove(choreo, index, deltaMs)` would change the choreography. */
export const canShiftMove = (choreo: Choreography, index: number, deltaMs: number) =>
  shiftedTime(choreo, index, deltaMs) !== null;

/**
 * Moves the move at `index` by `deltaMs` (rounded to 0.1 ms). Rejects instead of clamping: an
 * invalid index or delta, a time before 0 (choreography or audio time), outside the frames, at an
 * unusable pose or closer than `MIN_MOVE_GAP_MS` to a neighbor returns the same object. Order is
 * preserved.
 */
export function shiftMove(choreo: Choreography, index: number, deltaMs: number): Choreography {
  const t = shiftedTime(choreo, index, deltaMs);
  const move = choreo.moves[index];
  if (t === null || !move) return choreo;
  const moves = choreo.moves.slice();
  moves[index] = { ...move, timeMs: t };
  return { ...choreo, moves };
}

/**
 * Time for a new move after the one at `index`, or null when there is no room. With a next move:
 * the midpoint, snapped to the choreography's beat grid (k · beat in choreography time; the
 * import keeps the beat phase in `offsetMs`), falling back to the plain midpoint when the snapped
 * time breaks a rule. Without one: two beats after the move. Times are rounded to 0.1 ms.
 */
function insertTime(choreo: Choreography, index: number): number | null {
  const move = choreo.moves[index];
  if (!move || !Number.isInteger(index)) return null;
  const next = choreo.moves[index + 1];
  const beat = beatLengthMs(choreo.bpm);
  const fits = (t: number) => fitsAt(choreo, t, move, next);
  if (!next) {
    const t = roundTime(move.timeMs + 2 * beat);
    return fits(t) ? t : null;
  }
  const mid = (move.timeMs + next.timeMs) / 2;
  const snapped = roundTime(Math.round(mid / beat) * beat);
  if (fits(snapped)) return snapped;
  const raw = roundTime(mid);
  return fits(raw) ? raw : null;
}

/** Whether a move can be inserted after the move at `index`. */
export const canInsertAfter = (choreo: Choreography, index: number) =>
  insertTime(choreo, index) !== null;

/**
 * Inserts a new, non-gold move after the move at `index` (time rule: see `insertTime`). The new
 * move has an empty label and `iconId` "editor" (both required by the schema). Returns the new
 * choreography and the new move's index, or the same object and `index` when there is no room.
 */
export function insertMoveAfter(
  choreo: Choreography,
  index: number,
): { choreo: Choreography; index: number } {
  const t = insertTime(choreo, index);
  if (t === null) return { choreo, index };
  const moves = choreo.moves.slice();
  moves.splice(index + 1, 0, { timeMs: t, label: "", iconId: "editor", gold: false });
  return { choreo: { ...choreo, moves }, index: index + 1 };
}

/** Whether a move may be deleted without going below `MIN_MOVES`. */
export const canDeleteMove = (choreo: Choreography) => choreo.moves.length > MIN_MOVES;

/**
 * Removes the move at `index`. Returns the same object (unchanged) when the index is out of
 * range or fewer than `MIN_MOVES` moves would remain; callers can compare by reference.
 * Removing from a sorted list keeps it sorted.
 */
export function deleteMove(choreo: Choreography, index: number): Choreography {
  if (!Number.isInteger(index) || index < 0 || index >= choreo.moves.length) return choreo;
  if (!canDeleteMove(choreo)) return choreo;
  return { ...choreo, moves: choreo.moves.filter((_, i) => i !== index) };
}

/** Flips the gold flag of the move at `index` (unchanged object for an invalid index). */
export function toggleGold(choreo: Choreography, index: number): Choreography {
  const move = choreo.moves[index];
  if (!move) return choreo;
  const moves = choreo.moves.slice();
  moves[index] = { ...move, gold: !move.gold };
  return { ...choreo, moves };
}

/** Replaces all gold flags with the automatic suggestion (same rule as the video import). */
export function suggestGold(choreo: Choreography): Choreography {
  return { ...choreo, moves: suggestGoldMoves(choreo.moves, choreo.frames) };
}

/**
 * Shifts `offsetMs` by `deltaMs`, rounded to whole ms and clamped to
 * `anchorMs ± OFFSET_SHIFT_LIMIT_MS`. The anchor is the saved offset, so imported choreographies
 * with a large offset (video range start) stay editable. The first move never moves before audio
 * time 0 (`offsetMs >= -moves[0].timeMs`); an offset that already violates this may only grow.
 */
export function shiftOffset(
  choreo: Choreography,
  deltaMs: number,
  anchorMs: number = choreo.offsetMs,
): Choreography {
  if (!Number.isFinite(deltaMs)) return choreo;
  const firstMs = choreo.moves[0]?.timeMs ?? 0;
  const lo = Math.min(
    Math.max(Math.round(anchorMs - OFFSET_SHIFT_LIMIT_MS), Math.ceil(-firstMs)),
    choreo.offsetMs,
  );
  const hi = Math.max(Math.round(anchorMs + OFFSET_SHIFT_LIMIT_MS), choreo.offsetMs);
  // `|| 0` turns -0 (from rounding or -firstMs) into 0.
  const next = Math.min(hi, Math.max(lo, Math.round(choreo.offsetMs + deltaMs))) || 0;
  return next === choreo.offsetMs ? choreo : { ...choreo, offsetMs: next };
}

/** Effective tempo of a song (missing field = 1). */
export const tempoOf = (song: Song) => song.playbackRate ?? 1;

/**
 * Whether the song's audio source applies `playbackRate`. Only file and URL sources (HTML media
 * element) do; YouTube and Spotify always play at normal speed (finding N10).
 */
export const supportsTempo = (song: Song) =>
  song.source.type === "local" || song.source.type === "url";

/** Sets the tempo; 1 removes the optional field, as players read `playbackRate ?? 1`. */
export function setTempo(song: Song, rate: number): Song {
  const next: Song = { ...song };
  if (rate === 1) delete next.playbackRate;
  else next.playbackRate = rate;
  return next;
}

/** Whether the working copy differs from the saved song in any field the editor changes. */
export function isEdited(saved: Song, working: Song): boolean {
  if (tempoOf(saved) !== tempoOf(working)) return true;
  const a = saved.choreo,
    b = working.choreo;
  if (a.offsetMs !== b.offsetMs || a.moves.length !== b.moves.length) return true;
  return a.moves.some((m, i) => {
    const n = b.moves[i];
    return (
      !n ||
      n.timeMs !== m.timeMs ||
      n.gold !== m.gold ||
      n.label !== m.label ||
      n.iconId !== m.iconId
    );
  });
}

/**
 * The song to save: the working copy with `choreo.updatedAt = now`. The song's own `updatedAt`
 * is set by the repository on save.
 */
export const prepareSave = (working: Song, now: number): Song => ({
  ...working,
  choreo: { ...working.choreo, updatedAt: now },
});

/** Audio position label "mm:ss,s" (one decimal, German comma, minus sign when negative). */
export function formatMoveTime(ms: number): string {
  const tenths = Math.round(Math.abs(ms) / 100);
  const sign = ms < 0 && tenths > 0 ? "−" : "";
  const min = Math.floor(tenths / 600);
  const sec = Math.floor((tenths % 600) / 10);
  return `${sign}${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")},${tenths % 10}`;
}

/** Audio position of a move: choreography time plus `offsetMs` (without latency and sync). */
export const moveAudioMs = (choreo: Choreography, index: number) =>
  (choreo.moves[index]?.timeMs ?? 0) + choreo.offsetMs;
