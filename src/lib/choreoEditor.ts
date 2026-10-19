import type { Choreography, Song } from "./types";
import { suggestGoldMoves } from "./videoChoreo";

/**
 * Pure, immutable edit operations for the choreography editor (stage 8d-1). No React, no browser
 * APIs. The data format does not change: only `moves[].gold`, the move list (deletions),
 * `choreo.offsetMs` and the song's `playbackRate` are edited.
 */

/** A choreography keeps at least this many moves (same rule as the video import). */
export const MIN_MOVES = 2;
/** The editor moves `offsetMs` at most this far away from its anchor (the saved value). */
export const OFFSET_SHIFT_LIMIT_MS = 10_000;
/** Tempo choices offered by the editor. 1 means "no field" (`playbackRate` is removed). */
export const TEMPO_OPTIONS = [0.75, 1, 1.25] as const;

/** Length of one beat in ms. */
export const beatLengthMs = (bpm: number) => 60_000 / bpm;

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
    return !n || n.timeMs !== m.timeMs || n.gold !== m.gold;
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
