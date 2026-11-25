import type { AngleKey, Angles, Rating } from "./types";
import { ARM_KEYS, angleDiff } from "./pose";

import { DIFFICULTIES, type Difficulty } from "./difficulty";
import { t } from "./i18n";

export { DIFFICULTIES, type Difficulty };
export const TOLERANCE: Record<Difficulty, number> = { leicht: 1.3, normal: 1, schwer: 0.8 };
export const POINTS: Record<Rating, number> = {
  PERFECT: 1000,
  SUPER: 700,
  GOOD: 400,
  OK: 200,
  X: 0,
};
export const GOLD_FACTOR = 5;

/** Minimum share of the target's total weight that must be visible on the player. */
export const MIN_COVERAGE = 0.5;

const weightOf = (k: AngleKey) => (ARM_KEYS.includes(k) ? 2 : k === "torsoLean" ? 0.5 : 1);

/**
 * Gewichtete mittlere Abweichung in Grad (kürzester Bogen). Arme zählen doppelt, Rumpfneigung halb.
 * null = nicht bewertbar: weniger als MIN_COVERAGE des Zielgewichts sichtbar oder kein Armwinkel.
 */
export function angleDeviation(player: Angles, target: Angles): number | null {
  let sum = 0,
    w = 0,
    total = 0,
    arm = false;
  for (const k of Object.keys(target) as AngleKey[]) {
    const t = target[k];
    if (t == null) continue;
    const weight = weightOf(k);
    total += weight;
    const p = player[k];
    if (p == null) continue;
    sum += Math.abs(angleDiff(p, t)) * weight;
    w += weight;
    if (ARM_KEYS.includes(k)) arm = true;
  }
  if (!w || !arm || w < total * MIN_COVERAGE) return null;
  return sum / w;
}

export function judge(deviation: number | null, difficulty: Difficulty = "normal"): Rating {
  if (deviation == null) return "X";
  const d = deviation / TOLERANCE[difficulty];
  if (d < 15) return "PERFECT";
  if (d < 30) return "SUPER";
  if (d < 45) return "GOOD";
  if (d < 60) return "OK";
  return "X";
}

export const comboMultiplier = (combo: number) => Math.min(4, 1 + Math.floor(combo / 5));

/** Combo rules: these ratings keep the combo without raising it; COMBO_BREAK resets it. */
export const COMBO_HOLD: readonly Rating[] = ["OK"];
export const COMBO_BREAK: readonly Rating[] = ["X"];

export function nextCombo(combo: number, r: Rating) {
  if (COMBO_BREAK.includes(r)) return 0;
  if (COMBO_HOLD.includes(r)) return combo;
  return combo + 1;
}

export function movePoints(r: Rating, combo: number, gold: boolean) {
  return POINTS[r] * comboMultiplier(combo) * (gold ? GOLD_FACTOR : 1);
}

/**
 * Accuracy points of a move for the stars: rating points with gold, without the combo multiplier.
 * The displayed score keeps the combo; the stars only measure how well the moves were danced, so a
 * long combo of GOOD cannot reach five stars (Befund N2).
 */
export function accuracyPoints(r: Rating, gold: boolean) {
  return POINTS[r] * (gold ? GOLD_FACTOR : 1);
}

/** Reference maximum of the accuracy points: every move PERFECT, gold 5-fold. */
export function referenceMax(moves: { gold: boolean }[]) {
  return moves.reduce((s, m) => s + accuracyPoints("PERFECT", m.gold), 0) || 1;
}

/** Star thresholds on the accuracy ratio; calibrated with `bun run eval-demos` (docs/scoring.md). */
export const STAR_THRESHOLDS = [0.2, 0.35, 0.5, 0.65, 0.8];
export const MEGA_THRESHOLD = 0.95;

/** Stars of `accuracy` accuracy points out of `refMax` (ratio 0..1). */
export function starsFor(accuracy: number, refMax: number) {
  const r = accuracy / refMax;
  const stars = STAR_THRESHOLDS.filter((t) => r >= t).length;
  return { stars, mega: r >= MEGA_THRESHOLD, ratio: r };
}

/** Rank headline of the result screen, in the current language (call at render time). */
export function rankTitle(stars: number, mega: boolean) {
  if (mega) return t("shell.rank.mega");
  const key = (
    [
      "shell.rank.0",
      "shell.rank.1",
      "shell.rank.2",
      "shell.rank.3",
      "shell.rank.4",
      "shell.rank.5",
    ] as const
  )[stars];
  return key ? t(key) : undefined;
}
