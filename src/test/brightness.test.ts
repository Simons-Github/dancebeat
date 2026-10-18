import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOW_LIGHT_RELEASE,
  LOW_LIGHT_THRESHOLD,
  createBrightnessMeter,
  isLowLight,
} from "@/lib/brightness";

describe("Lichtcheck", () => {
  it("warnt unter der Schwelle und gibt erst darüber frei", () => {
    expect(isLowLight(LOW_LIGHT_THRESHOLD - 1)).toBe(true);
    expect(isLowLight(LOW_LIGHT_THRESHOLD)).toBe(false);
    // Between 45 and 55 the previous answer stays.
    expect(isLowLight(50, true)).toBe(true);
    expect(isLowLight(50, false)).toBe(false);
    expect(isLowLight(LOW_LIGHT_RELEASE - 1, true)).toBe(true);
    expect(isLowLight(LOW_LIGHT_RELEASE, true)).toBe(false);
  });
});

describe("Helligkeitsmessung", () => {
  afterEach(() => vi.restoreAllMocks());

  const withPixels = (data: Uint8ClampedArray) =>
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data }),
    } as unknown as CanvasRenderingContext2D);
  const video = document.createElement("video");

  it("mittelt die Farbkanäle und ignoriert Alpha", () => {
    const px = new Uint8ClampedArray(16 * 12 * 4);
    for (let i = 0; i < px.length; i += 4) px.set([30, 60, 90, 255], i);
    withPixels(px);
    expect(createBrightnessMeter()(video)).toBeCloseTo(60);
  });

  it("liefert 0 für Schwarz und 255 für Weiß", () => {
    withPixels(new Uint8ClampedArray(16 * 12 * 4).fill(0));
    expect(createBrightnessMeter()(video)).toBe(0);
    withPixels(new Uint8ClampedArray(16 * 12 * 4).fill(255));
    expect(createBrightnessMeter()(video)).toBe(255);
  });

  it("liefert null ohne Canvas-Kontext", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(createBrightnessMeter()(video)).toBeNull();
  });
});
