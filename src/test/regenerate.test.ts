import { beforeAll, describe, expect, it } from "vitest";

import { autoChoreo } from "@/data/demo";
import { beatMsOf, type EnergyCurve } from "@/lib/generator";
import { audioTiming, choreoDurationMs, regenerateSong } from "@/lib/library/regenerate";
import { loadMotionPack } from "@/lib/motionPack";
import { computeAngles, figure } from "@/lib/pose";
import { SongSchema } from "@/lib/schema";
import type { Choreography, MotionPack, Song } from "@/lib/types";
import { makeChoreo, makeSong } from "./fixtures";

let PACK: MotionPack;
beforeAll(async () => {
  PACK = await loadMotionPack();
});

const NOW = 1_800_000_000_000;

/**
 * Video-like choreography: 2D frames without pose3d every 500 ms up to `durationMs`, a move
 * every 2 s, a non-zero offset and custom colors.
 */
function videoChoreo(durationMs = 70_000, lastMoveMs?: number): Choreography {
  const landmarks = figure({ la: 90, ra: 45 });
  const angles = computeAngles(landmarks);
  const frames = [];
  for (let t = 0; t <= durationMs; t += 500) frames.push({ timeMs: t, landmarks, angles });
  const moves = [];
  const end = lastMoveMs ?? durationMs - 2000;
  for (let t = 2000; t <= end; t += 2000)
    moves.push({ timeMs: t, label: `M${t}`, iconId: "x", gold: false });
  return {
    ...makeChoreo(),
    title: "Mein Lied",
    bpm: 120,
    offsetMs: 137,
    accentColor: "#123456",
    secondaryColor: "#ABCDEF",
    frames,
    moves,
    createdAt: 42,
    updatedAt: 43,
  };
}

function videoSong(choreo = videoChoreo()): Song {
  return {
    ...makeSong(choreo),
    title: "Mein Lied",
    artist: "Ich",
    bpm: 120,
    difficulty: 2,
    syncOffsetMs: -35,
    startOffsetMs: 4000,
    playbackRate: 0.75,
    highscore: 98_765,
    stars: 4,
    createdAt: 11,
    updatedAt: 12,
  };
}

describe("choreoDurationMs", () => {
  it("takes the last frame when it ends after the last move", () => {
    expect(choreoDurationMs(videoChoreo(70_000, 60_000))).toBe(70_000);
  });

  it("takes the last move when it ends after the last frame", () => {
    const c = videoChoreo(30_000);
    c.moves.push({ timeMs: 45_000, label: "Spät", iconId: "x", gold: true });
    expect(choreoDurationMs(c)).toBe(45_000);
  });

  it("works with moves only", () => {
    const c = { ...videoChoreo(30_000), frames: [] };
    expect(choreoDurationMs(c)).toBe(28_000);
  });

  it("throws without any length", () => {
    expect(() => choreoDurationMs({ ...makeChoreo(), frames: [], moves: [] })).toThrow(Error);
    // A single frame and move at 0 ms has no length either.
    expect(() => choreoDurationMs(makeChoreo())).toThrow(Error);
  });
});

describe("regenerateSong", () => {
  const opts = { difficulty: 2 as const, seed: "seed-a" };

  it("builds the same choreography as the generator with the song's data", () => {
    const song = videoSong();
    const energy: EnergyCurve = {
      hopMs: 10,
      values: Float64Array.from({ length: 7000 }, (_, i) => (i % 50 === 0 ? 1 : 0.1)),
    };
    const out = regenerateSong(song, PACK, { ...opts, energy, beatPhaseMs: 120 }, NOW);
    const expected = autoChoreo(song.title, song.bpm, 70_000, ["#123456", "#ABCDEF"], PACK, {
      seed: "seed-a",
      difficulty: 2,
      energy,
      beatPhaseMs: 120,
      id: song.choreo.id,
    });
    expect(out.choreo.frames).toEqual(expected.frames);
    expect(out.choreo.moves).toEqual(expected.moves);
  });

  it("is deterministic per seed", () => {
    const song = videoSong();
    const a = regenerateSong(song, PACK, opts, NOW);
    const b = regenerateSong(song, PACK, opts, NOW + 1);
    expect(b.choreo.frames).toEqual(a.choreo.frames);
    expect(b.choreo.moves).toEqual(a.choreo.moves);
  });

  it("gives a different choreography for a different seed", () => {
    const song = videoSong();
    const a = regenerateSong(song, PACK, { ...opts, seed: "seed-a" }, NOW);
    const b = regenerateSong(song, PACK, { ...opts, seed: "seed-b" }, NOW);
    expect(b.choreo.moves).not.toEqual(a.choreo.moves);
  });

  it("replaces the video choreography with a generated one", () => {
    const song = videoSong();
    const out = regenerateSong(song, PACK, opts, NOW);
    expect(out.choreo.moves).not.toEqual(song.choreo.moves);
    expect(out.choreo.moves.length).toBeGreaterThan(0);
    expect(out.choreo.frames.length).toBeGreaterThan(0);
    expect(out.choreo.frames.every((f) => f.pose3d !== undefined)).toBe(true);
  });

  it("keeps the kept dance video (videoBlobId)", () => {
    const song = { ...videoSong(), videoBlobId: "video-blob" };
    expect(regenerateSong(song, PACK, opts, NOW).videoBlobId).toBe("video-blob");
    expect("videoBlobId" in regenerateSong(videoSong(), PACK, opts, NOW)).toBe(false);
  });

  it("applies the difficulty to the song and the move density", () => {
    const song = videoSong(videoChoreo(90_000));
    const easy = regenerateSong(song, PACK, { difficulty: 1, seed: "d" }, NOW);
    const hard = regenerateSong(song, PACK, { difficulty: 3, seed: "d" }, NOW);
    expect(easy.difficulty).toBe(1);
    expect(hard.difficulty).toBe(3);
    expect(hard.choreo.moves.length).toBeGreaterThanOrEqual(easy.choreo.moves.length);
  });

  it("keeps everything but difficulty and choreography content", () => {
    const song = videoSong();
    const out = regenerateSong(song, PACK, { difficulty: 3, seed: "x" }, NOW);
    expect(out.id).toBe(song.id);
    expect(out.title).toBe(song.title);
    expect(out.artist).toBe(song.artist);
    expect(out.bpm).toBe(song.bpm);
    expect(out.source).toEqual(song.source);
    expect(out.syncOffsetMs).toBe(song.syncOffsetMs);
    expect(out.startOffsetMs).toBe(song.startOffsetMs);
    expect(out.playbackRate).toBe(song.playbackRate);
    expect(out.highscore).toBe(song.highscore);
    expect(out.stars).toBe(song.stars);
    expect(out.createdAt).toBe(song.createdAt);

    expect(out.choreo.id).toBe(song.choreo.id);
    expect(out.choreo.title).toBe(song.choreo.title);
    expect(out.choreo.bpm).toBe(song.bpm);
    expect(out.choreo.offsetMs).toBe(137);
    expect(out.choreo.accentColor).toBe("#123456");
    expect(out.choreo.secondaryColor).toBe("#ABCDEF");
    expect(out.choreo.createdAt).toBe(42);
    expect(out.choreo.updatedAt).toBe(NOW);
  });

  it("does not change the input song", () => {
    const song = videoSong();
    const before = structuredClone(song);
    regenerateSong(song, PACK, opts, NOW);
    expect(song).toEqual(before);
  });

  it("ends the frames at the old length", () => {
    for (const durationMs of [45_000, 70_000, 123_500]) {
      const out = regenerateSong(videoSong(videoChoreo(durationMs)), PACK, opts, NOW);
      expect(out.choreo.frames.at(-1)?.timeMs).toBe(durationMs);
      expect(out.choreo.moves.at(-1)!.timeMs).toBeLessThan(durationMs);
    }
  });

  it("passes the song schema", () => {
    const out = regenerateSong(videoSong(), PACK, opts, NOW);
    expect(SongSchema.safeParse(out).success).toBe(true);
  });

  it("puts the moves on the given beat phase", () => {
    const song = { ...videoSong(), bpm: 128 };
    const beatPhaseMs = 213;
    const out = regenerateSong(song, PACK, { ...opts, beatPhaseMs }, NOW);
    const beat = beatMsOf(128);
    const phase = beatPhaseMs % beat;
    expect(out.choreo.moves.length).toBeGreaterThan(0);
    // B7: the phase is added to the kept offset; the moves lie on k · beat in choreography time,
    // so on the phase in the song's own timeline (choreography time + old offset).
    expect(out.choreo.offsetMs).toBeCloseTo(song.choreo.offsetMs + phase, 1);
    for (const m of out.choreo.moves) {
      const k = Math.round(m.timeMs / beat);
      expect(Math.abs(k * beat - m.timeMs)).toBeLessThanOrEqual(1);
      const own = m.timeMs + phase;
      const j = Math.round((own - phase) / beat);
      expect(Math.abs(phase + j * beat - own)).toBeLessThanOrEqual(1);
    }
  });

  it("throws for a choreography without length", () => {
    const song = makeSong({ ...makeChoreo(), frames: [], moves: [] });
    expect(() => regenerateSong(song, PACK, opts, NOW)).toThrow(Error);
  });

  it("throws when the result does not pass the schema", () => {
    // An invalid song (empty title) cannot be stored, so regenerating it must fail.
    const song = { ...videoSong(), title: "" };
    expect(() => regenerateSong(song, PACK, opts, NOW)).toThrow();
  });
});

describe("audioTiming", () => {
  /** Envelope with a sharp onset every beat at `phaseMs` (10 ms steps), from `fromMs` on. */
  function clickEnvelope(bpm: number, phaseMs: number, seconds: number, fromMs = 0) {
    const values = new Float64Array(seconds * 100);
    const beatMs = 60_000 / bpm;
    for (let t = phaseMs; t < seconds * 1000; t += beatMs)
      if (t >= fromMs) values[Math.round(t / 10)] = 1;
    return { hopMs: 10, values };
  }
  const analysis = (envelope: { hopMs: number; values: Float64Array }) => () =>
    Promise.resolve({ bpm: 120, durationMs: envelope.values.length * 10, envelope });
  const blob = new Blob(["x"]);
  const song120 = (offsetMs = 0, startOffsetMs = 0): Song => {
    const song = makeSong();
    return { ...song, bpm: 120, startOffsetMs, choreo: { ...song.choreo, offsetMs } };
  };
  /** Distance of `t` to the nearest point of the grid `phase + k · beat`. */
  const gridDistance = (t: number, phase: number, beatMs: number) => {
    const d = (((t - phase) % beatMs) + beatMs) % beatMs;
    return Math.min(d, beatMs - d);
  };

  it("returns nothing without an audio file and does not analyse", async () => {
    let calls = 0;
    const analyze = () => {
      calls++;
      return Promise.reject(new Error("unused"));
    };
    expect(await audioTiming(undefined, song120(), analyze)).toEqual({});
    expect(calls).toBe(0);
  });

  it("falls back to nothing when the file cannot be decoded", async () => {
    const timing = await audioTiming(blob, song120(), () => Promise.reject(new Error("decode")));
    expect(timing).toEqual({});
  });

  it("takes the envelope as energy and fits the beat phase to the song's BPM", async () => {
    const envelope = clickEnvelope(120, 230, 20);
    const timing = await audioTiming(blob, song120(), analysis(envelope));
    expect(timing.energy).toBe(envelope);
    expect(gridDistance(timing.beatPhaseMs ?? NaN, 230, 500)).toBeLessThanOrEqual(10);
  });

  it("leaves the phase to the generator when the envelope holds no onsets", async () => {
    const envelope = { hopMs: 10, values: new Float64Array(2000) };
    expect(await audioTiming(blob, song120(), analysis(envelope))).toEqual({ energy: envelope });
  });

  it("works in choreography time when the choreography has an offset (video import)", async () => {
    // Beats from 30 s on (silent intro); the choreography starts at 30.123 s of the audio.
    const envelope = clickEnvelope(120, 30_230, 60, 30_000);
    const offsetMs = 30_123;
    const timing = await audioTiming(blob, song120(offsetMs), analysis(envelope));
    // Audio beats at 30 230 + k · 500 are choreography beats at 107 + k · 500.
    expect(gridDistance(timing.beatPhaseMs ?? NaN, 107, 500)).toBeLessThanOrEqual(10);
    // Energy step i is the audio at i · 10 ms + offset.
    const energy = timing.energy!;
    expect(energy.hopMs).toBe(10);
    expect(energy.values.length).toBe(envelope.values.length - 3012);
    for (let i = 0; i < energy.values.length; i++)
      expect(energy.values[i]).toBe(envelope.values[i + 3012]);
  });

  it("fits the phase after a skipped intro (startOffsetMs)", async () => {
    // The first 10 s carry clicks on another grid; the song starts playing at 10 s.
    const intro = clickEnvelope(120, 0, 10);
    const main = clickEnvelope(120, 10_250, 40, 10_000);
    const values = main.values.map((v, i) => (i < 1000 ? intro.values[i]! : v));
    const timing = await audioTiming(blob, song120(0, 10_000), analysis({ hopMs: 10, values }));
    expect(gridDistance(timing.beatPhaseMs ?? NaN, 250, 500)).toBeLessThanOrEqual(10);
  });
});
