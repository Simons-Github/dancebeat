import { describe, expect, it } from "vitest";

import { SHIPPED_MODELS, modelUrl, wasmBaseUrl } from "@/lib/mediapipe";

import { MODELS, missingModels, needsDownload, sha256Hex, verifyModel } from "../../scripts/models";
import { listWasmFiles, resolveWasmRequest } from "../../vite-plugins/mediapipeWasm";

const BASE = import.meta.env.BASE_URL;

describe("MediaPipe-Adressen", () => {
  it("laden Laufzeit und Modell vom eigenen Origin unter BASE_URL", () => {
    expect(wasmBaseUrl()).toBe(`${BASE}mediapipe/wasm`);
    expect(modelUrl("lite")).toBe(`${BASE}mediapipe/models/pose_landmarker_lite.task`);
    for (const url of [wasmBaseUrl(), ...SHIPPED_MODELS.map(modelUrl)]) {
      expect(url).not.toMatch(/^[a-z]+:|^\/\//i);
      expect(url).not.toMatch(/jsdelivr|googleapis/);
    }
  });

  it("nutzt genau die Modelle, die fetch-models herunterlädt", () => {
    expect(SHIPPED_MODELS.map((v) => modelUrl(v).split("/").pop())).toEqual(
      MODELS.map((m) => m.file),
    );
  });
});

describe("Vite-Plugin für die WASM-Laufzeit", () => {
  const files = listWasmFiles();

  it("liefert SIMD- und No-SIMD-Laufzeit aus, nicht die Modul-Variante", () => {
    expect(files).toEqual([
      "vision_wasm_internal.js",
      "vision_wasm_internal.wasm",
      "vision_wasm_nosimd_internal.js",
      "vision_wasm_nosimd_internal.wasm",
    ]);
  });

  it("ordnet bekannte Dateien mit passendem Content-Type zu", () => {
    expect(resolveWasmRequest("/mediapipe/wasm/vision_wasm_internal.wasm", "/", files)).toEqual({
      file: "vision_wasm_internal.wasm",
      contentType: "application/wasm",
    });
    expect(
      resolveWasmRequest("/app/mediapipe/wasm/vision_wasm_internal.js?v=1", "/app/", files),
    ).toEqual({ file: "vision_wasm_internal.js", contentType: "text/javascript" });
  });

  it("lehnt Traversal, fremde Dateien und falsche Präfixe ab", () => {
    for (const url of [
      "/mediapipe/wasm/../../package.json",
      "/mediapipe/wasm/..%2F..%2Fpackage.json",
      "/mediapipe/wasm/sub/vision_wasm_internal.wasm",
      "/mediapipe/wasm/unknown.wasm",
      "/mediapipe/wasm/vision_wasm_module_internal.wasm",
      "/mediapipe/wasm/",
      "/other/vision_wasm_internal.wasm",
      "/mediapipe/wasm/vision_wasm_internal.wasm",
    ]) {
      const base = url.startsWith("/mediapipe/wasm/vision") ? "/app/" : "/";
      expect(resolveWasmRequest(url, base, files)).toBeNull();
    }
  });
});

describe("fetch-models", () => {
  const data = new TextEncoder().encode("model bytes");
  const hash = sha256Hex(data);

  it("überspringt vorhandene Dateien mit passendem Hash", () => {
    expect(needsDownload(data, hash)).toBe(false);
    expect(needsDownload(null, hash)).toBe(true);
    expect(needsDownload(new TextEncoder().encode("broken"), hash)).toBe(true);
  });

  it("bricht bei Hash-Abweichung mit klarer Meldung ab", () => {
    const spec = { file: "x.task", url: "https://example.invalid/x.task", sha256: hash };
    expect(() => verifyModel(spec, data)).not.toThrow();
    expect(() => verifyModel(spec, new TextEncoder().encode("other"))).toThrow(
      /SHA-256 mismatch for x\.task/,
    );
  });

  it("meldet fehlende Modelle vor dem Build", () => {
    expect(missingModels(() => true)).toEqual([]);
    expect(missingModels(() => false)).toEqual(MODELS.map((m) => m.file));
  });

  it("pinnt jedes Modell auf eine feste, versionierte URL und einen SHA-256", () => {
    for (const m of MODELS) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.url).toMatch(/\/float16\/1\//);
    }
  });
});
