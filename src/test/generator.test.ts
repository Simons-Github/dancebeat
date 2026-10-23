import { beforeAll, describe, expect, it } from "vitest";

import { autoChoreo } from "@/data/demo";
import { simulatedAngles } from "@/lib/game/simulatedPlayer";
import {
  BASE_STEP_BEATS,
  BLEND_BEATS,
  END_MARGIN_BEATS,
  GROUP_PATTERN,
  MAX_STEP_BEATS,
  MIN_INTRO_MS,
  MIN_MOVE_ENERGY,
  MIN_STEP_MS,
  PHRASE_BEATS,
  TEMPO_TOLERANCE,
  beatMsOf,
  generateChoreo,
  moveCandidates,
  planStructure,
  realizeFrames,
  selectMoves,
  type ClipRef,
  type EnergyCurve,
  type GenerationInput,
  type Plan,
} from "@/lib/generator";
import { isAistClip, loadMotionPack } from "@/lib/motionPack";
import { computeAngles, figure3d, type FigureParams } from "@/lib/pose";
import { roundSkeleton } from "@/lib/precision";
import { randomFromString } from "@/lib/random";
import { ChoreographySchema, MOTION_PACK_VERSION, MotionPackSchema } from "@/lib/schema";
import { Scorer } from "@/lib/scorer";
import { movePoints, nextCombo } from "@/lib/scoring";
import type { Choreography, MotionClip, MotionPack, Move } from "@/lib/types";
import { MIN_MOVE_GAP_MS } from "@/lib/videoChoreo";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

let PACK: MotionPack;
beforeAll(async () => {
  PACK = await loadMotionPack();
});

const COLORS: [string, string] = ["#FF2E93", "#00E5FF"];

const input = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  bpm: 128,
  beatPhaseMs: 0,
  durationMs: 60_000,
  style: "party",
  difficulty: 2,
  seed: "song-1",
  ...over,
});

/** Same pipeline as `generateChoreo`, but keeps the plan and the clip refs for inspection. */
function pipeline(inp: GenerationInput, pack: MotionPack = PACK) {
  const plan = planStructure(inp);
  const clips = selectMoves(plan, pack, inp, randomFromString(inp.seed));
  const out = realizeFrames(plan, clips, pack);
  return { plan, clips, ...out };
}

const choreoOf = (inp: GenerationInput, pack: MotionPack = PACK): Choreography =>
  autoChoreo("Test", inp.bpm, inp.durationMs, COLORS, pack, {
    seed: inp.seed,
    id: "00000000-0000-4000-8000-000000000000",
    difficulty: inp.difficulty,
    beatPhaseMs: inp.beatPhaseMs,
    style: inp.style,
    ...(inp.energy ? { energy: inp.energy } : {}),
  });

const phaseOf = (bpm: number, beatPhaseMs: number) => {
  const b = beatMsOf(bpm);
  return ((beatPhaseMs % b) + b) % b;
};

/** Last beat a move may start on (independent re-derivation of the plan's margin). */
const lastMoveBeatOf = (inp: GenerationInput) =>
  Math.floor((inp.durationMs - phaseOf(inp.bpm, inp.beatPhaseMs)) / beatMsOf(inp.bpm)) -
  END_MARGIN_BEATS;

/** Beat index of a move time (shipped pack: every anchor is on beat 0 of its clip). */
const beatOfTime = (inp: GenerationInput, t: number) =>
  (t - phaseOf(inp.bpm, inp.beatPhaseMs)) / beatMsOf(inp.bpm);

interface Phrase {
  index: number;
  letter: "A" | "B";
  section: "verse" | "chorus";
  group: number;
  startBeat: number;
}

/** Phrase layout derived from the spec (not from the plan): intro, then 8-beat phrases. */
function specLayout(inp: GenerationInput, introBeats: number): Phrase[] {
  const out: Phrase[] = [];
  const last = lastMoveBeatOf(inp);
  for (let s = introBeats, i = 0; s <= last; s += PHRASE_BEATS, i++) {
    const group = Math.floor(i / 4);
    out.push({
      index: i,
      letter: GROUP_PATTERN[i % 4]!,
      section: group % 2 === 0 ? "verse" : "chorus",
      group,
      startBeat: s,
    });
  }
  return out;
}

/** Moves grouped by the phrase whose beat span contains them (closing pose included). */
function movesByPhrase(inp: GenerationInput, phrases: Phrase[], moves: Move[]) {
  return phrases.map((p) =>
    moves.filter((m) => {
      const b = beatOfTime(inp, m.timeMs);
      return b >= p.startBeat - 1e-6 && b < p.startBeat + PHRASE_BEATS - 1e-6;
    }),
  );
}

const clipByIcon = (pack: MotionPack) => new Map(pack.clips.map((c) => [c.iconId ?? c.id, c]));

/** Hand-made clip: a held pose of one beat (like the demo clips). */
function clip(id: string, p: FigureParams, extra: Partial<MotionClip> = {}): MotionClip {
  const sk = figure3d(p);
  return {
    id,
    label: id,
    iconId: id,
    styles: ["party"],
    difficulty: 1,
    energy: 0.5,
    beats: 1,
    anchorBeat: 0,
    keyframes: [
      { beat: 0, pose3d: sk },
      { beat: 1, pose3d: sk },
    ],
    playability: 1,
    source: "test",
    ...extra,
  };
}

function makePack(clips: MotionClip[], transitions: MotionPack["transitions"] = {}): MotionPack {
  const pack = { version: MOTION_PACK_VERSION, clips, transitions };
  // Fixtures must be real packs.
  return MotionPackSchema.parse(pack);
}

const restClip = () => clip("rest", { la: 10, ra: 10 }, { energy: 0, label: "Locker" });

const SEEDS = Array.from({ length: 40 }, (_, i) => `seed-${i}`);

// ---------------------------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------------------------

describe("determinism", () => {
  it("same input and seed give deep-equal output", () => {
    for (const difficulty of [1, 2, 3] as const) {
      const inp = input({ difficulty, durationMs: 90_000, beatPhaseMs: 123 });
      expect(generateChoreo(inp, PACK)).toEqual(generateChoreo({ ...inp }, PACK));
    }
    const a = choreoOf(input());
    const b = choreoOf(input());
    expect({ ...a, createdAt: 0, updatedAt: 0 }).toEqual({ ...b, createdAt: 0, updatedAt: 0 });
  });

  it("different seeds give different move sequences (pairwise over 12 seeds)", () => {
    for (const difficulty of [1, 2, 3] as const) {
      const seqs = SEEDS.slice(0, 12).map((seed) =>
        generateChoreo(input({ seed, difficulty }), PACK)
          .moves.map((m) => m.iconId)
          .join(","),
      );
      expect(new Set(seqs).size).toBe(seqs.length);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Validity over a grid of tempos, difficulties, lengths and phases
// ---------------------------------------------------------------------------------------------

describe("validity grid", () => {
  const BPMS = [30, 60, 90, 128, 150, 200, 300];
  const DURATIONS = [10_000, 60_000, 600_000];
  const PHASES = [0, 137, -250];

  it("every choreography passes the schema, is on the beat grid and keeps its margins", () => {
    let checked = 0;
    for (const bpm of BPMS)
      for (const difficulty of [1, 2, 3] as const)
        for (const durationMs of DURATIONS)
          for (const beatPhaseMs of PHASES) {
            const inp = input({ bpm, difficulty, durationMs, beatPhaseMs, seed: `g${bpm}` });
            const ctx = `bpm ${bpm} d${difficulty} ${durationMs} ms phase ${beatPhaseMs}`;
            const c = choreoOf(inp);
            const parsed = ChoreographySchema.safeParse(c);
            expect(parsed.success, `${ctx}: ${parsed.error?.message ?? ""}`).toBe(true);

            const plan = planStructure(inp);
            const beatMs = beatMsOf(bpm);
            const phase = phaseOf(bpm, beatPhaseMs);
            expect(plan.beatPhaseMs, ctx).toBeCloseTo(phase, 6);
            expect(plan.beatPhaseMs >= 0 && plan.beatPhaseMs < beatMs, ctx).toBe(true);

            const t = c.moves.map((m) => m.timeMs);
            expect(t.length, ctx).toBeGreaterThan(0);
            for (let i = 1; i < t.length; i++) {
              expect(t[i]! - t[i - 1]!, `${ctx} gap #${i}`).toBeGreaterThanOrEqual(MIN_MOVE_GAP_MS);
            }
            for (const x of t) {
              const k = Math.round((x - phase) / beatMs);
              expect(Math.abs(phase + k * beatMs - x), `${ctx} on beat`).toBeLessThanOrEqual(1);
            }
            const introEnd = phase + plan.introBeats * beatMs;
            expect(t[0]!, `${ctx} intro`).toBeGreaterThanOrEqual(introEnd - 1);
            expect(t.at(-1)!, `${ctx} end margin`).toBeLessThanOrEqual(
              durationMs - END_MARGIN_BEATS * beatMs + 1,
            );
            // Intro rule wherever the nominal intro fits into the song.
            const nominal = phase + 4 * beatMs >= MIN_INTRO_MS ? 4 : 8;
            if (lastMoveBeatOf(inp) >= nominal) expect(plan.introBeats, ctx).toBe(nominal);
            checked++;
          }
    expect(checked).toBe(BPMS.length * 3 * DURATIONS.length * PHASES.length);
  }, 120_000);

  it("plan density: step 1, 2 or 4 beats, at least MIN_STEP_MS unless already 4 beats", () => {
    for (const bpm of BPMS)
      for (const difficulty of [1, 2, 3] as const) {
        const plan = planStructure(input({ bpm, difficulty, durationMs: 300_000 }));
        const beatMs = beatMsOf(bpm);
        for (const p of plan.phrases) {
          const steps = new Set(p.slots.map((s) => s.lengthBeats));
          expect(steps.size).toBe(1);
          const step = [...steps][0]!;
          expect([1, 2, 4]).toContain(step);
          if (step < MAX_STEP_BEATS) expect(step * beatMs).toBeGreaterThanOrEqual(MIN_STEP_MS);
          p.slots.forEach((s, j) => expect(s.beat).toBe(p.startBeat + j * step));
        }
      }
  });
});

// ---------------------------------------------------------------------------------------------
// planStructure
// ---------------------------------------------------------------------------------------------

describe("planStructure", () => {
  it("lays out intro, 8-beat phrases, A A B A groups and alternating verse / chorus keys", () => {
    const inp = input({ durationMs: 240_000 });
    const plan = planStructure(inp);
    const spec = specLayout(inp, plan.introBeats);
    // 128 BPM: 4 beats = 1875 ms < MIN_INTRO_MS, so the intro has 8 beats.
    expect(plan.introBeats).toBe(8);
    expect(spec.length).toBeGreaterThan(12);
    // The closing pose may remove a one-slot last phrase; all others are in the plan.
    expect(plan.phrases.length).toBeGreaterThanOrEqual(spec.length - 1);
    plan.phrases.forEach((p, i) => {
      const s = spec[i]!;
      expect(p.startBeat).toBe(s.startBeat);
      expect(p.beats).toBe(PHRASE_BEATS);
      expect(p.section).toBe(s.section);
      if (s.section === "chorus") expect(p.key).toBe(`chorus-${s.letter}`);
      else expect(p.key.endsWith(`-${s.letter}`)).toBe(true);
    });
    // Verse keys are fresh per verse group, A/B differ within a group.
    const verseKeys = new Map<number, Set<string>>();
    plan.phrases.forEach((p, i) => {
      if (p.section !== "verse") return;
      const g = spec[i]!.group;
      verseKeys.set(g, (verseKeys.get(g) ?? new Set()).add(p.key));
    });
    const groups = [...verseKeys.values()];
    expect(groups.length).toBeGreaterThan(1);
    for (const keys of groups) expect(keys.size).toBe(2);
    const all = groups.flatMap((k) => [...k]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses a 4-beat intro for slow songs", () => {
    expect(planStructure(input({ bpm: 90 })).introBeats).toBe(4);
    expect(planStructure(input({ bpm: 128 })).introBeats).toBe(8);
  });

  it("chooses density from difficulty and structure energy", () => {
    // Without a curve: verse A 0.3 (< LOW_ENERGY → step doubles), the rest normal.
    const plan = planStructure(input({ difficulty: 1, durationMs: 240_000 }));
    const verseA = plan.phrases.find((p) => p.section === "verse")!;
    const chorusA = plan.phrases.find((p) => p.key === "chorus-A")!;
    expect(verseA.slots[0]!.lengthBeats).toBe(BASE_STEP_BEATS[1] * 2);
    expect(chorusA.slots[0]!.lengthBeats).toBe(BASE_STEP_BEATS[1]);
    const hard = planStructure(input({ difficulty: 3, durationMs: 240_000 }));
    expect(hard.phrases.find((p) => p.key === "chorus-A")!.slots[0]!.lengthBeats).toBe(1);
  });

  it("returns no phrases and no closing pose when the song is shorter than the margin", () => {
    const inp = input({ durationMs: 500 });
    const plan = planStructure(inp);
    expect(plan.phrases).toEqual([]);
    expect(plan.final).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Structure in the output
// ---------------------------------------------------------------------------------------------

describe("repetition structure", () => {
  it("same key → same clip sequence; choruses and A phrases of a group identical", () => {
    for (const difficulty of [1, 2, 3] as const)
      for (const seed of SEEDS.slice(0, 10)) {
        const inp = input({ difficulty, seed, durationMs: 200_000, beatPhaseMs: 77 });
        const { plan, moves } = pipeline(inp);
        const spec = specLayout(inp, plan.introBeats);
        const perPhrase = movesByPhrase(inp, spec, moves).map((ms) => ms.map((m) => m.iconId));
        // The closing pose replaces the last slot of the last phrase: leave that phrase out.
        const full = spec.slice(0, -1);
        const keyOf = (p: Phrase) =>
          p.section === "chorus" ? `chorus-${p.letter}` : `v${p.group}-${p.letter}`;
        const byKey = new Map<string, string>();
        for (const p of full) {
          const seq = perPhrase[p.index]!.join(",");
          const seen = byKey.get(keyOf(p));
          if (seen === undefined) byKey.set(keyOf(p), seq);
          else expect(seq, `${seed} d${difficulty} phrase ${p.index}`).toBe(seen);
        }
        expect(full.some((p) => p.section === "chorus")).toBe(true);
        // Also cross-check with the plan's keys.
        plan.phrases.slice(0, full.length).forEach((p, i) => {
          expect(byKey.get(keyOf(spec[i]!))).toBe(perPhrase[i]!.join(","));
          expect(p.key.startsWith("chorus") ? "chorus" : "verse").toBe(spec[i]!.section);
        });
      }
  });
});

// ---------------------------------------------------------------------------------------------
// selectMoves
// ---------------------------------------------------------------------------------------------

describe("selectMoves", () => {
  it("never repeats a move directly (shipped pack, all difficulties, many seeds)", () => {
    for (const difficulty of [1, 2, 3] as const)
      for (const bpm of [90, 128, 150])
        for (const seed of SEEDS) {
          const { moves } = generateChoreo(
            input({ difficulty, bpm, seed, durationMs: 120_000 }),
            PACK,
          );
          for (let i = 1; i < moves.length; i++)
            expect(moves[i]!.iconId, `${seed} d${difficulty} ${bpm} #${i}`).not.toBe(
              moves[i - 1]!.iconId,
            );
        }
  });

  it("prefers the mirror partner right after a mirrored clip", () => {
    // Statistic: P(next move = mirror partner | move has mirrorOf and is not itself the answer
    // to its partner), over 40 seeds × 2 minutes, compared with a uniform pick among the other
    // candidates, 1 / (candidates − 1). Answers are left out because the generator deliberately
    // avoids going back (left, right, left).
    for (const difficulty of [1, 2] as const) {
      const byIcon = clipByIcon(PACK);
      const n = moveCandidates(PACK, input({ difficulty })).length;
      let hits = 0,
        total = 0;
      for (const seed of SEEDS) {
        const { moves } = generateChoreo(input({ difficulty, seed, durationMs: 120_000 }), PACK);
        const ids = moves.map((m) => byIcon.get(m.iconId)!);
        for (let i = 0; i + 1 < ids.length; i++) {
          const c = ids[i]!;
          if (!c.mirrorOf || ids[i - 1]?.id === c.mirrorOf) continue;
          total++;
          if (ids[i + 1]!.id === c.mirrorOf) hits++;
        }
      }
      const chance = 1 / (n - 1);
      console.info(
        `mirror d${difficulty}: ${hits}/${total} = ${(hits / total).toFixed(3)}, chance ${chance.toFixed(3)}`,
      );
      expect(total).toBeGreaterThan(100);
      // Twice the chance rate; with > 1000 samples that is far outside random variation.
      expect(hits / total).toBeGreaterThan(2 * chance);
    }
  });

  it("difficulty 1 uses no difficulty-2 clips, difficulty 2 and 3 use leg moves", () => {
    const byIcon = clipByIcon(PACK);
    // The demo leg moves; AIST++ clips of difficulty 2 only fit some tempos, so they are not listed.
    const hard = new Set(
      PACK.clips.filter((c) => c.difficulty > 1 && !isAistClip(c)).map((c) => c.iconId),
    );
    expect(hard).toEqual(new Set(["kick-l", "kick-r", "squat", "star"]));
    for (const seed of SEEDS) {
      const { moves } = generateChoreo(input({ difficulty: 1, seed, durationMs: 120_000 }), PACK);
      for (const m of moves) expect(byIcon.get(m.iconId)!.difficulty).toBe(1);
    }
    for (const difficulty of [2, 3] as const) {
      const used = new Set(
        SEEDS.slice(0, 10).flatMap((seed) =>
          generateChoreo(input({ difficulty, seed, durationMs: 120_000 }), PACK).moves.map(
            (m) => m.iconId,
          ),
        ),
      );
      for (const id of hard) expect(used.has(id!), `d${difficulty} ${id}`).toBe(true);
    }
  });

  it("never uses a rest pose (energy below MIN_MOVE_ENERGY) as a move", () => {
    const rest = new Set(PACK.clips.filter((c) => c.energy < MIN_MOVE_ENERGY).map((c) => c.iconId));
    expect(rest.has("neutral")).toBe(true);
    for (const seed of SEEDS.slice(0, 10))
      for (const difficulty of [1, 2, 3] as const)
        for (const m of generateChoreo(input({ seed, difficulty }), PACK).moves)
          expect(rest.has(m.iconId)).toBe(false);
  });

  it("closing pose is a symmetric clip", () => {
    const byIcon = clipByIcon(PACK);
    for (const seed of SEEDS)
      for (const difficulty of [1, 2, 3] as const) {
        const { moves } = generateChoreo(input({ seed, difficulty }), PACK);
        expect(byIcon.get(moves.at(-1)!.iconId)!.mirrorOf).toBeUndefined();
      }
  });
});

// ---------------------------------------------------------------------------------------------
// Gold moves
// ---------------------------------------------------------------------------------------------

describe("gold moves", () => {
  it("sit on the last move of every chorus B phrase and on the closing pose", () => {
    for (const durationMs of [60_000, 180_000, 300_000])
      for (const difficulty of [1, 2, 3] as const) {
        const inp = input({ durationMs, difficulty, beatPhaseMs: 40 });
        const { plan, moves } = pipeline(inp);
        const spec = specLayout(inp, plan.introBeats);
        const per = movesByPhrase(inp, spec, moves);
        const chorusB = spec.filter((p) => p.section === "chorus" && p.letter === "B");
        const goldPhrases = chorusB.length
          ? chorusB
          : spec.filter((p) => p.letter === "B").slice(0, 1);
        const expected = new Set<number>(goldPhrases.map((p) => per[p.index]!.at(-1)!.timeMs));
        expected.add(moves.at(-1)!.timeMs);
        const actual = new Set(moves.filter((m) => m.gold).map((m) => m.timeMs));
        expect(actual, `${durationMs} d${difficulty}`).toEqual(expected);
        expect(moves.at(-1)!.gold).toBe(true);
        // Reasonable count: a few per song, never most moves.
        expect(actual.size).toBeGreaterThanOrEqual(1);
        expect(actual.size / moves.length).toBeLessThan(0.2);
      }
  });

  it("uses the first B phrase when the song has no chorus", () => {
    // 128 BPM, 8-beat intro: 19 s → last move beat 38, phrases at 8, 16, 24, 32 (one group).
    const inp = input({ durationMs: 19_000 });
    const { plan, moves } = pipeline(inp);
    const spec = specLayout(inp, plan.introBeats);
    expect(spec.every((p) => p.section === "verse")).toBe(true);
    const per = movesByPhrase(inp, spec, moves);
    const b = spec.find((p) => p.letter === "B")!;
    expect(per[b.index]!.at(-1)!.gold).toBe(true);
    expect(moves.filter((m) => m.gold).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Energy curve
// ---------------------------------------------------------------------------------------------

describe("energy curve", () => {
  const HOP = 50;
  const D = 180_000;
  const curve = (fn: (t: number) => number, untilMs = D): EnergyCurve => ({
    hopMs: HOP,
    values: Float32Array.from({ length: Math.ceil(untilMs / HOP) }, (_, i) => fn(i * HOP)),
  });

  it("makes loud phrases denser and more energetic than quiet ones; gold on the loudest", () => {
    const base = input({ durationMs: D, difficulty: 2 });
    const plain = planStructure(base);
    const beatMs = beatMsOf(base.bpm);
    // Spike in a verse B phrase in the loud half (not the last phrase).
    const spike = plain.phrases.find(
      (p) => p.section === "verse" && p.key.endsWith("-B") && p.startBeat * beatMs > D / 2,
    )!;
    expect(spike).toBeDefined();
    const s0 = spike.startBeat * beatMs,
      s1 = (spike.startBeat + PHRASE_BEATS) * beatMs;
    const energy = curve((t) => (t >= s0 && t < s1 ? 5 : t < D / 2 ? 0.1 : 1));
    const inp = { ...base, energy };
    const plan = planStructure(inp);

    const verses = plan.phrases.filter((p) => p.section === "verse");
    const quiet = verses.filter((p) => (p.startBeat + PHRASE_BEATS) * beatMs <= D / 2);
    const loud = verses.filter((p) => p.startBeat * beatMs >= D / 2);
    expect(quiet.length).toBeGreaterThan(0);
    expect(loud.length).toBeGreaterThan(0);
    const step = (p: (typeof verses)[number]) => p.slots[0]!.lengthBeats;
    expect(Math.min(...quiet.map(step))).toBeGreaterThan(Math.max(...loud.map(step)));
    expect(Math.min(...loud.map((p) => p.energy))).toBeGreaterThan(
      Math.max(...quiet.map((p) => p.energy)),
    );

    // Gold on the last slot of the loudest phrase (a verse B phrase is otherwise never gold).
    const spiked = plan.phrases.find((p) => p.startBeat === spike.startBeat)!;
    expect(spiked.slots.at(-1)!.gold).toBe(true);
    expect(spiked.slots.slice(0, -1).some((s) => s.gold)).toBe(false);

    // In the output: more moves and higher clip energy in loud verses (over 20 seeds).
    const byIcon = clipByIcon(PACK);
    let qMoves = 0,
      lMoves = 0,
      qEnergy = 0,
      lEnergy = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      const { moves } = generateChoreo({ ...inp, seed }, PACK);
      const inSpan = (ps: typeof verses) =>
        moves.filter((m) =>
          ps.some((p) => {
            const b = beatOfTime(inp, m.timeMs);
            return b >= p.startBeat && b < p.startBeat + PHRASE_BEATS;
          }),
        );
      const q = inSpan(quiet),
        l = inSpan(loud);
      qMoves += q.length / quiet.length;
      lMoves += l.length / loud.length;
      qEnergy += q.reduce((s, m) => s + byIcon.get(m.iconId)!.energy, 0) / q.length;
      lEnergy += l.reduce((s, m) => s + byIcon.get(m.iconId)!.energy, 0) / l.length;
      const goldMove = moves.find(
        (m) => Math.abs(m.timeMs - Math.round(spiked.slots.at(-1)!.beat * beatMs)) <= 1,
      );
      expect(goldMove?.gold).toBe(true);
    }
    expect(lMoves).toBeGreaterThan(qMoves * 2);
    expect(lEnergy).toBeGreaterThan(qEnergy);
  });

  it("falls back to structure energy when the curve does not reach every phrase", () => {
    const base = input({ durationMs: D });
    const short = { ...base, energy: curve((t) => (t < 30_000 ? 1 : 0.2), D * 0.6) };
    // Observed behaviour: one phrase without curve data drops the whole curve (plan as without).
    expect(planStructure(short)).toEqual(planStructure(base));
    expect(generateChoreo(short, PACK)).toEqual(generateChoreo(base, PACK));
    const broken = { ...base, energy: { hopMs: 0, values: [1, 2, 3] } };
    expect(planStructure(broken)).toEqual(planStructure(base));
  });
});

// ---------------------------------------------------------------------------------------------
// realizeFrames
// ---------------------------------------------------------------------------------------------

describe("realizeFrames", () => {
  it("frames: whole ms, strictly ascending, 33 landmarks, pose3d, angles from computeAngles", () => {
    for (const difficulty of [1, 3] as const) {
      const inp = input({ difficulty, beatPhaseMs: 211, durationMs: 45_500 });
      const { frames, moves } = generateChoreo(inp, PACK);
      expect(frames.length).toBeGreaterThan(moves.length);
      frames.forEach((f, i) => {
        expect(Number.isInteger(f.timeMs)).toBe(true);
        if (i > 0) expect(f.timeMs).toBeGreaterThan(frames[i - 1]!.timeMs);
        expect(f.landmarks).toHaveLength(33);
        expect(f.pose3d).toBeDefined();
        const expected = computeAngles(f.landmarks, { aspect: 1 });
        const keys = Object.keys(expected) as (keyof typeof expected)[];
        expect(Object.keys(f.angles).sort()).toEqual([...keys].sort());
        for (const k of keys)
          expect(Math.abs(f.angles[k]! - expected[k]!)).toBeLessThanOrEqual(0.05 + 1e-9);
      });
      const times = new Set(frames.map((f) => f.timeMs));
      for (const m of moves) {
        expect(Number.isInteger(m.timeMs)).toBe(true);
        expect(times.has(m.timeMs)).toBe(true);
      }
      expect(frames[0]!.timeMs).toBe(0);
      expect(frames.at(-1)!.timeMs).toBe(inp.durationMs);
    }
  });

  it("holds the rest pose (demo:neutral) during the intro", () => {
    const neutral = PACK.clips.find((c) => c.id === "demo:neutral")!;
    const rest = roundSkeleton(neutral.keyframes[0]!.pose3d);
    const inp = input({ bpm: 90 });
    const { plan, clips, frames } = pipeline(inp);
    const beatMs = beatMsOf(inp.bpm);
    // The first clip starts `anchorBeat` before its move; the blend into it BLEND_BEATS earlier.
    const first = clips[0]!;
    const firstClip = PACK.clips.find((c) => c.id === first.clipId)!;
    const startBeat = first.beat - firstClip.anchorBeat + firstClip.keyframes[0]!.beat;
    const blendStart = plan.beatPhaseMs + (startBeat - BLEND_BEATS) * beatMs;
    const intro = frames.filter((f) => f.timeMs <= blendStart);
    expect(intro.length).toBeGreaterThan(0);
    for (const f of intro) expect(f.pose3d).toEqual(rest);
  });

  it("places moves on the clip anchors with label and iconId of the clip", () => {
    const noIcon = clip("b", { la: 90, ra: 90 }, { label: "Beta" });
    delete noIcon.iconId;
    const pack = makePack([
      restClip(),
      clip(
        "a",
        { la: 170, ra: 170 },
        {
          label: "Alpha",
          iconId: "icon-a",
          beats: 2,
          anchorBeat: 1,
          keyframes: [
            { beat: 0, pose3d: figure3d({ la: 45, ra: 45 }) },
            { beat: 1, pose3d: figure3d({ la: 170, ra: 170 }) },
            { beat: 2, pose3d: figure3d({ la: 170, ra: 170 }) },
          ],
        },
      ),
      noIcon,
    ]);
    const plan: Plan = {
      bpm: 120,
      beatPhaseMs: 100,
      durationMs: 10_000,
      introBeats: 4,
      phrases: [],
      final: null,
    };
    const refs: ClipRef[] = [
      // The move lies on `beat`; clip a (anchor 1) therefore starts one beat earlier.
      { clipId: "a", beat: 5, lengthBeats: 3, gold: false },
      { clipId: "b", beat: 8, lengthBeats: 6, gold: true },
    ];
    const { moves, frames } = realizeFrames(plan, refs, pack);
    expect(moves).toEqual([
      { timeMs: 100 + 5 * 500, label: "Alpha", iconId: "icon-a", gold: false },
      { timeMs: 100 + 8 * 500, label: "Beta", iconId: "b", gold: true },
    ]);
    // Target pose at the anchor: the clip's anchor keyframe.
    const at = (t: number) => frames.find((f) => f.timeMs === t)!;
    expect(at(2100).pose3d).toEqual(roundSkeleton(figure3d({ la: 45, ra: 45 }))); // clip start
    expect(at(2600).pose3d).toEqual(roundSkeleton(figure3d({ la: 170, ra: 170 })));
    expect(at(4100).pose3d).toEqual(roundSkeleton(figure3d({ la: 90, ra: 90 })));
    expect(frames.at(-1)!.timeMs).toBe(10_000);
  });

  it("throws for unknown clip ids", () => {
    const plan = planStructure(input());
    expect(() =>
      realizeFrames(plan, [{ clipId: "nope", beat: 8, lengthBeats: 2, gold: false }], PACK),
    ).toThrow(/nope/);
  });
});

// ---------------------------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------------------------

describe("edge cases", () => {
  it("10 s at 30 BPM: one move (the intro is shortened to fit)", () => {
    const inp = input({ bpm: 30, durationMs: 10_000 });
    const { plan, moves } = pipeline(inp);
    // Beat 2000 ms; last move beat = 5 − 2 = 3 < nominal intro 4 → intro shortened to 3 beats.
    expect(plan.introBeats).toBe(3);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ timeMs: 6000, gold: true });
  });

  it("a song shorter than the margin yields no moves and a schema-valid choreography", () => {
    for (const durationMs of [0, 500, 900]) {
      const inp = input({ durationMs }); // 128 BPM: 2 beats = 937.5 ms
      const c = choreoOf(inp);
      expect(c.moves).toEqual([]);
      expect(ChoreographySchema.safeParse(c).success).toBe(true);
      // The coach stands in the rest pose for the whole (short) song.
      expect(c.frames.length).toBeGreaterThan(0);
      const neutral = PACK.clips.find((cl) => cl.id === "demo:neutral")!.keyframes[0]!.pose3d;
      for (const f of c.frames) expect(f.pose3d).toEqual(roundSkeleton(neutral));
    }
  });

  it("a pack with a single candidate clip does not throw", () => {
    const pack = makePack([restClip(), clip("only", { la: 90, ra: 90 })]);
    for (const difficulty of [1, 2, 3] as const) {
      const c = choreoOf(input({ difficulty }), pack);
      expect(c.moves.length).toBeGreaterThan(0);
      expect(new Set(c.moves.map((m) => m.iconId))).toEqual(new Set(["only"]));
      expect(ChoreographySchema.safeParse(c).success).toBe(true);
    }
  });

  it("falls back to all styles when no clip has the requested style", () => {
    const hip = (c: MotionClip): MotionClip => ({ ...c, styles: ["hiphop"] });
    const pack = makePack([
      hip(restClip()),
      hip(clip("x", { la: 90, ra: 90 })),
      hip(clip("y", { la: 170, ra: 10 })),
    ]);
    const c = choreoOf(input({ style: "party" }), pack);
    expect(c.moves.length).toBeGreaterThan(0);
    expect(new Set(c.moves.map((m) => m.iconId))).toEqual(new Set(["x", "y"]));
    // Prefers the style when one clip has it.
    const mixed = makePack([
      restClip(),
      clip("p", { la: 90, ra: 90 }),
      hip(clip("h", { la: 170, ra: 170 })),
    ]);
    expect(new Set(choreoOf(input(), mixed).moves.map((m) => m.iconId))).toEqual(new Set(["p"]));
  });

  it("throws an Error with a German message when no clip fits", () => {
    const tooHard = makePack([restClip(), clip("k", { la: 90, ra: 90 }, { difficulty: 3 })]);
    expect(() => generateChoreo(input({ difficulty: 1 }), tooHard)).toThrow(
      /Motion-Paket enthält keine passenden Clips/,
    );
    const onlyRest = makePack([restClip()]);
    expect(() => generateChoreo(input(), onlyRest)).toThrow(Error);
    // A song without moves needs no clip, so it does not throw.
    expect(generateChoreo(input({ durationMs: 500 }), onlyRest).moves).toEqual([]);
  });

  it("never uses clips whose sourceBpm is outside ±12 %", () => {
    expect(TEMPO_TOLERANCE).toBe(0.12);
    const pack = makePack([
      restClip(),
      clip("slow", { la: 90, ra: 90 }, { sourceBpm: 100 }), // 128 / 100 = +28 %
      clip("fast", { la: 170, ra: 170 }, { sourceBpm: 150 }), // 128 / 150 = −14.7 %
      clip("near", { la: 45, ra: 135 }, { sourceBpm: 118 }), // +8.5 %
      clip("free", { la: 135, ra: 45 }),
    ]);
    const used = new Set(
      SEEDS.slice(0, 10).flatMap((seed) =>
        choreoOf(input({ seed }), pack).moves.map((m) => m.iconId),
      ),
    );
    expect(used.has("slow")).toBe(false);
    expect(used.has("fast")).toBe(false);
    expect(used).toEqual(new Set(["near", "free"]));
  });

  it("keeps the end margin with clips anchored after their first beat", () => {
    const anchored = (id: string, p: FigureParams): MotionClip => {
      const sk = figure3d(p);
      return clip(id, p, {
        beats: 2,
        anchorBeat: 1,
        keyframes: [
          { beat: 0, pose3d: figure3d({ la: 30, ra: 30 }) },
          { beat: 1, pose3d: sk },
          { beat: 2, pose3d: sk },
        ],
      });
    };
    const pack = makePack([
      restClip(),
      anchored("p", { la: 90, ra: 90 }),
      anchored("q", { la: 170, ra: 170 }),
    ]);
    const inp = input({ difficulty: 1, durationMs: 60_000 });
    const c = choreoOf(inp, pack);
    const beatMs = beatMsOf(inp.bpm);
    expect(c.moves.at(-1)!.timeMs).toBeLessThanOrEqual(
      inp.durationMs - END_MARGIN_BEATS * beatMs + 1,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Scoring, size, runtime
// ---------------------------------------------------------------------------------------------

describe("simulated player", () => {
  it.each([1, 2, 3] as const)(
    "noise 0 → every move PERFECT at difficulty %i (128 BPM)",
    (difficulty) => {
      const inp = input({ difficulty, durationMs: 90_000, beatPhaseMs: 55 });
      const c = choreoOf(inp);
      const s = new Scorer(c);
      for (let t = 0; t <= inp.durationMs + 1000; t += 33)
        s.sample(t, simulatedAngles(c, t, { noiseDeg: 0, missRate: 0 }));
      const snap = s.snapshot();
      expect(snap.judged).toBe(c.moves.length);
      expect(snap.counts.PERFECT).toBe(c.moves.length);
      let combo = 0,
        best = 0;
      for (const m of c.moves) {
        best += movePoints("PERFECT", combo, m.gold);
        combo = nextCombo(combo, "PERFECT");
      }
      expect(snap.score).toBe(best);
      // Stars ignore the combo: all PERFECT is exactly the reference maximum.
      expect(snap.ratio).toBeCloseTo(1, 9);
      expect(snap.mega).toBe(true);
    },
  );
});

describe("size and runtime", () => {
  it("3 min at 150 BPM, difficulty 3 stays below 2.5 MB of JSON", () => {
    const c = choreoOf(input({ bpm: 150, difficulty: 3, durationMs: 180_000 }));
    const bytes = new TextEncoder().encode(JSON.stringify(c)).length;
    console.info(
      `generator size: 3 min / 150 BPM / d3 = ${(bytes / 1e6).toFixed(3)} MB, ${c.frames.length} frames, ${c.moves.length} moves`,
    );
    expect(bytes).toBeLessThan(2.5e6);
  });

  it("generates a 600 s song well under a second (bound 2000 ms)", () => {
    generateChoreo(input({ durationMs: 60_000 }), PACK); // warm-up
    const t0 = performance.now();
    const out = generateChoreo(input({ bpm: 150, difficulty: 3, durationMs: 600_000 }), PACK);
    const ms = performance.now() - t0;
    console.info(
      `generator runtime: 600 s / 150 BPM / d3 = ${ms.toFixed(0)} ms, ${out.frames.length} frames`,
    );
    expect(out.moves.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });
});
