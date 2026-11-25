import { describe, expect, it } from "vitest";

import {
  HOLD_MS,
  DROPOUT_MS,
  MAX_FRAME_GAP_MS,
  STABLE_MS,
  createBodyTracker,
  createStatusSmoother,
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

  it("übersteht einen kurzen Ausfall, ohne neu zu starten", () => {
    const t = createBodyTracker();
    run(t, body(), 0, 900);
    // The frame with the flicker itself is never ready ...
    expect(t.update(body({ 27: [0.5, 0.9, 0.1] }), 933).ready).toBe(false);
    // ... but the hold goes on afterwards.
    expect(run(t, body(), 966, 100).ready).toBe(true);
  });

  it("startet neu, wenn der Ausfall länger als DROPOUT_MS dauert", () => {
    const t = createBodyTracker();
    run(t, body(), 0, 900);
    run(t, null, 933, DROPOUT_MS + 66);
    // 900 ms after the outage are not enough ...
    expect(run(t, body(), 1300, 900).ready).toBe(false);
    // ... a full second is.
    expect(run(t, body(), 2200, 300).ready).toBe(true);
  });

  it("zählt ein schwaches Landmark weiterhin als fehlend", () => {
    const t = createBodyTracker();
    const s = run(t, body({ 27: [0.5, 0.9, 0.3] }), 0, 3000);
    expect(s.allVisible).toBe(false);
    expect(s.ready).toBe(false);
  });

  it("verträgt langsame Erkennung (CPU, ~4 Bilder pro Sekunde)", () => {
    const t = createBodyTracker();
    let s = t.update(body(), 0);
    for (let at = 250; at <= 1500; at += 250) s = t.update(body(), at);
    expect(s.ready).toBe(true);
  });

  it("ist nicht bereit, solange ein Abstands- oder Mittenhinweis aktiv ist", () => {
    const near = run(createBodyTracker(), body({}, 0.99), 0, 3000);
    expect(near.allVisible).toBe(true);
    expect(near.ready).toBe(false);
    const far = run(
      createBodyTracker(),
      body({ 11: [0.55, 0.45, 0.9], 12: [0.45, 0.45, 0.9] }, 0.7),
      0,
      3000,
    );
    expect(far.ready).toBe(false);
    const shifted = body().map((p) => [p[0] - 0.3, p[1], p[2]] as Landmark);
    const off = run(createBodyTracker(), shifted, 0, 3000);
    expect(off.ready).toBe(false);
    expect(off.hint).toMatch(/Bildmitte/);
  });

  it("zeigt „Alles bereit“ nur, wenn ready gilt", () => {
    const t = createBodyTracker();
    expect(run(t, body(), 0, 500).hint).toMatch(/bleib kurz/);
    const s = run(t, body(), 533, 700);
    expect(s.ready).toBe(true);
    expect(s.hint).toMatch(/Alles bereit/);
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

describe("Glättung der Anzeige", () => {
  const good = () => createBodyTracker().update(body(), 0);
  const noFeet = () => createBodyTracker().update(body({ 27: [0, 0, 0], 28: [0, 0, 0] }), 0);

  it("zeigt den ersten Zustand sofort", () => {
    const sm = createStatusSmoother();
    expect(sm.next(good(), 0).allVisible).toBe(true);
  });

  it("schaltet erst nach STABLE_MS um", () => {
    const sm = createStatusSmoother();
    sm.next(good(), 0);
    expect(sm.next(noFeet(), 33).allVisible).toBe(true);
    expect(sm.next(noFeet(), 33 + STABLE_MS - 1).allVisible).toBe(true);
    expect(sm.next(noFeet(), 33 + STABLE_MS).allVisible).toBe(false);
  });

  it("ignoriert einen Wechsel, der gleich zurückspringt", () => {
    const sm = createStatusSmoother();
    sm.next(good(), 0);
    sm.next(noFeet(), 33);
    sm.next(good(), 66);
    // The candidate timer starts over.
    expect(sm.next(noFeet(), 100).allVisible).toBe(true);
    expect(sm.next(noFeet(), 100 + STABLE_MS - 1).allVisible).toBe(true);
  });

  it("zeigt nach reset wieder sofort", () => {
    const sm = createStatusSmoother();
    sm.next(good(), 0);
    sm.reset();
    expect(sm.next(noFeet(), 10).allVisible).toBe(false);
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
