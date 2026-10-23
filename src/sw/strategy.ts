// Pure service-worker logic (no globals): shared by src/sw/sw.ts and the Vitest tests.
// Only types that exist in both the DOM and the WebWorker lib are used here.

/** All our Cache Storage entries start with this; activate only ever deletes these. */
export const CACHE_PREFIX = "dancebeat-";

/**
 * Precache: app shell of exactly one build (index.html, hashed JS/CSS/fonts, manifest, icons).
 * Keyed by the build version so a new build never mixes files with an old one.
 */
export const precacheName = (version: string): string => `${CACHE_PREFIX}precache-${version}`;

/**
 * Runtime cache for the MediaPipe WASM runtime and pose models (13 MB WASM + 5.8 MB lite +
 * 9 MB full; only the WASM variant and the models the device actually loads). Keyed by a hash
 * of the MediaPipe files only (everything below mediapipe/, models included), not by the app
 * build: an app-only deploy keeps the cached files, while an @mediapipe/tasks-vision upgrade or
 * a new model changes the hash, so stale WASM is never served next to a newer JS glue file.
 */
export const mediapipeCacheName = (version: string): string =>
  `${CACHE_PREFIX}mediapipe-${version}`;

/** Path prefixes (relative to base) that go to the MediaPipe runtime cache. */
export const RUNTIME_PREFIXES = ["mediapipe/wasm/", "mediapipe/models/"] as const;

export type RequestKind = "network-only" | "navigation" | "precache" | "runtime";

export interface RequestInfo {
  method: string;
  url: string;
  mode: string;
  /** Value of the Range header, if any (media elements and partial fetches). */
  range: string | null;
}

export interface ClassifyContext {
  /** Origin of the service worker (self.location.origin). */
  origin: string;
  /** Absolute app base path, e.g. "/" or "/app/". */
  base: string;
  /** Precached absolute paths, e.g. "/assets/index-abc.js". */
  precache: ReadonlySet<string>;
}

/**
 * Decides how a request is handled. "network-only" means: do not call respondWith, the browser
 * handles it as if there were no service worker (cross-origin YouTube/Spotify/audio URLs,
 * blob:/data:, non-GET, Range requests, unknown same-origin files). "navigation" is answered
 * with the worker's own precached index.html (app shell), so the page always matches the build
 * of the worker that controls it.
 */
export function classifyRequest(req: RequestInfo, ctx: ClassifyContext): RequestKind {
  if (req.method !== "GET") return "network-only";
  if (req.range !== null) return "network-only";
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return "network-only";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "network-only";
  if (url.origin !== ctx.origin) return "network-only";
  // The base without its trailing slash ("/app" for "/app/") is the app root as well.
  const isBaseRoot = ctx.base.length > 1 && url.pathname === ctx.base.slice(0, -1);
  if (!isBaseRoot && !url.pathname.startsWith(ctx.base)) return "network-only";
  if (req.mode === "navigate") return "navigation";
  if (isBaseRoot) return "network-only";
  const rel = url.pathname.slice(ctx.base.length);
  if (RUNTIME_PREFIXES.some((p) => rel.startsWith(p))) return "runtime";
  // Precached files are stored without query; anything with a query goes to the network.
  if (url.search === "" && ctx.precache.has(url.pathname)) return "precache";
  return "network-only";
}

/** Only complete, readable responses are stored (no 206 partials, no opaque, no errors). */
export function isCacheable(res: Pick<Response, "ok" | "status" | "type">): boolean {
  return res.ok && res.status === 200 && res.type !== "opaque" && res.type !== "opaqueredirect";
}

/** Caches to delete on activate: ours (by prefix) that the current build does not use. */
export function staleCaches(names: readonly string[], keep: readonly string[]): string[] {
  return names.filter((n) => n.startsWith(CACHE_PREFIX) && !keep.includes(n));
}

/**
 * Message a page posts to a waiting worker when the user taps "Neu laden" (Etappe 7b-3): only
 * then does the new build skip waiting. The page reloads on the following `controllerchange`.
 */
export const SKIP_WAITING_MESSAGE = "dancebeat-skip-waiting";

/** Whether a `message` event's data asks the worker to skip waiting. */
export const isSkipWaitingMessage = (data: unknown): boolean => data === SKIP_WAITING_MESSAGE;
