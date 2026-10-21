import { describe, expect, it } from "vitest";
import { mirrorChoreo } from "@/lib/choreo";
import { ARM_KEYS, computeAngles, figure, isVisible, type FigureParams } from "@/lib/pose";
import { ChoreographySchema } from "@/lib/schema";
import type { AngleKey, Angles, Frame, Landmark, Landmark3d, Move } from "@/lib/types";
import {
  choreoFromPoseTrack,
  DEFAULT_MOVE_PLACEMENT,
  DEFAULT_ONE_EURO,
  MIN_MOVE_GAP_MS,
  OneEuroFilter,
  poseMotionAt,
  smoothTrack,
  suggestGoldMoves,
  toSquareSpace,
  trackMetrics,
  type OneEuroParams,
  type PoseTrack,
} from "@/lib/videoChoreo";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse of toSquareSpace: square-space landmarks as a per-axis normalized video frame. */
const toVideo = (lm: Landmark[], aspect: number): Landmark[] => {
  const s = Math.max(aspect, 1);
  return lm.map((p) => [0.5 + ((p[0] - 0.5) * s) / aspect, 0.5 + (p[1] - 0.5) * s, p[2] ?? 1]);
};

interface TrackSpec {
  aspect?: number;
  durationMs?: number;
  stepMs?: number;
  noise?: number;
  seed?: number;
  pose?: (t: number) => FigureParams;
  /** Per-sample edit (e.g. null samples, invisible points). */
  edit?: (t: number, lm: Landmark[]) => Landmark[] | null;
}

const wave = (t: number): FigureParams => ({
  la: 90 + 60 * Math.sin((2 * Math.PI * t) / 2000),
  ra: 90 - 50 * Math.sin((2 * Math.PI * t) / 3000),
  le: 30,
  re: 20,
  ll: 10,
  rl: 10,
});

function makeTrack(spec: TrackSpec = {}): PoseTrack {
  const { aspect = 16 / 9, durationMs = 8000, stepMs = 33, noise = 0, seed = 1 } = spec;
  const pose = spec.pose ?? wave;
  const rand = rng(seed);
  const samples: PoseTrack["samples"] = [];
  for (let t = 0; t <= durationMs; t += stepMs) {
    const raw = toVideo(figure(pose(t)), aspect).map(
      (p) =>
        [p[0] + (rand() - 0.5) * 2 * noise, p[1] + (rand() - 0.5) * 2 * noise, p[2]] as Landmark,
    );
    samples.push({ timeMs: t, landmarks: spec.edit ? spec.edit(t, raw) : raw });
  }
  return { aspect, samples };
}

// Most tests check the fixed grid; the hold-point default has its own tests below.
const opts = { title: "Video", bpm: 120, now: 1_760_000_000_000, movePlacement: "grid" as const };

const meanErr = (a: Angles[], b: Angles[], keys: AngleKey[]) => {
  let sum = 0,
    n = 0;
  a.forEach((x, i) => {
    for (const k of keys) {
      const u = x[k],
        v = b[i]?.[k];
      if (u != null && v != null) {
        sum += Math.abs(u - v);
        n++;
      }
    }
  });
  return sum / n;
};

describe("OneEuroFilter", () => {
  it("startet mit dem ersten Wert und folgt einem konstanten Signal exakt", () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.3, 0)).toBe(0.3);
    expect(f.filter(0.3, 33)).toBeCloseTo(0.3, 10);
    f.reset();
    expect(f.filter(0.8, 66)).toBe(0.8);
  });
});

describe("smoothTrack", () => {
  it("glättet Rauschen: Winkelfehler sinkt deutlich und bleibt unter 2,5°", () => {
    const aspect = 16 / 9;
    const track = makeTrack({ aspect, noise: 0.01, seed: 7 });
    const truth = track.samples.map((s) => computeAngles(figure(wave(s.timeMs))));
    const raw = track.samples.map((s) => computeAngles(s.landmarks!, { aspect }));
    const smooth = smoothTrack(track.samples).map((s) => computeAngles(s.landmarks!, { aspect }));
    // Skip the first half second (filter warm-up).
    const from = 15;
    const keys = ARM_KEYS;
    const eRaw = meanErr(raw.slice(from), truth.slice(from), keys);
    const eSmooth = meanErr(smooth.slice(from), truth.slice(from), keys);
    // Since 8g-3 the default smooths less (fast moves keep their peaks), so less noise goes.
    expect(eSmooth).toBeLessThan(eRaw * 0.7);
    expect(eSmooth).toBeLessThan(2.5);
  });

  it("reicht unsichere Punkte unverändert durch und setzt Filter nach Lücken zurück", () => {
    const a: Landmark[] = [
      [0.2, 0.2, 0.9],
      [0.4, 0.4, 0.9],
    ];
    const b: Landmark[] = [
      [0.3, 0.3, 0.9],
      [0.9, 0.9, 0.2],
    ];
    const c: Landmark[] = [
      [0.6, 0.6, 0.9],
      [0.7, 0.7, 0.9],
    ];
    const head = [
      { timeMs: 0, landmarks: a },
      { timeMs: 33, landmarks: b },
      { timeMs: 66, landmarks: c },
    ];
    const out = smoothTrack([
      ...head,
      { timeMs: 100, landmarks: null },
      { timeMs: 133, landmarks: a },
      { timeMs: 1000, landmarks: c },
    ]);
    // Smoothed between the neighbours, not the raw value.
    const x = out[1]!.landmarks![0]![0];
    expect(x).not.toBe(0.3);
    expect(x).toBeGreaterThan(0.2);
    expect(x).toBeLessThan(0.6);
    // Segments are independent of what lies behind a gap.
    expect(out.slice(0, 3)).toEqual(smoothTrack(head));
    // Invisible point: passed through, never zeroed.
    expect(out[1]!.landmarks![1]).toEqual([0.9, 0.9, 0.2]);
    // Point 1 restarts after its invisible sample.
    expect(out[2]!.landmarks![1]).toEqual([0.7, 0.7, 0.9]);
    expect(out[3]!.landmarks).toBeNull();
    // Reset after a null sample and after a long time gap.
    expect(out[4]!.landmarks).toEqual(a);
    expect(out[5]!.landmarks).toEqual(c);
  });
});

/**
 * Frozen copy of the 2D `onePass`/`smoothTrack` before Etappe 13c (reference for the generalized
 * filter, which must give exactly the same 2D output). OneEuroFilter itself is unchanged.
 */
type OldSample = { timeMs: number; landmarks: Landmark[] | null };
function oldOnePass(samples: OldSample[], p: OneEuroParams, maxGapMs: number): OldSample[] {
  const filters = new Map<number, { fx: OneEuroFilter; fy: OneEuroFilter; last: number }>();
  return samples.map(({ timeMs, landmarks }) => {
    if (!landmarks) {
      filters.clear();
      return { timeMs, landmarks: null };
    }
    for (const i of filters.keys()) if (i >= landmarks.length) filters.delete(i);
    const out = landmarks.map((pt, i): Landmark => {
      if (!isVisible(pt)) {
        filters.delete(i);
        return pt;
      }
      let f = filters.get(i);
      if (!f || timeMs - f.last > maxGapMs) {
        f = { fx: new OneEuroFilter(p), fy: new OneEuroFilter(p), last: timeMs };
        filters.set(i, f);
      }
      f.last = timeMs;
      const x = f.fx.filter(pt[0], timeMs);
      const y = f.fy.filter(pt[1], timeMs);
      return pt.length > 2 ? [x, y, pt[2] as number] : [x, y];
    });
    return { timeMs, landmarks: out };
  });
}
function oldSmoothTrack(samples: OldSample[], maxGapMs = 250): OldSample[] {
  const p = DEFAULT_ONE_EURO;
  const fwd = oldOnePass(samples, p, maxGapMs);
  const reversed = samples.map((s) => ({ timeMs: -s.timeMs, landmarks: s.landmarks })).reverse();
  const bwd = oldOnePass(reversed, p, maxGapMs).reverse();
  return fwd.map((s, k) => {
    const back = bwd[k]?.landmarks;
    if (!s.landmarks || !back) return s;
    const landmarks = s.landmarks.map((pt, i): Landmark => {
      const q = back[i];
      if (!q || !isVisible(pt)) return pt;
      const x = (pt[0] + q[0]) / 2,
        y = (pt[1] + q[1]) / 2;
      return pt.length > 2 ? [x, y, pt[2] as number] : [x, y];
    });
    return { timeMs: s.timeMs, landmarks };
  });
}

describe("smoothTrack 2D wie vor 13c", () => {
  it("liefert exakt dieselbe 2D-Ausgabe wie die eingefrorene alte Fassung", () => {
    const hash = (i: number) => {
      const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      return h - Math.floor(h);
    };
    const samples: OldSample[] = [];
    let t = 0;
    for (let i = 0; i < 120; i++) {
      // A gap longer than maxGapMs (250) after sample 60.
      t += i === 60 ? 600 : 33 + Math.round(hash(i + 500) * 20);
      if (i % 23 === 7) {
        samples.push({ timeMs: t, landmarks: null });
        continue;
      }
      const n = i % 31 === 11 ? 3 : 5; // fewer points now and then
      const landmarks = Array.from({ length: n }, (_, j): Landmark => {
        const x = 0.5 + 0.2 * Math.sin(t / 400 + j) + 0.01 * (hash(i * 7 + j) - 0.5);
        const y = 0.5 + 0.2 * Math.cos(t / 300 + j) + 0.01 * (hash(i * 7 + j + 3) - 0.5);
        if (j === 0) return [x, y]; // no visibility entry
        const v = hash(i * 11 + j);
        return [x, y, v < 0.2 ? 0.3 : v]; // some invisible points
      });
      samples.push({ timeMs: t, landmarks });
    }
    expect(smoothTrack(samples)).toEqual(oldSmoothTrack(samples));
    expect(smoothTrack(samples, {}, 100)).toEqual(oldSmoothTrack(samples, 100));
  });
});

describe("smoothTrack mit Weltpunkten", () => {
  /** Deterministic white-ish noise in [-amp, amp] (hash of i). */
  const noise = (i: number, amp: number) => {
    const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return amp * 2 * (h - Math.floor(h) - 0.5);
  };
  const truthAt = (t: number): [number, number, number] => [
    0.3 * Math.sin(t / 900),
    -0.4 + 0.1 * Math.cos(t / 700),
    0.05 * Math.sin(t / 500),
  ];
  const samples = Array.from({ length: 80 }, (_, i) => {
    const t = i * 50;
    const [x, y, z] = truthAt(t);
    const world: Landmark3d[] = [
      [x + noise(3 * i, 0.01), y + noise(3 * i + 1, 0.01), z + noise(3 * i + 2, 0.01), 0.9],
      [1, 2, 3, 0.3],
      [x, y, z],
    ];
    const landmarks: Landmark[] = [[0.5 + x / 4, 0.5 + y / 4, 0.9]];
    return { timeMs: t, landmarks, world };
  });

  it("glättet Rauschen in x, y und z", () => {
    const out = smoothTrack(samples);
    let eRaw = 0,
      eSmooth = 0;
    for (const [i, s] of samples.entries()) {
      if (i < 5 || i >= samples.length - 5) continue;
      const truth = truthAt(s.timeMs);
      const raw = s.world[0]!;
      const sm = out[i]!.world![0]!;
      for (let d = 0; d < 3; d++) {
        eRaw += Math.abs(raw[d]! - truth[d]!);
        eSmooth += Math.abs(sm[d]! - truth[d]!);
      }
      // Visibility stays.
      expect(sm[3]).toBe(0.9);
    }
    // Same parameters as for 2D (tuned for 0..1 coordinates; metres are of a similar scale), so
    // the reduction is moderate, like for the 2D points.
    expect(eSmooth).toBeLessThan(eRaw * 0.85);
  });

  it("reicht unsichere Weltpunkte unverändert durch, 2D bleibt wie ohne Weltpunkte", () => {
    const out = smoothTrack(samples);
    for (const [i, s] of out.entries()) expect(s.world![1]).toBe(samples[i]!.world[1]);
    const flat = samples.map(({ timeMs, landmarks }) => ({ timeMs, landmarks }));
    expect(out.map(({ timeMs, landmarks }) => ({ timeMs, landmarks }))).toEqual(smoothTrack(flat));
  });

  it("Samples ohne world bleiben ohne, world null bleibt null und setzt zurück", () => {
    const a: Landmark3d[] = [[0.1, 0.2, 0.3]];
    const b: Landmark3d[] = [[0.5, 0.6, 0.7]];
    const lm: Landmark[] = [[0.5, 0.5]];
    const out = smoothTrack([
      { timeMs: 0, landmarks: lm, world: a },
      { timeMs: 50, landmarks: lm },
      { timeMs: 100, landmarks: lm, world: b },
      { timeMs: 150, landmarks: lm, world: null },
      { timeMs: 200, landmarks: lm, world: a },
    ]);
    expect(out[1]).not.toHaveProperty("world");
    expect(out[3]!.world).toBeNull();
    // Each world sample stands alone between gaps: unchanged.
    expect(out[0]!.world).toEqual(a);
    expect(out[2]!.world).toEqual(b);
    expect(out[4]!.world).toEqual(a);
  });
});

describe("toSquareSpace", () => {
  it.each([16 / 9, 9 / 16, 4 / 3, 1])(
    "ergibt dieselben Winkel wie computeAngles mit aspect %f",
    (aspect) => {
      const raw = toVideo(
        figure({ la: 130, ra: 40, le: 50, re: 80, ll: 20, lk: 30, lean: 8 }),
        aspect,
      );
      const sq = computeAngles(toSquareSpace(raw, aspect));
      const ref = computeAngles(raw, { aspect });
      expect(Object.keys(sq).length).toBe(9);
      for (const [k, v] of Object.entries(ref)) expect(sq[k as AngleKey]).toBeCloseTo(v!, 6);
    },
  );
});

describe("choreoFromPoseTrack", () => {
  it("liefert für 16:9, 9:16 und 1:1 dieselben Winkel und quadratische Landmarks", () => {
    const still = () => ({ la: 120, ra: 60, le: 40, re: 70, ll: 15, rl: 25, rk: 20 });
    const truth = figure(still());
    const results = [16 / 9, 9 / 16, 1].map((aspect) =>
      choreoFromPoseTrack(makeTrack({ aspect, pose: still }), { ...opts, mirror: false }),
    );
    const ref = computeAngles(truth);
    for (const c of results) {
      const f = c.frames[10]!;
      for (const [k, v] of Object.entries(ref)) expect(f.angles[k as AngleKey]).toBeCloseTo(v!, 0);
      for (const i of [11, 15, 23, 27]) {
        expect(f.landmarks[i]![0]).toBeCloseTo(truth[i]![0], 3);
        expect(f.landmarks[i]![1]).toBeCloseTo(truth[i]![1], 3);
      }
    }
  });

  it("überspringt Lücken und unsichere Punkte statt 0 oder falsche Winkel zu erzeugen", () => {
    const track = makeTrack({
      edit: (t, lm) => {
        if (t >= 2000 && t < 2600) return null;
        if (t >= 4000 && t < 5000) lm[15] = [0.95, 0.95, 0.1];
        return lm;
      },
    });
    const c = choreoFromPoseTrack(track, { ...opts, mirror: false });
    expect(c.frames.some((f) => f.timeMs > 2050 && f.timeMs < 2550)).toBe(false);
    for (const f of c.frames) {
      for (const p of f.landmarks.slice(11, 29)) expect(p[0] === 0 && p[1] === 0).toBe(false);
      if (f.timeMs >= 4000 && f.timeMs < 5000) {
        expect(f.angles.leftElbow).toBeUndefined();
        expect(f.landmarks[15]![2]).toBe(0.1);
      } else expect(f.angles.leftElbow).toBeDefined();
    }
  });

  it("speichert im Spiegelraum: Standard == mirrorChoreo(mirror: false)", () => {
    const track = makeTrack({ noise: 0.003 });
    const a = choreoFromPoseTrack(track, opts);
    const plain = choreoFromPoseTrack(track, { ...opts, mirror: false });
    const b = mirrorChoreo(plain);
    expect(a.frames).toEqual(b.frames);
    expect(a.moves).toEqual(b.moves);
    // The dancer's right arm becomes the player's left arm.
    expect(a.frames[5]!.angles.leftShoulder).toBe(plain.frames[5]!.angles.rightShoulder);
    expect(a.frames[5]!.landmarks[11]).toEqual(plain.frames[5]!.landmarks[12]);
  });

  it("schneidet auf den Bereich zu und verschiebt ihn nach 0", () => {
    const track = makeTrack({ durationMs: 10000, stepMs: 50 });
    const c = choreoFromPoseTrack(track, {
      ...opts,
      mirror: false,
      range: { startMs: 2000, endMs: 6000 },
    });
    expect(c.frames[0]!.timeMs).toBe(0);
    expect(c.frames[c.frames.length - 1]!.timeMs).toBe(4000);
    const expected = computeAngles(figure(wave(2000)));
    // Small edge effect of the smoother at the segment start (fastest point of the wave).
    expect(Math.abs(c.frames[0]!.angles.leftShoulder! - expected.leftShoulder!)).toBeLessThan(3);
    expect(c.moves.every((m) => m.timeMs <= 4000)).toBe(true);
  });

  it("setzt Moves exakt aufs Beat-Raster und lässt unsichere Stellen aus", () => {
    const track = makeTrack({
      durationMs: 10000,
      edit: (t, lm) => {
        if (t >= 3000 && t < 4600) lm[23] = [lm[23]![0], lm[23]![1], 0.2];
        return lm;
      },
    });
    const c = choreoFromPoseTrack(track, {
      ...opts,
      mirror: false,
      beatOffsetMs: 250,
      beatsPerMove: 2,
    });
    // Beat phase lives in offsetMs; video time = timeMs + offsetMs.
    expect(c.offsetMs).toBe(250);
    expect(c.moves.map((m) => m.timeMs + c.offsetMs)).toEqual([
      250, 1250, 2250, 5250, 6250, 7250, 8250, 9250,
    ]);
    expect(c.frames.filter((f) => f.lowVisibility).length).toBeGreaterThan(10);
    const before = c.frames.find((f) => f.timeMs >= 1000);
    expect(before).toBeDefined();
    expect(before).not.toHaveProperty("lowVisibility");
    expect(c.moves.every((m) => m.label === "Move" && m.iconId === "video")).toBe(true);
  });

  it("legt die Beat-Phase in offsetMs, Moves liegen auf k · Beat", () => {
    const beatMs = 60000 / 120;
    for (const beatOffsetMs of [-180, 0, 333, 1750]) {
      const c = choreoFromPoseTrack(makeTrack({ durationMs: 8000 }), { ...opts, beatOffsetMs });
      expect(c.offsetMs).toBeGreaterThanOrEqual(0);
      expect(c.offsetMs).toBeLessThan(beatMs);
      expect(((beatOffsetMs - c.offsetMs) % beatMs) + 0).toBeCloseTo(0, 5);
      for (const m of c.moves) expect(m.timeMs % beatMs).toBeCloseTo(0, 5);
      expect(c.frames.every((f) => f.timeMs >= 0)).toBe(true);
    }
  });

  it("wirft bei ungültigen Optionen statt zu hängen", () => {
    const track = makeTrack({ durationMs: 2000 });
    for (const bad of [{ frameIntervalMs: 0 }, { bpm: 0 }, { beatsPerMove: -1 }]) {
      expect(() => choreoFromPoseTrack(track, { ...opts, ...bad })).toThrow(/Ungültige/);
    }
  });

  it("wählt 2 bis 4 Gold Moves", () => {
    const c = choreoFromPoseTrack(makeTrack({ durationMs: 40000, stepMs: 50 }), opts);
    const gold = c.moves.filter((m) => m.gold).length;
    expect(gold).toBeGreaterThanOrEqual(2);
    expect(gold).toBeLessThanOrEqual(4);
  });

  it("besteht das Schema und bleibt bei 3 Minuten unter 2 MB", () => {
    const rand = rng(3);
    const track = makeTrack({
      durationMs: 180_000,
      stepMs: 50,
      noise: 0.004,
      // Pessimistic: every visibility has two significant decimals.
      edit: (_t, lm) => lm.map((p) => [p[0], p[1], 0.6 + 0.39 * rand()] as Landmark),
    });
    const c = choreoFromPoseTrack(track, opts);
    expect(ChoreographySchema.safeParse(c).success).toBe(true);
    expect(c.frames.length).toBeGreaterThan(1700);
    expect(JSON.stringify(c).length).toBeLessThan(2_000_000);
  });

  it("speichert sichere Punkte ohne Visibility und bleibt dann unter 1,5 MB", () => {
    const track = makeTrack({
      durationMs: 180_000,
      stepMs: 50,
      noise: 0.004,
      edit: (_t, lm) => lm.map((p) => [p[0], p[1], 0.995] as Landmark),
    });
    const c = choreoFromPoseTrack(track, opts);
    expect(c.frames[0]?.landmarks.every((p) => p.length === 2)).toBe(true);
    expect(JSON.stringify(c).length).toBeLessThan(1_500_000);
  });

  it("rundet Visibility knapp unter 0.5 nicht auf sichtbar", () => {
    const track = makeTrack({
      edit: (_t, lm) => lm.map((p, i) => (i === 15 ? [p[0], p[1], 0.4999] : p) as Landmark),
    });
    const c = choreoFromPoseTrack(track, { ...opts, mirror: false });
    for (const f of c.frames) {
      expect(isVisible(f.landmarks[15])).toBe(false);
      expect(f.angles.leftElbow).toBeUndefined();
    }
  });

  it("wirft bei leerer Spur oder ohne erkannte Person", () => {
    expect(() => choreoFromPoseTrack({ aspect: 1, samples: [] }, opts)).toThrow(Error);
    const none = makeTrack({ edit: () => null });
    expect(() => choreoFromPoseTrack(none, opts)).toThrow(/Person/);
  });
});

describe("suggestGoldMoves", () => {
  const setup = (values: number[]) => {
    const moves: Move[] = values.map((_, i) => ({
      timeMs: i * 1000,
      label: "Move",
      iconId: "video",
      gold: true,
    }));
    const frames: Frame[] = values.map((v, i) => ({
      timeMs: i * 1000,
      landmarks: [],
      angles: { leftShoulder: v, rightShoulder: 10 },
    }));
    return { moves, frames };
  };

  it("nimmt die Moves mit der größten Bewegung und hält Abstand", () => {
    // Scores: index 3 and 4 = 120, index 12 = 40; spacing for 16 moves = 4.
    const { moves, frames } = setup([0, 0, 0, 120, 0, 0, 0, 0, 0, 0, 0, 0, 40, 40, 40, 40]);
    const out = suggestGoldMoves(moves, frames);
    expect(out.flatMap((m, i) => (m.gold ? [i] : []))).toEqual([3, 12]);
  });

  it("skaliert die Anzahl mit der Länge (2..4, weniger nur bei weniger Moves)", () => {
    const count = (n: number) => {
      const { moves, frames } = setup(Array.from({ length: n }, (_, i) => (i * 37) % 180));
      return suggestGoldMoves(moves, frames).filter((m) => m.gold).length;
    };
    expect(count(1)).toBe(1);
    expect(count(3)).toBe(2);
    expect(count(24)).toBe(3);
    expect(count(80)).toBe(4);
  });
});

describe("trackMetrics", () => {
  it("zählt Erkennung, Rasterpunkte und Moves wie choreoFromPoseTrack", () => {
    // Samples up to 7986 ms at 120 BPM, a move every 2 beats: grid 0, 1000, …, 7000.
    const track = makeTrack({ edit: (t, lm) => (t >= 1800 && t < 3300 ? null : lm) });
    const m = trackMetrics(track, opts);
    expect(m.samples).toBe(track.samples.length);
    expect(m.detectionRatio).toBeGreaterThan(0.8);
    expect(m.detectionRatio).toBeLessThan(0.95);
    expect(m.moveSlots).toBe(8);
    expect(m.moves).toBe(choreoFromPoseTrack(track, opts).moves.length);
    expect(m.moves).toBe(6); // the gap costs the moves at 2000 and 3000 ms
    expect(m.usableMoveRatio).toBeCloseTo(6 / 8, 10);
    expect(m.error).toBeNull();
  });

  it("misst Rauschen als Zittern, und die Glättung senkt es", () => {
    const clean = trackMetrics(makeTrack(), opts);
    const noisy = trackMetrics(makeTrack({ noise: 0.01, seed: 3 }), opts);
    expect(clean.jitterRawDeg).not.toBeNull();
    expect(noisy.jitterRawDeg!).toBeGreaterThan(clean.jitterRawDeg! * 5);
    expect(noisy.jitterSmoothDeg!).toBeLessThan(noisy.jitterRawDeg! * 0.5);
  });

  it("Holdout-Fehler: Glättung hilft bei Rauschen, zu starke schadet bei sauberen schnellen Moves", () => {
    const noisy = makeTrack({ noise: 0.02, seed: 4, stepMs: 50 });
    const smooth = trackMetrics(noisy, opts).holdoutDeg!;
    const none = trackMetrics(noisy, { ...opts, filter: { minCutoff: 1000 } }).holdoutDeg!;
    expect(smooth).toBeLessThan(none);

    const fast = (t: number) => ({ ...wave(t), la: 90 + 70 * Math.sin((2 * Math.PI * t) / 500) });
    const clean = makeTrack({ pose: fast, stepMs: 50 });
    const light = trackMetrics(clean, { ...opts, filter: { minCutoff: 1000 } }).holdoutDeg!;
    const heavy = trackMetrics(clean, {
      ...opts,
      filter: { minCutoff: 0.05, beta: 0 },
    }).holdoutDeg!;
    expect(heavy).toBeGreaterThan(light * 2);
  });

  it("meldet einen unbrauchbaren Abschnitt, statt zu werfen", () => {
    const empty = makeTrack({ edit: () => null });
    const m = trackMetrics(empty, opts);
    expect(m.detectionRatio).toBe(0);
    expect(m.moves).toBe(0);
    expect(m.jitterRawDeg).toBeNull();
    expect(m.holdoutDeg).toBeNull();
    expect(m.error).toBe("Im Video wurde zu selten eine Person erkannt.");
  });
});

/** Arms swing with period 2 s: still at 500, 1500, … ms (odd beats at 120 BPM), fastest on even beats. */
const oddHolds = (t: number): FigureParams => {
  const v = 60 * Math.sin((2 * Math.PI * t) / 2000);
  return { la: 90 + v, ra: 90 - v, le: 30, re: 20, ll: 10, rl: 10 };
};

/** Arms held still from 150 to 600 ms of every second, a smooth swing in between. */
const heldBlock = (t: number): FigureParams => {
  const s = t % 1000;
  const x = s >= 150 && s < 600 ? 0 : s >= 600 ? (s - 600) / 550 : (s + 400) / 550;
  const v = 80 * Math.sin(Math.PI * x) ** 2;
  return { la: 60 + v, ra: 120 - v, le: 30, re: 20, ll: 10, rl: 10 };
};

describe("Haltepunkt-Moves (movePlacement)", () => {
  const base = { ...opts, mirror: false, beatsPerMove: 2 };

  it("setzt Moves auf die Beats mit stehender Pose, das Raster bleibt auf geraden Beats", () => {
    const track = makeTrack({ pose: oddHolds });
    const grid = choreoFromPoseTrack(track, base);
    const holds = choreoFromPoseTrack(track, { ...base, movePlacement: "holds" });
    expect(grid.moves.map((m) => m.timeMs)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    expect(holds.moves.map((m) => m.timeMs)).toEqual([
      500, 1500, 2500, 3500, 4500, 5500, 6500, 7500,
    ]);
    // Same windows: as many moves as the grid on a fully usable track.
    expect(holds.moves).toHaveLength(grid.moves.length);
    expect(holds.moves.filter((m) => m.gold).length).toBeGreaterThanOrEqual(2);
  });

  it("ohne Option gilt DEFAULT_MOVE_PLACEMENT (Haltepunkte)", () => {
    expect(DEFAULT_MOVE_PLACEMENT).toBe("holds");
    const track = makeTrack({ pose: oddHolds });
    const noOption = { title: base.title, bpm: base.bpm, now: base.now, mirror: false };
    expect(choreoFromPoseTrack(track, { ...noOption, movePlacement: "holds" })).toEqual({
      ...choreoFromPoseTrack(track, noOption),
      id: expect.any(String),
    });
  });

  it("hält den Mindestabstand ein, auch bei 240 BPM", () => {
    // Windows of 2 beats (500 ms); still on 250 and 500 ms of every second. Without the gap rule
    // the picks 250 and 500 would be 250 ms apart.
    const track = makeTrack({ pose: heldBlock });
    const fast = { ...base, bpm: 240 };
    const grid = choreoFromPoseTrack(track, fast);
    const holds = choreoFromPoseTrack(track, { ...fast, movePlacement: "holds" });
    const t = holds.moves.map((m) => m.timeMs);
    expect(t.every((x, i) => i === 0 || x - t[i - 1]! >= MIN_MOVE_GAP_MS)).toBe(true);
    expect(t.slice(0, 4)).toEqual([250, 750, 1250, 1750]);
    expect(holds.moves).toHaveLength(grid.moves.length);
    // Every move still sits on a beat.
    for (const x of t) expect(x % 250).toBeCloseTo(0, 5);
  });

  it("rundet nicht ganzzahlige Beats pro Move auf ganze Fenster", () => {
    const track = makeTrack({ pose: oddHolds });
    const holds = choreoFromPoseTrack(track, {
      ...base,
      beatsPerMove: 2.4,
      movePlacement: "holds",
    });
    expect(holds.moves.map((m) => m.timeMs)).toEqual([
      500, 1500, 2500, 3500, 4500, 5500, 6500, 7500,
    ]);
  });

  it("nimmt bei verschobener Beat-Phase keine Beats vor dem ersten Rasterpunkt", () => {
    const beatMs = 500;
    for (const beatOffsetMs of [600, -400]) {
      const track = makeTrack({ pose: oddHolds });
      const o = { ...base, beatOffsetMs };
      const grid = choreoFromPoseTrack(track, o);
      const holds = choreoFromPoseTrack(track, { ...o, movePlacement: "holds" });
      expect(holds.moves.length).toBeLessThanOrEqual(grid.moves.length);
      for (const m of holds.moves) {
        expect(m.timeMs).toBeGreaterThanOrEqual(0);
        expect(m.timeMs % beatMs).toBeCloseTo(0, 5);
      }
      // First window starts at the first grid point (video time 600 resp. 100): nothing before.
      expect(holds.moves[0]!.timeMs + holds.offsetMs).toBeGreaterThanOrEqual(
        grid.moves[0]!.timeMs + grid.offsetMs,
      );
      const m = trackMetrics(track, { ...o, movePlacement: "holds" });
      expect(m.usableMoveRatio).toBeLessThanOrEqual(1);
      expect(m.moves).toBe(holds.moves.length);
    }
  });

  it("bevorzugt bei gleichmäßiger Bewegung keine Randbeats", () => {
    // Constant arm speed: no beat is stiller than another. Clamped edge frames used to make the
    // first and last beat look stiller.
    const steady = (t: number): FigureParams => ({
      la: 30 + (15 * t) / 1000,
      ra: 150 - (15 * t) / 1000,
      le: 30,
      re: 20,
      ll: 10,
      rl: 10,
    });
    const track = makeTrack({ pose: steady, durationMs: 7600, stepMs: 50 });
    const holds = choreoFromPoseTrack(track, { ...base, movePlacement: "holds" });
    const t = holds.moves.map((m) => m.timeMs);
    // Windows [0, 500], …, [7000, 7500]; the frames end at 7600, so 7500 + 125 ms is outside.
    expect(t[0]).toBe(500);
    expect(t[t.length - 1]).toBe(7000);
    expect(t).toHaveLength(8);
    const { frames } = holds;
    expect(poseMotionAt(frames, 0, 125)).toBeNull();
    expect(poseMotionAt(frames, 7500, 125)).toBeNull();
    expect(poseMotionAt(frames, 7000, 125)).not.toBeNull();
  });

  it("poseMotionAt misst Grad pro Sekunde und braucht genug Winkel", () => {
    const track = makeTrack({ pose: oddHolds });
    const { frames } = choreoFromPoseTrack(track, base);
    expect(poseMotionAt(frames, 1500, 125)!).toBeLessThan(2);
    // Shoulders change at 60 · 2π / 2 s ≈ 188 °/s on even beats; 2 of 8 limb angles move.
    expect(poseMotionAt(frames, 2000, 125)!).toBeGreaterThan(30);
    const armsOnly = frames.map((f) => ({
      ...f,
      angles: { leftShoulder: f.angles.leftShoulder!, rightShoulder: f.angles.rightShoulder! },
    }));
    expect(poseMotionAt(armsOnly, 2000, 125)).toBeNull();
  });

  it("trackMetrics: Bewegung an den Moves ist mit Haltepunkten niedriger, null bei Fehler", () => {
    const track = makeTrack({ pose: oddHolds });
    const grid = trackMetrics(track, base);
    const holds = trackMetrics(track, { ...base, movePlacement: "holds" });
    expect(grid.moveMotionDegPerS).not.toBeNull();
    expect(holds.moveMotionDegPerS!).toBeLessThan(grid.moveMotionDegPerS! / 5);
    expect(holds.moves).toBe(grid.moves);
    const empty = trackMetrics(makeTrack({ edit: () => null }), {
      ...base,
      movePlacement: "holds",
    });
    expect(empty.moveMotionDegPerS).toBeNull();
    expect(empty.error).not.toBeNull();
  });
});
