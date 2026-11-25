import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scorer, type IntensityRating, type MoveResult, type ScoreSnapshot } from "@/lib/scorer";
import type { Difficulty } from "@/lib/scoring";
import type { Angles, Choreography } from "@/lib/types";

export interface Judgement extends MoveResult {
  /** Unique per judgement, for popup keys. */
  id: number;
}

/** What the game loop needs from scoring; `Scorer` and this hook both provide it. */
export interface ScoringPort {
  sample(t: number, player: Angles | null, intensityRating?: IntensityRating): void;
  seekTo(t: number): void;
  reset(): void;
  done(): boolean;
}

/**
 * React binding for `Scorer`. `sample` may run every ~100 ms from the game loop; React state
 * changes only when a move is judged (about once per move), never per sample. A new choreography
 * or difficulty creates a fresh scorer, i.e. a reset.
 */
export function useScoring(choreo: Choreography | null, difficulty: Difficulty) {
  const scorer = useMemo(
    () => (choreo ? new Scorer(choreo, difficulty) : null),
    [choreo, difficulty],
  );
  const scorerRef = useRef(scorer);
  scorerRef.current = scorer;
  const seq = useRef(0);
  const [snapshot, setSnapshot] = useState<ScoreSnapshot | null>(() => scorer?.snapshot() ?? null);
  const [last, setLast] = useState<Judgement | null>(null);

  // Choreography changed: start from zero.
  useEffect(() => {
    setSnapshot(scorer?.snapshot() ?? null);
    setLast(null);
  }, [scorer]);

  const sample = useCallback(
    (t: number, player: Angles | null, intensityRating?: IntensityRating) => {
      const s = scorerRef.current;
      if (!s) return;
      const results = s.sample(t, player, intensityRating);
      const r = results.at(-1);
      if (!r) return;
      setSnapshot(s.snapshot());
      setLast({ ...r, id: ++seq.current });
    },
    [],
  );

  const seekTo = useCallback((t: number) => {
    const s = scorerRef.current;
    if (!s) return;
    s.seekTo(t);
    setSnapshot(s.snapshot());
  }, []);

  const reset = useCallback(() => {
    const s = scorerRef.current;
    if (!s) return;
    s.reset();
    setSnapshot(s.snapshot());
    setLast(null);
  }, []);

  const done = useCallback(() => scorerRef.current?.done() ?? true, []);
  const getSnapshot = useCallback(() => scorerRef.current?.snapshot() ?? null, []);

  return { sample, seekTo, reset, done, snapshot, last, getSnapshot };
}
