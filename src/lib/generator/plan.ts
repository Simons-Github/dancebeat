import type { EnergyCurve, GenerationInput, Plan, PlannedPhrase, SectionKind, Slot } from "./types";

/**
 * Song structure of a generated choreography (docs/choreography-format.md#generator): an intro
 * without moves, then phrases of PHRASE_BEATS beats in groups of four (A A B A). Groups alternate
 * between verse (fresh phrases each time) and chorus (always the same phrases), so the chorus is
 * recognisable. Pure logic, no randomness: the plan depends only on tempo, length, difficulty and
 * the energy curve.
 */

export const PHRASE_BEATS = 8;
/** Phrase pattern of a group; equal letters within a group are the same phrase. */
export const GROUP_PATTERN = ["A", "A", "B", "A"] as const;
/** The intro lasts 4 beats, or 8 if 4 beats end before this time (fast songs). */
export const MIN_INTRO_MS = 2000;
/** Beats between the last move and the end of the song (the move's window must close first). */
export const END_MARGIN_BEATS = 2;
/**
 * Beats per move by difficulty before the energy adjustment. 4 / 4 / 2 since the Gerätetest
 * 2026-10-27 (B8: too many moves too fast on every level; before 2 / 2 / 1).
 */
export const BASE_STEP_BEATS: Record<1 | 2 | 3, number> = { 1: 4, 2: 4, 3: 2 };
/** Phrases below this energy get half as many moves. */
export const LOW_ENERGY = 1 / 3;
/** Phrases at or above this energy get twice as many moves (difficulty 2 and 3). */
export const HIGH_ENERGY = 2 / 3;
/**
 * Moves closer than this are too fast to copy; the step doubles until it is reached. 700 since
 * the Gerätetest 2026-10-27 (B8, before 400): one beat stays a step only below 86 BPM.
 */
export const MIN_STEP_MS = 700;
/** Largest step: two moves per phrase. */
export const MAX_STEP_BEATS = 4;
/**
 * Phrase energy without an energy curve: the verse calmer than the chorus, B livelier than A.
 * Chorus B stays below HIGH_ENERGY, so only a measured curve makes difficulty 2 denser.
 */
export const STRUCTURE_ENERGY: Record<SectionKind, Record<"A" | "B", number>> = {
  verse: { A: 0.3, B: 0.5 },
  chorus: { A: 0.55, B: 0.65 },
};
/** Target clip energy for phrase energy 0 and 1 (linear in between). */
export const TARGET_ENERGY_RANGE: readonly [number, number] = [0.2, 0.8];

export const beatMsOf = (bpm: number) => 60000 / bpm;

/**
 * Beat phase `phaseMs` folded into one beat, [0, beat), rounded to 0.1 ms; 0 for an invalid
 * tempo or phase. Generated choreographies store it as `choreo.offsetMs` (Gerätetest 2026-10-27,
 * B7): beat pulse, sync test and editor expect the beats on k · beat in choreography time.
 */
export function phaseWithinBeat(bpm: number, phaseMs: number): number {
  const beatMs = beatMsOf(bpm);
  if (!(beatMs > 0) || !Number.isFinite(beatMs) || !Number.isFinite(phaseMs)) return 0;
  const p = Math.round((((phaseMs % beatMs) + beatMs) % beatMs) * 10) / 10;
  return p >= beatMs ? 0 : p;
}

/** The curve as seen from `offsetMs` on: step i is the original step at i + offsetMs / hopMs. */
export function shiftEnergy(curve: EnergyCurve, offsetMs: number): EnergyCurve {
  const shift = Math.round(offsetMs / curve.hopMs);
  if (!Number.isFinite(shift) || shift <= 0) return curve;
  const values = Array.from(
    { length: Math.max(0, curve.values.length - shift) },
    (_, i) => curve.values[i + shift] ?? 0,
  );
  return { hopMs: curve.hopMs, values };
}

/** Mean of the finite curve values in [fromMs, toMs); null if there are none. */
export function meanEnergy(curve: EnergyCurve, fromMs: number, toMs: number): number | null {
  if (!(curve.hopMs > 0)) return null;
  const a = Math.max(0, Math.floor(fromMs / curve.hopMs));
  const b = Math.min(curve.values.length, Math.ceil(toMs / curve.hopMs));
  if (b <= a) return null;
  // Non-finite values are skipped: a NaN would make the ranking engine-dependent.
  let sum = 0,
    n = 0;
  for (let i = a; i < b; i++) {
    const v = curve.values[i];
    if (v !== undefined && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : null;
}

/**
 * Rank of each value among all values as 0..1 (lowest 0, highest 1, ties share the mean rank);
 * a single value gets 0.5. Ranks make the energy independent of the curve's scale.
 */
export function percentileRanks(values: readonly number[]): number[] {
  if (values.length < 2) return values.map(() => 0.5);
  const order = values.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const ranks: number[] = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const rank = (i + j) / 2 / (values.length - 1);
    for (let k = i; k <= j; k++) ranks[order[k]![1]] = rank;
    i = j + 1;
  }
  return ranks;
}

/** Beats per move for a phrase: difficulty, energy, then at least MIN_STEP_MS apart. */
export function stepBeats(difficulty: 1 | 2 | 3, energy: number, beatMs: number): number {
  let step = BASE_STEP_BEATS[difficulty];
  if (energy < LOW_ENERGY) step *= 2;
  else if (energy >= HIGH_ENERGY && difficulty >= 2) step /= 2;
  step = Math.max(1, Math.min(MAX_STEP_BEATS, step));
  while (step < MAX_STEP_BEATS && step * beatMs < MIN_STEP_MS) step *= 2;
  return step;
}

export const targetEnergy = (phraseEnergy: number) =>
  TARGET_ENERGY_RANGE[0] + (TARGET_ENERGY_RANGE[1] - TARGET_ENERGY_RANGE[0]) * phraseEnergy;

interface Skeleton {
  key: string;
  section: SectionKind;
  letter: "A" | "B";
  startBeat: number;
}

/**
 * Plans the song: phrase layout, density per phrase, gold slots and the closing pose.
 *
 * - Beat k lies at `beatPhaseMs + k · beat` (phase normalised to one beat); the intro covers
 *   the beats before the first phrase (shortened for short songs, at least one beat), the
 *   last move is END_MARGIN_BEATS before the end.
 * - Phrases with the same key share density and slots, so they can repeat exactly.
 * - Gold: last slot of every chorus B phrase (the first B phrase if the song has no chorus),
 *   the last slot of the loudest phrase when an energy curve is given, and the closing pose.
 * - The closing pose replaces the last planned slot; a song too short for any slot has none.
 */
export function planStructure(input: GenerationInput): Plan {
  const beatMs = beatMsOf(input.bpm);
  const phase = ((input.beatPhaseMs % beatMs) + beatMs) % beatMs;
  const timeOf = (beat: number) => phase + beat * beatMs;
  const lastMoveBeat = Math.floor((input.durationMs - phase) / beatMs) - END_MARGIN_BEATS;
  // Short songs shorten the intro, but at least one beat stays without moves.
  const introBeats = Math.min(timeOf(4) >= MIN_INTRO_MS ? 4 : 8, Math.max(1, lastMoveBeat));
  const base = { bpm: input.bpm, beatPhaseMs: phase, durationMs: input.durationMs, introBeats };
  if (lastMoveBeat < introBeats) return { ...base, phrases: [], final: null };

  // Phrase layout: groups alternate verse / chorus.
  const layout: Skeleton[] = [];
  for (let start = introBeats, i = 0; start <= lastMoveBeat; start += PHRASE_BEATS, i++) {
    const group = Math.floor(i / GROUP_PATTERN.length);
    const letter = GROUP_PATTERN[i % GROUP_PATTERN.length]!;
    const section: SectionKind = group % 2 === 0 ? "verse" : "chorus";
    const key = section === "chorus" ? `chorus-${letter}` : `verse${group / 2}-${letter}`;
    layout.push({ key, section, letter, startBeat: start });
  }

  // Energy per phrase: measured (rank among phrases) or from the structure.
  const measured = input.energy
    ? layout.map((p) =>
        meanEnergy(input.energy!, timeOf(p.startBeat), timeOf(p.startBeat + PHRASE_BEATS)),
      )
    : null;
  const usable = measured?.every((m) => m !== null) ? (measured as number[]) : null;
  const ranks = usable ? percentileRanks(usable) : null;
  const phraseEnergy = layout.map((p, i) => ranks?.[i] ?? STRUCTURE_ENERGY[p.section][p.letter]);
  // Shared per key (mean over its occurrences), so repeated phrases keep the same slots.
  const keyEnergy = new Map<string, number>();
  for (const key of new Set(layout.map((p) => p.key))) {
    const e = layout.flatMap((p, i) => (p.key === key ? [phraseEnergy[i]!] : []));
    keyEnergy.set(key, e.reduce((s, x) => s + x, 0) / e.length);
  }

  const phrases: PlannedPhrase[] = layout.map((p) => {
    const energy = keyEnergy.get(p.key)!;
    const step = stepBeats(input.difficulty, energy, beatMs);
    const slots: Slot[] = [];
    for (let b = 0; b < PHRASE_BEATS && p.startBeat + b <= lastMoveBeat; b += step)
      slots.push({ beat: p.startBeat + b, lengthBeats: step, gold: false });
    return {
      key: p.key,
      section: p.section,
      startBeat: p.startBeat,
      beats: PHRASE_BEATS,
      slots,
      energy: targetEnergy(energy),
    };
  });

  // Gold slots.
  const lastSlot = (p: PlannedPhrase | undefined) => p?.slots[p.slots.length - 1];
  const bPhrases = phrases.filter((_, i) => layout[i]!.letter === "B");
  const chorusB = bPhrases.filter((p) => p.section === "chorus");
  for (const p of chorusB.length ? chorusB : bPhrases.slice(0, 1)) lastSlot(p)!.gold = true;
  if (usable) {
    const loudest = usable.indexOf(Math.max(...usable));
    const slot = lastSlot(phrases[loudest]);
    if (slot) slot.gold = true;
  }

  // Closing pose: replaces the last slot and lasts until the end of the song.
  const lastPhrase = phrases[phrases.length - 1];
  const finalSlot = lastPhrase?.slots.pop();
  if (!finalSlot || !lastPhrase) return { ...base, phrases: [], final: null };
  if (!lastPhrase.slots.length) phrases.pop();
  const endBeat = (input.durationMs - phase) / beatMs;
  return {
    ...base,
    phrases,
    final: { beat: finalSlot.beat, lengthBeats: endBeat - finalSlot.beat, gold: true },
  };
}
