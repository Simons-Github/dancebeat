import { audioTimeMs } from "./audio/clock";
import { effectivePlaybackRate } from "./audio/rate";
import { beatLengthMs } from "./choreoEditor";
import type { Move, Song } from "./types";

/**
 * Pure helpers for the editor's audio preview (stage 8d-2b). No React, no browser APIs. Times
 * named "game" are choreography time (`gameTimeMs`, same offsets as the game), "audio" is the
 * position of the audio source.
 */

/** "Ab Move N abspielen" starts this many beats before the move. */
export const PREVIEW_LEAD_BEATS = 2;

/**
 * Largest game-time step between two frames that still produces ticks. Larger steps (seek, offset
 * edit, stalled tab, clock correction) tick nothing, so a jump never fires a burst of clicks.
 * Normal frames advance about 17 ms × playbackRate.
 */
export const TICK_MAX_GAP_MS = 250;

/**
 * Audio position the preview seeks to. Without `index` (or for an unknown move): the song's
 * `startOffsetMs`, like the sync test. With a move: its game time minus `PREVIEW_LEAD_BEATS` beats,
 * converted with the game's offsets (latency scaled by the effective rate, `syncOffsetMs`,
 * `choreo.offsetMs`), never before `startOffsetMs` or 0.
 */
export function previewStartAudioMs(song: Song, latencyMs: number, index?: number): number {
  const floor = Math.max(0, song.startOffsetMs);
  const move = index === undefined ? undefined : song.choreo.moves[index];
  if (!move) return floor;
  const gameMs = move.timeMs - PREVIEW_LEAD_BEATS * beatLengthMs(song.choreo.bpm);
  const audioMs = audioTimeMs(gameMs, {
    latencyMs,
    syncOffsetMs: song.syncOffsetMs,
    choreoOffsetMs: song.choreo.offsetMs,
    rate: effectivePlaybackRate(song),
  });
  return Math.max(floor, audioMs);
}

/**
 * Choreography time at which a move's click must sound: the audio position minus
 * `choreo.offsetMs` only. The click is audio itself and goes through the same output delay as the
 * music, so latency and `syncOffsetMs` (which delay the visuals in the game) do not apply. Equals
 * `gameTimeMs + latency + syncOffsetMs`.
 */
export const tickTimeMs = (audioMs: number, choreoOffsetMs: number) => audioMs - choreoOffsetMs;

/**
 * After a start or seek the tick interval begins this far before the target, so a move exactly at
 * the start position still clicks.
 */
export const SEEK_TICK_EPSILON_MS = 0.5;

/** Index of the last move with `timeMs <= gameMs` (moves sorted), -1 before the first move. */
export function currentMoveIndex(moves: readonly Move[], gameMs: number): number {
  let lo = 0,
    hi = moves.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((moves[mid]?.timeMs ?? Infinity) <= gameMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Indices of the moves that became due between two frames (`prevMs < timeMs <= nowMs`). Nothing
 * after a reset (`prevMs` null), a backward step or a step larger than `TICK_MAX_GAP_MS`.
 */
export function dueMoves(moves: readonly Move[], prevMs: number | null, nowMs: number): number[] {
  if (prevMs === null || !Number.isFinite(prevMs) || !Number.isFinite(nowMs)) return [];
  if (nowMs <= prevMs || nowMs - prevMs > TICK_MAX_GAP_MS) return [];
  const out: number[] = [];
  for (let i = currentMoveIndex(moves, prevMs) + 1; i < moves.length; i++) {
    const t = moves[i]?.timeMs ?? Infinity;
    if (t > nowMs) break;
    out.push(i);
  }
  return out;
}

/**
 * Horizontal scroll (px) that brings `item` fully into `box` (both as left/right edges), 0 when it
 * is already visible. An item wider than the box aligns to its left edge.
 */
export function scrollIntoBoxDelta(
  box: { left: number; right: number },
  item: { left: number; right: number },
): number {
  if (item.left < box.left || item.right - item.left > box.right - box.left)
    return item.left - box.left;
  if (item.right > box.right) return item.right - box.right;
  return 0;
}
