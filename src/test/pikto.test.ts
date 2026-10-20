import { describe, expect, it } from "vitest";

import { MAX_PULSE_HZ, beatPulse, beatsPerPulse } from "@/lib/game/beat";
import {
  PIKTO,
  coachPose,
  coachView,
  flashSchedule,
  moveFigures,
  piktoLayout,
  stickFigure,
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

describe("Strichfiguren", () => {
  it("passt die Figur in eine Box der Höhe 1, zentriert", () => {
    const fig = stickFigure(figure({ la: 170, ra: 170 }))!;
    const ys = fig.lines.flatMap(([, y0, , y1]) => [y0, y1]);
    expect(Math.max(...ys)).toBeCloseTo(1);
    expect(Math.min(...ys, fig.head!.y - fig.head!.r)).toBeGreaterThanOrEqual(-0.001);
    const xs = fig.lines.flatMap(([x0, , x1]) => [x0, x1]);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 1);
  });

  it("lässt unsichere Landmarks weg statt sie bei 0 zu zeichnen", () => {
    const lm = figure({ la: 90, ra: 90 }).map((p, i): Landmark =>
      i === 15 ? [p[0], p[1], 0.2] : p,
    );
    const full = stickFigure(figure({ la: 90, ra: 90 }))!;
    const missing = stickFigure(lm)!;
    expect(missing.lines.length).toBe(full.lines.length - 1);
  });

  it("Pfeil, wenn eine Hand seit dem letzten Move weit gewandert ist", () => {
    const c = makeChoreo([
      { la: 10, ra: 10 },
      { la: 170, ra: 10 },
    ]);
    const [first, second] = moveFigures(c);
    expect(first?.arrows).toEqual([]);
    expect(second?.arrows.length).toBe(1);
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
