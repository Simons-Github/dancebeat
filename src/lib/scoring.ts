import type { AngleKey, Angles, Rating } from "./types";
import { ARM_KEYS } from "./pose";

export type Difficulty = "leicht" | "normal" | "schwer";
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
 * Gewichtete mittlere Abweichung in Grad. Arme zählen doppelt, Rumpfneigung halb.
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
    sum += Math.abs(p - t) * weight;
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

export function movePoints(r: Rating, combo: number, gold: boolean) {
  return POINTS[r] * comboMultiplier(combo) * (gold ? GOLD_FACTOR : 1);
}

/** Referenz-Maximum: alle Moves PERFECT bei Multiplikator x2 (realistisch erreichbar). */
export function referenceMax(moves: { gold: boolean }[]) {
  return moves.reduce((s, m) => s + 1000 * 2 * (m.gold ? GOLD_FACTOR : 1), 0) || 1;
}

export const STAR_THRESHOLDS = [0.15, 0.3, 0.45, 0.6, 0.75];
export const MEGA_THRESHOLD = 0.95;

export function starsFor(score: number, refMax: number) {
  const r = score / refMax;
  const stars = STAR_THRESHOLDS.filter((t) => r >= t).length;
  return { stars, mega: r >= MEGA_THRESHOLD, ratio: r };
}

export function rankTitle(stars: number, mega: boolean) {
  if (mega) return "MEGASTAR";
  return ["NOCH ÜBEN", "ANFÄNGER", "GROOVER", "TÄNZER", "PROFI", "SUPERSTAR"][stars];
}
