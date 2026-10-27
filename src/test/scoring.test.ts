import { describe, expect, it } from "vitest";
import {
  accuracyPoints,
  angleDeviation,
  comboMultiplier,
  DISTINCT_MAX,
  DISTINCT_SCALE_DEG,
  distinctWeights,
  judge,
  movePoints,
  nextCombo,
  rankTitle,
  referenceMax,
  starsFor,
} from "@/lib/scoring";
import type { Rating } from "@/lib/types";

describe("Bewertung", () => {
  it("Schwellen 15/30/45/60 Grad", () => {
    expect(judge(14)).toBe("PERFECT");
    expect(judge(29)).toBe("SUPER");
    expect(judge(44)).toBe("GOOD");
    expect(judge(59)).toBe("OK");
    expect(judge(61)).toBe("X");
  });
  it("Punkte 1000/700/400/200/0", () => {
    expect(movePoints("PERFECT", 0, false)).toBe(1000);
    expect(movePoints("SUPER", 0, false)).toBe(700);
    expect(movePoints("GOOD", 0, false)).toBe(400);
    expect(movePoints("OK", 0, false)).toBe(200);
    expect(movePoints("X", 0, false)).toBe(0);
  });
  it("Combo-Multiplikator max x4", () => {
    expect(comboMultiplier(100)).toBe(4);
  });
  it("Gold Moves zählen 5-fach", () => {
    expect(movePoints("PERFECT", 0, true)).toBe(5000);
  });
  it("Arme höher gewichtet als Beine", () => {
    expect(angleDeviation({ leftElbow: 30, leftKnee: 0 }, { leftElbow: 0, leftKnee: 0 })).toBe(20);
  });
});

describe("Mindestabdeckung", () => {
  const target = {
    leftElbow: 90,
    rightElbow: 90,
    leftShoulder: 90,
    rightShoulder: 90,
    leftHip: 170,
    rightHip: 170,
    leftKnee: 175,
    rightKnee: 175,
    torsoLean: 0,
  };

  it("nur Rumpfneigung sichtbar: nicht bewertbar (X statt PERFECT)", () => {
    expect(angleDeviation({ torsoLean: 0 }, target)).toBeNull();
    expect(judge(angleDeviation({ torsoLean: 0 }, target))).toBe("X");
  });

  it("nur Beine sichtbar: kein Armwinkel, nicht bewertbar", () => {
    expect(
      angleDeviation({ leftHip: 170, rightHip: 170, leftKnee: 175, rightKnee: 175 }, target),
    ).toBeNull();
  });

  it("ein Arm reicht nicht unter 50 % des Zielgewichts", () => {
    expect(angleDeviation({ leftElbow: 90, leftShoulder: 90 }, target)).toBeNull();
  });

  it("Beine fehlen, Arme sichtbar: wird bewertet", () => {
    const arms = { leftElbow: 90, rightElbow: 90, leftShoulder: 90, rightShoulder: 90 };
    expect(angleDeviation(arms, target)).toBe(0);
  });
});

describe("Combo", () => {
  it("PERFECT/SUPER/GOOD erhöhen, OK hält, X bricht ab", () => {
    expect(nextCombo(3, "PERFECT")).toBe(4);
    expect(nextCombo(3, "SUPER")).toBe(4);
    expect(nextCombo(3, "GOOD")).toBe(4);
    expect(nextCombo(3, "OK")).toBe(3);
    expect(nextCombo(3, "X")).toBe(0);
  });
});

describe("Sterne (Befund N2)", () => {
  /** Stars of a song where every one of `n` moves gets `r`; the combo never enters the stars. */
  const allRated = (r: Rating, n = 40, gold: boolean[] = []) => {
    const moves = Array.from({ length: n }, (_, i) => ({ gold: gold[i] ?? false }));
    const accuracy = moves.reduce((s, m) => s + accuracyPoints(r, m.gold), 0);
    return starsFor(accuracy, referenceMax(moves));
  };

  it("Genauigkeitspunkte ohne Combo, Gold 5-fach", () => {
    expect(accuracyPoints("SUPER", false)).toBe(700);
    expect(accuracyPoints("PERFECT", true)).toBe(5000);
    expect(referenceMax([{ gold: false }, { gold: true }])).toBe(6000);
    expect(referenceMax([])).toBe(1);
  });

  it("alles PERFECT ist genau die Referenz: Megastar, Quote nie über 1", () => {
    expect(allRated("PERFECT")).toEqual({ stars: 5, mega: true, ratio: 1 });
    expect(allRated("PERFECT", 40, [true, true, true])).toMatchObject({ ratio: 1, mega: true });
  });

  it("eine lange Combo aus GOOD zählt nicht mehr als gutes Tanzen", () => {
    // Before N2: 400 × up to ×4 against 1000 × 2 → ratio 0.65 at 40 moves (old 4 of 5 stars).
    let combo = 0,
      score = 0;
    for (let i = 0; i < 40; i++) {
      score += movePoints("GOOD", combo, false);
      combo = nextCombo(combo, "GOOD");
    }
    expect(score / (40 * 2000)).toBeCloseTo(0.65, 9);
    expect(allRated("GOOD")).toMatchObject({ stars: 2, mega: false });
  });

  it("Stufen: lauter SUPER 4, GOOD 2, OK 1, X 0 Sterne", () => {
    expect(allRated("SUPER").stars).toBe(4);
    expect(allRated("GOOD").stars).toBe(2);
    expect(allRated("OK").stars).toBe(1);
    expect(allRated("X")).toMatchObject({ stars: 0, ratio: 0 });
  });

  it("Rangtitel folgen den Sternen", () => {
    expect(rankTitle(allRated("SUPER").stars, false)).toBe("PROFI");
    expect(rankTitle(5, true)).toBe("MEGASTAR");
  });
});

describe("Gewichtung nach unterscheidenden Gelenken (Gerätetest A2)", () => {
  it("Gelenke nahe am typischen Wert des Songs zählen 1, abweichende mehr, gedeckelt", () => {
    const w = distinctWeights([
      { leftShoulder: 0, leftKnee: 0 },
      { leftShoulder: 0, leftKnee: 0 },
      { leftShoulder: 0 },
      { leftShoulder: 90, leftKnee: 0 },
      { leftShoulder: 179 },
    ]);
    // Typical left shoulder 0 (median), knee 0.
    expect(w[0]?.leftShoulder).toBeCloseTo(1);
    expect(w[0]?.leftKnee).toBe(1);
    expect(w[3]?.leftShoulder).toBeCloseTo(1 + 90 / DISTINCT_SCALE_DEG);
    expect(w[3]?.leftKnee).toBe(1);
    expect(w[4]).toEqual({ leftShoulder: DISTINCT_MAX });
    expect(distinctWeights([])).toEqual([]);
  });

  it("rechnet über die ±180°-Grenze mit dem kürzesten Bogen", () => {
    const w = distinctWeights([{ leftElbow: 175 }, { leftElbow: -175 }, { leftElbow: 178 }]);
    for (const x of w) expect(x.leftElbow).toBeLessThan(1 + 10 / DISTINCT_SCALE_DEG);
  });

  it("ein unbewegtes Gelenk mit Treffer rettet eine falsche Armpose nicht mehr", () => {
    const target = { leftShoulder: 80, rightShoulder: 0, leftKnee: 0, rightKnee: 0 };
    const player = { leftShoulder: 0, rightShoulder: 0, leftKnee: 0, rightKnee: 0 };
    const plain = angleDeviation(player, target)!;
    const weighted = angleDeviation(player, target, { leftShoulder: DISTINCT_MAX })!;
    expect(plain).toBeCloseTo((80 * 2) / 6);
    expect(weighted).toBeCloseTo((80 * 12) / 16);
    expect(judge(plain)).toBe("SUPER");
    expect(judge(weighted)).toBe("X");
  });
});
