import { ZodError } from "zod";
import { CHOREO_VERSION, ChoreoFileSchema, EXPORT_FORMAT } from "../schema";
import type { ChoreoFile, Song, SourceSpec } from "../types";
import { migrateChoreo } from "./migrations";
import { t } from "../i18n";

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
    .map((i) => `${i.path.join(".") || t("songs.import.fileFallback")}: ${i.message}`)
    .join("; ");

/** Parses and validates an export file; throws an Error with a user-facing message in the UI language. */
export function parseChoreoFile(text: string): ChoreoFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t("songs.import.invalidJson"));
  }
  try {
    // Files of format v1 are accepted; the choreography is migrated and the result is v2.
    const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
    const file =
      r && "choreo" in r
        ? ChoreoFileSchema.parse({ ...r, choreo: migrateChoreo(r["choreo"]) })
        : ChoreoFileSchema.parse(raw);
    return { ...file, version: CHOREO_VERSION };
  } catch (e) {
    if (e instanceof ZodError)
      throw new Error(t("songs.import.invalidFile", { details: describe(e) }));
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
