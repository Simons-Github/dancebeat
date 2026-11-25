import { describe, expect, it, vi } from "vitest";

import { drawCoach, drawFigure, drawMoveFigure, drawPiktos } from "@/lib/game/draw";
import { moveFigure, type PiktoItem } from "@/lib/game/pikto";
import { figure } from "@/lib/pose";
import type { Landmark } from "@/lib/types";

type Call = [string, ...number[]];

/** Recording 2D context: path calls are logged with their arguments; props are plain fields. */
function mockCtx() {
  const calls: Call[] = [];
  const rec =
    (name: string) =>
    (...a: number[]) => {
      calls.push([name, ...a]);
    };
  const shadowSet = vi.fn();
  const ctx = {
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    arc: rec("arc"),
    closePath: rec("closePath"),
    quadraticCurveTo: rec("quadraticCurveTo"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    strokeStyle: "",
    fillStyle: "",
    set shadowBlur(v: number) {
      shadowSet(v);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, shadowSet };
}

/** 33 landmarks at distinct positions: x = 0.01 * (i + 1), y = 0.02 * (i + 1). */
function pose(vis: Record<number, number> = {}): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => [0.01 * (i + 1), 0.02 * (i + 1), vis[i] ?? 1]);
}
const toPx = (p: Landmark) => [p[0] * 1000, p[1] * 1000] as const;
const style = { toPx, unit: 100, fill: "#f0f", grow: 0 };
const at = (i: number) => [0.01 * (i + 1) * 1000, 0.02 * (i + 1) * 1000] as const;

const hasMove = (calls: Call[], name: string, i: number) =>
  calls.some(
    (c) => c[0] === name && Math.abs(c[1]! - at(i)[0]) < 1e-6 && Math.abs(c[2]! - at(i)[1]) < 1e-6,
  );

describe("drawFigure", () => {
  it("draws every limb, the head, hands and the torso when all landmarks are visible", () => {
    const { ctx, calls } = mockCtx();
    drawFigure(ctx, pose(), style);
    const limbs: [number, number][] = [
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
      [23, 25],
      [25, 27],
      [24, 26],
      [26, 28],
      [27, 31],
      [28, 32],
    ];
    for (const [a, b] of limbs) {
      const k = calls.findIndex(
        (c, n) =>
          c[0] === "moveTo" &&
          c[1] === at(a)[0] &&
          c[2] === at(a)[1] &&
          calls[n + 1]?.[0] === "lineTo" &&
          calls[n + 1]?.[1] === at(b)[0] &&
          calls[n + 1]?.[2] === at(b)[1],
      );
      expect(k, `${a}-${b}`).toBeGreaterThanOrEqual(0);
    }
    expect(calls.filter((c) => c[0] === "arc").length).toBe(3); // head + two hands
    // Torso: closed quad that is filled.
    const close = calls.findIndex((c) => c[0] === "closePath");
    expect(close).toBeGreaterThan(0);
    expect(calls[close + 1]?.[0]).toBe("fill");
    // One stroke per width class (torso, neck, 5 limb groups).
    expect(calls.filter((c) => c[0] === "stroke").length).toBe(7);
  });

  it("skips parts with an invisible landmark and never draws at the origin", () => {
    const { ctx, calls } = mockCtx();
    drawFigure(ctx, pose({ 13: 0.2 }), style);
    expect(hasMove(calls, "moveTo", 13)).toBe(false);
    expect(hasMove(calls, "lineTo", 13)).toBe(false);
    expect(calls.some((c) => c[0] === "lineTo" && c[1] === at(11)[0] && c[2] === at(13)[1])).toBe(
      false,
    );
    // The forearm 13-15 is gone, the other arm is intact.
    expect(calls.some((c) => c[0] === "lineTo" && c[1] === at(15)[0] && c[2] === at(15)[1])).toBe(
      false,
    );
    expect(hasMove(calls, "moveTo", 12)).toBe(true);
    for (const c of calls) {
      if (["moveTo", "lineTo", "arc"].includes(c[0])) expect([c[1], c[2]]).not.toEqual([0, 0]);
    }
  });

  it("omits hand, foot and torso when their landmarks are missing", () => {
    const { ctx, calls } = mockCtx();
    drawFigure(ctx, pose({ 15: 0, 31: 0.1, 24: 0.3 }), style);
    expect(calls.filter((c) => c[0] === "arc").length).toBe(2); // head + right hand
    expect(hasMove(calls, "lineTo", 31)).toBe(false);
    expect(calls.some((c) => c[0] === "closePath")).toBe(false);
  });

  it("falls back to the nose for the head and never sets a shadow", () => {
    const { ctx, calls, shadowSet } = mockCtx();
    drawFigure(ctx, pose({ 7: 0 }), style);
    expect(calls.some((c) => c[0] === "arc" && c[1] === at(0)[0] && c[2] === at(0)[1])).toBe(true);
    expect(shadowSet).not.toHaveBeenCalled();
  });

  it("grows widths by the grow amount", () => {
    const a = mockCtx(),
      b = mockCtx();
    drawFigure(a.ctx, pose(), style);
    drawFigure(b.ctx, pose(), { ...style, grow: 10 });
    expect(b.ctx.lineWidth).toBeCloseTo(a.ctx.lineWidth + 10);
  });
});

describe("drawCoach", () => {
  it("only clears when there is no pose", () => {
    const canvas = document.createElement("canvas");
    const clearRect = vi.fn();
    const stroke = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue({
      setTransform: vi.fn(),
      clearRect,
      stroke,
    } as unknown as CanvasRenderingContext2D);
    drawCoach(canvas, null, { x: 0, y: 0, size: 1 }, "#ff00aa");
    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(stroke).not.toHaveBeenCalled();
  });
});

describe("Piktogramme", () => {
  const colors = { accent: "#112233", secondary: "#445566" };
  const fig = moveFigure(figure({ la: 10, ra: 10 }), figure({ la: 170, ra: 10, ll: 70 }))!;

  /** A canvas whose 2D context records path calls and shadowBlur writes. */
  function recorded() {
    const m = mockCtx();
    const base = m.ctx as unknown as object;
    const ctx = Object.create(base, {
      setTransform: { value: vi.fn() },
      clearRect: { value: vi.fn() },
    }) as CanvasRenderingContext2D;
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx);
    return { canvas, calls: m.calls, shadowSet: m.shadowSet };
  }
  const item = (over: Partial<PiktoItem> = {}): PiktoItem => ({
    index: 0,
    x: 0.5,
    alpha: 1,
    flash: 0,
    gold: false,
    past: false,
    ...over,
  });
  const count = (calls: Call[], name: string) => calls.filter((c) => c[0] === name).length;

  it("drawMoveFigure füllt Silhouetten und zeichnet je Pfeil einen Bogen (Kontur und Farbe)", () => {
    const { canvas, calls, shadowSet } = recorded();
    drawMoveFigure(canvas, fig, false, colors);
    expect(fig.arrows.length).toBe(2);
    // Two passes per arrow (dark outline, color) trace the same curve.
    expect(count(calls, "quadraticCurveTo")).toBe(fig.arrows.length * 2);
    expect(count(calls, "fill")).toBeGreaterThan(0);
    expect(count(calls, "stroke")).toBeGreaterThan(0);
    expect(shadowSet).not.toHaveBeenCalled();
  });

  it("drawPiktos zeichnet Gold mit Halo ohne shadowBlur", () => {
    const normal = recorded(),
      gold = recorded();
    drawPiktos(normal.canvas, [item()], [fig], colors);
    drawPiktos(gold.canvas, [item({ gold: true })], [fig], colors);
    // The halo is one more silhouette pass.
    expect(count(gold.calls, "stroke")).toBeGreaterThan(count(normal.calls, "stroke"));
    expect(count(gold.calls, "quadraticCurveTo")).toBe(fig.arrows.length * 2);
    expect(normal.shadowSet).not.toHaveBeenCalled();
    expect(gold.shadowSet).not.toHaveBeenCalled();
  });

  it("ohne Figur wird nur gelöscht", () => {
    const { canvas, calls } = recorded();
    drawMoveFigure(canvas, null, false, colors);
    drawPiktos(canvas, [item()], [null], colors);
    expect(calls).toEqual([]);
  });
});
