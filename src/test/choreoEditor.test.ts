import { describe, expect, it } from "vitest";

import {
  MIN_MOVES,
  OFFSET_SHIFT_LIMIT_MS,
  beatLengthMs,
  canDeleteMove,
  deleteMove,
  formatMoveTime,
  isEdited,
  moveAudioMs,
  prepareSave,
  setTempo,
  shiftOffset,
  suggestGold,
  supportsTempo,
  tempoOf,
  toggleGold,
} from "@/lib/choreoEditor";
import { ChoreographySchema, SongSchema } from "@/lib/schema";
import { suggestGoldMoves } from "@/lib/videoChoreo";
import { makeChoreo, makeSong } from "./fixtures";

const poses = (n: number) => Array.from({ length: n }, (_, i) => ({ la: (i * 37) % 180, ra: 90 }));

describe("deleteMove", () => {
  it("entfernt den Move, bleibt sortiert und lässt das Original unverändert", () => {
    const c = makeChoreo(poses(4));
    const out = deleteMove(c, 1);
    expect(out.moves.map((m) => m.timeMs)).toEqual([0, 1000, 1500]);
    expect(c.moves).toHaveLength(4);
    expect(ChoreographySchema.safeParse(out).success).toBe(true);
  });

  it("verweigert das Löschen bei MIN_MOVES und bei ungültigem Index (gleiches Objekt)", () => {
    const c = makeChoreo(poses(MIN_MOVES));
    expect(canDeleteMove(c)).toBe(false);
    expect(deleteMove(c, 0)).toBe(c);
    const d = makeChoreo(poses(3));
    expect(canDeleteMove(d)).toBe(true);
    expect(deleteMove(d, -1)).toBe(d);
    expect(deleteMove(d, 3)).toBe(d);
    expect(deleteMove(d, 0.5)).toBe(d);
    expect(deleteMove(d, 2).moves).toHaveLength(2);
  });
});

describe("toggleGold / suggestGold", () => {
  it("schaltet genau einen Move um", () => {
    const c = makeChoreo(poses(3));
    const out = toggleGold(c, 1);
    expect(out.moves.map((m) => m.gold)).toEqual([false, true, false]);
    expect(toggleGold(out, 1).moves.every((m) => !m.gold)).toBe(true);
    expect(toggleGold(c, 5)).toBe(c);
  });

  it("übernimmt den Vorschlag aus suggestGoldMoves", () => {
    const c = makeChoreo(poses(16));
    const out = suggestGold(c);
    expect(out.moves).toEqual(suggestGoldMoves(c.moves, c.frames));
    expect(out.moves.filter((m) => m.gold)).toHaveLength(2);
    expect(out.frames).toBe(c.frames);
  });
});

describe("shiftOffset", () => {
  it("rundet auf ganze ms", () => {
    const c = makeChoreo();
    expect(shiftOffset(c, 535.714).offsetMs).toBe(536);
    expect(shiftOffset({ ...c, offsetMs: 100 }, -10).offsetMs).toBe(90);
    expect(shiftOffset(c, 0)).toBe(c);
    expect(shiftOffset(c, Number.NaN)).toBe(c);
  });

  it("begrenzt auf ±OFFSET_SHIFT_LIMIT_MS um den Anker", () => {
    const c = { ...makeChoreo(), offsetMs: 60_000 };
    expect(shiftOffset(c, 50_000, 60_000).offsetMs).toBe(60_000 + OFFSET_SHIFT_LIMIT_MS);
    expect(shiftOffset(c, -50_000, 60_000).offsetMs).toBe(60_000 - OFFSET_SHIFT_LIMIT_MS);
    const near = { ...c, offsetMs: 69_950 };
    expect(shiftOffset(near, 100, 60_000).offsetMs).toBe(70_000);
  });

  it("der erste Move landet nie vor Musikzeit 0, kein -0", () => {
    const c = makeChoreo(poses(3)); // first move at 0 ms
    expect(c.moves[0]!.timeMs).toBe(0);
    expect(shiftOffset(c, -10)).toBe(c);
    const later = { ...c, moves: c.moves.map((m) => ({ ...m, timeMs: m.timeMs + 300 })) };
    expect(shiftOffset(later, -1000).offsetMs).toBe(-300);
    expect(moveAudioMs(shiftOffset(later, -1000), 0)).toBe(0);
    const zero = shiftOffset({ ...c, offsetMs: 5 }, -5.4);
    expect(Object.is(zero.offsetMs, 0)).toBe(true);
    expect(Object.is(shiftOffset({ ...c, offsetMs: 5 }, -100).offsetMs, 0)).toBe(true);
  });

  it("ein Offset, der schon vor 0 liegt, darf nur wachsen", () => {
    const c = { ...makeChoreo(poses(3)), offsetMs: -500 };
    expect(shiftOffset(c, -10)).toBe(c);
    expect(shiftOffset(c, 100).offsetMs).toBe(-400);
  });

  it("Beat-Schritt mit Bruchteil (128 BPM) hin und zurück", () => {
    const c = { ...makeChoreo(), offsetMs: 1000 };
    const beat = beatLengthMs(128);
    expect(beat).toBe(468.75);
    const up = shiftOffset(c, beat, 1000);
    expect(up.offsetMs).toBe(1469);
    expect(shiftOffset(up, -beat, 1000).offsetMs).toBe(1000);
  });

  it("Beat-Schritt aus BPM", () => {
    expect(beatLengthMs(120)).toBe(500);
    expect(beatLengthMs(100)).toBe(600);
    const c = makeChoreo();
    expect(shiftOffset(c, beatLengthMs(112)).offsetMs).toBe(536);
  });
});

describe("Tempo", () => {
  it("nur Datei- und URL-Quellen unterstützen Tempo", () => {
    const s = makeSong();
    expect(supportsTempo({ ...s, source: { type: "local", blobId: "b" } })).toBe(true);
    expect(supportsTempo({ ...s, source: { type: "url", url: "https://example.com/a.mp3" } })).toBe(
      true,
    );
    expect(supportsTempo({ ...s, source: { type: "youtube", videoId: "dQw4w9WgXcQ" } })).toBe(
      false,
    );
    expect(
      supportsTempo({
        ...s,
        source: { type: "spotify", trackUri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" },
      }),
    ).toBe(false);
  });

  it("1× entfernt das Feld, andere Werte setzen es", () => {
    const s = makeSong();
    const slow = setTempo(s, 0.75);
    expect(slow.playbackRate).toBe(0.75);
    expect(tempoOf(slow)).toBe(0.75);
    const normal = setTempo(slow, 1);
    expect("playbackRate" in normal).toBe(false);
    expect(tempoOf(normal)).toBe(1);
    expect(SongSchema.safeParse(setTempo(s, 1.25)).success).toBe(true);
  });
});

describe("isEdited / prepareSave / Zeiten", () => {
  it("erkennt Änderungen an Gold, Moves, Offset und Tempo", () => {
    const s = makeSong(makeChoreo(poses(3)));
    expect(isEdited(s, { ...s })).toBe(false);
    const gold = { ...s, choreo: toggleGold(s.choreo, 0) };
    expect(isEdited(s, gold)).toBe(true);
    expect(isEdited(s, { ...gold, choreo: toggleGold(gold.choreo, 0) })).toBe(false);
    expect(isEdited(s, { ...s, choreo: deleteMove(s.choreo, 0) })).toBe(true);
    expect(isEdited(s, { ...s, choreo: shiftOffset(s.choreo, 10) })).toBe(true);
    expect(isEdited(s, setTempo(s, 1.25))).toBe(true);
    expect(isEdited(s, setTempo(s, 1))).toBe(false);
  });

  it("prepareSave setzt nur choreo.updatedAt", () => {
    const s = makeSong();
    const out = prepareSave(s, 5000);
    expect(out.choreo.updatedAt).toBe(5000);
    expect(out.updatedAt).toBe(s.updatedAt);
  });

  it("Musikzeit = Move-Zeit + Offset, Format mm:ss,s", () => {
    const c = { ...makeChoreo(poses(2)), offsetMs: 64_960 };
    expect(moveAudioMs(c, 1)).toBe(65_460);
    expect(formatMoveTime(65_460)).toBe("01:05,5");
    expect(formatMoveTime(0)).toBe("00:00,0");
    expect(formatMoveTime(-1200)).toBe("−00:01,2");
    expect(formatMoveTime(-20)).toBe("00:00,0");
  });
});
