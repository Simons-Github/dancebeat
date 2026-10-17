import { describe, expect, it } from "vitest";
import { comboMultiplier, judge, movePoints, angleDeviation } from "@/lib/scoring";

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
