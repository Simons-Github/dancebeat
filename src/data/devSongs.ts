import { parseYouTubeId } from "@/lib/audio/sources";
import { SongSchema } from "@/lib/schema";
import { SONG_PALETTES } from "@/theme";
import type { Song } from "@/lib/types";

import { autoChoreo } from "./demo";

/** Dev builds only: `?devsong=youtube:<id|link>`, `?devsong=url:<address>`, `?devsong=clear`. */
export type DevSongSpec =
  | { kind: "youtube"; videoId: string; bpm: number; lenSec: number }
  | { kind: "url"; url: string; bpm: number; lenSec: number }
  | { kind: "clear" };

/** Fixed slots (one per type) so repeated calls overwrite instead of piling up. */
export const DEV_SONG_IDS = {
  youtube: "d4e0c1a2-00d0-4000-8000-000000000001",
  url: "d4e0c1a2-00d0-4000-8000-000000000002",
} as const;

const DEFAULT_BPM = 120;
const DEFAULT_LEN_SEC = 180;

function clampNumber(raw: unknown, min: number, max: number, fallback: number) {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseDevSong(search: Record<string, unknown>): DevSongSpec | null {
  const raw = search["devsong"];
  if (typeof raw !== "string") return null;
  if (raw === "clear") return { kind: "clear" };

  const bpm = clampNumber(search["bpm"], 30, 300, DEFAULT_BPM);
  const lenSec = clampNumber(search["len"], 10, 600, DEFAULT_LEN_SEC);

  if (raw.startsWith("youtube:")) {
    const videoId = parseYouTubeId(raw.slice("youtube:".length));
    return videoId ? { kind: "youtube", videoId, bpm, lenSec } : null;
  }
  if (raw.startsWith("url:")) {
    const address = raw.slice("url:".length);
    try {
      const u = new URL(address);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return { kind: "url", url: u.href, bpm, lenSec };
    } catch {
      return null;
    }
  }
  return null;
}

export function buildDevSong(spec: Exclude<DevSongSpec, { kind: "clear" }>, now: number): Song {
  const title = spec.kind === "youtube" ? "Dev: YouTube" : "Dev: URL";
  const palette = SONG_PALETTES[spec.kind === "youtube" ? 0 : 1] ?? SONG_PALETTES[0];
  const choreo = autoChoreo(title, spec.bpm, spec.lenSec * 1000, [
    palette.accent,
    palette.secondary,
  ]);
  return SongSchema.parse({
    id: DEV_SONG_IDS[spec.kind],
    title,
    artist: "Testsong",
    bpm: spec.bpm,
    difficulty: 1,
    source:
      spec.kind === "youtube"
        ? { type: "youtube", videoId: spec.videoId }
        : { type: "url", url: spec.url },
    syncOffsetMs: 0,
    startOffsetMs: 0,
    choreo,
    highscore: 0,
    stars: 0,
    createdAt: now,
    updatedAt: now,
  });
}
