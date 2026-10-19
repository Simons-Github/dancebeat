import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

import { MODELS_DIR, missingModels } from "../scripts/models";

/**
 * Serves the MediaPipe WASM runtime from the app's own origin instead of a CDN.
 * Dev: middleware answers `<base>mediapipe/wasm/<file>`. Build: copies the files to
 * `dist/mediapipe/wasm/` and fails early if a pose model has not been downloaded.
 * The runtime always matches the installed @mediapipe/tasks-vision.
 */

export const WASM_URL_DIR = "mediapipe/wasm/";
// Resolved via an exported package file (package.json itself is not exported), independent of cwd.
export const WASM_SOURCE_DIR = path.dirname(
  createRequire(import.meta.url).resolve("@mediapipe/tasks-vision/vision_wasm_internal.wasm"),
);

const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
};

/**
 * Runtime files actually loaded: FilesetResolver.forVisionTasks() without the module flag picks
 * vision_wasm_internal.* (SIMD) or vision_wasm_nosimd_internal.* (older Safari). The
 * `_module_` variant is never requested and is not shipped.
 */
export function listWasmFiles(dir: string = WASM_SOURCE_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) => e.isFile() && /^[\w.-]+\.(js|wasm)$/.test(e.name) && !e.name.includes("_module_"),
    )
    .map((e) => e.name)
    .sort();
}

/**
 * Maps a request URL to a known runtime file. Only exact names from `files` match,
 * so traversal (`..`, encoded slashes) and unknown files are rejected.
 */
export function resolveWasmRequest(
  url: string,
  base: string,
  files: readonly string[],
): { file: string; contentType: string } | null {
  const pathname = url.split(/[?#]/, 1)[0] ?? "";
  const prefix = `${base.endsWith("/") ? base : `${base}/`}${WASM_URL_DIR}`;
  if (!pathname.startsWith(prefix)) return null;
  const name = pathname.slice(prefix.length);
  if (!files.includes(name)) return null;
  const contentType = CONTENT_TYPES[path.extname(name)];
  return contentType ? { file: name, contentType } : null;
}

export function mediapipeWasm(sourceDir: string = WASM_SOURCE_DIR): Plugin {
  // Only absolute `base` values (e.g. "/" or "/app/") are supported, not relative "./".
  let base = "/";
  let command: "build" | "serve" = "serve";
  let modelsDir = MODELS_DIR;
  return {
    name: "dancebeat:mediapipe-wasm",
    configResolved(config) {
      base = config.base;
      command = config.command;
      modelsDir = path.join(config.root, MODELS_DIR);
    },
    buildStart() {
      if (command !== "build") return;
      const missing = missingModels((f) => existsSync(path.join(modelsDir, f)));
      if (missing.length > 0) {
        this.error(
          `MediaPipe model(s) missing in ${MODELS_DIR}: ${missing.join(", ")}. ` +
            `Run "bun run fetch-models" first.`,
        );
      }
    },
    configureServer(server) {
      const files = listWasmFiles(sourceDir);
      server.middlewares.use((req, res, next) => {
        const hit = req.url ? resolveWasmRequest(req.url, base, files) : null;
        if (!hit) return next();
        res.setHeader("Content-Type", hit.contentType);
        res.setHeader("Cache-Control", "no-cache");
        res.end(readFileSync(path.join(sourceDir, hit.file)));
      });
    },
    generateBundle() {
      for (const name of listWasmFiles(sourceDir)) {
        this.emitFile({
          type: "asset",
          fileName: `${WASM_URL_DIR}${name}`,
          source: readFileSync(path.join(sourceDir, name)),
        });
      }
    },
  };
}
