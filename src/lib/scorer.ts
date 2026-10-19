import { frameAt } from "./pose";
import {
  angleDeviation,
  judge,
  movePoints,
  nextCombo,
  referenceMax,
  starsFor,
  type Difficulty,
} from "./scoring";
import type { Angles, Choreography, Move, Rating } from "./types";

/** A move is judged by the best pose within ±MOVE_WINDOW_MS around its time. */
export const MOVE_WINDOW_MS = 250;

/** Movement mode: rates a move from its window [fromMs, toMs] instead of the angles. */
export type IntensityRating = (move: Move, fromMs: number, toMs: number) => Rating;

export interface MoveResult {
  index: number;
  rating: Rating;
  gold: boolean;
  points: number;
  /** Combo after this move. */
  combo: number;
}

export interface ScoreSnapshot {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Rating, number>;
  stars: number;
  mega: boolean;
  ratio: number;
  /** Moves judged so far. */
  judged: number;
  /** Moves that count (all minus those skipped by `seekTo`). */
  total: number;
}

const emptyCounts = (): Record<Rating, number> => ({ PERFECT: 0, SUPER: 0, GOOD: 0, OK: 0, X: 0 });

/**
 * Plain scoring state machine (no React, no clock). The caller feeds game time and the player's
 * angles; moves are judged once their window has passed.
 *
 * - Target angles per move are interpolated once in the constructor.
 * - `seekTo(t)` moves the pointer to the first move whose window is still open at `t` without
 *   judging the moves before it (intro skipped via `startOffsetMs`). They do not count, also not in
 *   the reference maximum for the stars. Seeking only goes forward; restarts use `reset()`.
 * - Non-finite times are ignored, so a broken clock never judges the whole song at once.
 */
export class Scorer {
  readonly moves: readonly Move[];
  private readonly targets: Angles[];
  private readonly difficulty: Difficulty;
  private best: (number | null)[] = [];
  private skipped: boolean[] = [];
  private next = 0;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private judged = 0;
  private counts = emptyCounts();
  private refMax = 1;

  constructor(choreo: Pick<Choreography, "moves" | "frames">, difficulty: Difficulty = "normal") {
    this.moves = choreo.moves;
    this.difficulty = difficulty;
    this.targets = choreo.moves.map((m) => frameAt(choreo.frames, m.timeMs)?.angles ?? {});
    this.reset();
  }

  /** Target angles of move `i` (precomputed). */
  target(i: number): Angles | undefined {
    return this.targets[i];
  }

  reset() {
    this.best = this.moves.map(() => null);
    this.skipped = this.moves.map(() => false);
    this.next = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.judged = 0;
    this.counts = emptyCounts();
    this.refMax = referenceMax(this.moves as Move[]);
  }

  /** Skips (without judging) every move whose window closed before `t`. Forward only. */
  seekTo(t: number) {
    if (!Number.isFinite(t)) return;
    let changed = false;
    while (this.next < this.moves.length) {
      const m = this.moves[this.next];
      if (!m || m.timeMs + MOVE_WINDOW_MS >= t) break;
      this.skipped[this.next] = true;
      this.best[this.next] = null;
      this.next++;
      changed = true;
    }
    if (changed) this.refMax = referenceMax(this.moves.filter((_, i) => !this.skipped[i]));
  }

  /**
   * Records the player's pose at game time `t` (null = no usable pose) and judges every move
   * whose window ended before `t`. Returns the moves judged by this call.
   * `intensityRating` replaces the angle comparison (movement mode); it gets the move's window.
   */
  sample(t: number, player: Angles | null, intensityRating?: IntensityRating): MoveResult[] {
    if (!Number.isFinite(t)) return [];
    const moves = this.moves;
    if (player) {
      for (let i = this.next; i < moves.length; i++) {
        const m = moves[i];
        if (!m || m.timeMs - MOVE_WINDOW_MS > t) break;
        if (t > m.timeMs + MOVE_WINDOW_MS) continue;
        const dev = angleDeviation(player, this.targets[i] ?? {});
        const prev = this.best[i] ?? null;
        if (dev != null && (prev == null || dev < prev)) this.best[i] = dev;
      }
    }
    const out: MoveResult[] = [];
    while (this.next < moves.length) {
      const m = moves[this.next];
      if (!m || t <= m.timeMs + MOVE_WINDOW_MS) break;
      const i = this.next++;
      const rating = intensityRating
        ? intensityRating(m, m.timeMs - MOVE_WINDOW_MS, m.timeMs + MOVE_WINDOW_MS)
        : judge(this.best[i] ?? null, this.difficulty);
      out.push(this.finalize(i, m, rating));
    }
    return out;
  }

  private finalize(index: number, m: Move, rating: Rating): MoveResult {
    const points = movePoints(rating, this.combo, m.gold);
    this.combo = nextCombo(this.combo, rating);
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += points;
    this.counts[rating]++;
    this.judged++;
    return { index, rating, gold: m.gold, points, combo: this.combo };
  }

  /** All moves judged or skipped. */
  done() {
    return this.next >= this.moves.length;
  }

  snapshot(): ScoreSnapshot {
    const { stars, mega, ratio } = starsFor(this.score, this.refMax);
    return {
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      stars,
      mega,
      ratio,
      judged: this.judged,
      total: this.skipped.filter((s) => !s).length,
    };
  }
}
