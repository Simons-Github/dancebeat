import { useEffect, useState } from "react";
import { z } from "zod";

import { DIFFICULTIES, type Difficulty } from "./scoring";

/** Range and step of the global latency compensation (ms). */
export const LATENCY_MIN = -500;
export const LATENCY_MAX = 500;
export const LATENCY_STEP = 10;

/** Defaults; every field falls back to its own entry when the stored value is unusable. */
const D = {
  cameraId: "",
  volume: 0.8,
  latencyMs: 0,
  skeleton: true,
  beatPulse: true,
  difficulty: "normal" as Difficulty,
  mirror: true,
  spotifyClientId: "",
  onboarded: false,
  lastSongId: "",
  autoStart: true,
  haptics: true,
};

/**
 * Each field falls back to its default on its own (`catch`), so one bad value never costs the
 * others. Numbers outside the range are clamped, not rejected; non-numbers use the default.
 * Unknown keys are dropped (zod strips them).
 */
const clamped = (min: number, max: number, fallback: number) =>
  z
    .number()
    .finite()
    .transform((n) => Math.min(max, Math.max(min, n)))
    .catch(fallback);

export const SettingsSchema = z.object({
  cameraId: z.string().catch(D.cameraId),
  volume: clamped(0, 1, D.volume),
  latencyMs: clamped(LATENCY_MIN, LATENCY_MAX, D.latencyMs).transform(Math.round),
  skeleton: z.boolean().catch(D.skeleton),
  /** Subtle beat pulse at the screen edge during play (off with prefers-reduced-motion anyway). */
  beatPulse: z.boolean().catch(D.beatPulse),
  difficulty: z.enum(DIFFICULTIES).catch(D.difficulty),
  mirror: z.boolean().catch(D.mirror),
  spotifyClientId: z.string().catch(D.spotifyClientId),
  onboarded: z.boolean().catch(D.onboarded),
  lastSongId: z.string().catch(D.lastSongId),
  /** Setup screen starts the game by itself as soon as the body was seen (countdown follows). */
  autoStart: z.boolean().catch(D.autoStart),
  /** Vibrate on PERFECT and Gold Move hits (where `navigator.vibrate` exists; not on iOS). */
  haptics: z.boolean().catch(D.haptics),
});

export type Settings = z.output<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = D;

const KEY = "dancebeat.settings";
const listeners = new Set<(s: Settings) => void>();
/** Latest saved value; keeps patches alive when a storage write fails. */
let current: Settings | null = null;

/** Drops the in-memory value (tests only, storage is cleared between cases). */
export function resetSettingsCacheForTests() {
  current = null;
}

/** Reads and validates the stored settings; anything unusable becomes the default. */
export function getSettings(): Settings {
  if (current) return current;
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "{}");
    const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
    return SettingsSchema.parse(obj);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Merges the patch into the stored settings and notifies listeners. A failing write (quota,
 * private mode) is swallowed: the new values still reach the UI for this session.
 */
export function saveSettings(patch: Partial<Settings>) {
  const s = SettingsSchema.parse({ ...getSettings(), ...patch });
  current = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not persisted; keep running with the in-memory value.
  }
  listeners.forEach((l) => l(s));
}

export function useSettings(): [Settings, (p: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    setS(getSettings());
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return [s, saveSettings];
}
