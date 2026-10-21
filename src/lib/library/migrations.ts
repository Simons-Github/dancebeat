import { z } from "zod";
import { computeAngles } from "../pose";
import { CHOREO_VERSION, ChoreographySchema, SongSchema } from "../schema";
import type { Choreography, Landmark, Song } from "../types";

const isUuid = (v: unknown) => z.string().uuid().safeParse(v).success;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Version 0 (no `version` field) used unsigned angles: they are recomputed from the landmarks,
 * or dropped for frames without landmarks (unavailable, never 0).
 */
function v0to1(raw: Record<string, unknown>, now: number): Record<string, unknown> {
  const frames = Array.isArray(raw["frames"]) ? raw["frames"] : [];
  return {
    ...raw,
    version: 1,
    id: isUuid(raw["id"]) ? raw["id"] : crypto.randomUUID(),
    frames: frames.map((f: unknown) => {
      if (!isObject(f)) return f;
      const landmarks = Array.isArray(f["landmarks"]) ? (f["landmarks"] as Landmark[]) : [];
      return { ...f, landmarks, angles: landmarks.length ? computeAngles(landmarks) : {} };
    }),
    createdAt: typeof raw["createdAt"] === "number" ? raw["createdAt"] : now,
    updatedAt: now,
  };
}

/** Version 2 adds the optional `pose3d` per frame; v1 frames stay valid as they are. */
function v1to2(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: 2 };
}

/**
 * Brings a stored or imported choreography to the current format version by running the steps
 * 0 → 1 → 2 from its version on, then validates it. Unknown versions are rejected.
 */
export function migrateChoreo(raw: unknown, now = Date.now()): Choreography {
  if (!isObject(raw)) throw new Error("Choreografie fehlt oder ist kein Objekt.");
  const version = raw["version"];
  // Only a missing field means version 0; an explicit 0 or null is unknown.
  if (version !== undefined && version !== 1 && version !== CHOREO_VERSION)
    throw new Error(`Unbekannte Choreografie-Version: ${String(raw["version"])}`);
  let c = raw;
  if (c["version"] === undefined) c = v0to1(c, now);
  if (c["version"] === 1) c = v1to2(c);
  return ChoreographySchema.parse(c);
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
