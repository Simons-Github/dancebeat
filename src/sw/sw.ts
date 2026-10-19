/// <reference lib="webworker" />
// Service worker entry. Built by vite-plugins/serviceWorker.ts into a standalone classic script
// `<base>sw.js` (IIFE, no imports) and type-checked via tsconfig.sw.json (WebWorker lib, no DOM).
// Production only; src/lib/serviceWorker.ts registers it.

import { createHandlers, type SwManifest } from "./handlers";

declare const self: ServiceWorkerGlobalScope;
// Replaced at build time (Vite `define`) with the precache list and versions.
declare const __DANCEBEAT_SW_MANIFEST__: SwManifest;

const handlers = createHandlers({
  caches: self.caches,
  fetch: (request) => self.fetch(request),
  origin: self.location.origin,
  manifest: __DANCEBEAT_SW_MANIFEST__,
});

// Updates use the normal lifecycle: the browser fetches sw.js on navigations, a changed file
// installs the new build next to the old one. No skipWaiting(): a new version never swaps files
// under a running game. It waits until every tab of the old version is closed and takes over on
// the next start; until then navigations keep getting the old worker's own shell (handlers.ts),
// so page, chunks and MediaPipe files always come from the same build.
self.addEventListener("install", (event) => {
  event.waitUntil(handlers.install());
});

// clients.claim(): only has an effect when pages are uncontrolled, i.e. on the very first
// install (an update only activates once no old-version page is left). It lets the first
// session already store the MediaPipe files in the runtime cache. Safe: that page requests the
// same hashed files the precache holds, unknown ones go to the network untouched.
self.addEventListener("activate", (event) => {
  event.waitUntil(handlers.activate().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const response = handlers.handleFetch(event.request, (p) => event.waitUntil(p));
  if (response) event.respondWith(response);
});
