import type { MotionClip, MotionPack } from "../types";
import type { ClipRef, GenerationInput, Plan, PlannedPhrase } from "./types";

/**
 * Move selection (replaceable stage of the generator): a weighted Markov chain over the motion
 * pack's transitions, filtered by style, difficulty and tempo. One clip sequence per phrase key,
 * so repeated phrases are identical. Deterministic for a given `random`.
 */

/** Clips below this energy are rest poses (demo `neutral`): intro pose, never a move. */
export const MIN_MOVE_ENERGY = 0.1;
/** Clips with their own tempo only within ±12 % of the song (else hurried or sluggish). */
export const TEMPO_TOLERANCE = 0.12;
/** Weight of every transition; observed transitions add their count on top. */
export const BASE_TRANSITION_WEIGHT = 1;
/** Standard deviation of the energy fit (clip energy vs. phrase target). */
export const ENERGY_SIGMA = 0.25;
/** The mirror partner of the previous clip is this much more likely (left, then right). */
export const MIRROR_BONUS = 4;
/** Clips of exactly the chosen difficulty are this much more likely than easier ones. */
export const LEVEL_BONUS = 2;

/** Clips usable as moves for this input, sorted by id (deterministic iteration). */
export function moveCandidates(pack: MotionPack, input: GenerationInput): MotionClip[] {
  const fits = (c: MotionClip) =>
    c.difficulty <= input.difficulty &&
    c.energy >= MIN_MOVE_ENERGY &&
    (c.sourceBpm === undefined || Math.abs(input.bpm / c.sourceBpm - 1) <= TEMPO_TOLERANCE);
  const inStyle = pack.clips.filter((c) => c.styles.includes(input.style) && fits(c));
  // An unknown style falls back to every style rather than failing.
  const pool = inStyle.length ? inStyle : pack.clips.filter(fits);
  return pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Pick an index with probability proportional to its weight; null if all weights are 0. */
export function weightedPick(weights: readonly number[], random: () => number): number | null {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return null;
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  // Rounding left a remainder: the last positive weight.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i]! > 0) return i;
  return null;
}

interface Context {
  input: GenerationInput;
  candidates: MotionClip[];
  byId: Map<string, MotionClip>;
  transitions: Record<string, Record<string, number>>;
  random: () => number;
}

/** Previous clip and whether it already answered its own predecessor as a mirror. */
interface Prev {
  id: string | null;
  mirrored: boolean;
}

function weightOf(ctx: Context, c: MotionClip, prev: Prev, target: number): number {
  const count = prev.id ? (ctx.transitions[prev.id]?.[c.id] ?? 0) : 0;
  const fit = Math.exp(-0.5 * ((c.energy - target) / ENERGY_SIGMA) ** 2);
  const prevClip = prev.id ? ctx.byId.get(prev.id) : undefined;
  // Prefer the mirror partner right after, but not back again (left, right, left).
  const mirror = prevClip?.mirrorOf === c.id && !prev.mirrored ? MIRROR_BONUS : 1;
  const level = c.difficulty === ctx.input.difficulty ? LEVEL_BONUS : 1;
  return (BASE_TRANSITION_WEIGHT + count) * fit * mirror * level * c.playability;
}

/**
 * One clip: weighted pick among `pool` minus `exclude` and the previous clip. Exclusions are
 * relaxed step by step if they leave nothing (tiny packs): first `exclude`, then the previous.
 */
function pick(
  ctx: Context,
  pool: readonly MotionClip[],
  prev: Prev,
  target: number,
  exclude: ReadonlySet<string>,
): MotionClip {
  const attempts = [
    pool.filter((c) => c.id !== prev.id && !exclude.has(c.id)),
    pool.filter((c) => c.id !== prev.id),
    pool,
  ];
  for (const options of attempts) {
    const i = weightedPick(
      options.map((c) => weightOf(ctx, c, prev, target)),
      ctx.random,
    );
    if (i !== null) return options[i]!;
  }
  throw new Error("Motion-Paket enthält keine passenden Clips");
}

const nextPrev = (ctx: Context, prev: Prev, id: string): Prev => ({
  id,
  mirrored: ctx.byId.get(prev.id ?? "")?.mirrorOf === id && !prev.mirrored,
});

/**
 * Chooses clips for the plan. Phrase keys are filled in order of first occurrence; later
 * occurrences repeat the sequence. A clip never directly follows itself, also across phrase
 * boundaries: the first slot avoids the clip every already chosen phrase ends on where it
 * precedes this one, and the slot an occurrence ends on avoids the first clip of every chosen
 * phrase that follows that occurrence (shortened occurrences end before the last slot).
 * The closing pose is a symmetric clip (no mirror partner), weighted toward high energy.
 */
export function selectMoves(
  plan: Plan,
  pack: MotionPack,
  input: GenerationInput,
  random: () => number,
): ClipRef[] {
  if (!plan.final) return []; // song too short for any move: no clip needed
  const candidates = moveCandidates(pack, input);
  if (!candidates.length) throw new Error("Motion-Paket enthält keine passenden Clips");
  const ctx: Context = {
    input,
    candidates,
    byId: new Map(pack.clips.map((c) => [c.id, c])),
    transitions: pack.transitions[input.style] ?? {},
    random,
  };

  const { phrases } = plan;
  // Neighbours per phrase key, with the slot count of the occurrence: a shortened occurrence
  // (fewer slots than the key's sequence) ends on an earlier clip, which must not repeat either.
  const preds = new Map<string, { key: string; slots: number }[]>();
  const succs = new Map<string, { key: string; slots: number }[]>();
  const link = (map: typeof preds, key: string, other: { key: string; slots: number }) =>
    map.set(key, [...(map.get(key) ?? []), other]);
  phrases.forEach((p, i) => {
    const next = phrases[i + 1];
    if (!next) return;
    link(succs, p.key, { key: next.key, slots: p.slots.length });
    link(preds, next.key, { key: p.key, slots: p.slots.length });
  });
  const slotCount = new Map<string, number>();
  for (const p of phrases)
    slotCount.set(p.key, Math.max(slotCount.get(p.key) ?? 0, p.slots.length));

  const content = new Map<string, string[]>();
  const out: ClipRef[] = [];
  let prev: Prev = { id: null, mirrored: false };

  const choose = (p: PlannedPhrase): string[] => {
    const n = slotCount.get(p.key)!;
    const seq: string[] = [];
    let local = prev;
    for (let j = 0; j < n; j++) {
      const exclude = new Set<string>();
      if (j === 0)
        for (const pred of preds.get(p.key) ?? []) {
          const last = content.get(pred.key)?.[pred.slots - 1];
          if (last) exclude.add(last);
        }
      // First clips of the successors of every occurrence that ends with this slot.
      for (const succ of succs.get(p.key) ?? []) {
        if (succ.slots !== j + 1) continue;
        const first = succ.key === p.key ? seq[0] : content.get(succ.key)?.[0];
        if (first) exclude.add(first);
      }
      const slotLen = p.slots[j]?.lengthBeats ?? p.slots[0]!.lengthBeats;
      const pool = ctx.candidates.filter((c) => c.beats <= slotLen);
      const c = pick(ctx, pool.length ? pool : ctx.candidates, local, p.energy, exclude);
      seq.push(c.id);
      local = nextPrev(ctx, local, c.id);
    }
    return seq;
  };

  for (const p of phrases) {
    const seq = content.get(p.key) ?? choose(p);
    content.set(p.key, seq);
    p.slots.forEach((slot, j) => {
      const clipId = seq[j]!;
      out.push({ clipId, beat: slot.beat, lengthBeats: slot.lengthBeats, gold: slot.gold });
      prev = nextPrev(ctx, prev, clipId);
    });
  }

  if (plan.final) {
    const f = plan.final;
    const fitting = ctx.candidates.filter((c) => c.beats <= Math.max(1, f.lengthBeats));
    const symmetric = fitting.filter((c) => c.mirrorOf === undefined);
    const pool = symmetric.length ? symmetric : fitting.length ? fitting : ctx.candidates;
    const weights = pool.map((c) => (c.id === prev.id ? 0 : c.energy ** 2 * c.playability));
    const i = weightedPick(weights, random) ?? 0;
    out.push({ clipId: pool[i]!.id, beat: f.beat, lengthBeats: f.lengthBeats, gold: f.gold });
  }
  return out;
}
