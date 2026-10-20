import { IDBFactory } from "fake-indexeddb";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongRepository } from "@/lib/library/repository";
import { makeSong } from "./fixtures";

type DemoModule = typeof import("@/data/demo");

const PINK = "d4e0c1a2-0001-4000-8000-000000000001";
const SUNSET = "d4e0c1a2-0002-4000-8000-000000000002";
const DELETED_KEY = "dancebeat.deletedDemos";
const AUDIO_KEY = "dancebeat.demoAudioVersion";

// jsdom has no OfflineAudioContext, and jsdom's Blob does not survive fake-indexeddb's
// structured clone; the repository does not inspect the stored audio.
const synth = vi.fn(() => Promise.resolve("wav" as unknown as Blob));

let repo: SongRepository;
let demo: DemoModule;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules(); // fresh DB connection and in-flight state per test
  repo = (await import("@/lib/library/repository")).songRepository;
  demo = await import("@/data/demo");
  synth.mockClear();
});

afterEach(() => localStorage.clear());

const ids = async () => (await repo.list()).map((s) => s.id).sort();

describe("seedDemos", () => {
  it("seeds both demos into a fresh library", async () => {
    await demo.seedDemos(repo, synth);
    expect(await ids()).toEqual([PINK, SUNSET].sort());
    expect(synth).toHaveBeenCalledTimes(2);
    expect(await repo.getAudio(PINK)).toBe("wav");
  });

  it("does not overwrite an existing demo, even without any marker", async () => {
    await demo.seedDemos(repo, synth);
    const pink = await repo.get(PINK);
    if (!pink) throw new Error("demo missing");
    await repo.save({ ...pink, highscore: 9000, stars: 4 });
    localStorage.clear();
    localStorage.setItem(AUDIO_KEY, String(demo.DEMO_AUDIO_VERSION)); // audio is current: no upgrade run either

    await demo.seedDemos(repo, synth);
    expect(await repo.get(PINK)).toMatchObject({ highscore: 9000, stars: 4 });
    expect(synth).toHaveBeenCalledTimes(2); // nothing synthesized the second time
  });

  it("does not re-seed a demo the player deleted", async () => {
    await demo.seedDemos(repo, synth);
    await repo.delete(PINK);
    demo.markDemoDeleted(PINK);

    await demo.seedDemos(repo, synth);
    expect(await ids()).toEqual([SUNSET]);
    expect(demo.getDeletedDemos()).toEqual([PINK]);
  });

  it("re-seeds missing demos after the database was wiped", async () => {
    await demo.seedDemos(repo, synth);
    localStorage.setItem("dancebeat.seeded", "1"); // stale marker of the old rule
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    repo = (await import("@/lib/library/repository")).songRepository;
    demo = await import("@/data/demo");

    await demo.seedDemos(repo, synth);
    expect(await ids()).toEqual([PINK, SUNSET].sort());
    expect(localStorage.getItem("dancebeat.seeded")).toBeNull();
  });

  it("shares one run between concurrent calls", async () => {
    const save = vi.spyOn(repo, "save");
    const a = demo.seedDemos(repo, synth);
    const b = demo.seedDemos(repo, synth);
    expect(b).toBe(a);
    await Promise.all([a, b]);
    expect(synth).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    // A later call starts a new run (and finds nothing to do).
    await demo.seedDemos(repo, synth);
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it("does not save a demo deleted while its audio was being synthesized", async () => {
    let release = () => {};
    synth.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          release = () => resolve("wav" as unknown as Blob);
        }),
    );
    const run = demo.seedDemos(repo, synth);
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(1));
    demo.markDemoDeleted(PINK); // first demo is Pink Pulse
    release();
    await run;
    expect(await ids()).toEqual([SUNSET]);
  });

  it("can retry after a failed run", async () => {
    synth.mockRejectedValueOnce(new Error("no audio"));
    await expect(demo.seedDemos(repo, synth)).rejects.toThrow("no audio");
    await demo.seedDemos(repo, synth);
    expect(await ids()).toEqual([PINK, SUNSET].sort());
  });

  it.each(["{kaputt", '{"a":1}', "[1,2]", '"text"', "null"])(
    "treats an unusable deleted list (%s) as empty",
    async (raw) => {
      localStorage.setItem(DELETED_KEY, raw);
      expect(demo.getDeletedDemos()).toEqual([]);
      await demo.seedDemos(repo, synth);
      expect(await ids()).toEqual([PINK, SUNSET].sort());
    },
  );

  it("survives a localStorage that throws", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(demo.getDeletedDemos()).toEqual([]);
      await demo.seedDemos(repo, synth);
      expect(await ids()).toEqual([PINK, SUNSET].sort());
    } finally {
      get.mockRestore();
    }
  });
});

describe("demo audio upgrade", () => {
  /** Library seeded with the old audio: demos present, no version marker. */
  async function seedOldLibrary() {
    synth.mockImplementation(() => Promise.resolve("old" as unknown as Blob));
    await demo.seedDemos(repo, synth);
    localStorage.removeItem(AUDIO_KEY);
    synth.mockImplementation(() => Promise.resolve("wav" as unknown as Blob));
    synth.mockClear();
  }

  afterEach(() => synth.mockImplementation(() => Promise.resolve("wav" as unknown as Blob)));

  it("sets the marker on a fresh install without extra synthesis", async () => {
    await demo.seedDemos(repo, synth);
    expect(synth).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(AUDIO_KEY)).toBe(String(demo.DEMO_AUDIO_VERSION));
  });

  it("replaces the audio of existing demos once and keeps their song data", async () => {
    await seedOldLibrary();
    const pink = await repo.get(PINK);
    if (!pink) throw new Error("demo missing");
    await repo.save({ ...pink, title: "Mein Pink", syncOffsetMs: 80, highscore: 9000, stars: 4 });

    await demo.seedDemos(repo, synth);
    expect(synth).toHaveBeenCalledTimes(2);
    expect(await repo.getAudio(PINK)).toBe("wav");
    expect(await repo.getAudio(SUNSET)).toBe("wav");
    expect(await repo.get(PINK)).toMatchObject({
      title: "Mein Pink",
      syncOffsetMs: 80,
      highscore: 9000,
      stars: 4,
      createdAt: pink.createdAt,
    });
    expect(localStorage.getItem(AUDIO_KEY)).toBe(String(demo.DEMO_AUDIO_VERSION));

    await demo.seedDemos(repo, synth);
    expect(synth).toHaveBeenCalledTimes(2); // second run: nothing to upgrade
  });

  it.each(["{kaputt", "0", '"2"', "1.5"])(
    "treats an invalid marker (%s) as version 1",
    async (raw) => {
      await seedOldLibrary();
      localStorage.setItem(AUDIO_KEY, raw);
      await demo.seedDemos(repo, synth);
      expect(synth).toHaveBeenCalledTimes(2);
      expect(await repo.getAudio(PINK)).toBe("wav");
    },
  );

  it("neither re-adds nor upgrades a deleted demo", async () => {
    await seedOldLibrary();
    await repo.delete(PINK);
    demo.markDemoDeleted(PINK);
    await demo.seedDemos(repo, synth);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(await ids()).toEqual([SUNSET]);
    expect(await repo.getAudio(PINK)).toBeUndefined();
    expect(await repo.getAudio(SUNSET)).toBe("wav");
  });

  it("skips a demo deleted while its new audio was being synthesized", async () => {
    await seedOldLibrary();
    let release = () => {};
    synth.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          release = () => resolve("wav" as unknown as Blob);
        }),
    );
    const save = vi.spyOn(repo, "save");
    const run = demo.seedDemos(repo, synth);
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(1));
    demo.markDemoDeleted(PINK);
    release();
    await run;
    expect(save).toHaveBeenCalledTimes(1); // only Sunset Kick
    expect(await repo.getAudio(PINK)).toBe("old");
  });

  it("keeps changes saved while the new audio was being synthesized", async () => {
    await seedOldLibrary();
    let release = () => {};
    synth.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          release = () => resolve("wav" as unknown as Blob);
        }),
    );
    const run = demo.seedDemos(repo, synth);
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(1));
    const pink = await repo.get(PINK);
    if (!pink) throw new Error("demo missing");
    await repo.save({ ...pink, highscore: 1234 });
    release();
    await run;
    expect(await repo.get(PINK)).toMatchObject({ highscore: 1234 });
    expect(await repo.getAudio(PINK)).toBe("wav");
  });

  it("does not touch a demo whose source the player replaced", async () => {
    await seedOldLibrary();
    const pink = await repo.get(PINK);
    if (!pink) throw new Error("demo missing");
    await repo.save({ ...pink, source: { type: "url", url: "https://example.com/a.mp3" } });
    await demo.seedDemos(repo, synth);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(await repo.get(PINK)).toMatchObject({ source: { type: "url" } });
  });

  it("logs a failed upgrade, keeps seeding and leaves the marker for a retry", async () => {
    await seedOldLibrary();
    await repo.delete(SUNSET); // missing demo: must still be seeded
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    synth.mockRejectedValueOnce(new Error("no audio"));
    await demo.seedDemos(repo, synth);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(await ids()).toEqual([PINK, SUNSET].sort());
    expect(await repo.getAudio(PINK)).toBe("old");
    expect(localStorage.getItem(AUDIO_KEY)).toBeNull();

    // The retry re-synthesizes both (the marker is global; Sunset Kick's redo is harmless).
    await demo.seedDemos(repo, synth);
    expect(synth).toHaveBeenCalledTimes(4);
    expect(await repo.getAudio(PINK)).toBe("wav");
    expect(localStorage.getItem(AUDIO_KEY)).toBe(String(demo.DEMO_AUDIO_VERSION));
  });
});

describe("encodeWav", () => {
  const ascii = (v: DataView, o: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));
  const pcm = (ab: ArrayBuffer) => new Int16Array(ab.slice(44));

  it("writes a valid mono 16-bit RIFF header", () => {
    const ab = demo.encodeWav(new Float32Array(100), 22050);
    const v = new DataView(ab);
    expect(ab.byteLength).toBe(44 + 200);
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 200);
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(28, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(200);
  });

  it("normalizes an over-loud signal to DEMO_PEAK", () => {
    const loud = Float32Array.from({ length: 1000 }, (_, i) => 2.5 * Math.sin(i / 7));
    const peak = Math.max(...pcm(demo.encodeWav(loud, 22050)).map(Math.abs)) / 0x7fff;
    expect(peak).toBeLessThanOrEqual(demo.DEMO_PEAK + 1e-4);
    expect(peak).toBeGreaterThan(demo.DEMO_PEAK - 1e-3);
  });

  it("keeps silence silent", () => {
    expect(pcm(demo.encodeWav(new Float32Array(50), 22050)).every((s) => s === 0)).toBe(true);
  });
});

describe("markDemoDeleted / isDemoId", () => {
  it("only records demo ids, once each", () => {
    expect(demo.isDemoId(PINK)).toBe(true);
    expect(demo.isDemoId("some-song")).toBe(false);
    demo.markDemoDeleted("some-song");
    expect(localStorage.getItem(DELETED_KEY)).toBeNull();
    demo.markDemoDeleted(PINK);
    demo.markDemoDeleted(PINK);
    demo.markDemoDeleted(SUNSET);
    expect(demo.getDeletedDemos()).toEqual([PINK, SUNSET]);
  });
});

describe("useSongLibrary", () => {
  beforeEach(() => {
    // Skip seeding (needs OfflineAudioContext) by marking both demos as deleted.
    localStorage.setItem(DELETED_KEY, JSON.stringify([PINK, SUNSET]));
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
    localStorage.setItem(DELETED_KEY, JSON.stringify([SUNSET]));
    await repo.save({ ...makeSong(), id: PINK, title: "Pink Pulse" });
    const other = await repo.save(makeSong());
    const { result } = await renderLibrary();
    expect(result.current.songs).toHaveLength(2);

    await act(() => result.current.remove(other));
    expect(demo.getDeletedDemos()).toEqual([SUNSET]); // non-demo: list untouched

    const pink = result.current.songs.find((s) => s.id === PINK);
    if (!pink) throw new Error("demo missing");
    await act(() => result.current.remove(pink));
    expect(result.current.songs).toEqual([]);
    expect(demo.getDeletedDemos()).toEqual([SUNSET, PINK]);
  });

  it("remove() marks the demo before deleting it", async () => {
    localStorage.setItem(DELETED_KEY, JSON.stringify([SUNSET])); // keeps seeding out of it
    await repo.save({ ...makeSong(), id: PINK, title: "Pink Pulse" });
    const { result } = await renderLibrary();
    const pink = result.current.songs.find((s) => s.id === PINK);
    if (!pink) throw new Error("demo missing");
    const del = vi.spyOn(repo, "delete").mockImplementationOnce(() => {
      expect(demo.getDeletedDemos()).toContain(PINK);
      return Promise.reject(new Error("disk"));
    });
    await expect(result.current.remove(pink)).rejects.toThrow("disk");
    expect(del).toHaveBeenCalledOnce();
    expect(demo.getDeletedDemos()).toContain(PINK); // stale mark is harmless
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
