import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SongRepository } from "@/lib/library/repository";
import { figure } from "@/lib/pose";
import { makeSong } from "./fixtures";

// Audio is stored as plain strings here: jsdom's Blob does not survive fake-indexeddb's
// structured clone, and the repository does not inspect the stored value.
const audio = (s: string) => s as unknown as Blob;

let repo: SongRepository;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules(); // fresh module-level DB connection per test
  repo = (await import("@/lib/library/repository")).songRepository;
});

/** Creates the database at an old schema version (stores as of version 1) with raw records. */
function seed(version: number, records: { songs: unknown[]; blobs: [string, unknown][] }) {
  return new Promise<void>((resolve, reject) => {
    const r = indexedDB.open("dancebeat", version);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("songs", { keyPath: "id" });
      r.result.createObjectStore("blobs");
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction(["songs", "blobs"], "readwrite");
      records.songs.forEach((s) => tx.objectStore("songs").put(s));
      records.blobs.forEach(([k, v]) => tx.objectStore("blobs").put(v, k));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
}

describe("IndexedDbSongRepository", () => {
  it("speichert Song und Audio und listet nach createdAt", async () => {
    const a = { ...makeSong(), createdAt: 2, source: { type: "local" as const, blobId: "a" } };
    const b = { ...makeSong(), createdAt: 1 };
    const saved = await repo.save(a, audio("A"));
    await repo.save(b);
    expect(saved.updatedAt).toBeGreaterThan(1);
    expect((await repo.list()).map((s) => s.id)).toEqual([b.id, a.id]);
    expect(await repo.getAudio("a")).toBe("A");
  });

  it("weist ungültige Songs beim Speichern ab", async () => {
    await expect(repo.save({ ...makeSong(), bpm: 5 })).rejects.toThrow();
    expect(await repo.list()).toEqual([]);
  });

  it("löscht Song und Audio gemeinsam", async () => {
    const s = { ...makeSong(), source: { type: "local" as const, blobId: "x" } };
    await repo.save(s, audio("X"));
    await repo.delete(s.id);
    expect(await repo.get(s.id)).toBeUndefined();
    expect(await repo.getAudio("x")).toBeUndefined();
  });

  it("speichert das Tanzvideo getrennt unter videoBlobId (8h-2b-1)", async () => {
    const s = {
      ...makeSong(),
      source: { type: "local" as const, blobId: "a" },
      videoBlobId: "v",
    };
    await repo.save(s, audio("A"), audio("V"));
    expect(await repo.getAudio("a")).toBe("A");
    expect(await repo.getVideo("v")).toBe("V");
    expect((await repo.get(s.id))?.videoBlobId).toBe("v");
    // Also with a non-local music source.
    const u = {
      ...makeSong(),
      source: { type: "url" as const, url: "https://example.com/a.mp3" },
      videoBlobId: "w",
    };
    await repo.save(u, undefined, audio("W"));
    expect(await repo.getVideo("w")).toBe("W");
  });

  it("weist ein Tanzvideo ohne videoBlobId ab und speichert nichts", async () => {
    const s = { ...makeSong(), source: { type: "local" as const, blobId: "a" } };
    await expect(repo.save(s, audio("A"), audio("V"))).rejects.toThrow();
    expect(await repo.list()).toEqual([]);
    expect(await repo.getAudio("a")).toBeUndefined();
  });

  it("weist eine leere videoBlobId ab", async () => {
    await expect(repo.save({ ...makeSong(), videoBlobId: "" })).rejects.toThrow();
  });

  it("Songs ohne videoBlobId bleiben gültig", async () => {
    const s = await repo.save(makeSong());
    expect("videoBlobId" in s).toBe(false);
    expect(await repo.get(s.id)).toEqual(s);
  });

  it("löscht Song, Audio und Tanzvideo gemeinsam", async () => {
    const s = {
      ...makeSong(),
      source: { type: "local" as const, blobId: "x" },
      videoBlobId: "y",
    };
    await repo.save(s, audio("X"), audio("Y"));
    await repo.delete(s.id);
    expect(await repo.get(s.id)).toBeUndefined();
    expect(await repo.getAudio("x")).toBeUndefined();
    expect(await repo.getVideo("y")).toBeUndefined();
  });

  it("löscht das Tanzvideo auch bei ungültigem Datensatz", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seed(3, {
      songs: [{ id: "broken", source: { type: "url", url: "x" }, videoBlobId: "vb" }],
      blobs: [["vb", "V"]],
    });
    expect(await repo.list()).toEqual([]);
    await repo.delete("broken");
    expect(await repo.getVideo("vb")).toBeUndefined();
    warn.mockRestore();
  });

  it("Export enthält kein videoBlobId", async () => {
    const s = await repo.save({ ...makeSong(), videoBlobId: "v" });
    expect(await repo.export(s.id)).not.toContain("videoBlobId");
  });

  it("exportiert und importiert als neuen Song", async () => {
    const s = await repo.save(makeSong());
    const imported = await repo.import(await repo.export(s.id), {
      type: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(imported.id).not.toBe(s.id);
    expect(await repo.list()).toHaveLength(2);
  });

  it("migriert Datenbank-Version 1, überspringt ungültige Einträge und kann sie löschen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const legacy = {
      ...makeSong(),
      id: "demo-pink",
      source: { type: "local", blobId: "demo-pink" },
      updatedAt: undefined,
      choreo: {
        title: "Alt",
        bpm: 112,
        offsetMs: 0,
        accentColor: "#FF2E93",
        secondaryColor: "#00E5FF",
        frames: [
          { timeMs: 0, landmarks: figure({ la: 90, ra: 90 }), angles: { leftShoulder: 90 } },
        ],
        moves: [{ timeMs: 0, label: "x", iconId: "x", gold: false }],
      },
    };
    await seed(1, {
      songs: [legacy, { id: "broken", title: 5 }],
      blobs: [["demo-pink", "AUDIO"]],
    });

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).not.toBe("demo-pink");
    expect(list[0]!.choreo.version).toBe(2);
    expect(list[0]!.choreo.frames[0]!.angles.leftShoulder).toBeCloseTo(90, 6);
    expect(await repo.getAudio("demo-pink")).toBe("AUDIO");

    await repo.delete("broken");
    await repo.delete(list[0]!.id);
    expect(await repo.getAudio("demo-pink")).toBeUndefined();
    warn.mockRestore();
  });

  it("migriert Datenbank-Version 2 mit Choreografie v1 auf Format v2", async () => {
    const song = makeSong();
    const v1 = JSON.parse(JSON.stringify({ ...song, choreo: { ...song.choreo, version: 1 } }));
    await seed(2, { songs: [v1], blobs: [] });

    const stored = await repo.get(song.id);
    expect(stored).toEqual(song);
    expect(stored!.choreo.version).toBe(2);
    expect(stored!.choreo.frames).toEqual(song.choreo.frames);
  });
});
