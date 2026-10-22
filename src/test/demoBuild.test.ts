import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import packJson from "@/data/motion-pack.json";
import {
  INTRO_MOTION_BEATS,
  MANIFEST_ENERGY,
  buildDemoChoreo,
  buildDemoClips,
  planFromManifest,
  sectionStarts,
} from "@/lib/demoBuild";
import { DemoManifestSchema, type DemoManifest, type SectionKind } from "@/lib/demoManifest";
import { GROUP_PATTERN, TEMPO_TOLERANCE, stepBeats, type Plan } from "@/lib/generator";
import { simulateScore } from "@/lib/generator/metrics";
import { frameAt } from "@/lib/pose";
import { CHOREO_VERSION, ChoreographySchema, MotionPackSchema } from "@/lib/schema";
import type { AngleKey, Choreography, Frame, MotionPack } from "@/lib/types";
import { SONG_PALETTES } from "@/theme";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const PACK: MotionPack = MotionPackSchema.parse(packJson);

const ROOT = path.resolve(__dirname, "../..");
const DEMO_DIR = path.join(ROOT, "src/data/demos");

interface Shipped {
  slug: string;
  manifest: DemoManifest;
}

const SHIPPED: Shipped[] = readdirSync(DEMO_DIR)
  .filter((f) => f.endsWith(".manifest.json"))
  .sort()
  .map((f) => ({
    slug: f.replace(/\.manifest\.json$/, ""),
    manifest: DemoManifestSchema.parse(JSON.parse(readFileSync(path.join(DEMO_DIR, f), "utf8"))),
  }));

const built = new Map<string, Choreography>();
/** buildDemoChoreo, cached per manifest id (the build is deterministic, see its own test). */
function choreoOf(m: DemoManifest): Choreography {
  const hit = built.get(m.id);
  if (hit) return hit;
  const c = buildDemoChoreo(m, PACK);
  built.set(m.id, c);
  return c;
}

const shipped = (slug: string): DemoManifest => {
  const s = SHIPPED.find((x) => x.slug === slug);
  if (!s) throw new Error(`manifest ${slug} missing`);
  return s.manifest;
};

const beatMsOf = (m: DemoManifest) => 60_000 / m.bpm;
/** Exact time of a beat of the manifest's grid. */
const timeOf = (m: DemoManifest, beat: number) => m.beatPhaseMs + beat * beatMsOf(m);

/** Independent re-derivation of the section start beats. */
function startsOf(m: DemoManifest): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of m.sections) {
    out.push(acc);
    acc += s.beats;
  }
  return out;
}

/** 120 BPM (500 ms per beat), phase 100 ms. Sections start at 0, 16, 32, 52, 60, 80; end 88. */
const handManifest = (over: Partial<DemoManifest> = {}): DemoManifest =>
  DemoManifestSchema.parse({
    version: 1,
    id: "demo-hand-written",
    title: "Hand Written",
    artist: "DanceBeat Original",
    audio: "Hand_Written.mp3",
    palette: 1,
    difficulty: 2,
    bpm: 120,
    beatPhaseMs: 100,
    durationMs: 45_000,
    sections: [
      { kind: "intro", beats: 16 },
      { kind: "verse", beats: 16 },
      { kind: "chorus", beats: 20 },
      { kind: "verse", beats: 8 },
      { kind: "chorus", beats: 20 },
      { kind: "outro", beats: 8 },
    ],
    phrases: { intro: "auto", verse: "auto", chorus: "auto", outro: "auto" },
    gold: [
      { section: 1, beat: 0 },
      { section: 2, beat: 16 },
    ],
    ...over,
  });

const allSlots = (plan: Plan) => plan.phrases.flatMap((p) => p.slots);

// ---------------------------------------------------------------------------------------------
// planFromManifest
// ---------------------------------------------------------------------------------------------

describe("sectionStarts", () => {
  it("is the cumulative sum of the section lengths, starting at 0", () => {
    expect(sectionStarts(handManifest())).toEqual([0, 16, 32, 52, 60, 80]);
    for (const { manifest } of SHIPPED) expect(sectionStarts(manifest)).toEqual(startsOf(manifest));
  });
});

describe("planFromManifest", () => {
  it("takes tempo, phase and length from the manifest; introBeats = leading intro", () => {
    const m = handManifest();
    const plan = planFromManifest(m);
    expect(plan.bpm).toBe(120);
    expect(plan.beatPhaseMs).toBe(100);
    expect(plan.durationMs).toBe(45_000);
    expect(plan.introBeats).toBe(16);
    expect(INTRO_MOTION_BEATS).toBe(8);
  });

  it("cuts sections into 8-beat phrases with A A B A keys; intro only in its last 8 beats", () => {
    const plan = planFromManifest(handManifest());
    const layout = plan.phrases.map((p) => [p.key, p.startBeat, p.beats, p.section]);
    expect(layout).toEqual([
      [`intro-${GROUP_PATTERN[0]}`, 8, 8, "verse"],
      ["verse-A", 16, 8, "verse"],
      ["verse-A", 24, 8, "verse"],
      ["chorus-A", 32, 8, "chorus"],
      ["chorus-A", 40, 8, "chorus"],
      ["chorus-B", 48, 4, "chorus"],
      ["verse-A", 52, 8, "verse"],
      ["chorus-A", 60, 8, "chorus"],
      ["chorus-A", 68, 8, "chorus"],
      ["chorus-B", 76, 4, "chorus"],
    ]);
    // No slot inside the first 8 intro beats and none in the outro (it is the closing pose).
    for (const s of allSlots(plan)) {
      expect(s.beat).toBeGreaterThanOrEqual(16 - INTRO_MOTION_BEATS);
      expect(s.beat).toBeLessThan(80);
    }
  });

  it("places slots every stepBeats from the phrase start, with lengthBeats = step", () => {
    const m = handManifest();
    const plan = planFromManifest(m);
    const kindOf = (key: string) => key.split("-")[0] as SectionKind;
    for (const p of plan.phrases) {
      const step = stepBeats(m.difficulty, MANIFEST_ENERGY[kindOf(p.key)], beatMsOf(m));
      const expected: number[] = [];
      for (let b = 0; b < p.beats; b += step) expected.push(p.startBeat + b);
      expect(
        p.slots.map((s) => s.beat),
        p.key,
      ).toEqual(expected);
      for (const s of p.slots) expect(s.lengthBeats, p.key).toBe(step);
    }
  });

  it("MANIFEST_ENERGY covers every section kind with a value in 0..1", () => {
    for (const kind of ["intro", "verse", "prechorus", "chorus", "bridge", "outro"] as const) {
      const e = MANIFEST_ENERGY[kind];
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });

  it("marks exactly the manifest's gold positions; the closing pose at the outro is not gold", () => {
    const plan = planFromManifest(handManifest());
    const gold = allSlots(plan)
      .filter((s) => s.gold)
      .map((s) => s.beat)
      .sort((a, b) => a - b);
    expect(gold).toEqual([16, 48]);
    expect(plan.final).toEqual({ beat: 80, lengthBeats: (45_000 - 100) / 500 - 80, gold: false });
  });

  it("throws for a gold position that is not on a slot", () => {
    // Difficulty 1 never halves the step, so beat 1 of a phrase is never a slot.
    const m = handManifest({ difficulty: 1, gold: [{ section: 1, beat: 1 }] });
    expect(() => planFromManifest(m)).toThrow(Error);
  });

  it("without an outro the last slot becomes the closing pose", () => {
    const base = {
      sections: [
        { kind: "intro" as const, beats: 16 },
        { kind: "verse" as const, beats: 16 },
        { kind: "chorus" as const, beats: 16 },
      ],
      phrases: { intro: "auto" as const, verse: "auto" as const, chorus: "auto" as const },
    };
    const m = handManifest({ ...base, gold: [] });
    const step = stepBeats(m.difficulty, MANIFEST_ENERGY.chorus, beatMsOf(m));
    const lastBeat = 48 - step;
    const plan = planFromManifest(m);
    expect(plan.final?.beat).toBe(lastBeat);
    expect(plan.final?.gold).toBe(false);
    expect(allSlots(plan).some((s) => s.beat === lastBeat)).toBe(false);

    const golden = planFromManifest(
      handManifest({ ...base, gold: [{ section: 2, beat: 16 - step }] }),
    );
    expect(golden.final?.beat).toBe(lastBeat);
    expect(golden.final?.gold).toBe(true);
  });

  it("a manifest without intro has introBeats 0", () => {
    const m = handManifest({
      sections: [
        { kind: "verse", beats: 16 },
        { kind: "outro", beats: 8 },
      ],
      phrases: { verse: "auto", outro: "auto" },
      gold: [],
    });
    const plan = planFromManifest(m);
    expect(plan.introBeats).toBe(0);
    expect(plan.phrases[0]?.startBeat).toBe(0);
    expect(plan.final?.beat).toBe(16);
  });
});

// ---------------------------------------------------------------------------------------------
// buildDemoChoreo on the shipped manifests
// ---------------------------------------------------------------------------------------------

const ANGLE_TOL = 0.1 + 1e-6;

function expectAnglesClose(a: Frame, b: Frame, what: string) {
  for (const key of Object.keys(a.angles) as AngleKey[]) {
    const x = a.angles[key];
    const y = b.angles[key];
    if (x === undefined) continue;
    expect(y, `${what} ${key}`).toBeDefined();
    expect(Math.abs(x - (y ?? NaN)), `${what} ${key}: ${x} vs ${y}`).toBeLessThanOrEqual(ANGLE_TOL);
  }
}

/** Frame of `frames` closest to `t`, if one lies within 1 ms. */
function frameNear(frames: readonly Frame[], t: number): Frame | null {
  let best: Frame | null = null;
  for (const f of frames)
    if (
      Math.abs(f.timeMs - t) <= 1 &&
      (!best || Math.abs(f.timeMs - t) < Math.abs(best.timeMs - t))
    )
      best = f;
  return best;
}

describe("buildDemoChoreo", () => {
  it("has the expected metadata and a stable id", () => {
    const m = shipped("gold-in-my-pocket");
    const c = choreoOf(m);
    expect(ChoreographySchema.safeParse(c).success).toBe(true);
    expect(c.version).toBe(CHOREO_VERSION);
    expect(c.version).toBe(2);
    expect(c.title).toBe(m.title);
    expect(c.bpm).toBe(m.bpm);
    expect(c.offsetMs).toBe(0);
    expect(c.accentColor).toBe(SONG_PALETTES[m.palette]?.accent);
    expect(c.secondaryColor).toBe(SONG_PALETTES[m.palette]?.secondary);
    expect(c.createdAt).toBe(0);
    expect(c.updatedAt).toBe(0);
    expect(c.frames.length).toBeGreaterThan(0);
    expect(c.moves.length).toBeGreaterThan(0);

    expect(buildDemoChoreo(m, PACK)).toEqual(c);
    const ids = SHIPPED.map((s) => choreoOf(s.manifest).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildDemoChoreo({ ...handManifest(), id: "demo-other-song" }, PACK).id).not.toBe(
      buildDemoChoreo(handManifest(), PACK).id,
    );
  });

  it.each(SHIPPED.map((s) => [s.slug, s.manifest] as const))(
    "%s: moves on the beat grid, none in the intro",
    (_slug, m) => {
      const c = choreoOf(m);
      const beatMs = beatMsOf(m);
      for (const mv of c.moves) {
        const k = Math.round((mv.timeMs - m.beatPhaseMs) / beatMs);
        expect(Math.abs(mv.timeMs - timeOf(m, k)), `move at ${mv.timeMs}`).toBeLessThanOrEqual(1);
      }
      const starts = startsOf(m);
      const firstMotion = m.sections.findIndex((s) => s.kind !== "intro");
      const firstStart = timeOf(m, starts[firstMotion] ?? 0);
      for (const mv of c.moves) expect(mv.timeMs).toBeGreaterThanOrEqual(firstStart - 1);
    },
  );

  it.each(SHIPPED.map((s) => [s.slug, s.manifest] as const))(
    "%s: gold moves exactly as in the manifest, closing pose not gold",
    (_slug, m) => {
      const c = choreoOf(m);
      const starts = startsOf(m);
      const expected = m.gold
        .map((g) => Math.round(timeOf(m, (starts[g.section] ?? NaN) + g.beat)))
        .sort((a, b) => a - b);
      const actual = c.moves.filter((mv) => mv.gold).map((mv) => mv.timeMs);
      expect(actual.length).toBe(expected.length);
      actual.forEach((t, i) => expect(Math.abs(t - (expected[i] ?? NaN))).toBeLessThanOrEqual(1));
      expect(c.moves[c.moves.length - 1]?.gold).toBe(false);
    },
  );

  it.each(SHIPPED.map((s) => [s.slug, s.manifest] as const))(
    "%s: repeated sections dance the same moves and poses",
    (_slug, m) => {
      const c = choreoOf(m);
      const starts = startsOf(m);
      const beatMs = beatMsOf(m);
      const kinds = new Set(m.sections.map((s) => s.kind));
      let compared = 0;
      for (const kind of kinds) {
        if (kind === "intro" || kind === "outro") continue;
        const occ = m.sections.flatMap((s, i) => (s.kind === kind ? [i] : []));
        const first = occ[0];
        if (first === undefined) continue;
        for (const other of occ.slice(1)) {
          const what = `${kind} #${first} vs #${other}`;
          const common = Math.min(m.sections[first]!.beats, m.sections[other]!.beats);
          const t0 = timeOf(m, starts[first]!);
          const t1 = timeOf(m, starts[other]!);
          const endRel = common * beatMs;
          const movesIn = (t: number) =>
            c.moves
              .filter((mv) => mv.timeMs >= t - 1 && mv.timeMs < t + endRel - 1)
              .map((mv) => ({ rel: mv.timeMs - t, label: mv.label, iconId: mv.iconId }));
          const a = movesIn(t0);
          const b = movesIn(t1);
          expect(a.length, what).toBeGreaterThan(0);
          expect(b.length, what).toBe(a.length);
          a.forEach((x, i) => {
            const y = b[i]!;
            expect(Math.abs(x.rel - y.rel), `${what} move ${i}`).toBeLessThanOrEqual(1);
            expect(y.label, `${what} move ${i}`).toBe(x.label);
            expect(y.iconId, `${what} move ${i}`).toBe(x.iconId);
          });

          // Frames from the first move to one beat before the shorter section's end.
          const fromRel = a[0]!.rel;
          const toRel = endRel - beatMs;
          const window = c.frames.filter((f) => f.timeMs - t0 >= fromRel && f.timeMs - t0 <= toRel);
          expect(window.length, what).toBeGreaterThan(0);
          for (const f of window) {
            const rel = f.timeMs - t0;
            const g = frameNear(c.frames, t1 + rel) ?? frameAt(c.frames, t1 + rel);
            expect(g, `${what} frame +${rel}`).not.toBeNull();
            if (g) expectAnglesClose(f, g, `${what} frame +${Math.round(rel)}`);
          }
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(0);
    },
  );

  it("a perfect simulated player gets only PERFECT", () => {
    const c = choreoOf(shipped("gold-in-my-pocket"));
    const snap = simulateScore(c, { noiseDeg: 0, missRate: 0, seed: 1 });
    expect(snap.total).toBe(c.moves.length);
    expect(snap.judged).toBe(c.moves.length);
    expect(snap.counts.PERFECT).toBe(c.moves.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Fixed phrases
// ---------------------------------------------------------------------------------------------

describe("buildDemoClips with fixed phrases", () => {
  const FIXED = ["demo:arms-up", "demo:left-up", "demo:flex"];

  const fixedManifest = (chorus: string[], outro: "auto" | string[] = "auto") =>
    handManifest({
      difficulty: 1,
      gold: [],
      phrases: { intro: "auto", verse: "auto", chorus, outro },
    });

  it("cycles the fixed ids within every chorus, each occurrence starting at ids[0]", () => {
    const m = fixedManifest(FIXED, ["demo:flex"]);
    const plan = planFromManifest(m);
    const clips = buildDemoClips(m, PACK, plan);
    const starts = startsOf(m);
    for (const sec of [2, 4]) {
      const from = starts[sec]!;
      const to = from + m.sections[sec]!.beats;
      const ids = clips
        .filter((r) => r.beat >= from && r.beat < to)
        .sort((x, y) => x.beat - y.beat)
        .map((r) => r.clipId);
      expect(ids.length).toBeGreaterThan(FIXED.length);
      expect(ids).toEqual(ids.map((_, j) => FIXED[j % FIXED.length]));
    }
    // Fixed outro: ids[0] as closing pose at the outro start.
    const last = [...clips].sort((x, y) => x.beat - y.beat).at(-1);
    expect(last?.clipId).toBe("demo:flex");
    expect(last?.beat).toBe(80);

    // The choreography shows the same sequence as labels.
    const labelOf = new Map(PACK.clips.map((cl) => [cl.id, cl.label]));
    const c = buildDemoChoreo(m, PACK);
    const t0 = timeOf(m, starts[2]!);
    const t1 = timeOf(m, starts[3]!);
    const labels = c.moves
      .filter((mv) => mv.timeMs >= t0 - 1 && mv.timeMs < t1 - 1)
      .map((mv) => mv.label);
    expect(labels).toEqual(labels.map((_, j) => labelOf.get(FIXED[j % FIXED.length]!)));
  });

  it("throws for clip ids that are not in the pack", () => {
    const m = fixedManifest(["demo:arms-up", "demo:does-not-exist"]);
    expect(() => buildDemoClips(m, PACK)).toThrow(Error);
  });

  it("throws for a fixed clip whose source tempo is outside the tolerance", () => {
    const base = PACK.clips.find((c) => c.id === "demo:arms-up");
    if (!base) throw new Error("demo:arms-up missing");
    const m = fixedManifest(["test:tempo"]);
    const { mirrorOf: _mirror, ...symmetric } = base;
    const withTempo = (sourceBpm: number): MotionPack => ({
      ...PACK,
      clips: [...PACK.clips, { ...symmetric, id: "test:tempo", sourceBpm }],
    });
    expect(() => buildDemoClips(m, withTempo(m.bpm * (1 + TEMPO_TOLERANCE + 0.05)))).toThrow(Error);
    expect(() => buildDemoClips(m, withTempo(m.bpm * (1 - TEMPO_TOLERANCE - 0.05)))).toThrow(Error);
    expect(() => buildDemoClips(m, withTempo(m.bpm * 1.05))).not.toThrow();
  });

  it("throws for fixed rest poses, clips harder than the song and clips longer than a slot", () => {
    const rest = PACK.clips.find((c) => c.energy < 0.1);
    if (!rest) throw new Error("no rest pose in the pack");
    expect(() => buildDemoClips(fixedManifest([rest.id]), PACK)).toThrow(/Ruhepose/);
    const hard = PACK.clips.find((c) => c.difficulty > 1 && c.energy >= 0.1);
    if (!hard) throw new Error("no clip above difficulty 1 in the pack");
    expect(() => buildDemoClips(fixedManifest([hard.id]), PACK)).toThrow(/schwerer/);
    const base = PACK.clips.find((c) => c.id === "demo:arms-up")!;
    const long: MotionPack = {
      ...PACK,
      clips: [...PACK.clips, { ...base, id: "test:long", beats: 9 }],
    };
    expect(() => buildDemoClips(fixedManifest(["test:long"]), long)).toThrow(/länger/);
  });
});

describe("planFromManifest edge cases", () => {
  it("throws if no move remains after the intro", () => {
    const m = handManifest({
      sections: [{ kind: "intro", beats: 16 }],
      phrases: { intro: "auto" },
      gold: [],
    });
    expect(() => planFromManifest(m)).toThrow(/Intro/);
  });

  it("never repeats a clip directly in the shipped songs", () => {
    for (const { slug } of SHIPPED) {
      const ids = buildDemoClips(shipped(slug), PACK).map((r) => r.clipId);
      ids.forEach((id, i) => expect(id, `${slug} move ${i}`).not.toBe(ids[i - 1]));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Shipped choreographies
// ---------------------------------------------------------------------------------------------

describe("shipped demo choreographies", () => {
  it("there are four demo manifests", () => {
    expect(SHIPPED.length).toBe(4);
  });

  it.each(SHIPPED.map((s) => [s.slug, s.manifest] as const))(
    "%s.choreo.json is valid, small and up to date",
    (slug, m) => {
      const file = path.join(DEMO_DIR, `${slug}.choreo.json`);
      // Difficulty 3 moves on every beat in dense sections, so its file is larger by design.
      const maxBytes = (m.difficulty === 3 ? 2 : 1) * 1024 * 1024;
      expect(statSync(file).size).toBeLessThan(maxBytes);
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      const res = ChoreographySchema.safeParse(parsed);
      expect(res.success, `${slug}: schema`).toBe(true);
      const fresh: unknown = JSON.parse(JSON.stringify(choreoOf(m)));
      expect(parsed, `${slug}.choreo.json is stale: run bun run build-demo`).toEqual(fresh);
    },
  );
});
