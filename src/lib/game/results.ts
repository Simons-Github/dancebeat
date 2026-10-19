import type { SongRepository } from "../library/repository";
import type { GameResult, Song } from "../types";

/** Highest star count a song can store (SongSchema: int 0..5; the mega step is not stored). */
export const MAX_STARS = 5;
/** Saving the result may delay the result screen at most this long (ms). */
export const RESULT_SAVE_TIMEOUT_MS = 2000;

const clampStars = (n: number) =>
  Number.isFinite(n) ? Math.min(MAX_STARS, Math.max(0, Math.floor(n))) : 0;

/**
 * Best-of merge of a finished game into the song: highscore and stars only ever rise.
 * Returns the updated song, or null when the result improves nothing. Pure.
 */
export function applyResult(song: Song, r: Pick<GameResult, "score" | "stars">): Song | null {
  const score = Number.isFinite(r.score) ? Math.max(0, Math.round(r.score)) : 0;
  const highscore = Math.max(song.highscore, score);
  const stars = Math.max(song.stars, clampStars(r.stars));
  if (highscore === song.highscore && stars === song.stars) return null;
  return { ...song, highscore, stars };
}

/**
 * Stores the result as the song's new best (if it is one). Songs that are not in the library
 * (e.g. dev songs) are left alone. Storage errors (StorageFullError, ...) propagate to the caller.
 */
export async function recordResult(
  repo: SongRepository,
  songId: string,
  score: number,
  stars: number,
): Promise<{ newHighscore: boolean }> {
  const song = await repo.get(songId);
  if (!song) return { newHighscore: false };
  const updated = applyResult(song, { score, stars });
  if (updated) await repo.save(updated);
  return { newHighscore: updated !== null && updated.highscore > song.highscore };
}

/**
 * recordResult for the end of a game: never throws and never waits longer than `timeoutMs`.
 * Errors and timeouts are logged and count as "no new highscore".
 */
export function recordResultSafely(
  repo: SongRepository,
  songId: string,
  score: number,
  stars: number,
  timeoutMs = RESULT_SAVE_TIMEOUT_MS,
): Promise<{ newHighscore: boolean }> {
  const fallback = { newHighscore: false };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`Saving the highscore took longer than ${timeoutMs} ms, skipped.`);
      resolve(fallback);
    }, timeoutMs);
    recordResult(repo, songId, score, stars).then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e: unknown) => {
        clearTimeout(timer);
        console.warn("Saving the highscore failed:", e);
        resolve(fallback);
      },
    );
  });
}
