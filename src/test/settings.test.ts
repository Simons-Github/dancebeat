import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  LATENCY_MAX,
  LATENCY_MIN,
  getSettings,
  saveSettings,
} from "@/lib/settings";

const KEY = "dancebeat.settings";
const store = (v: unknown) => localStorage.setItem(KEY, JSON.stringify(v));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("settings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.autoStart).toBe(true);
  });

  it("returns the defaults for invalid JSON or non-objects", () => {
    localStorage.setItem(KEY, "{nope");
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    store([1, 2]);
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    store("text");
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back per field and keeps the valid ones", () => {
    store({
      volume: "laut",
      skeleton: "ja",
      difficulty: "extrem",
      cameraId: 5,
      mirror: false,
      latencyMs: 40,
      autoStart: false,
    });
    expect(getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      mirror: false,
      latencyMs: 40,
      autoStart: false,
    });
  });

  it("clamps volume and latency into their ranges", () => {
    store({ volume: 7, latencyMs: -9000 });
    expect(getSettings().volume).toBe(1);
    expect(getSettings().latencyMs).toBe(LATENCY_MIN);
    store({ volume: -1, latencyMs: 9000.4 });
    expect(getSettings().volume).toBe(0);
    expect(getSettings().latencyMs).toBe(LATENCY_MAX);
  });

  it("rounds latency and rejects non-finite numbers", () => {
    store({ latencyMs: 12.6 });
    expect(getSettings().latencyMs).toBe(13);
    store({ latencyMs: null, volume: null });
    expect(getSettings().latencyMs).toBe(0);
    expect(getSettings().volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it("drops unknown keys", () => {
    store({ mirror: false, foo: "bar" });
    expect(getSettings()).not.toHaveProperty("foo");
  });

  it("merges patches, persists and notifies listeners", async () => {
    const { useSettings } = await import("@/lib/settings");
    const { renderHook, act } = await import("@testing-library/react");
    const { result } = renderHook(() => useSettings());
    act(() => result.current[1]({ skeleton: false }));
    act(() => result.current[1]({ difficulty: "schwer" }));
    expect(result.current[0]).toMatchObject({ skeleton: false, difficulty: "schwer" });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      skeleton: false,
      difficulty: "schwer",
    });
  });

  it("survives a failing localStorage write and still notifies", async () => {
    const { useSettings } = await import("@/lib/settings");
    const { renderHook, act } = await import("@testing-library/react");
    const { result } = renderHook(() => useSettings());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => act(() => saveSettings({ mirror: false }))).not.toThrow();
    expect(result.current[0].mirror).toBe(false);
  });

  it("keeps earlier patches in memory when writes keep failing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    saveSettings({ mirror: false });
    saveSettings({ difficulty: "schwer" });
    expect(getSettings()).toMatchObject({ mirror: false, difficulty: "schwer" });
  });
});
