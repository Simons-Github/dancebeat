import { afterEach, describe, expect, it, vi } from "vitest";

import { GOLD_PATTERN_MS, PERFECT_PULSE_MS, vibrateFor } from "@/lib/haptics";

const vibrate = vi.fn();
const install = () =>
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });

afterEach(() => {
  vibrate.mockReset();
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("haptics", () => {
  it("short pulse for PERFECT", () => {
    install();
    vibrateFor("PERFECT", false, true);
    expect(vibrate).toHaveBeenCalledWith(PERFECT_PULSE_MS);
  });

  it("stronger pattern for a gold move hit", () => {
    install();
    vibrateFor("PERFECT", true, true);
    vibrateFor("GOOD", true, true);
    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(vibrate).toHaveBeenNthCalledWith(1, GOLD_PATTERN_MS);
    expect(vibrate).toHaveBeenNthCalledWith(2, GOLD_PATTERN_MS);
  });

  it("nothing for other ratings, a missed gold move or when disabled", () => {
    install();
    for (const r of ["SUPER", "GOOD", "OK", "X"] as const) vibrateFor(r, false, true);
    vibrateFor("X", true, true);
    vibrateFor("PERFECT", true, false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("does nothing without the API and swallows errors", () => {
    expect(() => vibrateFor("PERFECT", false, true)).not.toThrow();
    vibrate.mockImplementation(() => {
      throw new Error("blocked");
    });
    install();
    expect(() => vibrateFor("PERFECT", false, true)).not.toThrow();
  });
});
