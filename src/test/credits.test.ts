import { describe, expect, it } from "vitest";

import { AIST_CREDITS, CREDITS, SHIPS_AIST } from "@/data/credits";
import { DEMO_TITLES } from "@/data/demo";
import committed from "@/data/motion-pack.json";
import { AIST_VIDEO_PREFIX } from "@/lib/aist";
import { MotionPackSchema } from "@/lib/schema";

describe("Credits", () => {
  it("nennen AIST++ genau dann, wenn das ausgelieferte Motion-Paket AIST-Clips enthält", () => {
    const pack = MotionPackSchema.parse(committed);
    const hasAist = pack.clips.some((c) => c.source.startsWith(`video:${AIST_VIDEO_PREFIX}`));
    expect(SHIPS_AIST).toBe(hasAist);
    for (const c of AIST_CREDITS) expect(CREDITS.includes(c)).toBe(hasAist);
  });

  it("nennen jeden Demo-Song und Gemini als Musikquelle", () => {
    const text = CREDITS.flatMap((c) => c.lines).join("\n");
    for (const t of DEMO_TITLES) expect(text).toContain(t);
    expect(text).toContain("Gemini");
  });

  it("verlinken nur per https und nennen CC BY 4.0 bei AIST++", () => {
    for (const c of [...CREDITS, ...AIST_CREDITS]) {
      for (const l of c.links) expect(new URL(l.href).protocol).toBe("https:");
    }
    const aist = AIST_CREDITS.flatMap((c) => [...c.lines, ...c.links.map((l) => l.href)]).join(
      "\n",
    );
    expect(aist).toContain("Google LLC");
    expect(aist).toContain("creativecommons.org/licenses/by/4.0");
    expect(aist).toContain("ISMIR 2019");
  });

  it("nennen die Lizenzen von DanceBeat, MediaPipe, Fredoka und den npm-Paketen", () => {
    const text = CREDITS.flatMap((c) => [...c.lines, ...c.links.map((l) => l.href)]).join("\n");
    expect(text).toContain("Required Notice: Copyright 2026 Simon Berger");
    expect(text).toContain("polyformproject.org/licenses/noncommercial/1.0.0");
    expect(text).toContain("MediaPipe");
    expect(text).toContain("Apache License 2.0");
    expect(text).toContain("Copyright 2016 The Fredoka Project Authors");
    expect(text).toContain("SIL Open Font License 1.1");
    expect(text).toContain("„Lizenztexte“");
  });

  it("nennen die AIST Dance DB mit dem Satz aus deren Terms of Use", () => {
    const text = AIST_CREDITS.flatMap((c) => c.lines).join("\n");
    expect(text).toContain(
      "We have used the AIST Dance Video Database (https://aistdancedb.ongaaccel.jp).",
    );
    expect(text).toContain("nur für nicht-kommerzielle Zwecke");
    expect(text).not.toContain("©");
  });
});
