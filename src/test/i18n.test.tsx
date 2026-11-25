import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { en } from "@/lib/i18n/en";
import { getLanguage, localeOf, normalizeLanguage, t, tn, useT } from "@/lib/i18n";
import { getSettings, resetSettingsCacheForTests, saveSettings } from "@/lib/settings";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSettingsCacheForTests();
});

function Probe() {
  const tr = useT();
  return <p>{tr("common.cancel")}</p>;
}

describe("i18n", () => {
  it("falls back to German for unknown languages", () => {
    localStorage.setItem("dancebeat.settings", JSON.stringify({ language: "xx" }));
    expect(getSettings().language).toBe("de");
    expect(normalizeLanguage("xx")).toBe("de");
    expect(getLanguage()).toBe("de");
    expect(localeOf()).toBe("de-DE");
  });

  it("English has exactly the keys of German", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(en[k]).not.toBe("");
  });

  it("interpolates {name} and picks plural forms", () => {
    const key = Object.keys(de)
      .find((k) => k.endsWith("_one"))!
      .replace(/_one$/, "");
    saveSettings({ language: "en" });
    expect(tn(key as Parameters<typeof tn>[0], 1)).toContain("1");
    expect(tn(key as Parameters<typeof tn>[0], 3)).toContain("3");
    const withVar = Object.entries(en).find(([, v]) => v.includes("{"));
    if (withVar) {
      const name = /\{(\w+)\}/.exec(withVar[1])![1]!;
      expect(t(withVar[0] as keyof typeof en, { [name]: "ZZ" })).toContain("ZZ");
    }
  });

  it("re-renders a component in English after switching", () => {
    render(<Probe />);
    expect(screen.getByText("Abbrechen")).toBeInTheDocument();
    act(() => saveSettings({ language: "en" }));
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });
});
