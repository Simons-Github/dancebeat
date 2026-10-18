import { useEffect, useState } from "react";
import type { Difficulty } from "./scoring";

export interface Settings {
  cameraId: string;
  volume: number;
  latencyMs: number;
  skeleton: boolean;
  difficulty: Difficulty;
  mirror: boolean;
  spotifyClientId: string;
  onboarded: boolean;
  lastSongId: string;
}

const DEFAULTS: Settings = {
  cameraId: "",
  volume: 0.8,
  latencyMs: 0,
  skeleton: true,
  difficulty: "normal",
  mirror: true,
  spotifyClientId: "",
  onboarded: false,
  lastSongId: "",
};
const KEY = "dancebeat.settings";
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}
export function saveSettings(patch: Partial<Settings>) {
  const s = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(s));
  listeners.forEach((l) => l(s));
}
export function useSettings(): [Settings, (p: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => {
    setS(getSettings());
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return [s, saveSettings];
}
