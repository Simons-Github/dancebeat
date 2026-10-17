import { ZodError } from "zod";
import { CHOREO_VERSION, ChoreoFileSchema, EXPORT_FORMAT } from "../schema";
import type { ChoreoFile, Song, SourceSpec } from "../types";
import { migrateChoreo } from "./migrations";

/** Builds the JSON export of a song's choreography (no audio, no source, no scores). */
export function buildChoreoFile(song: Song, now = Date.now()): ChoreoFile {
  const { title, artist, bpm, difficulty, syncOffsetMs, startOffsetMs } = song;
  return {
    format: EXPORT_FORMAT,
    version: CHOREO_VERSION,
    exportedAt: now,
    song: { title, artist, bpm, difficulty, syncOffsetMs, startOffsetMs },
    choreo: song.choreo,
  };
}

const describe = (e: ZodError) =>
  e.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "Datei"}: ${i.message}`)
    .join("; ");

/** Parses and validates an export file; throws an Error with a German, user-facing message. */
export function parseChoreoFile(text: string): ChoreoFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON.");
  }
  try {
    if (typeof raw === "object" && raw !== null && "choreo" in raw) {
      const r = raw as Record<string, unknown>;
      return ChoreoFileSchema.parse({ ...r, choreo: migrateChoreo(r["choreo"]) });
    }
    return ChoreoFileSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) throw new Error(`Ungültige Choreografie-Datei. ${describe(e)}`);
    throw e;
  }
}

/** Creates a new song from an imported file. IDs are always fresh, so imports never overwrite. */
export function songFromChoreoFile(file: ChoreoFile, source: SourceSpec, now = Date.now()): Song {
  return {
    ...file.song,
    id: crypto.randomUUID(),
    source,
    choreo: { ...file.choreo, id: crypto.randomUUID(), createdAt: now, updatedAt: now },
    highscore: 0,
    stars: 0,
    createdAt: now,
    updatedAt: now,
  };
}
