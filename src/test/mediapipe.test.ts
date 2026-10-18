import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TASKS_VISION_VERSION } from "@/lib/mediapipe";

describe("MediaPipe-Version", () => {
  it("ist in package.json exakt festgelegt und passt zur WASM-Version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(TASKS_VISION_VERSION);
  });
});
