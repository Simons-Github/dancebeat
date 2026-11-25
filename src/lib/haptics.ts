import type { Rating } from "./types";

/** Vibration patterns (ms; odd entries are pauses). */
export const PERFECT_PULSE_MS = 30;
export const GOLD_PATTERN_MS = [40, 40, 80];

/**
 * Short buzz for PERFECT, a stronger pattern for a hit Gold Move. Silent when disabled or when
 * the browser has no `navigator.vibrate` (iOS Safari); never throws.
 */
export function vibrateFor(rating: Rating, gold: boolean, enabled: boolean) {
  if (!enabled || rating === "X") return;
  const pattern = gold ? GOLD_PATTERN_MS : rating === "PERFECT" ? PERFECT_PULSE_MS : null;
  if (!pattern) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration is optional feedback.
  }
}
