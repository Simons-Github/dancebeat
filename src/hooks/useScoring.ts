import { useCallback, useRef, useState } from "react";
import {
  angleDeviation,
  judge,
  movePoints,
  referenceMax,
  starsFor,
  type Difficulty,
} from "@/lib/scoring";
import { frameAt } from "@/lib/pose";
import type { Angles, Choreography, Rating } from "@/lib/types";

export interface Judgement {
  id: number;
  rating: Rating;
  gold: boolean;
  moveIndex: number;
}

const WINDOW = 250;

/** Alle ~100 ms aufrufen: beste Übereinstimmung im ±250-ms-Fenster pro Move zählt. */
export function useScoring(choreo: Choreography | null, difficulty: Difficulty) {
  const best = useRef<Map<number, number>>(new Map());
  const next = useRef(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const comboRef = useRef(0);
  const maxCombo = useRef(0);
  const scoreRef = useRef(0);
  const counts = useRef<Record<Rating, number>>({ PERFECT: 0, SUPER: 0, GOOD: 0, OK: 0, X: 0 });
  const [last, setLast] = useState<Judgement | null>(null);
  const refMax = choreo ? referenceMax(choreo.moves) : 1;

  const finalize = useCallback(
    (i: number, rating: Rating) => {
      const m = choreo?.moves[i];
      if (!m) return;
      const c = rating === "X" || rating === "OK" ? 0 : comboRef.current + 1;
      const pts = movePoints(rating, comboRef.current, m.gold);
      comboRef.current = c;
      maxCombo.current = Math.max(maxCombo.current, c);
      scoreRef.current += pts;
      counts.current[rating]++;
      setScore(scoreRef.current);
      setCombo(c);
      setLast({ id: Date.now() + i, rating, gold: m.gold, moveIndex: i });
    },
    [choreo],
  );

  /** deviationFn erlaubt alternative Bewertung (Bewegungsmodus). */
  const sample = useCallback(
    (t: number, player: Angles | null, intensityRating?: () => Rating) => {
      if (!choreo) return;
      const moves = choreo.moves;
      for (let i = next.current; i < moves.length; i++) {
        const m = moves[i];
        if (!m) continue;
        if (m.timeMs - WINDOW > t) break;
        if (t <= m.timeMs + WINDOW && player) {
          const target = frameAt(choreo.frames, m.timeMs)?.angles ?? {};
          const dev = angleDeviation(player, target);
          if (dev != null) best.current.set(i, Math.min(best.current.get(i) ?? Infinity, dev));
        }
      }
      while (next.current < moves.length) {
        const mv = moves[next.current];
        if (!mv || t <= mv.timeMs + WINDOW) break;
        const i = next.current;
        const r = intensityRating
          ? intensityRating()
          : judge(best.current.has(i) ? best.current.get(i)! : null, difficulty);
        finalize(i, r);
        next.current++;
      }
    },
    [choreo, difficulty, finalize],
  );

  const reset = useCallback(() => {
    best.current.clear();
    next.current = 0;
    comboRef.current = 0;
    maxCombo.current = 0;
    scoreRef.current = 0;
    counts.current = { PERFECT: 0, SUPER: 0, GOOD: 0, OK: 0, X: 0 };
    setScore(0);
    setCombo(0);
    setLast(null);
  }, []);

  const stars = starsFor(score, refMax);
  return {
    sample,
    score,
    combo,
    last,
    stars,
    counts,
    maxCombo,
    reset,
    done: () => next.current >= (choreo?.moves.length ?? 0),
  };
}
