import { SONG_PALETTES } from "@/theme";

import { SECTION_KINDS, type DemoManifest, type SectionKind } from "./demoManifest";
import {
  DEFAULT_STYLE,
  END_MARGIN_BEATS,
  GROUP_PATTERN,
  MIN_MOVE_ENERGY,
  PHRASE_BEATS,
  TEMPO_TOLERANCE,
  beatMsOf,
  realizeFrames,
  selectMoves,
  stepBeats,
  targetEnergy,
  type ClipRef,
  type GenerationInput,
  type Plan,
  type PlannedPhrase,
  type Slot,
} from "./generator";
import { hashSeed, randomFromString } from "./random";
import { CHOREO_VERSION } from "./schema";
import type { Choreography, MotionPack } from "./types";

/**
 * Song structure of the shipped demo songs (Etappe 14b, docs/choreography-format.md#demo-pipeline):
 * the manifest replaces `planStructure`, fixed clip sequences replace `selectMoves`, and
 * `realizeFrames` builds the frames. Pure and deterministic (seed = song id), run offline by
 * `bun run build-demo`.
 */

/**
 * Phrase energy per section kind (0..1, as in `planStructure` without an energy curve). The
 * chorus stays below HIGH_ENERGY, so difficulty 2 keeps two beats per move there.
 */
export const MANIFEST_ENERGY: Record<SectionKind, number> = {
  intro: 0.2,
  verse: 0.3,
  prechorus: 0.5,
  chorus: 0.6,
  bridge: 0.4,
  outro: 0.3,
};

/** The intro dances (without moves) only in its last beats; before, the rest pose stands. */
export const INTRO_MOTION_BEATS = 8;

/** Start beat of every section (beat 0 = `beatPhaseMs`). */
export function sectionStarts(m: DemoManifest): number[] {
  let beat = 0;
  return m.sections.map((s) => {
    const start = beat;
    beat += s.beats;
    return start;
  });
}

/**
 * Plans the song from the manifest: every section except the outro is cut into phrases of
 * PHRASE_BEATS from its start (the last one may be shorter), keyed `<kind>-<A|B>` by the group
 * pattern A A B A, so every occurrence of a kind repeats the same phrases. Only the last
 * INTRO_MOTION_BEATS of the intro get phrases. Density from `stepBeats` with MANIFEST_ENERGY.
 * Gold exactly as in the manifest (it must lie on a slot); the closing pose starts the outro or,
 * without one, replaces the last slot.
 */
export function planFromManifest(m: DemoManifest): Plan {
  const beatMs = beatMsOf(m.bpm);
  const starts = sectionStarts(m);
  const lastMoveBeat = Math.floor((m.durationMs - m.beatPhaseMs) / beatMs) - END_MARGIN_BEATS;
  const first = m.sections[0];
  const introBeats = first?.kind === "intro" ? first.beats : 0;

  const phrases: PlannedPhrase[] = [];
  let final: Slot | null = null;
  m.sections.forEach((section, i) => {
    const start = starts[i]!;
    const end = start + section.beats;
    if (section.kind === "outro") {
      // The schema allows the outro only as the last section.
      final = {
        beat: start,
        lengthBeats: (m.durationMs - m.beatPhaseMs) / beatMs - start,
        gold: false,
      };
      return;
    }
    const from = section.kind === "intro" ? Math.max(start, end - INTRO_MOTION_BEATS) : start;
    const energy = MANIFEST_ENERGY[section.kind];
    const step = stepBeats(m.difficulty, energy, beatMs);
    for (let p = from, n = 0; p < end; p += PHRASE_BEATS, n++) {
      const beats = Math.min(PHRASE_BEATS, end - p);
      const slots: Slot[] = [];
      for (let b = 0; b < beats && p + b <= lastMoveBeat; b += step)
        slots.push({ beat: p + b, lengthBeats: step, gold: false });
      if (!slots.length) continue;
      phrases.push({
        key: `${section.kind}-${GROUP_PATTERN[n % GROUP_PATTERN.length]!}`,
        section: section.kind === "chorus" ? "chorus" : "verse",
        startBeat: p,
        beats,
        slots,
        energy: targetEnergy(energy),
      });
    }
  });

  for (const g of m.gold) {
    const beat = starts[g.section]! + g.beat;
    const slot = phrases.flatMap((p) => p.slots).find((s) => s.beat === beat);
    if (!slot)
      throw new Error(
        `Gold-Move (Abschnitt ${g.section}, Beat ${g.beat}) liegt nicht auf einem Move-Beat`,
      );
    slot.gold = true;
  }

  const base = { bpm: m.bpm, beatPhaseMs: m.beatPhaseMs, durationMs: m.durationMs, introBeats };
  if (!final) {
    // No outro: the last slot becomes the closing pose and lasts until the end of the song.
    const last = phrases[phrases.length - 1];
    const slot = last?.slots.pop();
    if (!last || !slot || slot.beat < introBeats)
      throw new Error(`Manifest ${m.id} hat keinen Move nach dem Intro`);
    if (!last.slots.length) phrases.pop();
    final = {
      beat: slot.beat,
      lengthBeats: (m.durationMs - m.beatPhaseMs) / beatMs - slot.beat,
      gold: slot.gold,
    };
  }
  return { ...base, phrases, final };
}

/** Generator input of a manifest: its tempo grid, difficulty and the song id as seed. */
export const manifestInput = (m: DemoManifest): GenerationInput => ({
  bpm: m.bpm,
  beatPhaseMs: m.beatPhaseMs,
  durationMs: m.durationMs,
  style: DEFAULT_STYLE,
  difficulty: m.difficulty,
  seed: m.id,
});

/**
 * Clips for the plan: "auto" phrases come from `selectMoves` (seeded with the song id); fixed
 * sequences replace them, cycling through the ids within each section occurrence, so every
 * occurrence starts with the first id. A fixed outro closes with its first id. Fixed clips must be
 * known moves (not rest poses), no harder than the song, fit their slot and lie within
 * TEMPO_TOLERANCE, else the build aborts.
 */
export function buildDemoClips(
  m: DemoManifest,
  pack: MotionPack,
  plan: Plan = planFromManifest(m),
): ClipRef[] {
  const byId = new Map(pack.clips.map((c) => [c.id, c]));
  const beatMs = beatMsOf(m.bpm);
  for (const kind of SECTION_KINDS) {
    const ids = m.phrases[kind];
    if (!Array.isArray(ids)) continue;
    // The closing pose may be longer than a step; every other clip must fit its slot.
    const step =
      kind === "outro" ? Infinity : stepBeats(m.difficulty, MANIFEST_ENERGY[kind], beatMs);
    for (const id of ids) {
      const clip = byId.get(id);
      if (!clip) throw new Error(`Unbekannter Clip ${id} im Manifest ${m.id}`);
      if (clip.energy < MIN_MOVE_ENERGY)
        throw new Error(`Clip ${id} ist eine Ruhepose, kein Move (${kind})`);
      if (clip.difficulty > m.difficulty)
        throw new Error(
          `Clip ${id} ist schwerer als der Song (${clip.difficulty} > ${m.difficulty})`,
        );
      if (clip.beats > step)
        throw new Error(
          `Clip ${id} ist mit ${clip.beats} Beats länger als ein Slot (${step}) in ${kind}`,
        );
      if (clip.sourceBpm !== undefined && Math.abs(m.bpm / clip.sourceBpm - 1) > TEMPO_TOLERANCE)
        throw new Error(
          `Clip ${id} hat ${clip.sourceBpm} BPM, der Song ${m.bpm} BPM ` +
            `(mehr als ±${TEMPO_TOLERANCE * 100} %)`,
        );
    }
  }

  const clips = selectMoves(plan, pack, manifestInput(m), randomFromString(m.id));
  const starts = sectionStarts(m);
  const sectionAt = (beat: number) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1]! <= beat) i++;
    return i;
  };
  // selectMoves returns the slots in order, the closing pose last.
  let section = -1,
    j = 0;
  return clips.map((ref) => {
    const s = sectionAt(ref.beat);
    if (s !== section) {
      section = s;
      j = 0;
    }
    const ids = m.phrases[m.sections[s]!.kind];
    const fixed = Array.isArray(ids) ? ids[j % ids.length] : undefined;
    j++;
    return fixed === undefined ? ref : { ...ref, clipId: fixed };
  });
}

/** Deterministic version-4 UUID of a demo choreography, derived from the song id. */
export function demoChoreoId(songId: string): string {
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(hashSeed(songId)),
    b = hex(hashSeed(`${songId}#choreo`));
  return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-8${a.slice(1, 4)}-${b}${a.slice(4, 8)}`;
}

/**
 * Deterministic version-4 UUID of a demo song in the library, derived from the manifest id
 * (`demo-<slug>` is no UUID, `SongSchema.id` needs one). Salted differently from `demoChoreoId`.
 */
export function demoSongId(manifestId: string): string {
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(hashSeed(`${manifestId}#song`)),
    b = hex(hashSeed(`${manifestId}#song-id`));
  return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-8${a.slice(1, 4)}-${b}${a.slice(4, 8)}`;
}

/**
 * The complete choreography of a demo song. Moves inside the intro are dropped (the intro dances
 * without moves); times are fixed (0), the seed sets them when it stores the song (14c).
 */
export function buildDemoChoreo(m: DemoManifest, pack: MotionPack): Choreography {
  const plan = planFromManifest(m);
  const { frames, moves } = realizeFrames(plan, buildDemoClips(m, pack, plan), pack);
  const introEndMs = Math.round(m.beatPhaseMs + plan.introBeats * beatMsOf(m.bpm));
  const palette = SONG_PALETTES[m.palette]!;
  return {
    version: CHOREO_VERSION,
    id: demoChoreoId(m.id),
    title: m.title,
    bpm: m.bpm,
    offsetMs: 0,
    accentColor: palette.accent,
    secondaryColor: palette.secondary,
    frames,
    moves: moves.filter((mv) => mv.timeMs >= introEndMs),
    createdAt: 0,
    updatedAt: 0,
  };
}
