// Request/Response are Node's own (undici); jsdom does not replace them.
import { describe, expect, it, vi } from "vitest";

import { createHandlers, type SwManifest } from "@/sw/handlers";
import {
  classifyRequest,
  isCacheable,
  mediapipeCacheName,
  precacheName,
  staleCaches,
  type RequestInfo,
} from "@/sw/strategy";

const ORIGIN = "https://dance.local";
const ctx = {
  origin: ORIGIN,
  base: "/",
  precache: new Set(["/index.html", "/assets/index-abc.js", "/manifest.webmanifest"]),
};
const req = (url: string, over: Partial<RequestInfo> = {}): RequestInfo => ({
  method: "GET",
  url,
  mode: "cors",
  range: null,
  ...over,
});

describe("classifyRequest", () => {
  it("lässt Nicht-GET, Range, fremde Origins und blob:/data: an den Browser", () => {
    expect(classifyRequest(req(`${ORIGIN}/assets/index-abc.js`, { method: "POST" }), ctx)).toBe(
      "network-only",
    );
    expect(classifyRequest(req(`${ORIGIN}/assets/index-abc.js`, { range: "bytes=0-" }), ctx)).toBe(
      "network-only",
    );
    expect(classifyRequest(req("https://www.youtube.com/iframe_api"), ctx)).toBe("network-only");
    expect(classifyRequest(req("https://example.com/song.mp3", { mode: "no-cors" }), ctx)).toBe(
      "network-only",
    );
    expect(classifyRequest(req("blob:https://dance.local/1234"), ctx)).toBe("network-only");
    expect(classifyRequest(req("data:text/plain,hi"), ctx)).toBe("network-only");
    expect(classifyRequest(req("kaputt"), ctx)).toBe("network-only");
  });

  it("erkennt Navigationen, auch Deep Links", () => {
    expect(classifyRequest(req(`${ORIGIN}/`, { mode: "navigate" }), ctx)).toBe("navigation");
    expect(classifyRequest(req(`${ORIGIN}/setup/xyz`, { mode: "navigate" }), ctx)).toBe(
      "navigation",
    );
    expect(classifyRequest(req("https://other.example/", { mode: "navigate" }), ctx)).toBe(
      "network-only",
    );
  });

  it("bedient vorgeladene Dateien nur ohne Query", () => {
    expect(classifyRequest(req(`${ORIGIN}/assets/index-abc.js`), ctx)).toBe("precache");
    expect(classifyRequest(req(`${ORIGIN}/assets/index-abc.js?v=2`), ctx)).toBe("network-only");
    expect(classifyRequest(req(`${ORIGIN}/assets/index-new.js`), ctx)).toBe("network-only");
    expect(classifyRequest(req(`${ORIGIN}/robots.txt`), ctx)).toBe("network-only");
  });

  it("legt MediaPipe-WASM und Modelle in den Laufzeit-Cache", () => {
    expect(classifyRequest(req(`${ORIGIN}/mediapipe/wasm/vision_wasm_internal.wasm`), ctx)).toBe(
      "runtime",
    );
    expect(classifyRequest(req(`${ORIGIN}/mediapipe/models/pose_landmarker_lite.task`), ctx)).toBe(
      "runtime",
    );
    // A Range request for the model still bypasses the worker.
    expect(
      classifyRequest(
        req(`${ORIGIN}/mediapipe/models/pose_landmarker_lite.task`, { range: "bytes=0-9" }),
        ctx,
      ),
    ).toBe("network-only");
  });

  it("beachtet einen Basis-Pfad", () => {
    const sub = { ...ctx, base: "/app/", precache: new Set(["/app/index.html"]) };
    expect(classifyRequest(req(`${ORIGIN}/app/index.html`), sub)).toBe("precache");
    expect(classifyRequest(req(`${ORIGIN}/app/mediapipe/wasm/x.wasm`), sub)).toBe("runtime");
    expect(classifyRequest(req(`${ORIGIN}/mediapipe/wasm/x.wasm`), sub)).toBe("network-only");
    expect(classifyRequest(req(`${ORIGIN}/other`, { mode: "navigate" }), sub)).toBe("network-only");
  });

  it("behandelt den Basis-Pfad ohne Schrägstrich als Navigation", () => {
    const sub = { ...ctx, base: "/app/", precache: new Set(["/app/index.html"]) };
    expect(classifyRequest(req(`${ORIGIN}/app`, { mode: "navigate" }), sub)).toBe("navigation");
    expect(classifyRequest(req(`${ORIGIN}/app`), sub)).toBe("network-only");
    expect(classifyRequest(req(`${ORIGIN}/apple`, { mode: "navigate" }), sub)).toBe("network-only");
  });
});

describe("Cache-Hilfen", () => {
  it("speichert nur vollständige, lesbare Antworten", () => {
    expect(isCacheable({ ok: true, status: 200, type: "basic" })).toBe(true);
    expect(isCacheable({ ok: true, status: 206, type: "basic" })).toBe(false);
    expect(isCacheable({ ok: false, status: 404, type: "basic" })).toBe(false);
    expect(isCacheable({ ok: false, status: 0, type: "opaque" })).toBe(false);
  });

  it("löscht nur eigene, veraltete Caches", () => {
    const keep = [precacheName("new"), mediapipeCacheName("mp1")];
    const names = [
      precacheName("old"),
      precacheName("new"),
      mediapipeCacheName("mp0"),
      mediapipeCacheName("mp1"),
      "fremde-app-cache",
    ];
    expect(staleCaches(names, keep)).toEqual([precacheName("old"), mediapipeCacheName("mp0")]);
  });
});

// --- Handlers with fake caches and fetch -----------------------------------------------------

const keyOf = (r: Request | string | URL): string =>
  typeof r === "string" ? r : r instanceof URL ? r.href : r.url;

function fakeCaches(fetchFn: (r: Request) => Promise<Response>) {
  const store = new Map<string, Map<string, Response>>();
  const cacheFor = (entries: Map<string, Response>) => ({
    match: (r: Request | string) => {
      const hit = entries.get(keyOf(r));
      const copy = hit?.clone();
      // clone() drops the faked `redirected` flag (see markRedirected); keep it like a real cache.
      if (copy && hit?.redirected) markRedirected(copy);
      return Promise.resolve(copy);
    },
    put: (r: Request | string, res: Response) => {
      entries.set(keyOf(r), res);
      return Promise.resolve();
    },
    addAll: async (reqs: Request[]) => {
      const responses = await Promise.all(reqs.map((r) => fetchFn(r)));
      if (responses.some((r) => !r.ok)) throw new TypeError("addAll failed");
      reqs.forEach((r, i) => entries.set(r.url, responses[i] as Response));
    },
  });
  const caches = {
    open: (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      return Promise.resolve(cacheFor(store.get(name) as Map<string, Response>));
    },
    keys: () => Promise.resolve([...store.keys()]),
    delete: (name: string) => Promise.resolve(store.delete(name)),
  };
  return { caches: caches as unknown as CacheStorage, store };
}

const manifest: SwManifest = {
  base: "/",
  precache: ["/index.html", "/assets/index-abc.js"],
  version: "v1",
  mediapipeVersion: "mp1",
};

// Responses cannot be constructed as redirected; real caches keep the flag of the fetch.
function markRedirected(res: Response): Response {
  Object.defineProperty(res, "redirected", { value: true });
  return res;
}

// The Request constructor rejects mode "navigate" (only browsers create those): override it.
function makeRequest(url: string, { mode, ...init }: RequestInit): Request {
  const request = new Request(url, init);
  if (mode) Object.defineProperty(request, "mode", { value: mode });
  return request;
}

function setup() {
  let online = true;
  const fetchFn = vi.fn(async (r: Request): Promise<Response> => {
    if (!online) throw new TypeError("Failed to fetch");
    const { pathname } = new URL(r.url);
    if (pathname.endsWith("/missing.task")) return new Response("nope", { status: 404 });
    return new Response(`net:${pathname}`, { status: 200 });
  });
  const { caches, store } = fakeCaches(fetchFn);
  const handlers = createHandlers({ caches, fetch: fetchFn, origin: ORIGIN, manifest });
  const pending: Promise<unknown>[] = [];
  const handle = (url: string, init: RequestInit = {}) =>
    handlers.handleFetch(makeRequest(url, init), (p) => pending.push(p));
  return {
    handlers,
    store,
    fetchFn,
    handle,
    flush: () => Promise.all(pending),
    goOffline: () => {
      online = false;
    },
  };
}

describe("Service-Worker-Handler", () => {
  it("lädt beim Install alle Dateien mit cache: reload vor", async () => {
    const { handlers, store, fetchFn } = setup();
    await handlers.install();
    const cache = store.get(precacheName("v1"));
    expect([...(cache?.keys() ?? [])]).toEqual([
      `${ORIGIN}/index.html`,
      `${ORIGIN}/assets/index-abc.js`,
    ]);
    expect(fetchFn.mock.calls.every(([r]) => r.cache === "reload")).toBe(true);
  });

  it("räumt beim Activate alte Versionen ab, behält aktuelle und fremde Caches", async () => {
    const { handlers, store } = setup();
    for (const name of [precacheName("v0"), mediapipeCacheName("mp0"), "fremd"]) {
      store.set(name, new Map());
    }
    await handlers.install();
    store.set(mediapipeCacheName("mp1"), new Map());
    await handlers.activate();
    expect([...store.keys()].sort()).toEqual(
      ["fremd", mediapipeCacheName("mp1"), precacheName("v1")].sort(),
    );
  });

  it("liefert vorgeladene Dateien aus dem Cache, auch offline", async () => {
    const { handlers, handle, goOffline } = setup();
    await handlers.install();
    goOffline();
    const res = await handle(`${ORIGIN}/assets/index-abc.js`);
    expect(await res?.text()).toBe("net:/assets/index-abc.js");
  });

  it("Navigation: liefert die eigene Shell aus dem Cache, auch wenn das Netz anderes hätte", async () => {
    const { handlers, handle, fetchFn } = setup();
    await handlers.install();
    fetchFn.mockClear();
    // Online, the network would answer with a newer build; the worker keeps its own shell.
    for (const url of [`${ORIGIN}/`, `${ORIGIN}/setup/xyz`]) {
      const res = await handle(url, { mode: "navigate" });
      expect(await res?.text()).toBe("net:/index.html");
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("Navigation: auch offline aus dem Cache", async () => {
    const { handlers, handle, goOffline } = setup();
    await handlers.install();
    goOffline();
    const res = await handle(`${ORIGIN}/setup/xyz`, { mode: "navigate" });
    expect(await res?.text()).toBe("net:/index.html");
  });

  it("Navigation: ohne Shell im Cache vom Netz, offline mit Netzfehler", async () => {
    const { handle, goOffline } = setup();
    const online = await handle(`${ORIGIN}/setup/xyz`, { mode: "navigate" });
    expect(await online?.text()).toBe("net:/setup/xyz");
    goOffline();
    await expect(handle(`${ORIGIN}/`, { mode: "navigate" })).rejects.toThrow("Failed to fetch");
  });

  it("Navigation: verpackt eine umgeleitete Shell neu (Pretty-URL-Hosts)", async () => {
    const { store, handle } = setup();
    const shell = markRedirected(
      new Response("<html>shell</html>", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/html" },
      }),
    );
    store.set(precacheName("v1"), new Map([[`${ORIGIN}/index.html`, shell]]));
    const res = await handle(`${ORIGIN}/setup/xyz`, { mode: "navigate" });
    expect(res?.redirected).toBe(false);
    expect(res?.status).toBe(200);
    expect(res?.statusText).toBe("OK");
    expect(res?.headers.get("Content-Type")).toBe("text/html");
    expect(await res?.text()).toBe("<html>shell</html>");
  });

  it("speichert MediaPipe-Dateien beim ersten erfolgreichen Abruf", async () => {
    const { store, handle, fetchFn, flush, goOffline } = setup();
    const url = `${ORIGIN}/mediapipe/wasm/vision_wasm_internal.wasm`;
    expect(await (await handle(url))?.text()).toBe("net:/mediapipe/wasm/vision_wasm_internal.wasm");
    await flush();
    expect([...(store.get(mediapipeCacheName("mp1"))?.keys() ?? [])]).toEqual([url]);
    goOffline();
    expect(await (await handle(url))?.text()).toBe("net:/mediapipe/wasm/vision_wasm_internal.wasm");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("speichert keine Fehlerantworten im Laufzeit-Cache", async () => {
    const { store, handle, flush } = setup();
    const res = await handle(`${ORIGIN}/mediapipe/models/missing.task`);
    expect(res?.status).toBe(404);
    await flush();
    expect(store.get(mediapipeCacheName("mp1"))?.size).toBe(0);
  });

  it("lässt fremde und unbekannte Anfragen unangetastet", () => {
    const { handle } = setup();
    expect(handle("https://www.youtube.com/iframe_api")).toBeNull();
    expect(handle(`${ORIGIN}/assets/index-abc.js`, { method: "POST", body: "x" })).toBeNull();
    expect(handle(`${ORIGIN}/assets/index-abc.js`, { headers: { Range: "bytes=0-" } })).toBeNull();
    expect(handle(`${ORIGIN}/assets/unknown.js`)).toBeNull();
  });
});
