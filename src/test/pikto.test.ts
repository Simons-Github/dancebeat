import { describe, expect, it } from "vitest";

import { MAX_PULSE_HZ, beatPulse, beatsPerPulse } from "@/lib/game/beat";
import {
  PIKTO,
  createMoveFigureCache,
  coachPose,
  coachView,
  flashSchedule,
  moveFigure,
  moveFigures,
  piktoLayout,
} from "@/lib/game/pikto";
import { popupContent } from "@/lib/game/popup";
import { figure } from "@/lib/pose";
import type { Landmark, Move } from "@/lib/types";
import { makeChoreo } from "./fixtures";

const move = (timeMs: number, gold = false): Move => ({ timeMs, label: "x", iconId: "x", gold });

describe("Piktoleiste: Positionen", () => {
  const moves = [move(5000), move(6000, true), move(12_000)];

  it("taucht 4 s vorher rechts auf und läuft linear zur Marke", () => {
    expect(piktoLayout(moves, 5000 - PIKTO.previewMs - 1)).toEqual([]);
    const [atEdge] = piktoLayout(moves, 5000 - PIKTO.previewMs);
    expect(atEdge?.x).toBeCloseTo(1);
    expect(atEdge?.alpha).toBe(0); // fades in
    const half = piktoLayout(moves, 5000 - PIKTO.previewMs / 2)[0];
    expect(half?.x).toBeCloseTo(PIKTO.markerX + (1 - PIKTO.markerX) / 2);
    expect(half?.alpha).toBe(1);
    const atMarker = piktoLayout(moves, 5000)[0];
    expect(atMarker?.x).toBeCloseTo(PIKTO.markerX);
  });

  it("blitzt an der Marke weiß auf und verblasst danach", () => {
    const just = piktoLayout(moves, 5010)[0];
    expect(just).toMatchObject({ index: 0, past: true, x: PIKTO.markerX });
    expect(just!.flash).toBeGreaterThan(0.9);
    const later = piktoLayout(moves, 5000 + PIKTO.flashMs + 10)[0];
    expect(later!.flash).toBe(0);
    expect(later!.alpha).toBeGreaterThan(0);
    expect(piktoLayout(moves, 5000 + PIKTO.fadeOutMs + 1).map((i) => i.index)).not.toContain(0);
  });

  it("zeigt mehrere Moves zugleich in Zeitreihenfolge, Gold markiert", () => {
    const items = piktoLayout(moves, 4000);
    expect(items.map((i) => i.index)).toEqual([0, 1]);
    expect(items[1]?.gold).toBe(true);
    expect(items[0]!.x).toBeLessThan(items[1]!.x);
  });

  it("kein Blitz bei reduzierter Bewegung", () => {
    expect(piktoLayout(moves, 5010, { reducedMotion: true })[0]?.flash).toBe(0);
  });

  it("nie mehr als 3 Blitze pro Sekunde", () => {
    const dense = Array.from({ length: 20 }, (_, i) => move(i * 125));
    const flashes = flashSchedule(dense);
    const times = dense.filter((_, i) => flashes[i]).map((m) => m.timeMs);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1000 / 3);
    for (let t = 0; t < 2500; t += 10) {
      const lit = piktoLayout(dense, t, { flashes }).filter((it) => it.flash > 0);
      expect(lit.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("Piktogramm-Figuren", () => {
  const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
  const hide = (lm: Landmark[], i: number, v: number) =>
    lm.map((p, k): Landmark => (k === i ? [p[0], p[1], v] : p));
  const shift = (lm: Landmark[], idx: number[], dx: number) =>
    idx.forEach((i) => {
      const p = lm[i]!;
      lm[i] = [p[0] + dx, p[1], p[2] ?? 1];
    });
  const rest = { la: 10, ra: 10 };

  it("passt die Figur in eine Box der Höhe 1, zentriert", () => {
    const fig = moveFigure(figure({ la: 170, ra: 170 }))!;
    const pts = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].map((i) => fig.landmarks[i]!);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(1 - PIKTO.pad);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(PIKTO.pad - 1e-9);
    const xs = pts.map((p) => p[0]);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(fig.aspect / 2 - PIKTO.pad);
  });

  it("behält unsichere Landmarks unsicher statt sie bei 0 zu setzen", () => {
    const fig = moveFigure(hide(figure({ la: 90, ra: 90 }), 15, 0.2))!;
    expect(fig.landmarks[15]![2]).toBe(0.2);
    expect(fig.landmarks[15]!.slice(0, 2)).not.toEqual([0, 0]);
    expect(fig.landmarks[11]![2]).toBe(1);
  });

  it("kein Pfeil beim ersten Move", () => {
    const [first] = moveFigures(makeChoreo([rest, { la: 170, ra: 10 }]));
    expect(first?.arrows).toEqual([]);
  });

  it("kein Pfeil unter der Mindeststrecke", () => {
    const cur = figure(rest);
    const prev = figure(rest);
    shift(prev, [15], 0.02);
    expect(moveFigure(cur, prev)!.arrows).toEqual([]);
    expect(moveFigure(cur, figure(rest))!.arrows).toEqual([]);
  });

  it("Hand-, Fuß- und Hüftbewegung ergeben je einen Pfeil", () => {
    expect(moveFigure(figure(rest), figure({ la: 170, ra: 10 }))!.arrows.length).toBe(1);
    expect(moveFigure(figure(rest), figure({ ...rest, ll: 70 }))!.arrows.length).toBe(1);
    const prevHip = figure(rest);
    shift(prevHip, [23, 24], 0.2);
    expect(moveFigure(figure(rest), prevHip)!.arrows.length).toBe(1);
  });

  it("höchstens zwei Pfeile, die längsten zuerst", () => {
    const prev = figure({ la: 170, ra: 120, ll: 70, rl: 40 });
    const arrows = moveFigure(figure(rest), prev)!.arrows;
    expect(arrows.length).toBe(PIKTO.maxArrows);
    const len = (a: (typeof arrows)[number]) => dist([a.x0, a.y0], [a.x1, a.y1]);
    expect(len(arrows[0]!)).toBeGreaterThan(len(arrows[1]!));
  });

  it("überspringt Punkte, die in einer der Posen unsicher sind", () => {
    const far = figure({ la: 170, ra: 10 });
    expect(moveFigure(figure(rest), hide(far, 15, 0.1))!.arrows).toEqual([]);
    expect(moveFigure(hide(figure(rest), 15, 0.1), far)!.arrows).toEqual([]);
    const prevHip = figure(rest);
    shift(prevHip, [23, 24], 0.3);
    expect(moveFigure(hide(figure(rest), 24, 0), prevHip)!.arrows).toEqual([]);
  });

  it("der Bogen biegt vom Rumpf weg und die Enden sind gekürzt", () => {
    for (const [side, prevParams, hand] of [
      ["links", { la: 170, ra: 10 }, 15],
      ["rechts", { la: 10, ra: 170 }, 16],
    ] as const) {
      const fig = moveFigure(figure(rest), figure(prevParams))!;
      const a = fig.arrows[0]!;
      const lm = fig.landmarks;
      const center = [
        (lm[11]![0] + lm[12]![0] + lm[23]![0] + lm[24]![0]) / 4,
        (lm[11]![1] + lm[12]![1] + lm[23]![1] + lm[24]![1]) / 4,
      ];
      const chordMid = [(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2];
      expect(dist([a.cx, a.cy], center), side).toBeGreaterThan(dist(chordMid, center));
      expect(dist([a.cx, a.cy], chordMid)).toBeCloseTo(
        dist([a.x0, a.y0], [a.x1, a.y1]) * PIKTO.arrowBend,
      );
      // The arrow ends `arrowTrim` before the hand's current position.
      expect(dist([a.x1, a.y1], lm[hand]!)).toBeCloseTo(PIKTO.arrowTrim, 5);
    }
  });
});

describe("Figuren-Cache", () => {
  const c = makeChoreo([
    { la: 10, ra: 10 },
    { la: 90, ra: 10 },
    { la: 170, ra: 10 },
    { la: 90, ra: 90 },
  ]);

  it("liefert dasselbe wie moveFigures", () => {
    expect(createMoveFigureCache().figures(c)).toEqual(moveFigures(c));
  });

  it("Gold umschalten behält alle Figuren (===)", () => {
    const cache = createMoveFigureCache();
    const a = cache.figures(c);
    const moves = c.moves.map((m, i) => (i === 1 ? { ...m, gold: true } : m));
    const b = cache.figures({ moves, frames: c.frames });
    b.forEach((f, i) => expect(f).toBe(a[i]));
  });

  it("verschobener Move ändert nur sich und seinen Nachfolger", () => {
    const cache = createMoveFigureCache();
    const a = cache.figures(c);
    const moves = c.moves.map((m, i) => (i === 1 ? { ...m, timeMs: m.timeMs + 200 } : m));
    const b = cache.figures({ moves, frames: c.frames });
    expect(b).toEqual(moveFigures({ moves, frames: c.frames }));
    expect(b[0]).toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
    expect(b[2]).not.toBe(a[2]);
    expect(b[3]).toBe(a[3]);
  });

  it("eingefügter Move lässt unbeteiligte Figuren unberührt", () => {
    const cache = createMoveFigureCache();
    const a = cache.figures(c);
    const moves = [...c.moves.slice(0, 2), move(1250), ...c.moves.slice(2)];
    const b = cache.figures({ moves, frames: c.frames });
    expect(b).toEqual(moveFigures({ moves, frames: c.frames }));
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b[4]).toBe(a[3]);
  });

  it("neues frames-Objekt verwirft den Cache", () => {
    const cache = createMoveFigureCache();
    const a = cache.figures(c);
    const b = cache.figures({ moves: c.moves, frames: [...c.frames] });
    b.forEach((f, i) => {
      expect(f).toEqual(a[i]);
      expect(f).not.toBe(a[i]);
    });
  });
});

describe("Coach", () => {
  it("interpoliert flüssig zwischen den Frames (smoothstep)", () => {
    const c = makeChoreo([
      { la: 10, ra: 10 },
      { la: 170, ra: 170 },
    ]);
    const a = c.frames[0]!.landmarks[15]!;
    const b = c.frames[1]!.landmarks[15]!;
    expect(coachPose(c.frames, 0)?.[15]).toEqual([a[0], a[1], 1]);
    const mid = coachPose(c.frames, 250)![15]!;
    expect(mid[0]).toBeCloseTo((a[0] + b[0]) / 2);
    expect(mid[1]).toBeCloseTo((a[1] + b[1]) / 2);
    const quarter = coachPose(c.frames, 125)![15]!;
    // smoothstep(0.25) = 0.15625: slower than linear at the start
    expect(quarter[1]).toBeCloseTo(a[1] + (b[1] - a[1]) * 0.15625);
    expect(coachPose(c.frames, 99_999)?.[15]).toEqual(b);
  });

  it("feste Ansicht über alle Frames: der Coach springt und zoomt nicht", () => {
    const c = makeChoreo([
      { la: 10, ra: 10 },
      { la: 170, ra: 170, dy: 0.06, lk: 70, rk: 70 },
    ]);
    const v = coachView(c.frames);
    for (const f of c.frames)
      for (const i of [0, 15, 16, 27, 28]) {
        const p = f.landmarks[i]!;
        expect(p[0]).toBeGreaterThanOrEqual(v.x);
        expect(p[0]).toBeLessThanOrEqual(v.x + v.size);
        expect(p[1]).toBeGreaterThanOrEqual(v.y);
        expect(p[1]).toBeLessThanOrEqual(v.y + v.size);
      }
  });
});

describe("Beat-Puls", () => {
  it("auf dem Schlag voll, danach abklingend, vor dem Start nichts", () => {
    expect(beatPulse(0, 120)).toBe(1);
    expect(beatPulse(100, 120)).toBeGreaterThan(0);
    expect(beatPulse(300, 120)).toBe(0);
    expect(beatPulse(500, 120)).toBe(1);
    expect(beatPulse(-10, 120)).toBe(0);
  });

  it("mit Rate gilt die Grenze für bpm × Rate (echte Zeit)", () => {
    for (const rate of [0.5, 1, 1.25, 1.5, 2]) {
      for (let bpm = 60; bpm <= 300; bpm += 7) {
        const hz = (bpm * rate) / 60 / beatsPerPulse(bpm * rate);
        expect(hz).toBeLessThanOrEqual(MAX_PULSE_HZ);
      }
    }
    // 150 BPM at 2x = 300 BPM: pulse only every 2nd beat (period 2 · 400 ms in game time).
    expect(beatPulse(800, 150, 2)).toBe(1);
    expect(beatPulse(400, 150, 2)).toBe(0);
    expect(beatPulse(400, 150)).toBe(1);
  });

  it("höchstens 3 Pulse pro Sekunde, auch bei schnellen Songs", () => {
    for (const bpm of [60, 124, 180, 181, 240, 300]) {
      const hz = bpm / 60 / beatsPerPulse(bpm);
      expect(hz).toBeLessThanOrEqual(MAX_PULSE_HZ);
    }
  });
});

describe("Wertungs-Popups", () => {
  it("normale Moves zeigen das Urteil, Gold Moves YEAH! oder X", () => {
    expect(popupContent({ rating: "SUPER", gold: false }).text).toBe("SUPER");
    expect(popupContent({ rating: "GOOD", gold: true }).text).toBe("YEAH!");
    expect(popupContent({ rating: "X", gold: true }).text).toBe("X");
  });
});
