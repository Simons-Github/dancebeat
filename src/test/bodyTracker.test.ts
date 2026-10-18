import { describe, expect, it } from "vitest";

import {
  HOLD_MS,
  MAX_FRAME_GAP_MS,
  createBodyTracker,
  distanceOf,
  statusRows,
} from "@/lib/bodyTracker";
import type { Landmark } from "@/lib/types";

/** Indices of shoulders, hips, knees and ankles. */
const KEY = [11, 12, 23, 24, 25, 26, 27, 28];

/** Full standing body: shoulders y=.25, hips .5, knees .7, ankles .9 (span .65). */
function body(overrides: Record<number, Landmark> = {}, ankleY = 0.9): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  const set = (i: number, x: number, y: number, v = 0.95) => (lm[i] = [x, y, v]);
  set(11, 0.55, 0.25);
  set(12, 0.45, 0.25);
  set(23, 0.53, 0.5);
  set(24, 0.47, 0.5);
  set(25, 0.53, 0.7);
  set(26, 0.47, 0.7);
  set(27, 0.53, ankleY);
  set(28, 0.47, ankleY);
  for (const [i, p] of Object.entries(overrides)) lm[Number(i)] = p;
  return lm;
}

type Tracker = ReturnType<typeof createBodyTracker>;

/** Feeds frames at ~30 fps from `t0` for `ms`; returns the last status. */
function run(tracker: Tracker, lm: Landmark[] | null, t0: number, ms: number) {
  let s = tracker.update(lm, t0);
  for (let t = t0 + 33; t <= t0 + ms; t += 33) s = tracker.update(lm, t);
  return s;
}

describe("Körper-Check", () => {
  it("wird erst nach einer Sekunde durchgehender Sicht bereit", () => {
    const t = createBodyTracker();
    expect(run(t, body(), 0, HOLD_MS - 100).ready).toBe(false);
    const s = run(t, body(), HOLD_MS - 100 + 33, 200);
    expect(s.ready).toBe(true);
    expect(s.allVisible).toBe(true);
  });

  it.each(KEY)("bleibt nicht bereit, wenn Punkt %i fehlt", (i) => {
    const s = run(createBodyTracker(), body({ [i]: [0.5, 0.5, 0.2] }), 0, 3000);
    expect(s.ready).toBe(false);
    expect(s.allVisible).toBe(false);
  });

  it("zählt Sichtbarkeit genau ab 0.5", () => {
    expect(run(createBodyTracker(), body({ 27: [0.5, 0.9, 0.5] }), 0, 1200).ready).toBe(true);
    expect(run(createBodyTracker(), body({ 27: [0.5, 0.9, 0.49] }), 0, 1200).ready).toBe(false);
  });

  it("startet die Sekunde neu, wenn die Sichtbarkeit einmal flackert", () => {
    const t = createBodyTracker();
    run(t, body(), 0, 900);
    expect(t.update(body({ 27: [0.5, 0.9, 0.1] }), 933).ready).toBe(false);
    // 900 ms after the flicker are not enough ...
    expect(run(t, body(), 966, 900).ready).toBe(false);
    // ... a full second is.
    expect(run(t, body(), 1866, 300).ready).toBe(true);
  });

  it("startet neu, wenn niemand im Bild ist", () => {
    const t = createBodyTracker();
    run(t, body(), 0, 800);
    expect(t.update(null, 833).ready).toBe(false);
    expect(run(t, body(), 866, 500).ready).toBe(false);
  });

  it("zählt eine Bildpause nicht als durchgehende Sicht", () => {
    const t = createBodyTracker();
    t.update(body(), 0);
    expect(t.update(body(), MAX_FRAME_GAP_MS + 700).ready).toBe(false);
  });

  it("reset verwirft den Fortschritt", () => {
    const t = createBodyTracker();
    run(t, body(), 0, 1500);
    t.reset();
    expect(t.update(body(), 1600).ready).toBe(false);
  });
});

describe("Abstand und Hinweise", () => {
  const hint = (lm: Landmark[] | null) => createBodyTracker().update(lm, 0).hint;

  it("meldet keine Person", () => {
    expect(hint(null)).toMatch(/vor die Kamera/);
  });
  it("meldet fehlende Füße mit Schritt zurück", () => {
    const h = hint(body({ 27: [0.5, 0.9, 0.1], 28: [0.5, 0.9, 0.1] }));
    expect(h).toMatch(/Füße nicht im Bild/);
    expect(h).toMatch(/Schritt zurück/);
  });
  it("meldet fehlende Knie", () => {
    expect(hint(body({ 25: [0.5, 0.7, 0.1], 26: [0.5, 0.7, 0.1] }))).toMatch(/Knie/);
  });
  it("meldet fehlenden Oberkörper", () => {
    expect(hint(body({ 11: [0.5, 0.25, 0.1] }))).toMatch(/Oberkörper/);
  });
  it("meldet zu nah und zu weit", () => {
    expect(distanceOf(body({}, 0.99))).toBe("near");
    expect(hint(body({}, 0.99))).toMatch(/Schritt zurück/);
    const far = body({ 11: [0.55, 0.45, 0.9], 12: [0.45, 0.45, 0.9] }, 0.7);
    expect(distanceOf(far)).toBe("far");
    expect(hint(far)).toMatch(/näher/);
  });
  it("meldet Randposition", () => {
    const shifted = body().map((p) => [p[0] - 0.3, p[1], p[2]] as Landmark);
    expect(hint(shifted)).toMatch(/Bildmitte/);
  });
  it("bestätigt, wenn alles passt", () => {
    expect(distanceOf(body())).toBe("ok");
    expect(hint(body())).toMatch(/bleib kurz/);
  });
});

describe("Statuszeilen", () => {
  const status = (lm: Landmark[] | null) => createBodyTracker().update(lm, 0);

  it("sind ohne Messung offen", () => {
    expect(statusRows(null, false).map((r) => r.state)).toEqual(["pending", "pending", "pending"]);
  });
  it("sind bei vollem Körper in Ordnung", () => {
    const rows = statusRows(status(body()), false);
    expect(rows.map((r) => r.state)).toEqual(["ok", "ok", "ok"]);
    expect(rows.map((r) => r.label)).toEqual([
      "Kopf bis Fuß sichtbar",
      "Genug Licht",
      "Abstand passt",
    ]);
  });
  it("warnen bei fehlenden Füßen", () => {
    const rows = statusRows(status(body({ 27: [0, 0, 0], 28: [0, 0, 0] })), false);
    expect(rows[0]).toMatchObject({ state: "warn", label: "Füße nicht im Bild" });
  });
  it("warnen bei wenig Licht", () => {
    expect(statusRows(status(body()), true)[1]).toMatchObject({
      state: "warn",
      label: "Mehr Licht nötig",
    });
  });
});
