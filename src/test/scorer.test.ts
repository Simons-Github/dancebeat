import { describe, expect, it, vi } from "vitest";

import * as pose from "@/lib/pose";
import { MOVE_WINDOW_MS, Scorer } from "@/lib/scorer";
import { GOLD_FACTOR, POINTS } from "@/lib/scoring";
import { seededRandom, simulatedAngles, type SimOptions } from "@/lib/game/simulatedPlayer";
import type { Choreography } from "@/lib/types";
import { makeChoreo } from "./fixtures";

/** Moves every second from 1000 ms on; frames at the move times (fixtures place them every 500 ms). */
function choreo(n = 8, gold: number[] = []): Choreography {
  const poses = Array.from({ length: n }, (_, i) =>
    i % 2 ? { la: 170, ra: 170 } : { la: 90, ra: 90, le: 60, re: 60 },
  );
  const c = makeChoreo(poses);
  const frames = c.frames.map((f, i) => ({ ...f, timeMs: 1000 + i * 1000 }));
  const moves = frames.map((f, i) => ({
    timeMs: f.timeMs,
    label: `M${i}`,
    iconId: "x",
    gold: gold.includes(i),
  }));
  return { ...c, frames, moves };
}

/** Feeds the scorer like the game loop: a sample every 100 ms up to `endMs`. */
function run(s: Scorer, c: Choreography, sim: SimOptions | "none", from = 0, endMs = 12_000) {
  for (let t = from; t <= endMs; t += 100) {
    s.sample(t, sim === "none" ? null : simulatedAngles(c, t, sim));
  }
  return s.snapshot();
}

describe("Scorer mit simuliertem Spieler", () => {
  it("Perfect-Lauf: alle Moves PERFECT, Combo = Anzahl Moves", () => {
    const c = choreo(8);
    const snap = run(new Scorer(c), c, { noiseDeg: 0, missRate: 0 });
    expect(snap.counts.PERFECT).toBe(8);
    expect(snap.combo).toBe(8);
    expect(snap.maxCombo).toBe(8);
    expect(snap.judged).toBe(8);
    // 5 × 1000 (x1), then 3 × 2000 (x2 from combo 5)
    expect(snap.score).toBe(5 * 1000 + 3 * 2000);
  });

  it("Rauschen: mittleres Rauschen senkt die Wertung, aber niemand bekommt X", () => {
    const c = choreo(8);
    const snap = run(new Scorer(c), c, { noiseDeg: 25, missRate: 0, random: seededRandom(7) });
    expect(snap.counts.PERFECT).toBeLessThan(8);
    expect(snap.counts.X).toBe(0);
    expect(snap.judged).toBe(8);
  });

  it("Rauschen ist reproduzierbar (gleicher Seed, gleiches Ergebnis)", () => {
    const c = choreo(8);
    const a = run(new Scorer(c), c, { noiseDeg: 40, missRate: 0.3, random: seededRandom(3) });
    const b = run(new Scorer(c), c, { noiseDeg: 40, missRate: 0.3, random: seededRandom(3) });
    expect(a).toEqual(b);
  });

  it("Totalausfall: niemand im Bild → alle X, Score 0, Combo 0", () => {
    const c = choreo(6);
    const snap = run(new Scorer(c), c, { noiseDeg: 0, missRate: 1 });
    expect(snap.counts.X).toBe(6);
    expect(snap.score).toBe(0);
    expect(snap.combo).toBe(0);
  });

  it("ohne Pose (null) schließt die Uhr trotzdem jedes Fenster", () => {
    const c = choreo(3);
    const s = new Scorer(c);
    expect(s.sample(1000 + MOVE_WINDOW_MS, null)).toEqual([]);
    expect(s.sample(1000 + MOVE_WINDOW_MS + 1, null)).toHaveLength(1);
    expect(s.done()).toBe(false);
    s.sample(10_000, null);
    expect(s.done()).toBe(true);
  });

  it("bewertet mit der besten Pose im ±250-ms-Fenster, außerhalb zählt nichts", () => {
    const c = choreo(1);
    const target = new Scorer(c).target(0)!;
    const s = new Scorer(c);
    s.sample(1000 - MOVE_WINDOW_MS - 1, target); // too early
    s.sample(1000 - 200, { ...target, leftShoulder: (target.leftShoulder ?? 0) + 50 });
    s.sample(1000 + 200, target);
    const [r] = s.sample(1000 + MOVE_WINDOW_MS + 1, null);
    expect(r?.rating).toBe("PERFECT");
  });
});

describe("Combo und Gold", () => {
  it("OK hält die Combo, nur X bricht sie", () => {
    const c = choreo(4);
    const s = new Scorer(c);
    const t0 = s.target(0)!;
    const okPose = (i: number) => {
      const t = s.target(i)!;
      // 52° off on every angle → weighted mean 52° → OK (45..60)
      const out = { ...t };
      for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = out[k]! + 52;
      return out;
    };
    s.sample(1000, t0);
    expect(s.sample(1300, null)[0]?.combo).toBe(1);
    s.sample(2000, okPose(1));
    const [ok] = s.sample(2300, null);
    expect(ok?.rating).toBe("OK");
    expect(ok?.combo).toBe(1);
    const [x] = s.sample(3300, null);
    expect(x?.rating).toBe("X");
    expect(x?.combo).toBe(0);
  });

  it("Gold Moves zählen 5-fach, auch im Referenzmaximum", () => {
    const c = choreo(2, [1]);
    const s = new Scorer(c);
    s.sample(1000, s.target(0)!);
    s.sample(2000, s.target(1)!);
    const results = s.sample(5000, null);
    expect(results.map((r) => r.points)).toEqual([POINTS.PERFECT * GOLD_FACTOR]);
    const snap = s.snapshot();
    expect(snap.score).toBe(POINTS.PERFECT + POINTS.PERFECT * GOLD_FACTOR);
    // Reference: every move PERFECT, gold 5-fold, no combo → (1 + 5) × 1000; both hit.
    expect(snap.ratio).toBeCloseTo(1);
  });
});

describe("seekTo und startOffsetMs", () => {
  it("überspringt Moves vor der Startzeit ohne Wertung (kein X)", () => {
    const c = choreo(6);
    const s = new Scorer(c);
    s.seekTo(3500); // intro skipped: moves at 1000, 2000, 3000 are over
    const snap0 = s.snapshot();
    expect(snap0.judged).toBe(0);
    expect(snap0.total).toBe(3);
    const snap = run(s, c, { noiseDeg: 0, missRate: 0 }, 3500);
    expect(snap.counts.X).toBe(0);
    expect(snap.counts.PERFECT).toBe(3);
    expect(snap.judged).toBe(3);
  });

  it("Sterne beziehen sich nur auf die gespielten Moves", () => {
    const c = choreo(6);
    const s = new Scorer(c);
    s.seekTo(3500);
    const snap = run(s, c, { noiseDeg: 0, missRate: 0 }, 3500);
    expect(snap.ratio).toBeCloseTo(3000 / (3 * 1000));
  });

  it("ein noch offenes Fenster bleibt offen", () => {
    const c = choreo(3);
    const s = new Scorer(c);
    s.seekTo(1000 + MOVE_WINDOW_MS); // window of move 0 is still open
    expect(s.snapshot().total).toBe(3);
  });

  it("seekTo rückwärts ändert nichts (Neustart über reset)", () => {
    const c = choreo(3);
    const s = new Scorer(c);
    s.sample(2500, null);
    s.seekTo(0);
    expect(s.snapshot().judged).toBe(2);
    s.reset();
    expect(s.snapshot()).toMatchObject({ judged: 0, score: 0, combo: 0, total: 3 });
  });

  it("ignoriert ungültige Zeiten statt alles auf einmal zu werten", () => {
    const c = choreo(3);
    const s = new Scorer(c);
    expect(s.sample(NaN, null)).toEqual([]);
    expect(s.sample(Infinity, null)).toEqual([]);
    s.seekTo(NaN);
    expect(s.snapshot().judged).toBe(0);
    expect(s.done()).toBe(false);
  });

  it("Zielwinkel werden einmal pro Move vorberechnet, nicht pro Aufruf", () => {
    const c = choreo(4);
    const spy = vi.spyOn(pose, "frameAt");
    const s = new Scorer(c);
    const calls = spy.mock.calls.length;
    expect(calls).toBe(4);
    run(s, c, { noiseDeg: 0, missRate: 0 });
    // simulatedAngles itself uses frameAt; the scorer adds none.
    const simCalls = Math.floor(12_000 / 100) + 1;
    expect(spy.mock.calls.length - calls).toBe(simCalls);
    spy.mockRestore();
  });
});

describe("Bewegungsmodus (intensityRating)", () => {
  it("ersetzt den Winkelvergleich und bekommt Move und Fenster", () => {
    const c = choreo(2, [1]);
    const s = new Scorer(c);
    const rating = vi.fn(() => "GOOD" as const);
    s.sample(1000, null, rating);
    expect(rating).not.toHaveBeenCalled();
    const results = s.sample(2300, s.target(1)!, rating);
    expect(results.map((r) => r.rating)).toEqual(["GOOD", "GOOD"]);
    expect(rating).toHaveBeenNthCalledWith(
      1,
      c.moves[0],
      1000 - MOVE_WINDOW_MS,
      1000 + MOVE_WINDOW_MS,
    );
    expect(rating).toHaveBeenNthCalledWith(
      2,
      c.moves[1],
      2000 - MOVE_WINDOW_MS,
      2000 + MOVE_WINDOW_MS,
    );
    // Gold still multiplies the points.
    expect(results[1]?.points).toBe(POINTS.GOOD * GOLD_FACTOR);
  });
});
