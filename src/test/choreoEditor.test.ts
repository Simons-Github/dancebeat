import { describe, expect, it } from "vitest";

import {
  MIN_MOVES,
  MIN_MOVE_GAP_MS,
  OFFSET_SHIFT_LIMIT_MS,
  beatLengthMs,
  canDeleteMove,
  canInsertAfter,
  canShiftMove,
  deleteMove,
  formatMoveTime,
  insertMoveAfter,
  isEdited,
  moveAudioMs,
  prepareSave,
  setTempo,
  shiftMove,
  shiftOffset,
  suggestGold,
  supportsTempo,
  tempoOf,
  toggleGold,
} from "@/lib/choreoEditor";
import { ChoreographySchema, SongSchema } from "@/lib/schema";
import type { Choreography } from "@/lib/types";
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

/** Frames every 500 ms from 0 to 4000 ms (120 BPM), moves only at `times`. */
function sparse(times: number[], offsetMs = 0): Choreography {
  const c = makeChoreo(poses(9));
  return {
    ...c,
    offsetMs,
    moves: times.map((t, i) => ({ timeMs: t, label: `M${i}`, iconId: "x", gold: false })),
  };
}
const times = (c: Choreography) => c.moves.map((m) => m.timeMs);

describe("shiftMove", () => {
  it("verschiebt einen Move, rundet auf 0,1 ms, Original bleibt", () => {
    expect(MIN_MOVE_GAP_MS).toBe(300);
    const c = sparse([0, 2000, 4000]);
    expect(times(shiftMove(c, 1, 500))).toEqual([0, 2500, 4000]);
    expect(times(shiftMove(c, 1, -250.44))).toEqual([0, 1749.6, 4000]);
    expect(canShiftMove(c, 1, 500)).toBe(true);
    expect(times(c)).toEqual([0, 2000, 4000]);
    expect(shiftMove(c, 1, 500).frames).toBe(c.frames);
  });

  it("verweigert zu kleinen Abstand zu beiden Nachbarn (genau 300 ms ist erlaubt)", () => {
    const c = sparse([0, 2000, 4000]);
    expect(times(shiftMove(c, 1, 1700))).toEqual([0, 3700, 4000]);
    expect(shiftMove(c, 1, 1700.1)).toBe(c);
    expect(times(shiftMove(c, 1, -1700))).toEqual([0, 300, 4000]);
    expect(shiftMove(c, 1, -1700.1)).toBe(c);
    // Jumping over a neighbor is rejected as well, so the order stays.
    expect(shiftMove(c, 1, 2500)).toBe(c);
    expect(canShiftMove(c, 1, -1700.1)).toBe(false);
  });

  it("bleibt im Bereich der Frames und nie vor 0", () => {
    const c = sparse([0, 2000, 4000]);
    expect(shiftMove(c, 2, 1)).toBe(c);
    expect(shiftMove(c, 0, -1)).toBe(c);
    const late: Choreography = {
      ...c,
      frames: c.frames.map((f) => ({ ...f, timeMs: f.timeMs + 1000 })),
      moves: c.moves.map((m) => ({ ...m, timeMs: m.timeMs + 1000 })),
    };
    expect(shiftMove(late, 0, -500)).toBe(late);
    expect(shiftMove(late, 2, 500)).toBe(late);
    expect(times(shiftMove(late, 2, -500))).toEqual([1000, 3000, 4500]);
  });

  it("halbe Beats bei 128 BPM driften nicht", () => {
    const c = { ...sparse([0, 2000, 4000]), bpm: 128 };
    const half = beatLengthMs(128) / 2;
    const once = shiftMove(c, 0, half);
    expect(once.moves[0]!.timeMs).toBe(234.4);
    expect(shiftMove(once, 0, half).moves[0]!.timeMs).toBe(468.8);
  });

  it("verweigert Zeiten ohne brauchbare Pose (wie der Video-Import)", () => {
    const c = sparse([0, 2000, 4000]);
    const frames = c.frames.map((f) =>
      f.timeMs === 1500
        ? { ...f, lowVisibility: true }
        : f.timeMs === 3000
          ? { ...f, angles: {} }
          : f,
    );
    const d = { ...c, frames };
    expect(shiftMove(d, 1, -500)).toBe(d); // exactly on the low-visibility frame
    expect(shiftMove(d, 1, -250)).toBe(d); // interpolated from it
    expect(shiftMove(d, 1, 1000)).toBe(d); // no limb angles
    expect(shiftMove(d, 1, 750)).toBe(d); // interpolation keeps only shared angles
    // frameAt interpolates 2500 ms with the next frame (3000 ms, no angles): no target either.
    expect(shiftMove(d, 1, 500)).toBe(d);
    expect(times(shiftMove(d, 1, 250))).toEqual([0, 2250, 4000]);
    expect(canInsertAfter({ ...d, moves: d.moves.slice(0, 2) }, 1)).toBe(false); // 3000 ms
  });

  it("verweigert Musikzeit vor 0", () => {
    const c = sparse([1000, 2000, 3000], -800);
    expect(shiftMove(c, 0, -500)).toBe(c);
    const ok = shiftMove(c, 0, -200);
    expect(times(ok)).toEqual([800, 2000, 3000]);
    expect(moveAudioMs(ok, 0)).toBe(0);
  });

  it("ungültiger Index, NaN, Unendlich und 0 ändern nichts", () => {
    const c = sparse([0, 2000, 4000]);
    for (const [i, d] of [
      [-1, 500],
      [3, 500],
      [0.5, 500],
      [1, Number.NaN],
      [1, Number.POSITIVE_INFINITY],
      [1, 0],
      [1, 0.04],
    ] as const) {
      expect(shiftMove(c, i, d)).toBe(c);
      expect(canShiftMove(c, i, d)).toBe(false);
    }
    expect(shiftMove({ ...c, frames: [] }, 1, 500).moves).toBe(c.moves);
  });

  it("viele Verschiebungen halten die Moves sortiert und schema-gültig", () => {
    let c = sparse([0, 1000, 2000, 3000, 4000]);
    const beat = beatLengthMs(c.bpm);
    for (let k = 0; k < 60; k++) c = shiftMove(c, (k * 7) % 5, ((k % 4) - 1.5) * beat);
    const t = times(c);
    expect(t.every((x, i) => i === 0 || x - t[i - 1]! >= MIN_MOVE_GAP_MS)).toBe(true);
    expect(ChoreographySchema.safeParse(c).success).toBe(true);
  });
});

describe("insertMoveAfter", () => {
  it("fügt in der Mitte ein, auf das Beat-Raster der Choreografie-Zeit gerastet", () => {
    // Midpoint 1300 ms, nearest k · 500 ms is 1500 ms; offsetMs (beat phase) does not matter.
    const c = sparse([0, 2600, 4000], 130);
    expect(canInsertAfter(c, 0)).toBe(true);
    const out = insertMoveAfter(c, 0);
    expect(out.index).toBe(1);
    expect(times(out.choreo)).toEqual([0, 1500, 2600, 4000]);
    expect(out.choreo.moves[1]).toEqual({ timeMs: 1500, label: "", iconId: "editor", gold: false });
    expect(times(c)).toEqual([0, 2600, 4000]);
  });

  it("nimmt die ungerasterte Mitte, wenn der Beat zu nah am Nachbarn liegt", () => {
    // Midpoint 400 ms snaps to 500 ms: only 200 ms before the move at 700 ms.
    const c = sparse([100, 700, 4000]);
    expect(times(insertMoveAfter(c, 0).choreo)).toEqual([100, 400, 700, 4000]);
    // Exactly 300 ms to both neighbors is still allowed; one beat apart at 200 BPM fits.
    expect(times(insertMoveAfter(sparse([0, 600, 4000]), 0).choreo)).toEqual([0, 300, 600, 4000]);
    const fast = { ...sparse([0, 600, 4000]), bpm: 200 };
    expect(canInsertAfter(fast, 0)).toBe(true);
    expect(canInsertAfter(sparse([0, 599, 4000]), 0)).toBe(false);
  });

  it("nach dem letzten Move: zwei Beats später", () => {
    const c = sparse([0, 1000, 2000]);
    const out = insertMoveAfter(c, 2);
    expect(out.index).toBe(3);
    expect(times(out.choreo)).toEqual([0, 1000, 2000, 3000]);
  });

  it("ohne Platz oder bei ungültigem Index: unverändert", () => {
    const c = makeChoreo(poses(3)); // midpoints 250 ms from the moves, frames end at the last move
    for (const i of [0, 1, 2, -1, 3, 0.5]) {
      expect(canInsertAfter(c, i)).toBe(false);
      const out = insertMoveAfter(c, i);
      expect(out.choreo).toBe(c);
      expect(out.index).toBe(i);
    }
    // Two beats after the last move lie beyond the frames.
    expect(canInsertAfter(sparse([0, 3500]), 1)).toBe(false);
  });

  it("Ergebnis ist schema-gültig und zählt als Änderung", () => {
    const s = makeSong(sparse([0, 2000, 4000]));
    const { choreo } = insertMoveAfter(s.choreo, 1);
    expect(times(choreo)).toEqual([0, 2000, 3000, 4000]);
    expect(ChoreographySchema.safeParse(choreo).success).toBe(true);
    expect(isEdited(s, { ...s, choreo })).toBe(true);
    expect(isEdited(s, { ...s, choreo: shiftMove(s.choreo, 1, 500) })).toBe(true);
  });

  it("Einfügen, Löschen und Verschieben bei gleichen Zeiten zählt als Änderung", () => {
    const s = makeSong(sparse([0, 2000, 4000]));
    const inserted = insertMoveAfter(s.choreo, 0).choreo; // new move at 1000 ms
    const swapped = shiftMove(deleteMove(inserted, 2), 1, 1000);
    expect(times(swapped)).toEqual(times(s.choreo));
    expect(isEdited(s, { ...s, choreo: swapped })).toBe(true);
    const relabeled = s.choreo.moves.map((m, i) => (i === 1 ? { ...m, iconId: "y" } : m));
    expect(isEdited(s, { ...s, choreo: { ...s.choreo, moves: relabeled } })).toBe(true);
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
