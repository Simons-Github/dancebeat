import type { GameResult } from "../types";

/**
 * Small in-memory hand-over between screens (not persisted; highscore and stars are stored in the
 * song by `recordResult` in results.ts before the result is handed over):
 * - the final result for /result/$songId,
 * - whether the setup may start the game on its own. After "Abbrechen" in the countdown the
 *   setup would otherwise send the player straight back into the game; auto-start stays off for
 *   that song until the next manual "Los geht's".
 */
let lastResult: GameResult | null = null;
const autoStartOff = new Set<string>();

export function setLastResult(r: GameResult) {
  lastResult = r;
}

export function getLastResult(songId: string): GameResult | null {
  return lastResult?.songId === songId ? lastResult : null;
}

export function disarmAutoStart(songId: string) {
  autoStartOff.add(songId);
}

export function rearmAutoStart(songId: string) {
  autoStartOff.delete(songId);
}

export function isAutoStartArmed(songId: string) {
  return !autoStartOff.has(songId);
}

export function resetSessionForTests() {
  lastResult = null;
  autoStartOff.clear();
}
