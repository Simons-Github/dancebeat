import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SW_ENTRY,
  createSwManifest,
  hashFiles,
  isPrecacheExcluded,
  selectPrecacheFiles,
} from "../../vite-plugins/serviceWorker";

const dist = (): Map<string, string> =>
  new Map([
    ["index.html", "<html>v1</html>"],
    ["assets/index-abc.js", "app"],
    ["assets/_songId-def.js", "lazy route"],
    ["assets/index-ghi.css", "css"],
    ["assets/fredoka-latin-400-normal-xyz.woff2", "font"],
    ["assets/index-abc.js.map", "map"],
    ["manifest.webmanifest", "{}"],
    ["favicon.svg", "<svg/>"],
    ["icons/icon-192.png", "png"],
    ["robots.txt", "User-agent: *"],
    ["mediapipe/wasm/vision_wasm_internal.js", "glue"],
    ["mediapipe/wasm/vision_wasm_internal.wasm", "wasm"],
    ["mediapipe/models/pose_landmarker_lite.task", "model"],
    ["sw.js", "old worker"],
    [".DS_Store", "junk"],
  ]);

describe("Service-Worker-Plugin: Precache-Liste", () => {
  it("schließt MediaPipe, sw.js, Sourcemaps und robots.txt aus", () => {
    expect(isPrecacheExcluded("mediapipe/wasm/vision_wasm_nosimd_internal.wasm")).toBe(true);
    expect(isPrecacheExcluded("mediapipe/models/pose_landmarker_lite.task")).toBe(true);
    expect(isPrecacheExcluded("sw.js")).toBe(true);
    expect(isPrecacheExcluded("assets/index-abc.js.map")).toBe(true);
    expect(isPrecacheExcluded("robots.txt")).toBe(true);
    expect(isPrecacheExcluded("assets/vision_bundle-abc.js")).toBe(false);
  });

  it("schließt Dotfiles und Punkt-Ordner aus", () => {
    expect(isPrecacheExcluded(".DS_Store")).toBe(true);
    expect(isPrecacheExcluded("icons/.DS_Store")).toBe(true);
    expect(isPrecacheExcluded(".well-known/assetlinks.json")).toBe(true);
    expect(isPrecacheExcluded("icons/icon.v2.svg")).toBe(false);
  });

  it("enthält Shell, Lazy-Chunks, CSS, Fonts, Manifest und Icons, sortiert", () => {
    expect(selectPrecacheFiles(dist().keys())).toEqual([
      "assets/_songId-def.js",
      "assets/fredoka-latin-400-normal-xyz.woff2",
      "assets/index-abc.js",
      "assets/index-ghi.css",
      "favicon.svg",
      "icons/icon-192.png",
      "index.html",
      "manifest.webmanifest",
    ]);
  });

  it("setzt den Basis-Pfad vor jede URL", () => {
    const m = createSwManifest(dist(), "/app/");
    expect(m.base).toBe("/app/");
    expect(m.precache).toContain("/app/index.html");
    expect(m.precache.every((u) => u.startsWith("/app/"))).toBe(true);
  });
});

describe("Service-Worker-Plugin: Versionen", () => {
  it("ist stabil und hängt von Namen und Inhalt ab", () => {
    const a = hashFiles(
      new Map([
        ["a", "1"],
        ["b", "2"],
      ]),
    );
    expect(
      hashFiles(
        new Map([
          ["b", "2"],
          ["a", "1"],
        ]),
      ),
    ).toBe(a);
    expect(
      hashFiles(
        new Map([
          ["a", "1"],
          ["b", "3"],
        ]),
      ),
    ).not.toBe(a);
    expect(
      hashFiles(
        new Map([
          ["a", "1"],
          ["c", "2"],
        ]),
      ),
    ).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("ändert nur die App-Version, wenn sich nur die App ändert", () => {
    const before = createSwManifest(dist(), "/");
    const changed = dist();
    changed.set("index.html", "<html>v2</html>");
    const after = createSwManifest(changed, "/");
    expect(after.version).not.toBe(before.version);
    expect(after.mediapipeVersion).toBe(before.mediapipeVersion);
  });

  it("ändert nur die MediaPipe-Version, wenn sich WASM oder Modell ändert", () => {
    const before = createSwManifest(dist(), "/");
    const changed = dist();
    changed.set("mediapipe/wasm/vision_wasm_internal.wasm", "wasm 2");
    const after = createSwManifest(changed, "/");
    expect(after.mediapipeVersion).not.toBe(before.mediapipeVersion);
    expect(after.version).toBe(before.version);
  });

  it("findet den Einstieg des Service Workers", () => {
    expect(existsSync(SW_ENTRY)).toBe(true);
  });
});
