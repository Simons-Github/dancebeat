import { describe, expect, it } from "vitest";

import { gameTimeMs } from "@/lib/audio/clock";
import {
  PREVIEW_LEAD_BEATS,
  TICK_MAX_GAP_MS,
  currentMoveIndex,
  dueMoves,
  previewStartAudioMs,
  scrollIntoBoxDelta,
  tickTimeMs,
} from "@/lib/editorPreview";
import type { Move } from "@/lib/types";
import { makeChoreo, makeSong } from "./fixtures";

const movesAt = (...times: number[]): Move[] =>
  times.map((t) => ({ timeMs: t, label: "", iconId: "x", gold: false }));

describe("previewStartAudioMs", () => {
  // 120 BPM: 2 beats = 1000 ms. Moves at 0, 500, …, 2000 ms.
  const song = {
    ...makeSong({ ...makeChoreo(Array.from({ length: 5 }, () => ({ la: 90, ra: 90 }))) }),
    syncOffsetMs: 40,
    startOffsetMs: 200,
  };
  const withOffset = { ...song, choreo: { ...song.choreo, offsetMs: 3000 } };

  it("ohne Move: startOffsetMs wie im Sync-Test", () => {
    expect(previewStartAudioMs(song, 100)).toBe(200);
    expect(previewStartAudioMs({ ...song, startOffsetMs: -5 }, 100)).toBe(0);
    expect(previewStartAudioMs(song, 100, 99)).toBe(200);
  });

  it("ab Move: zwei Beats vorher, mit den Offsets des Spiels", () => {
    expect(PREVIEW_LEAD_BEATS).toBe(2);
    // Move 4 at 2000 ms → game 1000 → audio 1000 + 100 + 40 + 3000.
    const audio = previewStartAudioMs(withOffset, 100, 4);
    expect(audio).toBe(4140);
    expect(gameTimeMs(audio, { latencyMs: 100, syncOffsetMs: 40, choreoOffsetMs: 3000 })).toBe(
      1000,
    );
  });

  it("nie vor startOffsetMs oder 0", () => {
    // Move 0 at 0 ms → game −1000 → audio −860, clamped to the start offset.
    expect(previewStartAudioMs(song, 100, 0)).toBe(200);
    expect(previewStartAudioMs({ ...song, startOffsetMs: 0 }, 0, 0)).toBe(0);
  });

  it("nutzt die BPM der Choreografie", () => {
    const slow = { ...withOffset, choreo: { ...withOffset.choreo, bpm: 60 } };
    // 2 beats at 60 BPM = 2000 ms → game 0.
    expect(previewStartAudioMs(slow, 0, 4)).toBe(3040);
  });
});

describe("currentMoveIndex", () => {
  const moves = movesAt(1000, 2000, 3000);
  it("letzter fälliger Move, −1 davor", () => {
    expect(currentMoveIndex(moves, 999)).toBe(-1);
    expect(currentMoveIndex(moves, 1000)).toBe(0);
    expect(currentMoveIndex(moves, 2999.9)).toBe(1);
    expect(currentMoveIndex(moves, 3000)).toBe(2);
    expect(currentMoveIndex(moves, 1e9)).toBe(2);
    expect(currentMoveIndex([], 5)).toBe(-1);
  });
});

describe("dueMoves", () => {
  const moves = movesAt(1000, 1100, 2000);
  it("Moves mit prev < t ≤ now", () => {
    expect(dueMoves(moves, 980, 1000)).toEqual([0]);
    expect(dueMoves(moves, 1000, 1016)).toEqual([]);
    expect(dueMoves(moves, 990, 1100)).toEqual([0, 1]);
    expect(dueMoves(moves, 1990, 2010)).toEqual([2]);
    expect(dueMoves(moves, 2010, 2030)).toEqual([]);
  });

  it("kein Klick nach Reset, Rücksprung oder großem Sprung", () => {
    expect(dueMoves(moves, null, 1000)).toEqual([]);
    expect(dueMoves(moves, 1050, 990)).toEqual([]);
    expect(dueMoves(moves, 1000, 1000)).toEqual([]);
    expect(dueMoves(moves, 900, 900 + TICK_MAX_GAP_MS + 1)).toEqual([]);
    expect(dueMoves(moves, 0, 3000)).toEqual([]);
    expect(dueMoves(moves, 900, 900 + TICK_MAX_GAP_MS)).toEqual([0, 1]);
    expect(dueMoves(moves, Number.NaN, 1000)).toEqual([]);
  });
});

describe("scrollIntoBoxDelta", () => {
  const box = { left: 100, right: 400 };
  it("0 wenn sichtbar, sonst bis zum nächsten Rand", () => {
    expect(scrollIntoBoxDelta(box, { left: 150, right: 250 })).toBe(0);
    expect(scrollIntoBoxDelta(box, { left: 380, right: 480 })).toBe(80);
    expect(scrollIntoBoxDelta(box, { left: 40, right: 140 })).toBe(-60);
    expect(scrollIntoBoxDelta(box, { left: 120, right: 500 })).toBe(20);
  });
});

describe("tickTimeMs", () => {
  it("Audioposition minus Choreo-Offset, ohne Latenz und Sync-Offset", () => {
    const o = { latencyMs: 120, syncOffsetMs: 40, choreoOffsetMs: 3000 };
    expect(tickTimeMs(5000, 3000)).toBe(2000);
    expect(tickTimeMs(5000, 3000)).toBe(gameTimeMs(5000, o) + 120 + 40);
  });
});
