import { z } from "zod";
import { computeAngles } from "../pose";
import { CHOREO_VERSION, ChoreographySchema, SongSchema } from "../schema";
import type { Choreography, Landmark, Song } from "../types";

const isUuid = (v: unknown) => z.string().uuid().safeParse(v).success;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Brings a stored or imported choreography to the current format version.
 * Version 0 (no `version` field) used unsigned angles: they are recomputed from the landmarks,
 * or dropped for frames without landmarks (unavailable, never 0).
 */
export function migrateChoreo(raw: unknown, now = Date.now()): Choreography {
  if (!isObject(raw)) throw new Error("Choreografie fehlt oder ist kein Objekt.");
  if (raw["version"] === CHOREO_VERSION) return ChoreographySchema.parse(raw);
  if (raw["version"] !== undefined)
    throw new Error(`Unbekannte Choreografie-Version: ${String(raw["version"])}`);

  const frames = Array.isArray(raw["frames"]) ? raw["frames"] : [];
  return ChoreographySchema.parse({
    ...raw,
    version: CHOREO_VERSION,
    id: isUuid(raw["id"]) ? raw["id"] : crypto.randomUUID(),
    frames: frames.map((f: unknown) => {
      if (!isObject(f)) return f;
      const landmarks = Array.isArray(f["landmarks"]) ? (f["landmarks"] as Landmark[]) : [];
      return { ...f, landmarks, angles: landmarks.length ? computeAngles(landmarks) : {} };
    }),
    createdAt: typeof raw["createdAt"] === "number" ? raw["createdAt"] : now,
    updatedAt: now,
  });
}

/** Brings a stored song record to the current format (see migrateChoreo). */
export function migrateSong(raw: unknown, now = Date.now()): Song {
  if (!isObject(raw)) throw new Error("Song-Eintrag ist kein Objekt.");
  const choreo = migrateChoreo(raw["choreo"], now);
  const current = isUuid(raw["id"]) && typeof raw["updatedAt"] === "number";
  return SongSchema.parse({
    ...raw,
    id: isUuid(raw["id"]) ? raw["id"] : crypto.randomUUID(),
    choreo,
    createdAt: typeof raw["createdAt"] === "number" ? raw["createdAt"] : now,
    updatedAt: current ? raw["updatedAt"] : now,
  });
}
