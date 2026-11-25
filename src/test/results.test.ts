import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyResult, recordResult, recordResultSafely } from "@/lib/game/results";
import type { SongRepository } from "@/lib/library/repository";
import { makeSong } from "./fixtures";

// makeSong(): highscore 1234, stars 3.
describe("applyResult", () => {
  it("übernimmt nur einen höheren Punktestand", () => {
    const s = makeSong();
    expect(applyResult(s, { score: 2000, stars: 2 })).toMatchObject({ highscore: 2000, stars: 3 });
  });

  it("übernimmt nur mehr Sterne", () => {
    const s = makeSong();
    expect(applyResult(s, { score: 100, stars: 4 })).toMatchObject({ highscore: 1234, stars: 4 });
  });

  it("übernimmt beides", () => {
    const s = makeSong();
    const u = applyResult(s, { score: 5000, stars: 5 });
    expect(u).toMatchObject({ id: s.id, highscore: 5000, stars: 5 });
    expect(s.highscore).toBe(1234); // input untouched
  });

  it("gibt null zurück, wenn sich nichts verbessert", () => {
    const s = makeSong();
    expect(applyResult(s, { score: 1234, stars: 3 })).toBeNull();
    expect(applyResult(s, { score: 10, stars: 0 })).toBeNull();
  });

  it("rundet den Punktestand", () => {
    const s = makeSong();
    expect(applyResult(s, { score: 1234.4, stars: 0 })).toBeNull();
    expect(applyResult(s, { score: 1500.6, stars: 0 })?.highscore).toBe(1501);
  });

  it("begrenzt Sterne auf ganze Zahlen 0..5 und ignoriert ungültige Werte", () => {
    const s = { ...makeSong(), highscore: 0, stars: 0 };
    expect(applyResult(s, { score: 0, stars: 9 })?.stars).toBe(5);
    expect(applyResult(s, { score: 0, stars: 2.7 })?.stars).toBe(2);
    expect(applyResult(s, { score: -5, stars: -1 })).toBeNull();
    expect(applyResult(s, { score: Number.NaN, stars: Number.NaN })).toBeNull();
  });
});

describe("recordResult (IndexedDB)", () => {
  let repo: SongRepository;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules(); // fresh module-level DB connection per test
    repo = (await import("@/lib/library/repository")).songRepository;
  });

  it("speichert neuen Highscore und Sterne", async () => {
    const s = await repo.save(makeSong());
    expect(await recordResult(repo, s.id, 3000, 4)).toEqual({ newHighscore: true });
    expect(await repo.get(s.id)).toMatchObject({ highscore: 3000, stars: 4 });
  });

  it("schwächeres Ergebnis danach ändert nichts", async () => {
    const s = await repo.save(makeSong());
    await recordResult(repo, s.id, 3000, 4);
    const before = await repo.get(s.id);
    expect(await recordResult(repo, s.id, 2000, 2)).toEqual({ newHighscore: false });
    expect(await repo.get(s.id)).toEqual(before);
  });

  it("mehr Sterne ohne höheren Punktestand: gespeichert, aber kein neuer Highscore", async () => {
    const s = await repo.save({ ...makeSong(), stars: 1 });
    expect(await recordResult(repo, s.id, 1000, 2)).toEqual({ newHighscore: false });
    expect(await repo.get(s.id)).toMatchObject({ highscore: 1234, stars: 2 });
  });

  it("unbekannter Song: kein Highscore, nichts gespeichert", async () => {
    expect(await recordResult(repo, "missing", 9999, 5)).toEqual({ newHighscore: false });
    expect(await repo.list()).toEqual([]);
  });

  it("0 Punkte sind nie ein neuer Highscore", async () => {
    const s = await repo.save({ ...makeSong(), highscore: 0, stars: 0 });
    expect(await recordResult(repo, s.id, 0, 0)).toEqual({ newHighscore: false });
  });

  it("reicht Speicherfehler an den Aufrufer weiter", async () => {
    const s = await repo.save(makeSong());
    vi.spyOn(repo, "save").mockRejectedValueOnce(new Error("voll"));
    await expect(recordResult(repo, s.id, 9999, 5)).rejects.toThrow("voll");
  });

  it("recordResultSafely: Fehler ergibt kein Highscore statt Ausnahme", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await repo.save(makeSong());
    vi.spyOn(repo, "save").mockRejectedValueOnce(new Error("voll"));
    expect(await recordResultSafely(repo, s.id, 9999, 5)).toEqual({ newHighscore: false });
    expect(warn).toHaveBeenCalled();
  });

  it("recordResultSafely: hängendes Speichern endet nach dem Timeout", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await repo.save(makeSong());
    vi.spyOn(repo, "save").mockReturnValueOnce(new Promise(() => {}));
    expect(await recordResultSafely(repo, s.id, 9999, 5, 20)).toEqual({ newHighscore: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("20 ms"));
  });
});
