import { z } from "zod";

import { SONG_PALETTES } from "@/theme";

import type { MotionPack } from "./types";

/**
 * Manifest of a shipped demo song (Etappe 14a, docs/choreography-format.md#demo-manifest):
 * audio file, measured tempo and beat grid, song structure and the phrases per section type.
 * Written by hand in src/data/demos/<slug>.manifest.json; not persisted in the library, so it has
 * its own version and no migration.
 */

export const DEMO_MANIFEST_VERSION = 1;

export const SECTION_KINDS = ["intro", "verse", "prechorus", "chorus", "bridge", "outro"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
const SectionKindSchema = z.enum(SECTION_KINDS);

/**
 * A section of the song, measured in beats from the end of the previous one (the first starts at
 * beat 0 = `beatPhaseMs`). Beats instead of 8-counts: the generated songs do not keep strict
 * 8-count phrasing, section boundaries also fall on beat 4 mod 8, so the length only has to be a
 * multiple of 4 beats (one bar).
 */
export const DemoSectionSchema = z
  .object({
    kind: SectionKindSchema,
    beats: z
      .number()
      .int()
      .positive()
      .refine((b) => b % 4 === 0, "beats must be a multiple of 4"),
  })
  .strict();

/** Fixed clip sequence (motion pack ids) or "auto": the generator chooses with the song's seed. */
const PhraseSchema = z.union([z.literal("auto"), z.array(z.string().min(1)).min(1)]);

export const DemoManifestSchema = z
  .object({
    version: z.literal(DEMO_MANIFEST_VERSION),
    /** Song id in the library. */
    id: z.string().regex(/^demo-[a-z0-9-]+$/, "id must look like demo-<slug>"),
    title: z.string().min(1),
    artist: z.string().min(1),
    /** File name in public/demo-audio/. */
    audio: z.string().regex(/^[A-Za-z0-9_-]+\.mp3$/, "audio must be a plain .mp3 file name"),
    /** Index into SONG_PALETTES (src/theme.ts); no colours in the manifest. */
    palette: z
      .number()
      .int()
      .nonnegative()
      .max(SONG_PALETTES.length - 1, `palette must be an index below ${SONG_PALETTES.length}`),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    bpm: z.number().finite().min(30).max(300),
    /**
     * Time of beat 0 in ms, below one beat; sections count from it. It is a beat of the measured
     * grid, not a measured downbeat: the section lengths were chosen on this same grid.
     */
    beatPhaseMs: z.number().finite().nonnegative(),
    /** Measured length of the audio file. */
    durationMs: z.number().int().positive(),
    sections: z.array(DemoSectionSchema).min(1),
    /** Phrase per section kind; every kind used in `sections` needs one. */
    phrases: z
      .object({
        intro: PhraseSchema,
        verse: PhraseSchema,
        prechorus: PhraseSchema,
        chorus: PhraseSchema,
        bridge: PhraseSchema,
        outro: PhraseSchema,
      } satisfies Record<SectionKind, typeof PhraseSchema>)
      .partial()
      .strict(),
    /** Gold moves: section index and beat within that section (not in intro or outro). */
    gold: z.array(
      z
        .object({ section: z.number().int().nonnegative(), beat: z.number().int().nonnegative() })
        .strict(),
    ),
    /** Optional display names per clip id. */
    moveNames: z.record(z.string().min(1), z.string().min(1).max(60)).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const beatMs = 60_000 / m.bpm;
    if (m.beatPhaseMs >= beatMs)
      ctx.addIssue({
        code: "custom",
        path: ["beatPhaseMs"],
        message: `beatPhaseMs must be below one beat (${beatMs.toFixed(1)} ms)`,
      });
    const kinds = new Set(m.sections.map((s) => s.kind));
    for (const kind of kinds)
      if (m.phrases[kind] === undefined)
        ctx.addIssue({
          code: "custom",
          path: ["phrases", kind],
          message: `section kind ${kind} has no phrase`,
        });
    const goldKeys = new Set<string>();
    m.gold.forEach((g, i) => {
      const key = `${g.section}:${g.beat}`;
      if (goldKeys.has(key))
        ctx.addIssue({ code: "custom", path: ["gold", i], message: `duplicate gold ${key}` });
      goldKeys.add(key);
      const section = m.sections[g.section];
      if (!section)
        ctx.addIssue({
          code: "custom",
          path: ["gold", i, "section"],
          message: `gold section ${g.section} does not exist (${m.sections.length} sections)`,
        });
      else if (section.kind === "intro" || section.kind === "outro")
        ctx.addIssue({
          code: "custom",
          path: ["gold", i, "section"],
          message: `gold section ${g.section} is an ${section.kind} (no moves there)`,
        });
      else if (g.beat >= section.beats)
        ctx.addIssue({
          code: "custom",
          path: ["gold", i, "beat"],
          message: `gold beat ${g.beat} is outside section ${g.section} (${section.beats} beats)`,
        });
    });
    const totalBeats = m.sections.reduce((sum, s) => sum + s.beats, 0);
    const endMs = m.beatPhaseMs + totalBeats * beatMs;
    if (endMs > m.durationMs)
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: `sections end at ${Math.round(endMs)} ms, after the song (${m.durationMs} ms)`,
      });
  });

export type DemoManifest = z.infer<typeof DemoManifestSchema>;
export type DemoSection = z.infer<typeof DemoSectionSchema>;

/** Clip ids used in phrases or moveNames that the motion pack does not contain (sorted, unique). */
export function unknownClipIds(manifest: DemoManifest, pack: MotionPack): string[] {
  const known = new Set(pack.clips.map((c) => c.id));
  const used = new Set<string>();
  for (const phrase of Object.values(manifest.phrases))
    if (Array.isArray(phrase)) phrase.forEach((id) => used.add(id));
  for (const id of Object.keys(manifest.moveNames ?? {})) used.add(id);
  return [...used].filter((id) => !known.has(id)).sort();
}
