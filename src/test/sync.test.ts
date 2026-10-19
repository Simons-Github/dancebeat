import { describe, expect, it } from "vitest";

import { gameTimeMs } from "@/lib/audio/clock";
import {
  SYNC_DISCARD_TAPS,
  SYNC_MAX_SPREAD_MS,
  SYNC_MIN_TAPS,
  beatDeviationMs,
  computeSyncOffset,
  formatOffsetMs,
  isUneven,
  MAX_TAP_AGE_MS,
  tapAudioMs,
  wrapToBeat,
} from "@/lib/sync";

const BPM = 120; // period 500 ms
const PERIOD = 500;
const N = SYNC_MIN_TAPS + SYNC_DISCARD_TAPS;

/** Taps on beats 4, 5, 6 … plus a per-tap shift. */
const taps = (shift: (i: number) => number, n = N, start = 4) =>
  Array.from({ length: n }, (_, i) => (start + i) * PERIOD + shift(i));

describe("wrapToBeat", () => {
  it("wraps into (−period/2, period/2]", () => {
    expect(wrapToBeat(0, PERIOD)).toBe(0);
    expect(wrapToBeat(250, PERIOD)).toBe(250);
    expect(wrapToBeat(-250, PERIOD)).toBe(250);
    expect(wrapToBeat(260, PERIOD)).toBe(-240);
    expect(wrapToBeat(1240, PERIOD)).toBe(240);
    expect(wrapToBeat(-1010, PERIOD)).toBe(-10);
  });
});

describe("computeSyncOffset", () => {
  it("taps exactly on the grid give 0", () => {
    expect(
      computeSyncOffset(
        taps(() => 0),
        BPM,
        0,
        0,
      ),
    ).toEqual({
      offsetMs: 0,
      spreadMs: 0,
      count: SYNC_MIN_TAPS,
    });
  });

  it("a constant lag becomes the offset, negative lags too", () => {
    expect(
      computeSyncOffset(
        taps(() => 70),
        BPM,
        0,
        0,
      )?.offsetMs,
    ).toBe(70);
    expect(
      computeSyncOffset(
        taps(() => -35),
        BPM,
        0,
        0,
      )?.offsetMs,
    ).toBe(-35);
  });

  it("with the proposed offset, the game time of each tap lands on the beat grid", () => {
    const t = taps(() => 123);
    const r = computeSyncOffset(t, BPM, 40, 15);
    expect(r?.offsetMs).toBe(68);
    for (const tap of t) {
      const g = gameTimeMs(tap, {
        latencyMs: 40,
        syncOffsetMs: r?.offsetMs ?? 0,
        choreoOffsetMs: 15,
      });
      expect(wrapToBeat(g, PERIOD)).toBeCloseTo(0);
    }
  });

  it("subtracts latency and choreo offset", () => {
    expect(
      computeSyncOffset(
        taps(() => 100),
        BPM,
        30,
        0,
      )?.offsetMs,
    ).toBe(70);
    expect(
      computeSyncOffset(
        taps(() => 100),
        BPM,
        0,
        60,
      )?.offsetMs,
    ).toBe(40);
    expect(
      computeSyncOffset(
        taps(() => 100),
        BPM,
        30,
        60,
      )?.offsetMs,
    ).toBe(10);
  });

  it("handles taps straddling the wrap boundary at ±period/2", () => {
    // Residuals alternate around 250 / −250: a naive mean would give about 0.
    const r = computeSyncOffset(
      taps((i) => (i % 2 ? 245 : 255)),
      BPM,
      0,
      0,
    );
    expect(r).not.toBeNull();
    expect(Math.abs(r?.offsetMs ?? 0)).toBeGreaterThanOrEqual(245);
    expect(Math.abs(r?.offsetMs ?? 0)).toBeLessThanOrEqual(250);
    expect(r?.spreadMs).toBeLessThanOrEqual(5);
  });

  it("ignores the first taps and outliers", () => {
    const t = taps((i) => (i < SYNC_DISCARD_TAPS ? 200 : i === 6 ? -180 : 50 + (i % 3) - 1));
    const r = computeSyncOffset(t, BPM, 0, 0);
    expect(r?.offsetMs).toBe(50);
    expect(r?.count).toBe(SYNC_MIN_TAPS - 1);
  });

  it("returns null below the minimum tap count or for a bad tempo", () => {
    expect(
      computeSyncOffset(
        taps(() => 0, N - 1),
        BPM,
        0,
        0,
      ),
    ).toBeNull();
    expect(computeSyncOffset([], BPM, 0, 0)).toBeNull();
    expect(
      computeSyncOffset(
        taps(() => 0),
        0,
        0,
        0,
      ),
    ).toBeNull();
    expect(
      computeSyncOffset(
        taps(() => 0),
        Number.NaN,
        0,
        0,
      ),
    ).toBeNull();
  });

  it("reports the spread (median absolute deviation)", () => {
    // Alternating ±20 around 30: every tap is 20 ms off the median.
    const even = computeSyncOffset(
      taps((i) => 30 + (i % 2 ? 20 : -20)),
      BPM,
      0,
      0,
    );
    expect(even?.offsetMs).toBe(30);
    expect(even?.spreadMs).toBe(20);
    expect(even && isUneven(even)).toBe(false);

    const ragged = computeSyncOffset(
      taps((i) => [0, 60, -60, 90, -90][i % 5] ?? 0),
      BPM,
      0,
      0,
    );
    expect(ragged?.spreadMs).toBeGreaterThan(SYNC_MAX_SPREAD_MS);
    expect(ragged && isUneven(ragged)).toBe(true);
  });
});

describe("tapAudioMs", () => {
  it("subtracts the event age, scaled by the playback rate", () => {
    expect(tapAudioMs(1000, 16)).toBe(984);
    expect(tapAudioMs(1000, 20, 1.5)).toBe(970);
    expect(tapAudioMs(1000, MAX_TAP_AGE_MS)).toBe(1000 - MAX_TAP_AGE_MS);
  });

  it("treats negative, too old or invalid ages as 0", () => {
    expect(tapAudioMs(1000, -5)).toBe(1000);
    expect(tapAudioMs(1000, MAX_TAP_AGE_MS + 1)).toBe(1000);
    expect(tapAudioMs(1000, Number.NaN)).toBe(1000);
    expect(tapAudioMs(1000, Number.POSITIVE_INFINITY)).toBe(1000);
  });
});

describe("beatDeviationMs / formatOffsetMs", () => {
  it("measures a tap against the current game grid", () => {
    const o = { latencyMs: 10, syncOffsetMs: 20, choreoOffsetMs: 0 };
    expect(beatDeviationMs(2040, BPM, o)).toBe(10);
    expect(beatDeviationMs(2010, BPM, o)).toBe(-20);
  });

  it("formats with sign and typographic minus", () => {
    expect(formatOffsetMs(40)).toBe("+40 ms");
    expect(formatOffsetMs(-15)).toBe("−15 ms");
    expect(formatOffsetMs(0)).toBe("0 ms");
  });
});
