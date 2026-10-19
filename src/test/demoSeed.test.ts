import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SongRepository } from "@/lib/library/repository";
import { makeSong } from "./fixtures";

type DemoModule = typeof import("@/data/demo");

const PINK = "d4e0c1a2-0001-4000-8000-000000000001";
const SUNSET = "d4e0c1a2-0002-4000-8000-000000000002";
const DELETED_KEY = "dancebeat.deletedDemos";

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

  async function renderLibrary() {
    const { useSongLibrary } = await import("@/hooks/useSongLibrary");
    const hook = renderHook(() => useSongLibrary());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

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

  it("rename() updates title, artist and the choreo title", async () => {
    const s = await repo.save(makeSong());
    const { result } = await renderLibrary();
    await act(() => result.current.rename(s, "  Neuer Titel ", " Neue Band "));
    expect(result.current.songs[0]).toMatchObject({
      title: "Neuer Titel",
      artist: "Neue Band",
      choreo: { title: "Neuer Titel" },
    });
    expect(await repo.get(s.id)).toMatchObject({ title: "Neuer Titel", artist: "Neue Band" });
  });

  it("rename() keeps the artist when none is given and rejects an empty title", async () => {
    const s = await repo.save(makeSong());
    const { result } = await renderLibrary();
    await act(() => result.current.rename(s, "Nur Titel"));
    expect(result.current.songs[0]).toMatchObject({ title: "Nur Titel", artist: s.artist });
    await expect(result.current.rename(s, "   ")).rejects.toThrow();
  });
});
