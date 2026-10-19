import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { build, type Plugin, type ResolvedConfig } from "vite";

import type { SwManifest } from "../src/sw/handlers";
import { RUNTIME_PREFIXES } from "../src/sw/strategy";

/**
 * Builds the service worker (src/sw/sw.ts) as a standalone classic script `<base>sw.js`
 * (IIFE, no imports, unhashed so its URL stays stable) and injects the precache list and
 * versions. Own build, not an extra input of the app build: app chunks can neither be shared
 * with it nor import it. Build only; the dev server has no service worker.
 */

export const SW_FILE = "sw.js";
export const SW_ENTRY = "src/sw/sw.ts";

/** Paths (relative to dist/) that are never precached. */
export function isPrecacheExcluded(file: string): boolean {
  return (
    file === SW_FILE ||
    file === "robots.txt" ||
    file.endsWith(".map") ||
    // Dotfiles and dot-directories (.well-known/, .DS_Store, ...) are not app files.
    file.split("/").some((segment) => segment.startsWith(".")) ||
    // MediaPipe WASM (13 MB per variant) and models: runtime cache, only what is loaded.
    RUNTIME_PREFIXES.some((p) => file.startsWith(p))
  );
}

/** Sorted dist-relative files to precache (index.html, assets, manifest, icons, favicon). */
export function selectPrecacheFiles(files: Iterable<string>): string[] {
  return [...new Set(files)].filter((f) => !isPrecacheExcluded(f)).sort();
}

/** Sorted dist-relative MediaPipe files (WASM runtime, models) for the runtime cache version. */
export function selectRuntimeFiles(files: Iterable<string>): string[] {
  return [...new Set(files)].filter((f) => RUNTIME_PREFIXES.some((p) => f.startsWith(p))).sort();
}

/** Short content hash over file names and contents (order-independent). */
export function hashFiles(files: ReadonlyMap<string, string | Uint8Array>): string {
  const outer = createHash("sha256");
  for (const name of [...files.keys()].sort()) {
    const content = files.get(name) ?? "";
    const inner = createHash("sha256").update(content).digest("hex");
    outer.update(`${name}\0${inner}\n`);
  }
  return outer.digest("hex").slice(0, 16);
}

export function createSwManifest(
  files: ReadonlyMap<string, string | Uint8Array>,
  base: string,
): SwManifest {
  const pick = (names: string[]) => new Map(names.map((n) => [n, files.get(n) ?? ""] as const));
  const precacheFiles = selectPrecacheFiles(files.keys());
  return {
    base,
    precache: precacheFiles.map((f) => `${base}${f}`),
    version: hashFiles(pick(precacheFiles)),
    mediapipeVersion: hashFiles(pick(selectRuntimeFiles(files.keys()))),
  };
}

/** Recursively lists files below `dir` as "/"-separated relative paths. */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = `${prefix}${e.name}`;
    if (e.isDirectory()) return listFiles(path.join(dir, e.name), `${rel}/`);
    return e.isFile() ? [rel] : [];
  });
}

async function buildServiceWorker(config: ResolvedConfig, manifest: SwManifest): Promise<string> {
  const result = await build({
    configFile: false,
    root: config.root,
    mode: config.mode,
    logLevel: "warn",
    publicDir: false,
    define: { __DANCEBEAT_SW_MANIFEST__: JSON.stringify(manifest) },
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      minify: config.build.minify,
      target: config.build.target,
      lib: {
        entry: path.resolve(config.root, SW_ENTRY),
        formats: ["iife"],
        name: "DanceBeatServiceWorker",
        fileName: () => SW_FILE,
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const out of outputs) {
    if (!("output" in out)) continue;
    const chunk = out.output.find((o) => o.type === "chunk" && o.isEntry);
    if (chunk?.type !== "chunk") continue;
    // Classic script: older iOS Safari has no module service workers.
    if (chunk.imports.length > 0 || chunk.dynamicImports.length > 0) {
      throw new Error(`${SW_FILE} must be self-contained (no static or dynamic imports)`);
    }
    return chunk.code;
  }
  throw new Error("service worker build produced no entry chunk");
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: "dancebeat:service-worker",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle: {
      // After vite:build-html (index.html) and mediapipeWasm (WASM assets) have emitted.
      order: "post",
      async handler(_options, bundle) {
        if (!config) return;
        const files = new Map<string, string | Uint8Array>();
        for (const [name, out] of Object.entries(bundle)) {
          files.set(name, out.type === "chunk" ? out.code : out.source);
        }
        if (config.publicDir && config.build.copyPublicDir) {
          for (const rel of listFiles(config.publicDir)) {
            if (!files.has(rel)) files.set(rel, readFileSync(path.join(config.publicDir, rel)));
          }
        }
        if (files.has(SW_FILE)) this.error(`${SW_FILE} already exists in the build output`);
        if (!files.has("index.html")) this.error("index.html missing from the build output");

        const code = await buildServiceWorker(config, createSwManifest(files, config.base));
        this.emitFile({ type: "asset", fileName: SW_FILE, source: code });
      },
    },
  };
}
