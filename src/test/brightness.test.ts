import { describe, expect, it } from "vitest";

import { LOW_LIGHT_RELEASE, LOW_LIGHT_THRESHOLD, isLowLight } from "@/lib/brightness";

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
