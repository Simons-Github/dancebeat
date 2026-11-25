/// <reference lib="webworker" />
// Service worker entry. Built by vite-plugins/serviceWorker.ts into a standalone classic script
// `<base>sw.js` (IIFE, no imports) and type-checked via tsconfig.sw.json (WebWorker lib, no DOM).
// Production only; src/lib/serviceWorker.ts registers it.

import { createHandlers, type SwManifest } from "./handlers";
import { isSkipWaitingMessage } from "./strategy";

declare const self: ServiceWorkerGlobalScope;
// Replaced at build time (Vite `define`) with the precache list and versions.
declare const __DANCEBEAT_SW_MANIFEST__: SwManifest;

const handlers = createHandlers({
  caches: self.caches,
  fetch: (request) => self.fetch(request),
  origin: self.location.origin,
  manifest: __DANCEBEAT_SW_MANIFEST__,
});

// Updates use the normal lifecycle: the browser fetches sw.js on navigations (and the page asks
// for an update check when it becomes visible), a changed file installs the new build next to
// the old one. No automatic skipWaiting(): a new version never swaps files under a running game.
// It waits until every tab of the old version is closed and takes over on the next start; until
// then navigations keep getting the old worker's own shell (handlers.ts), so page, chunks and
// MediaPipe files always come from the same build. Exception: the user taps "Neu laden" in the
// update banner (library and settings only), the page posts SKIP_WAITING_MESSAGE and reloads as
// soon as this worker controls it (src/lib/serviceWorker.ts).
self.addEventListener("install", (event) => {
  event.waitUntil(handlers.install());
});

self.addEventListener("message", (event) => {
  if (isSkipWaitingMessage(event.data)) event.waitUntil(self.skipWaiting());
});

// clients.claim(): on the very first install it lets the first session already store the
// MediaPipe files in the runtime cache. Safe: that page requests the same hashed files the
// precache holds, unknown ones go to the network untouched. After a user-requested update it
// also takes over the old pages; the requesting page reloads, other tabs of the old build may
// then fail to load a lazy chunk and show the error screen with "Zur Startseite" (rare, accepted).
self.addEventListener("activate", (event) => {
  event.waitUntil(handlers.activate().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const response = handlers.handleFetch(event.request, (p) => event.waitUntil(p));
  if (response) event.respondWith(response);
});
