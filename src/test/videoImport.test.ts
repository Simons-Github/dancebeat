import { describe, expect, it } from "vitest";

import { mirrorChoreo } from "@/lib/choreo";
import { angleDiff, computeAngles } from "@/lib/pose";
import type { AngleKey } from "@/lib/types";
import { buildNewSong, validateNewSongFields } from "@/lib/library/newSong";
import {
  buildVideoChoreo,
  looksMirrored,
  parseBeatPhaseMs,
  parseVideoSeconds,
  validateVideoRange,
  type VideoImportOptions,
} from "@/lib/library/videoImport";
import type { PoseTrack } from "@/lib/videoChoreo";
import { figureLandmarks } from "./videoAnalysisFakes";

const ASPECT = 16 / 9;

function makeTrack(
  durationMs = 10_000,
  stepMs = 50,
  detected: (t: number) => boolean = () => true,
): PoseTrack {
  const samples: PoseTrack["samples"] = [];
  for (let t = 0; t <= durationMs; t += stepMs) {
    samples.push({ timeMs: t, landmarks: detected(t) ? figureLandmarks(t, ASPECT) : null });
  }
  return { aspect: ASPECT, samples };
}

const TRACK = makeTrack();
const base = (over: Partial<VideoImportOptions> = {}): VideoImportOptions => ({
  track: TRACK,
  title: "Video",
  bpm: 120,
  range: { startMs: 3000, endMs: 9000 },
  beatPhaseMs: 250,
  now: 1_760_000_000_000,
  ...over,
});

const mod = (x: number, m: number) => ((x % m) + m) % m;

describe("buildVideoChoreo", () => {
  it.each([
    // [start, phase P] – P − start negative, positive and zero
    [3000, 250],
    [1000, 1250],
    [2000, 0],
    [1700, 40],
  ])("puts moves on audio times ≡ P mod beat (start %d, P %d)", (startMs, beatPhaseMs) => {
    const range = { startMs, endMs: 9000 };
    const { choreo, startOffsetMs } = buildVideoChoreo(base({ range, beatPhaseMs }));
    const beat = 500;
    expect(startOffsetMs).toBe(startMs);
    expect(choreo.offsetMs).toBeCloseTo(startMs + mod(beatPhaseMs - startMs, beat), 6);
    expect(choreo.moves.length).toBeGreaterThanOrEqual(2);
    for (const m of choreo.moves) {
      const audio = m.timeMs + choreo.offsetMs;
      expect(mod(audio - beatPhaseMs + 1e-6, beat)).toBeLessThan(1e-3);
      expect(audio).toBeGreaterThanOrEqual(startMs);
      expect(audio).toBeLessThanOrEqual(9000);
    }
  });

  it("start 3000, P 250: offset 3250, first move at choreo time 0", () => {
    const { choreo } = buildVideoChoreo(base({ movePlacement: "grid" }));
    expect(choreo.offsetMs).toBe(3250);
    expect(choreo.moves[0]?.timeMs).toBe(0);
    expect(choreo.bpm).toBe(120);
  });

  it("reference frames match the video pose at the same audio time", () => {
    const { choreo } = buildVideoChoreo(base({ mirror: false }));
    let checked = 0;
    for (const frame of choreo.frames) {
      const videoTime = frame.timeMs + choreo.offsetMs;
      const sample = TRACK.samples.find((s) => Math.abs(s.timeMs - videoTime) < 1);
      if (!sample?.landmarks) continue;
      const expected = computeAngles(sample.landmarks, { aspect: ASPECT });
      for (const [k, v] of Object.entries(frame.angles) as [AngleKey, number][]) {
        const e = expected[k];
        if (e == null) continue;
        expect(Math.abs(angleDiff(v, e))).toBeLessThan(5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("passes mirror through (default mirrored, false keeps sides)", () => {
    const mirrored = buildVideoChoreo(base()).choreo;
    const plain = buildVideoChoreo(base({ mirror: false })).choreo;
    expect(buildVideoChoreo(base({ mirror: true })).choreo.frames).toEqual(mirrored.frames);
    expect(mirrorChoreo(mirrored).frames.map((f) => f.angles)).toEqual(
      plain.frames.map((f) => f.angles),
    );
    expect(plain.frames.map((f) => f.angles)).not.toEqual(mirrored.frames.map((f) => f.angles));
  });

  it("reports moves, gold moves and the detection ratio of the range", () => {
    // No person from 5 s to 6 s (exclusive): 20 of 121 samples in 3..9 s.
    const track = makeTrack(10_000, 50, (t) => t < 5000 || t >= 6000);
    const { choreo, stats } = buildVideoChoreo(base({ track }));
    expect(stats.moves).toBe(choreo.moves.length);
    expect(stats.gold).toBe(choreo.moves.filter((m) => m.gold).length);
    expect(stats.gold).toBeGreaterThan(0);
    expect(stats.detectionRatio).toBeCloseTo(101 / 121, 6);
  });

  it("throws German messages for bad ranges and unusable tracks", () => {
    expect(() => buildVideoChoreo(base({ range: { startMs: 5000, endMs: 5000 } }))).toThrow(
      "Das Ende muss nach dem Start liegen.",
    );
    expect(() => buildVideoChoreo(base({ range: { startMs: 5000, endMs: 6500 } }))).toThrow(
      /mindestens 2 Sekunden/,
    );
    expect(() =>
      buildVideoChoreo(base({ range: { startMs: 0, endMs: 12_000 }, durationMs: 10_000 })),
    ).toThrow("Das Ende liegt hinter dem Videoende.");
    expect(() => buildVideoChoreo(base({ track: makeTrack(10_000, 50, () => false) }))).toThrow(
      "Im Video wurde zu selten eine Person erkannt.",
    );
  });
});

describe("validateVideoRange", () => {
  it("accepts a valid range and tolerates end rounding", () => {
    expect(validateVideoRange({ startMs: 0, endMs: 2000 }, 2000)).toBeNull();
    expect(validateVideoRange({ startMs: 0, endMs: 6000 }, 5950)).toBeNull();
    expect(validateVideoRange({ startMs: 0, endMs: 6000 }, null)).toBeNull();
  });

  it("rejects reversed, short, too long and out-of-video ranges", () => {
    expect(validateVideoRange({ startMs: 3000, endMs: 1000 }, 10_000)).toMatch(/nach dem Start/);
    expect(validateVideoRange({ startMs: 0, endMs: 1999 }, 10_000)).toMatch(/mindestens/);
    expect(validateVideoRange({ startMs: 0, endMs: 600_001 }, null)).toMatch(/höchstens/);
    expect(validateVideoRange({ startMs: 0, endMs: 8000 }, 7000)).toMatch(/Videoende/);
    expect(validateVideoRange({ startMs: NaN, endMs: 8000 }, null)).toMatch(/Sekunden/);
    expect(validateVideoRange({ startMs: -1, endMs: 8000 }, null)).toMatch(/Sekunden/);
  });
});

describe("parseVideoSeconds", () => {
  it("parses comma and dot without the 600 s cap", () => {
    expect(parseVideoSeconds("12,5")).toBe(12_500);
    expect(parseVideoSeconds("760.25")).toBe(760_250);
    expect(parseVideoSeconds("3600")).toBe(3_600_000);
    expect(parseVideoSeconds("")).toBe(0);
    expect(parseVideoSeconds("", null)).toBeNull();
    expect(parseVideoSeconds("-1")).toBeNull();
    expect(parseVideoSeconds("1:30")).toBeNull();
  });
});

describe("parseBeatPhaseMs", () => {
  it.each([
    ["", 0],
    ["0", 0],
    [" 250 ", 250],
    ["-120", -120],
    ["−80", -80],
    ["700000", 700_000],
  ])("parses %j", (text, ms) => {
    expect(parseBeatPhaseMs(text)).toBe(ms);
  });

  it.each(["1,5", "abc", "12ms", "3600001"])("rejects %j", (text) => {
    expect(parseBeatPhaseMs(text)).toBeNull();
  });
});

describe("buildNewSong (video)", () => {
  it("keeps the choreo timing, sets startOffsetMs and fresh ids, title and colors", () => {
    const { choreo, startOffsetMs } = buildVideoChoreo(base());
    const song = buildNewSong(
      {
        source: { kind: "youtube", videoId: "dQw4w9WgXcQ" },
        title: "  Mein Tanz ",
        artist: "Ich",
        bpm: 99, // ignored: the choreo's bpm counts
        difficulty: 3,
        durationMs: 0,
        colors: ["#111111", "#222222"],
        choreo: { type: "video", choreo, startOffsetMs },
      },
      42,
    );
    expect(song.bpm).toBe(120);
    expect(song.startOffsetMs).toBe(3000);
    expect(song.syncOffsetMs).toBe(0);
    expect(song.title).toBe("Mein Tanz");
    expect(song.choreo.title).toBe("Mein Tanz");
    expect(song.choreo.offsetMs).toBe(3250);
    expect(song.choreo.moves).toEqual(choreo.moves);
    expect(song.choreo.frames).toEqual(choreo.frames);
    expect(song.choreo.id).not.toBe(choreo.id);
    expect(song.choreo.accentColor).toBe("#111111");
    expect(song.choreo.secondaryColor).toBe("#222222");
    expect(song.choreo.createdAt).toBe(42);
    expect(song.createdAt).toBe(42);
  });

  it("keepVideo gives the song a fresh videoBlobId, otherwise the key is missing", () => {
    const { choreo, startOffsetMs } = buildVideoChoreo(base());
    const input = (keepVideo?: boolean) => ({
      source: { kind: "url" as const, url: "https://example.com/a.mp3" },
      title: "T",
      artist: "",
      bpm: 120,
      difficulty: 2 as const,
      durationMs: 0,
      colors: ["#111111", "#222222"] as [string, string],
      choreo: {
        type: "video" as const,
        choreo,
        startOffsetMs,
        ...(keepVideo !== undefined && { keepVideo }),
      },
    });
    const kept = buildNewSong(input(true));
    expect(kept.videoBlobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(buildNewSong(input(true)).videoBlobId).not.toBe(kept.videoBlobId);
    expect("videoBlobId" in buildNewSong(input(false))).toBe(false);
    expect("videoBlobId" in buildNewSong(input())).toBe(false);
  });

  it("video mode needs bpm but no duration", () => {
    const fields = {
      kind: "youtube" as const,
      title: "T",
      link: "dQw4w9WgXcQ",
      bpm: 120,
      durationS: NaN,
      imported: false,
    };
    expect(validateNewSongFields({ ...fields, video: true })).toEqual({});
    expect(validateNewSongFields(fields).duration).toBeDefined();
    expect(validateNewSongFields({ ...fields, video: true, bpm: NaN }).bpm).toBeDefined();
  });
});

describe("looksMirrored", () => {
  it("erkennt gespiegelte Videos am Dateinamen", () => {
    for (const name of [
      "NewJeans 'Super Shy' Dance Practice (Mirrored) [abc123].mp4",
      "BLACKPINK_Pink_Venom_MIRRORED.mp4",
      "dance-practice-mirror.mov",
      "mirror.mp4",
      "MirrorMode.mp4",
      "kpop_mirror2.mp4",
      "Tanz gespiegelt.mp4",
      "Choreo spiegelverkehrt.mov",
      "안무 거울모드.mp4",
    ]) {
      expect(looksMirrored(name), name).toBe(true);
    }
  });

  it("ignoriert Namen ohne Hinweis, Wörter, die nur so beginnen oder enden, und Verneinungen", () => {
    for (const name of [
      "tanz.mp4",
      "Mirrorball Party.mp4",
      "Supermirror.mov",
      "Zumba 2024.mp4",
      "",
    ]) {
      expect(looksMirrored(name), name).toBe(false);
    }
  });
});
