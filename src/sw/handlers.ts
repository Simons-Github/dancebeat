// Service-worker event logic with injected dependencies (caches, fetch), so it runs in Vitest
// with simple fakes. src/sw/sw.ts only wires these to the real events.

import {
  classifyRequest,
  isCacheable,
  mediapipeCacheName,
  precacheName,
  staleCaches,
  type RequestKind,
} from "./strategy";

/** Injected at build time by vite-plugins/serviceWorker.ts. */
export interface SwManifest {
  /** Absolute app base path ("/" or "/app/"). */
  base: string;
  /** Absolute paths to precache, e.g. "/index.html", "/assets/index-abc.js". */
  precache: string[];
  /** Hash over the precached files' contents. */
  version: string;
  /** Hash over the shipped MediaPipe WASM runtime and models. */
  mediapipeVersion: string;
}

export interface SwDeps {
  caches: CacheStorage;
  fetch: (request: Request) => Promise<Response>;
  origin: string;
  manifest: SwManifest;
}

export interface SwHandlers {
  install(): Promise<void>;
  activate(): Promise<void>;
  /**
   * Returns a response promise for requests we handle, or null to let the browser handle the
   * request itself (no respondWith). `waitUntil` keeps background cache writes alive.
   */
  handleFetch(request: Request, waitUntil: (p: Promise<unknown>) => void): Promise<Response> | null;
  classify(request: Request): RequestKind;
}

export function createHandlers({ caches, fetch, origin, manifest }: SwDeps): SwHandlers {
  const precache = new Set(manifest.precache);
  const shellCache = precacheName(manifest.version);
  const runtimeCache = mediapipeCacheName(manifest.mediapipeVersion);
  // Cache keys are absolute URLs (what request.url is), independent of the worker's location.
  const absolute = (path: string): string => new URL(path, origin).href;
  const indexUrl = absolute(`${manifest.base}index.html`);

  const classify = (request: Request): RequestKind =>
    classifyRequest(
      {
        method: request.method,
        url: request.url,
        mode: request.mode,
        range: request.headers.get("range"),
      },
      { origin, base: manifest.base, precache },
    );

  // App shell, cache first: every in-scope navigation (also deep links like /setup/xyz) gets
  // the index.html of THIS worker's build, the client router takes over from there. So the page
  // always matches the worker's precache and MediaPipe runtime cache, online or offline, and a
  // flaky connection cannot stall the start. New builds arrive via the normal service-worker
  // lifecycle (see sw.ts). Network only if the shell is not cached (e.g. evicted).
  async function navigation(request: Request): Promise<Response> {
    const cached = await (await caches.open(shellCache)).match(indexUrl);
    if (!cached) return fetch(request);
    // Hosts with pretty URLs answer /index.html with 30x -> /. respondWith() rejects a
    // redirected response for navigations, so re-wrap it as a fresh, non-redirected one.
    if (!cached.redirected) return cached;
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: cached.headers,
    });
  }

  // Cache first; a miss (e.g. evicted entry) goes to the network without re-storing.
  async function precached(request: Request): Promise<Response> {
    const cached = await (await caches.open(shellCache)).match(request.url);
    return cached ?? fetch(request);
  }

  // Cache first, filled lazily: only the WASM variant and model this device loads get stored.
  async function runtime(
    request: Request,
    waitUntil: (p: Promise<unknown>) => void,
  ): Promise<Response> {
    const cache = await caches.open(runtimeCache);
    const cached = await cache.match(request.url);
    if (cached) return cached;
    const response = await fetch(request);
    if (isCacheable(response)) {
      // Not awaited: the page streams the response while the copy is written. Quota errors
      // (iOS) are ignored, the file is then simply fetched again next time.
      waitUntil(cache.put(request.url, response.clone()).catch(() => undefined));
    }
    return response;
  }

  return {
    classify,
    async install() {
      const cache = await caches.open(shellCache);
      // cache: "reload" bypasses the HTTP cache, so index.html cannot be an older build.
      await cache.addAll(
        manifest.precache.map((p) => new Request(absolute(p), { cache: "reload" })),
      );
    },
    async activate() {
      const stale = staleCaches(await caches.keys(), [shellCache, runtimeCache]);
      await Promise.all(stale.map((name) => caches.delete(name)));
    },
    handleFetch(request, waitUntil) {
      switch (classify(request)) {
        case "navigation":
          return navigation(request);
        case "precache":
          return precached(request);
        case "runtime":
          return runtime(request, waitUntil);
        case "network-only":
          return null;
      }
    },
  };
}
