import { tanstackRouter } from "@tanstack/router-plugin/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { csp } from "./vite-plugins/csp";
import { mediapipeWasm } from "./vite-plugins/mediapipeWasm";
import { serviceWorker } from "./vite-plugins/serviceWorker";

// Plain client-side SPA: index.html is the entry, no server and no prerendering.
// HTTPS is opt-in (`bun run dev:https` sets DEV_HTTPS=1): phone cameras need a secure context.
const useHttps = process.env["DEV_HTTPS"] === "1";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Reachable from the phone only for `dev:https`; plain dev stays on localhost.
  server: useHttps ? { host: true } : {},
  preview: { host: true },
  // The demo choreographies (src/data/demos/*.choreo.json, lazy chunks, up to 1.4 MB as JS but
  // ~230 kB gzip) exceed Vite's 500 kB default; code chunks stay far below this limit.
  // license: names, versions and license texts of all bundled npm packages as
  // dist/licenses.json, shown under "Lizenztexte" in Settings (src/lib/licenses.ts).
  build: { chunkSizeWarningLimit: 1500, license: { fileName: "licenses.json" } },
  plugins: [
    // Must run before the React plugin so generated route files are picked up.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    viteReact(),
    tailwindcss(),
    // MediaPipe WASM runtime from our own origin (dev middleware + copy into dist/).
    mediapipeWasm(),
    // CSP meta tag: own origin plus the named YouTube/Spotify hosts (see vite-plugins/csp.ts).
    csp(),
    // Offline: own service worker as dist/sw.js with injected precache list (build only).
    serviceWorker(),
    ...(useHttps ? [basicSsl()] : []),
  ],
});
