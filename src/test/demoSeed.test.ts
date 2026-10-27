import { createHash } from "node:crypto";

import { IDBFactory } from "fake-indexeddb";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import goldInMyPocket from "@/data/demos/gold-in-my-pocket.manifest.json";
import goldOnTheGlass from "@/data/demos/gold-on-the-glass.manifest.json";
import lemonadeSkies from "@/data/demos/lemonade-skies.manifest.json";
import riseUntilTheMorning from "@/data/demos/rise-until-the-morning.manifest.json";
import { demoSongId } from "@/lib/demoBuild";
import { DemoManifestSchema } from "@/lib/demoManifest";
import type { SongRepository } from "@/lib/library/repository";
import { SongSchema } from "@/lib/schema";
import type { Song } from "@/lib/types";
import { makeChoreo, makeSong } from "./fixtures";

type DemoModule = typeof import("@/data/demo");

const DEMOS = [goldInMyPocket, goldOnTheGlass, lemonadeSkies, riseUntilTheMorning].map((raw) => {
  const m = DemoManifestSchema.parse(raw);
  return { id: demoSongId(m.id), file: m.audio, title: m.title };
});
const ALL = DEMOS.map((d) => d.id).sort();
const FILES = DEMOS.map((d) => d.file).sort();
const FIRST = DEMOS[0]!.id;
const OTHERS = DEMOS.slice(1).map((d) => d.id);
const without = (id: string) => ALL.filter((x) => x !== id);
/** Per-demo choreography marker with the current version for `ids`. */
const choreoMarker = (ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, demo.DEMO_CHOREO_VERSION]));
const storedChoreoMarker = () => JSON.parse(localStorage.getItem(CHOREO_KEY) ?? "null") as unknown;

const PINK = "d4e0c1a2-0001-4000-8000-000000000001";
const SUNSET = "d4e0c1a2-0002-4000-8000-000000000002";
const DELETED_KEY = "dancebeat.deletedDemos";
const AUDIO_KEY = "dancebeat.demoAudioVersion";
const CHOREO_KEY = "dancebeat.demoChoreoVersions";

// jsdom's Blob does not survive fake-indexeddb's structured clone; the repository does not
// inspect the stored audio, so a string stands in for the MP3.
const audio = (tag: string) => tag as unknown as Blob;
const loadAudio = vi.fn((file: string) => Promise.resolve(audio(`mp3:${file}`)));
const restoreLoadAudio = () =>
  loadAudio.mockImplementation((file: string) => Promise.resolve(audio(`mp3:${file}`)));

let repo: SongRepository;
let demo: DemoModule;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules(); // fresh DB connection and in-flight state per test
  repo = (await import("@/lib/library/repository")).songRepository;
  demo = await import("@/data/demo");
  restoreLoadAudio();
  loadAudio.mockClear();
});

afterEach(() => localStorage.clear());

const ids = async () => (await repo.list()).map((s) => s.id).sort();
const calledFiles = () => loadAudio.mock.calls.map(([f]) => f).sort();

/** Former synthesized demo as the old seed stored it: demo audio, unedited choreo. */
const legacySong = (id: string): Song => ({
  ...makeSong(),
  id,
  title: id === PINK ? "Pink Pulse" : "Sunset Kick",
  artist: "DanceBeat Demo",
  source: { type: "local", blobId: id },
});

describe("seedDemos", () => {
  it("seeds all four demos into a fresh library", async () => {
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual(ALL);
    expect([...demo.DEMO_IDS].sort()).toEqual(ALL);
    expect(calledFiles()).toEqual(FILES);
    for (const d of DEMOS) {
      expect(await repo.getAudio(d.id)).toBe(`mp3:${d.file}`);
      const song = await repo.get(d.id);
      expect(SongSchema.safeParse(song).success, d.title).toBe(true);
      expect(song).toMatchObject({ title: d.title, source: { type: "local", blobId: d.id } });
      expect(song?.createdAt).toBeGreaterThan(0);
      expect(song?.choreo.createdAt).toBeGreaterThan(0);
      expect(song?.choreo.updatedAt).toBe(song?.choreo.createdAt);
    }
  });

  it("does not overwrite an existing demo while both versions are current", async () => {
    await demo.seedDemos(repo, loadAudio);
    const first = await repo.get(FIRST);
    if (!first) throw new Error("demo missing");
    await repo.save({ ...first, highscore: 9000, stars: 4 });
    localStorage.clear();
    localStorage.setItem(AUDIO_KEY, String(demo.DEMO_AUDIO_VERSION));
    localStorage.setItem(CHOREO_KEY, JSON.stringify(choreoMarker(ALL)));

    await demo.seedDemos(repo, loadAudio);
    expect(await repo.get(FIRST)).toMatchObject({ highscore: 9000, stars: 4 });
    expect(loadAudio).toHaveBeenCalledTimes(4); // nothing downloaded the second time
  });

  it("does not re-seed a demo the player deleted", async () => {
    await demo.seedDemos(repo, loadAudio);
    await repo.delete(FIRST);
    demo.markDemoDeleted(FIRST);

    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual(without(FIRST));
    expect(demo.getDeletedDemos()).toEqual([FIRST]);
  });

  it("re-seeds missing demos after the database was wiped", async () => {
    await demo.seedDemos(repo, loadAudio);
    localStorage.setItem("dancebeat.seeded", "1"); // stale marker of the old rule
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    repo = (await import("@/lib/library/repository")).songRepository;
    demo = await import("@/data/demo");

    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual(ALL);
    expect(localStorage.getItem("dancebeat.seeded")).toBeNull();
  });

  it("shares one run between concurrent calls", async () => {
    const save = vi.spyOn(repo, "save");
    const a = demo.seedDemos(repo, loadAudio);
    const b = demo.seedDemos(repo, loadAudio);
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(calledFiles()).toEqual(FILES); // once per demo
    expect(save).toHaveBeenCalledTimes(4);
    // A later call starts a new run (and finds nothing to do).
    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).toHaveBeenCalledTimes(4);
  });

  it("does not save a demo deleted while its audio was downloading", async () => {
    let release = () => {};
    loadAudio.mockImplementation((file: string) =>
      file === DEMOS[0]!.file
        ? new Promise<Blob>((resolve) => {
            release = () => resolve(audio("late"));
          })
        : Promise.resolve(audio(`mp3:${file}`)),
    );
    const run = demo.seedDemos(repo, loadAudio);
    await vi.waitFor(() => expect(loadAudio).toHaveBeenCalledTimes(4));
    demo.markDemoDeleted(FIRST);
    release();
    await run;
    expect(await ids()).toEqual(without(FIRST));
  });

  it("skips only a failing demo, warns and adds it on the next seed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadAudio.mockImplementation((file: string) =>
      file === DEMOS[0]!.file
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(audio(`mp3:${file}`)),
    );
    await expect(demo.seedDemos(repo, loadAudio)).resolves.toBeUndefined();
    expect(await ids()).toEqual(without(FIRST));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    restoreLoadAudio();
    loadAudio.mockClear();
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual(ALL);
    expect(calledFiles()).toEqual([DEMOS[0]!.file]);
  });

  it.each(["{kaputt", '{"a":1}', "[1,2]", '"text"', "null"])(
    "treats an unusable deleted list (%s) as empty",
    async (raw) => {
      localStorage.setItem(DELETED_KEY, raw);
      expect(demo.getDeletedDemos()).toEqual([]);
      await demo.seedDemos(repo, loadAudio);
      expect(await ids()).toEqual(ALL);
    },
  );

  it("survives a localStorage that throws", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(demo.getDeletedDemos()).toEqual([]);
      await demo.seedDemos(repo, loadAudio);
      expect(await ids()).toEqual(ALL);
    } finally {
      get.mockRestore();
    }
  });
});

describe("default audio loader", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Minimal fetch response; `type` is the Content-Type header. */
  const response = (url: string, type = "audio/mpeg", ok = true) => ({
    ok,
    status: ok ? 200 : 404,
    headers: new Headers(type ? { "Content-Type": type } : {}),
    blob: () => Promise.resolve(audio(url)),
  });

  it("fetches the MP3s from the app's own origin", async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(response(url)));
    vi.stubGlobal("fetch", fetchMock);
    await demo.seedDemos(repo);
    const urls = fetchMock.mock.calls.map(([u]) => u).sort();
    expect(urls).toEqual(FILES.map((f) => `${import.meta.env.BASE_URL}demo-audio/${f}`));
    expect(await ids()).toEqual(ALL);
  });

  it("treats an HTTP error as a failed demo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", (url: string) => Promise.resolve(response(url, "audio/mpeg", false)));
    await demo.seedDemos(repo);
    expect(await ids()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it("treats the SPA fallback (200 with index.html) as a failed demo and retries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = DEMOS[0]!.file;
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(url.endsWith(missing) ? response(url, "text/html") : response(url)),
    );
    await demo.seedDemos(repo);
    expect(await ids()).toEqual(without(FIRST));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    vi.stubGlobal("fetch", (url: string) => Promise.resolve(response(url)));
    await demo.seedDemos(repo);
    expect(await ids()).toEqual(ALL);
  });

  it("rejects a response without content type", async () => {
    vi.stubGlobal("fetch", (url: string) => Promise.resolve(response(url, "")));
    await expect(demo.fetchDemoAudio("a.mp3")).rejects.toThrow("expected audio");
  });

  it("aborts a stalled download after the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(demo.fetchDemoAudio("a.mp3", 10)).rejects.toThrow("aborted");
  });

  it("uses a generous default timeout", () => {
    expect(demo.DEMO_AUDIO_TIMEOUT_MS).toBe(60_000);
  });
});

describe("invalid choreography", () => {
  afterEach(() => vi.doUnmock("@/data/demos/gold-in-my-pocket.choreo.json"));

  it("skips a demo whose choreography fails the schema", async () => {
    vi.doMock("@/data/demos/gold-in-my-pocket.choreo.json", () => ({ default: { id: 1 } }));
    vi.resetModules();
    repo = (await import("@/lib/library/repository")).songRepository;
    demo = await import("@/data/demo");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual(without(FIRST));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("legacy demos", () => {
  it("removes untouched former demos without marking them deleted", async () => {
    await repo.save(legacySong(PINK), audio("wav"));
    await repo.save(legacySong(SUNSET), audio("wav"));
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual(ALL);
    expect(await repo.getAudio(PINK)).toBeUndefined();
    expect(demo.getDeletedDemos()).toEqual([]);
    expect(demo.isDemoId(PINK)).toBe(false);
  });

  it("keeps a former demo whose choreography was edited", async () => {
    const choreo = { ...makeChoreo(), createdAt: 1, updatedAt: 2 };
    await repo.save({ ...legacySong(PINK), choreo }, audio("wav"));
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual([...ALL, PINK].sort());
  });

  it.each([
    ["renamed", { title: "Mein Pink" }],
    ["new artist", { artist: "Ich" }],
    ["calibrated", { syncOffsetMs: 80 }],
    ["with start offset", { startOffsetMs: 3000 }],
    ["with playback rate", { playbackRate: 0.75 }],
  ] satisfies [string, Partial<Song>][])("keeps a former demo %s", async (_, change) => {
    await repo.save({ ...legacySong(PINK), ...change }, audio("wav"));
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual([...ALL, PINK].sort());
  });

  it("keeps a former demo whose audio source the player replaced", async () => {
    await repo.save({
      ...legacySong(SUNSET),
      source: { type: "url", url: "https://example.com/a.mp3" },
    });
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual([...ALL, SUNSET].sort());
  });
});

describe("demo audio upgrade", () => {
  /** Library seeded with older audio: demos present, no version marker. */
  async function seedOldLibrary() {
    loadAudio.mockImplementation(() => Promise.resolve(audio("old")));
    await demo.seedDemos(repo, loadAudio);
    localStorage.removeItem(AUDIO_KEY);
    restoreLoadAudio();
    loadAudio.mockClear();
  }

  it("sets the marker on a fresh install without extra downloads", async () => {
    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem(AUDIO_KEY)).toBe(String(demo.DEMO_AUDIO_VERSION));
  });

  it("replaces the audio of existing demos once and keeps their song data", async () => {
    await seedOldLibrary();
    const first = await repo.get(FIRST);
    if (!first) throw new Error("demo missing");
    await repo.save({ ...first, title: "Mein Demo", syncOffsetMs: 80, highscore: 9000, stars: 4 });

    await demo.seedDemos(repo, loadAudio);
    expect(calledFiles()).toEqual(FILES);
    for (const d of DEMOS) expect(await repo.getAudio(d.id)).toBe(`mp3:${d.file}`);
    expect(await repo.get(FIRST)).toMatchObject({
      title: "Mein Demo",
      syncOffsetMs: 80,
      highscore: 9000,
      stars: 4,
      createdAt: first.createdAt,
    });
    expect(localStorage.getItem(AUDIO_KEY)).toBe(String(demo.DEMO_AUDIO_VERSION));

    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).toHaveBeenCalledTimes(4); // second run: nothing to upgrade
  });

  it.each(["{kaputt", "0", '"2"', "1.5"])(
    "treats an invalid marker (%s) as version 1",
    async (raw) => {
      await seedOldLibrary();
      localStorage.setItem(AUDIO_KEY, raw);
      await demo.seedDemos(repo, loadAudio);
      expect(loadAudio).toHaveBeenCalledTimes(4);
      expect(await repo.getAudio(FIRST)).toBe(`mp3:${DEMOS[0]!.file}`);
    },
  );

  it("neither re-adds nor upgrades a deleted demo", async () => {
    await seedOldLibrary();
    await repo.delete(FIRST);
    demo.markDemoDeleted(FIRST);
    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).toHaveBeenCalledTimes(3);
    expect(await ids()).toEqual(without(FIRST));
    expect(await repo.getAudio(FIRST)).toBeUndefined();
  });

  it("keeps changes saved while the new audio was downloading", async () => {
    await seedOldLibrary();
    let release = () => {};
    loadAudio.mockImplementation((file: string) =>
      file === DEMOS[0]!.file
        ? new Promise<Blob>((resolve) => {
            release = () => resolve(audio("new"));
          })
        : Promise.resolve(audio(`mp3:${file}`)),
    );
    const run = demo.seedDemos(repo, loadAudio);
    await vi.waitFor(() => expect(loadAudio).toHaveBeenCalledTimes(4));
    const first = await repo.get(FIRST);
    if (!first) throw new Error("demo missing");
    await repo.save({ ...first, highscore: 1234 });
    release();
    await run;
    expect(await repo.get(FIRST)).toMatchObject({ highscore: 1234 });
    expect(await repo.getAudio(FIRST)).toBe("new");
  });

  it("does not touch a demo whose source the player replaced", async () => {
    await seedOldLibrary();
    const first = await repo.get(FIRST);
    if (!first) throw new Error("demo missing");
    await repo.save({ ...first, source: { type: "url", url: "https://example.com/a.mp3" } });
    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).toHaveBeenCalledTimes(3);
    expect(await repo.get(FIRST)).toMatchObject({ source: { type: "url" } });
  });

  it("logs a failed upgrade, keeps seeding and leaves the marker for a retry", async () => {
    await seedOldLibrary();
    await repo.delete(OTHERS[0]!); // missing demo: must still be seeded
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadAudio.mockImplementation((file: string) =>
      file === DEMOS[0]!.file
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(audio(`mp3:${file}`)),
    );
    await demo.seedDemos(repo, loadAudio);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(await ids()).toEqual(ALL);
    expect(await repo.getAudio(FIRST)).toBe("old");
    expect(localStorage.getItem(AUDIO_KEY)).toBeNull();

    restoreLoadAudio();
    loadAudio.mockClear();
    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).toHaveBeenCalledTimes(4); // the marker is global: all are fetched again
    expect(await repo.getAudio(FIRST)).toBe(`mp3:${DEMOS[0]!.file}`);
    expect(localStorage.getItem(AUDIO_KEY)).toBe(String(demo.DEMO_AUDIO_VERSION));
  });
});

describe("demo choreography upgrade", () => {
  /** Library seeded before the current choreo version: demos present, no choreo marker. */
  async function seedOldChoreos() {
    await demo.seedDemos(repo, loadAudio);
    localStorage.removeItem(CHOREO_KEY);
    loadAudio.mockClear();
  }

  /** A demo the player played and edited. */
  async function playAndEdit(id: string) {
    const song = await repo.get(id);
    if (!song) throw new Error("demo missing");
    await repo.save({
      ...song,
      title: "Mein Demo",
      syncOffsetMs: 80,
      highscore: 9000,
      stars: 4,
      choreo: { ...song.choreo, title: "Eigene", updatedAt: song.choreo.createdAt + 1 },
    });
    return song;
  }

  const expectFresh = async (id: string, title: string) => {
    const song = await repo.get(id);
    expect(song).toMatchObject({
      title,
      syncOffsetMs: 0,
      highscore: 0,
      stars: 0,
      source: { type: "local", blobId: id },
    });
    expect(song?.choreo.title).toBe(title);
    expect(song?.choreo.updatedAt).toBe(song?.choreo.createdAt);
  };

  it("sets the marker on a fresh install without extra downloads", async () => {
    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).toHaveBeenCalledTimes(4);
    expect(storedChoreoMarker()).toEqual(choreoMarker(ALL));
  });

  it("replaces existing demos completely once, reusing the current audio", async () => {
    await seedOldChoreos();
    await playAndEdit(FIRST);

    await demo.seedDemos(repo, loadAudio);
    expect(loadAudio).not.toHaveBeenCalled();
    for (const d of DEMOS) {
      await expectFresh(d.id, d.title);
      expect(await repo.getAudio(d.id)).toBe(`mp3:${d.file}`);
    }
    expect(storedChoreoMarker()).toEqual(choreoMarker(ALL));

    await playAndEdit(FIRST);
    await demo.seedDemos(repo, loadAudio);
    expect(await repo.get(FIRST)).toMatchObject({ title: "Mein Demo", highscore: 9000 });
  });

  it("keeps the library position of replaced demos", async () => {
    await seedOldChoreos();
    // Demos in reverse id order, then an own song: the library lists by createdAt.
    for (const [i, id] of [...ALL].reverse().entries()) {
      const song = await repo.get(id);
      if (!song) throw new Error("demo missing");
      await repo.save({ ...song, createdAt: 1000 + i });
    }
    const own = { ...makeSong(), createdAt: 2000 };
    await repo.save(own);
    const order = async () => (await repo.list()).map((s) => s.id);
    const before = await order();
    expect(before).toEqual([...[...ALL].reverse(), own.id]);

    await demo.seedDemos(repo, loadAudio);
    expect(await order()).toEqual(before);
    for (const d of DEMOS) await expectFresh(d.id, d.title);
    expect(storedChoreoMarker()).toEqual(choreoMarker(ALL));
  });

  it("downloads the audio once when audio and choreography are both outdated", async () => {
    loadAudio.mockImplementation(() => Promise.resolve(audio("old")));
    await demo.seedDemos(repo, loadAudio);
    localStorage.clear();
    restoreLoadAudio();
    loadAudio.mockClear();

    await demo.seedDemos(repo, loadAudio);
    expect(calledFiles()).toEqual(FILES);
    for (const d of DEMOS) expect(await repo.getAudio(d.id)).toBe(`mp3:${d.file}`);
    expect(localStorage.getItem(AUDIO_KEY)).toBe(String(demo.DEMO_AUDIO_VERSION));
    expect(storedChoreoMarker()).toEqual(choreoMarker(ALL));
  });

  it.each(["{kaputt", "2", "[2]", '{"x":0}'])(
    "treats an invalid marker (%s) as version 1 for every demo",
    async (raw) => {
      await seedOldChoreos();
      await playAndEdit(FIRST);
      localStorage.setItem(CHOREO_KEY, raw);
      await demo.seedDemos(repo, loadAudio);
      await expectFresh(FIRST, DEMOS[0]!.title);
    },
  );

  it("restores the demo audio of a demo whose source the player replaced", async () => {
    await seedOldChoreos();
    const first = await repo.get(FIRST);
    if (!first) throw new Error("demo missing");
    await repo.save({ ...first, source: { type: "url", url: "https://example.com/a.mp3" } });

    await demo.seedDemos(repo, loadAudio);
    expect(calledFiles()).toEqual([DEMOS[0]!.file]);
    await expectFresh(FIRST, DEMOS[0]!.title);
    expect(await repo.getAudio(FIRST)).toBe(`mp3:${DEMOS[0]!.file}`);
  });

  it("drops an attached dance video", async () => {
    await seedOldChoreos();
    const withVideo = await repo.setVideo(FIRST, audio("video"));
    const videoId = withVideo.videoBlobId;
    if (!videoId) throw new Error("video missing");

    await demo.seedDemos(repo, loadAudio);
    expect((await repo.get(FIRST))?.videoBlobId).toBeUndefined();
    expect(await repo.getVideo(videoId)).toBeUndefined();
  });

  it("neither re-adds nor replaces a deleted demo", async () => {
    await seedOldChoreos();
    await repo.delete(FIRST);
    demo.markDemoDeleted(FIRST);
    await demo.seedDemos(repo, loadAudio);
    expect(await ids()).toEqual(without(FIRST));
  });

  it("logs a failed replacement, keeps the old demo and retries only that one", async () => {
    await seedOldChoreos();
    const first = await repo.get(FIRST);
    if (!first) throw new Error("demo missing");
    await repo.save({ ...first, source: { type: "url", url: "https://example.com/a.mp3" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadAudio.mockImplementation(() => Promise.reject(new Error("offline")));

    await demo.seedDemos(repo, loadAudio);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(await repo.get(FIRST)).toMatchObject({ source: { type: "url" } });
    expect(storedChoreoMarker()).toEqual(choreoMarker(OTHERS));

    // The seed runs again after every library write: replaced demos keep new progress.
    await playAndEdit(OTHERS[0]!);
    restoreLoadAudio();
    await demo.seedDemos(repo, loadAudio);
    await expectFresh(FIRST, DEMOS[0]!.title);
    expect(await repo.get(OTHERS[0]!)).toMatchObject({ title: "Mein Demo", highscore: 9000 });
    expect(storedChoreoMarker()).toEqual(choreoMarker(ALL));
  });

  it("does not replace a demo deleted while its audio was downloading", async () => {
    await seedOldChoreos();
    localStorage.removeItem(AUDIO_KEY); // forces a download per demo
    let release = () => {};
    loadAudio.mockImplementation((file: string) =>
      file === DEMOS[0]!.file
        ? new Promise<Blob>((resolve) => {
            release = () => resolve(audio("late"));
          })
        : Promise.resolve(audio(`mp3:${file}`)),
    );
    const run = demo.seedDemos(repo, loadAudio);
    await vi.waitFor(() => expect(loadAudio).toHaveBeenCalledTimes(4));
    demo.markDemoDeleted(FIRST);
    await repo.delete(FIRST);
    release();
    await run;
    expect(await ids()).toEqual(without(FIRST));
  });
});

describe("DEMO_CHOREO_VERSION", () => {
  // Fingerprint of the shipped choreographies at the current DEMO_CHOREO_VERSION. When the test
  // fails, the demos were rebuilt: raise DEMO_CHOREO_VERSION (src/data/demo.ts) so existing
  // libraries get them, then update both values here.
  const FINGERPRINT = {
    version: 5,
    sha256: "0fcebeffcb063b46a9b8284ac09bf63ddbd86c5a7fb7b9871984d56556f11347",
  };

  it("is raised whenever a shipped choreography changes", async () => {
    const files = await Promise.all([
      import("@/data/demos/gold-in-my-pocket.choreo.json"),
      import("@/data/demos/gold-on-the-glass.choreo.json"),
      import("@/data/demos/lemonade-skies.choreo.json"),
      import("@/data/demos/rise-until-the-morning.choreo.json"),
    ]);
    const hash = createHash("sha256");
    for (const f of files) hash.update(JSON.stringify(f.default));
    expect({ version: demo.DEMO_CHOREO_VERSION, sha256: hash.digest("hex") }).toEqual(FINGERPRINT);
  });
});

describe("markDemoDeleted / isDemoId", () => {
  it("only records demo ids, once each", () => {
    expect(demo.isDemoId(FIRST)).toBe(true);
    expect(demo.isDemoId("some-song")).toBe(false);
    demo.markDemoDeleted("some-song");
    expect(localStorage.getItem(DELETED_KEY)).toBeNull();
    demo.markDemoDeleted(FIRST);
    demo.markDemoDeleted(FIRST);
    demo.markDemoDeleted(OTHERS[0]!);
    expect(demo.getDeletedDemos()).toEqual([FIRST, OTHERS[0]]);
  });
});

describe("useSongLibrary", () => {
  beforeEach(() => {
    // Skip seeding (would fetch the MP3s) by marking every demo as deleted.
    localStorage.setItem(DELETED_KEY, JSON.stringify(DEMOS.map((d) => d.id)));
  });

  /** Fresh cache per test; pass a client to share it between hook instances. */
  async function renderLibrary(client = new QueryClient()) {
    const { useSongLibrary } = await import("@/hooks/useSongLibrary");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useSongLibrary(), { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("loads the library once for all hook instances under one client", async () => {
    await repo.save(makeSong());
    const list = vi.spyOn(repo, "list");
    const client = new QueryClient();
    const a = await renderLibrary(client);
    const b = await renderLibrary(client);
    expect(list).toHaveBeenCalledTimes(1);
    expect(b.result.current.songs).toBe(a.result.current.songs);
    expect(b.result.current.songs).toHaveLength(1);
  });

  it("a save() through one instance updates the songs of the other", async () => {
    const client = new QueryClient();
    const a = await renderLibrary(client);
    const b = await renderLibrary(client);
    expect(b.result.current.songs).toEqual([]);
    const s = makeSong();
    await act(() => a.result.current.save(s));
    expect(b.result.current.songs.map((x) => x.id)).toEqual([s.id]);
  });

  it("keeps the same empty songs array while loading", async () => {
    const { useSongLibrary } = await import("@/hooks/useSongLibrary");
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useSongLibrary(), { wrapper });
    const first = hook.result.current.songs;
    expect(hook.result.current.loading).toBe(true);
    hook.rerender();
    expect(hook.result.current.songs).toBe(first);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
  });

  it("stays loading and warns when the first list() fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(repo, "list").mockRejectedValueOnce(new Error("read failed"));
    const { useSongLibrary } = await import("@/hooks/useSongLibrary");
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useSongLibrary(), { wrapper });
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Loading the library failed:", expect.any(Error)),
    );
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.songs).toEqual([]);
    warn.mockRestore();
  });

  it("remove() deletes the song and marks a demo as deleted", async () => {
    localStorage.setItem(DELETED_KEY, JSON.stringify(OTHERS));
    await repo.save({ ...makeSong(), id: FIRST, title: "Demo" });
    const other = await repo.save(makeSong());
    const { result } = await renderLibrary();
    expect(result.current.songs).toHaveLength(2);

    await act(() => result.current.remove(other));
    expect(demo.getDeletedDemos()).toEqual(OTHERS); // non-demo: list untouched

    const first = result.current.songs.find((s) => s.id === FIRST);
    if (!first) throw new Error("demo missing");
    await act(() => result.current.remove(first));
    expect(result.current.songs).toEqual([]);
    expect(demo.getDeletedDemos()).toEqual([...OTHERS, FIRST]);
  });

  it("remove() marks the demo before deleting it", async () => {
    localStorage.setItem(DELETED_KEY, JSON.stringify(OTHERS)); // keeps seeding out of it
    await repo.save({ ...makeSong(), id: FIRST, title: "Demo" });
    const { result } = await renderLibrary();
    const first = result.current.songs.find((s) => s.id === FIRST);
    if (!first) throw new Error("demo missing");
    const del = vi.spyOn(repo, "delete").mockImplementationOnce(() => {
      expect(demo.getDeletedDemos()).toContain(FIRST);
      return Promise.reject(new Error("disk"));
    });
    await expect(result.current.remove(first)).rejects.toThrow("disk");
    expect(del).toHaveBeenCalledOnce();
    expect(demo.getDeletedDemos()).toContain(FIRST); // stale mark is harmless
  });

  it("a failing reload after a successful write is not a write error", async () => {
    const { result } = await renderLibrary();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(repo, "list").mockRejectedValueOnce(new Error("read failed"));
    const s = makeSong();
    await act(() => result.current.save(s));
    expect(await repo.get(s.id)).toBeDefined();
    expect(warn).toHaveBeenCalledWith("Reloading the library failed:", expect.any(Error));
    warn.mockRestore();
  });

  it("updateDetails() saves title, artist, start offset and the choreo title in one write", async () => {
    const s = await repo.save(makeSong());
    const { result } = await renderLibrary();
    const save = vi.spyOn(repo, "save");
    await act(() =>
      result.current.updateDetails(s, {
        title: "  Neuer Titel ",
        artist: " Neue Band ",
        startOffsetMs: 12500,
      }),
    );
    expect(save).toHaveBeenCalledTimes(1);
    save.mockRestore();
    expect(result.current.songs[0]).toMatchObject({
      title: "Neuer Titel",
      artist: "Neue Band",
      startOffsetMs: 12500,
      choreo: { title: "Neuer Titel" },
    });
    expect(await repo.get(s.id)).toMatchObject({
      title: "Neuer Titel",
      artist: "Neue Band",
      startOffsetMs: 12500,
    });
  });

  it("updateDetails() keeps artist and start offset when left out and rejects an empty title", async () => {
    const s = await repo.save({ ...makeSong(), startOffsetMs: 3000 });
    const { result } = await renderLibrary();
    await act(() => result.current.updateDetails(s, { title: "Nur Titel" }));
    expect(result.current.songs[0]).toMatchObject({
      title: "Nur Titel",
      artist: s.artist,
      startOffsetMs: 3000,
    });
    await expect(result.current.updateDetails(s, { title: "   " })).rejects.toThrow();
  });
});
