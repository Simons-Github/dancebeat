import { describe, expect, it, vi } from "vitest";

import { clearOverlay, guideBox } from "@/lib/overlay";

describe("Zielrahmen", () => {
  it("behält in jedem Format das Seitenverhältnis 1:2 und 85 % Höhe", () => {
    for (const [w, h] of [
      [640, 480],
      [1280, 720],
      [720, 1280],
    ] as const) {
      const b = guideBox(w, h);
      expect(b.h).toBeCloseTo(h * 0.85);
      expect(b.h / b.w).toBeCloseTo(2);
      expect(b.x + b.w / 2).toBeCloseTo(w / 2);
      expect(b.y + b.h / 2).toBeCloseTo(h / 2);
    }
  });

  it("passt in sehr schmale Bilder, ohne herauszuragen", () => {
    const b = guideBox(100, 1000);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(100);
    expect(b.h / b.w).toBeCloseTo(2);
  });
});

describe("clearOverlay", () => {
  it("löscht die ganze Fläche", () => {
    const clearRect = vi.fn();
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    vi.spyOn(canvas, "getContext").mockReturnValue({
      clearRect,
    } as unknown as CanvasRenderingContext2D);
    clearOverlay(canvas);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 320, 240);
  });

  it("verträgt fehlenden Kontext", () => {
    expect(() => clearOverlay(document.createElement("canvas"))).not.toThrow();
  });
});
