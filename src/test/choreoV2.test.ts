import { describe, expect, it } from "vitest";
import { mirrorChoreo } from "@/lib/choreo";
import { buildChoreoFile, parseChoreoFile } from "@/lib/library/choreoFile";
import { migrateChoreo } from "@/lib/library/migrations";
import { figure, figure3d, frameAt, type FigureParams } from "@/lib/pose";
import { ChoreographySchema, Skeleton3DSchema } from "@/lib/schema";
import { FIGURE_UNITS_PER_METER, interpolate, project, type Skeleton3D } from "@/lib/skeleton";
import type { Choreography, Frame, Landmark, Landmark3d } from "@/lib/types";
import { choreoFromPoseTrack, type PoseTrack } from "@/lib/videoChoreo";
import { makeChoreo, makeSong } from "./fixtures";

const twoFrames = () =>
  makeChoreo([
    { la: 0, ra: 0 },
    { la: 90, ra: 90 },
  ]);

/** Choreo with a 3D pose on the given frames (figure3d of the same parameters). */
function withPose3d(poses: FigureParams[], on: (i: number) => boolean): Choreography {
  const c = makeChoreo(poses);
  return {
    ...c,
    frames: c.frames.map((f, i) => (on(i) ? { ...f, pose3d: figure3d(poses[i]!) } : f)),
  };
}

/** A v1 choreography as stored or exported before Etappe 13d. */
const asV1 = (c: Choreography) => JSON.parse(JSON.stringify({ ...c, version: 1 })) as unknown;

describe("Choreografie-Format v2 (pose3d)", () => {
  it("akzeptiert Frames mit und ohne pose3d", () => {
    const c = withPose3d(
      [
        { la: 0, ra: 0 },
        { la: 90, ra: 90 },
      ],
      (i) => i === 1,
    );
    const parsed = ChoreographySchema.parse(c);
    expect(parsed.frames[0]).not.toHaveProperty("pose3d");
    expect(parsed.frames[1]!.pose3d).toEqual(c.frames[1]!.pose3d);
  });

  it("lehnt ungültige pose3d ab", () => {
    const sk = figure3d({ la: 30, ra: 60 });
    const bad: unknown[] = [
      { ...sk, root: { pos: [0, 0], yawDeg: 0 } },
      { ...sk, root: { pos: [0, 0, 0], yawDeg: Number.NaN } },
      { ...sk, bones: { ...sk.bones, torso: [0, 2, 0] } },
      { ...sk, bones: { ...sk.bones, tail: [0, 1, 0] } },
      { root: sk.root },
    ];
    for (const b of bad) expect(Skeleton3DSchema.safeParse(b).success).toBe(false);
    expect(Skeleton3DSchema.safeParse(sk).success).toBe(true);
    expect(Skeleton3DSchema.safeParse({ ...sk, bones: {} }).success).toBe(true);
  });
});

describe("Migration Version 1 → 2", () => {
  it("setzt nur die Version, Frames bleiben unverändert", () => {
    const c = twoFrames();
    const v1 = asV1(c);
    const m = migrateChoreo(v1, 42);
    expect(m.version).toBe(2);
    expect(m.frames).toEqual(c.frames);
    expect(m).toEqual({ ...c, version: 2 });
    expect(m.updatedAt).toBe(c.updatedAt);
  });

  it("v2 bleibt unverändert, unbekannte Versionen werden abgelehnt", () => {
    const c = withPose3d([{ la: 10, ra: 20 }], () => true);
    expect(migrateChoreo(c)).toEqual(c);
    expect(() => migrateChoreo({ ...c, version: 3 })).toThrow("Unbekannte Choreografie-Version");
  });

  it("nur ein fehlendes Versionsfeld gilt als Version 0", () => {
    const c = twoFrames();
    for (const version of [0, null, "1"])
      expect(() => migrateChoreo({ ...c, version })).toThrow(
        `Unbekannte Choreografie-Version: ${String(version)}`,
      );
  });
});

describe("frameAt mit pose3d", () => {
  const poses: FigureParams[] = [
    { la: 0, ra: 0 },
    { la: 90, ra: 40 },
    { la: 160, ra: 120 },
    { la: 30, ra: 30 },
    { la: 60, ra: 10 },
    { la: 10, ra: 60 },
  ];
  // Frames every 500 ms; pose3d on frames 0, 1 and 3 only.
  const c = withPose3d(poses, (i) => i === 0 || i === 1 || i === 3);
  const sk = (i: number) => c.frames[i]!.pose3d!;
  const smooth = (k: number) => k * k * (3 - 2 * k);

  it("interpoliert zwischen zwei Nachbarn mit pose3d wie die Landmarks", () => {
    // Halfway: smoothstep(0.5) = 0.5.
    expect(frameAt(c.frames, 250)!.pose3d).toEqual(interpolate(sk(0), sk(1), 0.5));
  });

  it("überbrückt genau einen Frame ohne pose3d", () => {
    expect(frameAt(c.frames, 750)!.pose3d).toEqual(interpolate(sk(1), sk(3), smooth(0.25)));
    expect(frameAt(c.frames, 1250)!.pose3d).toEqual(interpolate(sk(1), sk(3), smooth(0.75)));
  });

  it("ohne pose3d auf einer Seite (Lücke größer als ein Frame) fehlt es", () => {
    expect(frameAt(c.frames, 1750)).not.toHaveProperty("pose3d");
    expect(frameAt(c.frames, 2250)).not.toHaveProperty("pose3d");
  });

  it("gibt auf einem Frame mit pose3d dessen Pose unverändert zurück", () => {
    // Partner without leftShin: interpolate would drop the bone.
    const { leftShin: _, ...bones } = sk(1).bones;
    const frames = c.frames.map((f, i) => (i === 1 ? { ...f, pose3d: { ...sk(1), bones } } : f));
    expect(frameAt(frames, 0)!.pose3d).toBe(sk(0));
    const hit = frameAt(c.frames, 500)!.pose3d;
    expect(hit).toBe(sk(1));
    // In between, interpolate drops the bone the partner lacks.
    expect(frameAt(frames, 0.5)!.pose3d!.bones.leftShin).toBeUndefined();
  });

  it("gibt am Rand den Frame unverändert zurück", () => {
    expect(frameAt(c.frames, -10)!.pose3d).toEqual(sk(0));
    expect(frameAt(c.frames, 9999)).toBe(c.frames[5]);
  });

  it("Frames ohne pose3d verhalten sich wie bisher", () => {
    const plain = makeChoreo(poses);
    const f = frameAt(plain.frames, 250)!;
    expect(Object.keys(f).sort()).toEqual(["angles", "landmarks", "timeMs"]);
  });
});

describe("mirrorChoreo mit pose3d", () => {
  const c = withPose3d(
    [
      { la: 20, ra: 150, le: 40, ll: 25, lean: 6 },
      { la: 90, ra: 10 },
    ],
    (i) => i === 0,
  );

  it("spiegelt pose3d passend zu den Landmarks und ist zweimal angewendet die Identität", () => {
    const m = mirrorChoreo(c);
    expect(m.frames[1]).not.toHaveProperty("pose3d");
    const sk = m.frames[0]!.pose3d!;
    expect(sk.bones.leftUpperArm).toEqual(
      c.frames[0]!.pose3d!.bones.rightUpperArm!.map((v, i) => (i === 0 ? -v + 0 : v)),
    );
    expect(mirrorChoreo(m)).toEqual(c);
  });
});

describe("Export und Import über Versionen", () => {
  it("liest eine alte Exportdatei v1 und liefert v2", () => {
    const song = makeSong(twoFrames());
    const file = buildChoreoFile(song, 5);
    const old = { ...file, version: 1, choreo: asV1(song.choreo) };
    const parsed = parseChoreoFile(JSON.stringify(old));
    expect(parsed.version).toBe(2);
    expect(parsed.choreo.version).toBe(2);
    expect(parsed.choreo.frames).toEqual(song.choreo.frames);
  });

  it("schreibt v2 und behält pose3d in der Rundreise", () => {
    const c = withPose3d([{ la: 10, ra: 170 }], () => true);
    const file = buildChoreoFile(makeSong(c), 5);
    expect(file.version).toBe(2);
    expect(parseChoreoFile(JSON.stringify(file)).choreo).toEqual(c);
  });

  it("lehnt unbekannte Dateiversionen ab", () => {
    const file = { ...buildChoreoFile(makeSong(twoFrames()), 5), version: 9 };
    expect(() => parseChoreoFile(JSON.stringify(file))).toThrow("Ungültige Choreografie-Datei");
  });
});

// ---------------------------------------------------------------------------------------------
// Video import with world landmarks

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

const wave = (t: number): FigureParams => ({
  la: 90 + 60 * Math.sin((2 * Math.PI * t) / 2000),
  ra: 90 - 50 * Math.sin((2 * Math.PI * t) / 3000),
  le: 30,
  re: 20,
  ll: 10,
  rl: 10,
});

/**
 * Square video (aspect 1) of `figure()` with matching MediaPipe world points: metres around the
 * hip midpoint, x toward the image right, y down, z away from the camera.
 */
function makeTrack(durationMs: number, opts: { world: boolean; noise?: number }): PoseTrack {
  const rand = rng(7);
  const n = () => (rand() - 0.5) * 2 * (opts.noise ?? 0);
  const samples: PoseTrack["samples"] = [];
  for (let t = 0; t <= durationMs; t += 33) {
    const lm = figure(wave(t));
    const landmarks = lm.map((p) => [p[0] + n(), p[1] + n(), p[2] ?? 1] as Landmark);
    if (!opts.world) {
      samples.push({ timeMs: t, landmarks });
      continue;
    }
    const world = lm.map((p): Landmark3d => [
      (p[0] - 0.5) / FIGURE_UNITS_PER_METER + n(),
      (p[1] - 0.58) / FIGURE_UNITS_PER_METER + n(),
      n() * 4,
      p[2] ?? 1,
    ]);
    samples.push({ timeMs: t, landmarks, world });
  }
  return { aspect: 1, samples };
}

/** First and last frame have pose3d, and never two frames in a row lack it. */
function expectThinned(frames: Frame[]) {
  expect(frames[0]!.pose3d).toBeDefined();
  expect(frames[frames.length - 1]!.pose3d).toBeDefined();
  for (let i = 1; i < frames.length; i++)
    expect(!!frames[i - 1]!.pose3d || !!frames[i]!.pose3d).toBe(true);
}

const videoOpts = { title: "Video", bpm: 120, now: 1, movePlacement: "grid" as const };

describe("choreoFromPoseTrack mit Weltpunkten", () => {
  it("etwa jeder zweite Frame bekommt pose3d, gerundet und passend zur gespiegelten 2D-Figur", () => {
    const c = choreoFromPoseTrack(makeTrack(4000, { world: true }), videoOpts);
    expect(c.frames.length).toBeGreaterThan(30);
    const with3d = c.frames.filter((f) => f.pose3d);
    expect(with3d.length).toBeLessThanOrEqual(Math.ceil(c.frames.length / 2) + 1);
    expectThinned(c.frames);
    // Between the first and the last 3D pose every time gets one through frameAt.
    const [first, last] = [with3d[0]!.timeMs, with3d[with3d.length - 1]!.timeMs];
    for (let t = first; t <= last; t += 25) expect(frameAt(c.frames, t)?.pose3d).toBeDefined();
    for (const f of with3d) {
      const sk = f.pose3d!;
      expect(Object.keys(sk.bones)).toHaveLength(12);
      for (const v of [...Object.values(sk.bones), sk.root.pos])
        for (const x of v!) expect(Math.round(x * 1000) / 1000).toBe(x);
      expect(Math.round(sk.root.yawDeg * 10) / 10).toBe(sk.root.yawDeg);
      // Mirror space: the projected 3D pose and the stored landmarks show the same move.
      const p = project(sk);
      for (const i of [13, 14, 15, 16, 25, 26]) {
        expect(p[i]![0]).toBeCloseTo(f.landmarks[i]![0], 1);
        expect(p[i]![1]).toBeCloseTo(f.landmarks[i]![1], 1);
      }
    }
  });

  it("mit Beat-Phase haben erster und letzter Frame pose3d", () => {
    for (const beatOffsetMs of [40, 130, 333]) {
      const c = choreoFromPoseTrack(makeTrack(4000, { world: true }), {
        ...videoOpts,
        beatOffsetMs,
      });
      expect(c.offsetMs).toBeGreaterThan(0);
      expectThinned(c.frames);
    }
  });

  it("eine fehlende Weltpunkt-Probe in der Mitte reißt keine Lücke von zwei Frames", () => {
    const track = makeTrack(4000, { world: true });
    // Gaps at four consecutive slots, so both parities are covered.
    for (const gapAt of [2000, 2100, 2200, 2300]) {
      const samples = track.samples.map((s) =>
        Math.abs(s.timeMs - gapAt) < 40 ? { ...s, world: null } : s,
      );
      const c = choreoFromPoseTrack({ ...track, samples }, videoOpts);
      const i = c.frames.findIndex((f) => Math.abs(f.timeMs - gapAt) < 40);
      expect(i).toBeGreaterThan(0);
      expect(c.frames[i]).not.toHaveProperty("pose3d");
      expectThinned(c.frames);
    }
  });

  it("ohne Weltpunkte bleibt die Choreo ohne pose3d (wie bisher)", () => {
    const c = choreoFromPoseTrack(makeTrack(4000, { world: false }), videoOpts);
    for (const f of c.frames) expect(f).not.toHaveProperty("pose3d");
  });

  it("Weltpunkte ohne Körperachse ergeben keinen pose3d", () => {
    const track = makeTrack(4000, { world: true });
    const samples = track.samples.map((s) => ({
      ...s,
      world: s.world!.map((p): Landmark3d => [p[0], p[1], p[2], 0.1]),
    }));
    const c = choreoFromPoseTrack({ ...track, samples }, videoOpts);
    for (const f of c.frames) expect(f).not.toHaveProperty("pose3d");
  });

  it("Größe: 3-Minuten-Choreo mit pose3d unter +50 %", () => {
    // Measured during 13d (1800 frames): pose3d on every frame +57.8 % (3 decimals) or +51.3 %
    // (2 decimals), hence about every second frame: 1 370 789 → 1 767 777 bytes, +29.0 %.
    const c = choreoFromPoseTrack(makeTrack(180_000, { world: true, noise: 0.003 }), videoOpts);
    expect(c.frames.length).toBeGreaterThan(1700);
    expect(c.frames[0]!.landmarks).toHaveLength(33);
    const strip = (f: Frame): Frame => {
      const { pose3d: _, ...rest } = f;
      return rest;
    };
    const with3d = JSON.stringify(c).length;
    const without = JSON.stringify({ ...c, frames: c.frames.map(strip) }).length;
    const ratio = with3d / without;
    expect(ratio).toBeLessThan(1.5);
  });
});

/** Compile-time: Skeleton3D and the parsed pose3d are interchangeable. */
const _assign: (sk: Skeleton3D) => Frame["pose3d"] = (sk) => sk;
void _assign;
