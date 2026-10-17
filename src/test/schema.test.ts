import { describe, expect, it } from "vitest";
import { ChoreographySchema, SongSchema } from "@/lib/schema";
import { buildChoreoFile, parseChoreoFile, songFromChoreoFile } from "@/lib/library/choreoFile";
import { migrateChoreo, migrateSong } from "@/lib/library/migrations";
import { computeAngles, figure } from "@/lib/pose";
import { makeChoreo, makeSong } from "./fixtures";

describe("Choreografie-Format v1", () => {
  it("akzeptiert eine gültige Choreografie", () => {
    expect(
      ChoreographySchema.safeParse(
        makeChoreo([
          { la: 0, ra: 0 },
          { la: 90, ra: 90 },
        ]),
      ).success,
    ).toBe(true);
  });

  it("lehnt unsortierte Frames ab", () => {
    const c = makeChoreo([
      { la: 0, ra: 0 },
      { la: 90, ra: 90 },
    ]);
    c.frames.reverse();
    const r = ChoreographySchema.safeParse(c);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("sortiert");
  });

  it("lehnt unsortierte Moves, falsche Version und ungültige Farben ab", () => {
    const c = makeChoreo([
      { la: 0, ra: 0 },
      { la: 90, ra: 90 },
    ]);
    expect(ChoreographySchema.safeParse({ ...c, moves: [...c.moves].reverse() }).success).toBe(
      false,
    );
    expect(ChoreographySchema.safeParse({ ...c, version: 2 }).success).toBe(false);
    expect(ChoreographySchema.safeParse({ ...c, accentColor: "pink" }).success).toBe(false);
  });

  it("verlangt UUIDs für Song und Choreografie", () => {
    expect(SongSchema.safeParse({ ...makeSong(), id: "demo-pink" }).success).toBe(false);
  });
});

describe("Migration Version 0 → 1", () => {
  const lm = figure({ la: 160, ra: 20, re: 60 });
  const legacy = {
    title: "Alt",
    bpm: 112,
    offsetMs: 0,
    accentColor: "#FF2E93",
    secondaryColor: "#00E5FF",
    // Old unsigned convention: these values must not survive.
    frames: [
      { timeMs: 0, landmarks: lm, angles: { leftShoulder: 160, leftElbow: 180 } },
      { timeMs: 100, landmarks: [], angles: { leftShoulder: 90 } },
    ],
    moves: [{ timeMs: 0, label: "x", iconId: "x", gold: false }],
  };

  it("berechnet Winkel aus Landmarks neu und verwirft Winkel ohne Landmarks", () => {
    const c = migrateChoreo(legacy, 42);
    expect(c.version).toBe(1);
    expect(c.frames[0]!.angles).toEqual(computeAngles(lm));
    expect(c.frames[1]!.angles).toEqual({});
    expect(c.createdAt).toBe(42);
  });

  it("vergibt UUIDs und Zeitstempel für alte Song-Einträge", () => {
    const s = migrateSong(
      { ...makeSong(), id: "demo-pink", updatedAt: undefined, choreo: legacy },
      42,
    );
    expect(SongSchema.safeParse(s).success).toBe(true);
    expect(s.id).not.toBe("demo-pink");
    expect(s.updatedAt).toBe(42);
    expect(s.source).toEqual({ type: "local", blobId: "blob-1" });
  });

  it("lässt aktuelle Einträge unverändert", () => {
    const song = makeSong();
    expect(migrateSong(song, 42)).toEqual(song);
  });
});

describe("Export und Import", () => {
  it("Rundreise: exportieren, parsen, als neuer Song anlegen", () => {
    const song = makeSong();
    const json = JSON.stringify(buildChoreoFile(song, 5));
    expect(json).not.toContain("blob-1"); // no source
    expect(json).not.toContain("1234"); // no highscore
    const file = parseChoreoFile(json);
    const imported = songFromChoreoFile(file, { type: "url", url: "https://example.org/a.mp3" }, 9);
    expect(SongSchema.safeParse(imported).success).toBe(true);
    expect(imported.id).not.toBe(song.id);
    expect(imported.choreo.id).not.toBe(song.choreo.id);
    expect(imported.choreo.frames).toEqual(song.choreo.frames);
    expect(imported.highscore).toBe(0);
  });

  it("meldet kaputtes JSON und ungültige Dateien verständlich", () => {
    expect(() => parseChoreoFile("{nope")).toThrow("kein gültiges JSON");
    const bad = buildChoreoFile(
      makeSong(
        makeChoreo([
          { la: 0, ra: 0 },
          { la: 90, ra: 90 },
        ]),
      ),
    );
    bad.choreo.frames.reverse();
    expect(() => parseChoreoFile(JSON.stringify(bad))).toThrow(
      /Ungültige Choreografie-Datei.*sortiert/,
    );
  });
});
