import { describe, expect, it } from "vitest";
import { DEMO_POSES, DEMO_SEQUENCES } from "@/data/demo";
import { mirrorLandmarks } from "@/lib/choreo";
import {
  boneDistance,
  buildMotionPack,
  checkComplete,
  CLIP_FILTERS,
  demoClipId,
  demoMotionSource,
  groupClips,
  type MotionSource,
  type RawClip,
} from "@/lib/motionPack";
import { VIDEO_KEYFRAME_STEP_BEATS, videoClipId, videoMotionSource } from "@/lib/motionPackVideo";
import { figure, figure3d, type FigureParams } from "@/lib/pose";
import { buildPoseTrackFile, type PoseTrackFile } from "@/lib/poseTrackFile";
import { MotionClipSchema } from "@/lib/schema";
import { FIGURE_UNITS_PER_METER, mirror3d, type Skeleton3D } from "@/lib/skeleton";
import type { Landmark, Landmark3d } from "@/lib/types";
import type { PoseTrack } from "@/lib/videoChoreo";

const NEUTRAL = figure3d({ la: 10, ra: 10 });
const BPM = 120;
const BEAT_MS = 60000 / BPM;
const A: FigureParams = { la: 160, ra: 20, le: 0, re: 60 }; // asymmetric: tests mirror space
const B: FigureParams = { la: 90, ra: 90 };
const KEYS = ["la", "ra", "le", "re", "ll", "rl", "lk", "rk", "lean", "dy"] as const;

const lerp = (a: FigureParams, b: FigureParams, s: number): FigureParams => {
  const out: FigureParams = { la: 0, ra: 0 };
  for (const k of KEYS) out[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * s;
  return out;
};
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Pattern time τ = t − 1 beat: A held around τ-beats 0, 4 …, B around 2, 6 …, a smooth move of one
 * beat between. In video time the holds sit on the odd beats 1, 3, …, 11 (beat 0 at the range
 * start has no motion measure, so hold placement could not pick it); hold `n` shows poseOf(n).
 * The range ends before beat 12, so no extra one-beat hold appears at the end.
 */
const DURATION_MS = 11.5 * BEAT_MS;
const poseOf = (n: number) => (n % 2 === 0 ? A : B);
function dancer(t: number): FigureParams {
  const w = Math.floor(t / (2 * BEAT_MS));
  const s = smooth((t - w * 2 * BEAT_MS - BEAT_MS / 2) / BEAT_MS);
  return lerp(poseOf(w), poseOf(w + 1), s);
}

/**
 * Square, unmirrored camera video of a dancer showing `figure()` in mirror space (so the frames
 * are mirrorLandmarks of it: dancer-left at image right), with MediaPipe world points (metres,
 * x image-right, y down, around the hips, frontal).
 */
function makeTrack(durationMs: number, world: (t: number) => boolean): PoseTrack {
  const samples: PoseTrack["samples"] = [];
  for (let t = 0; t <= durationMs; t += 20) {
    const landmarks: Landmark[] = mirrorLandmarks(figure(dancer(Math.max(0, t - BEAT_MS))));
    if (!world(t)) {
      samples.push({ timeMs: t, landmarks, world: null });
      continue;
    }
    const w = landmarks.map((p): Landmark3d => [
      (p[0] - 0.5) / FIGURE_UNITS_PER_METER,
      (p[1] - 0.58) / FIGURE_UNITS_PER_METER,
      0,
      p[2] ?? 1,
    ]);
    samples.push({ timeMs: t, landmarks, world: w });
  }
  return { aspect: 1, samples };
}

const makeFile = (
  opts: { mirror?: boolean; world?: (t: number) => boolean; video?: string } = {},
): PoseTrackFile =>
  buildPoseTrackFile({
    exportedAt: 1,
    video: opts.video ?? "Dance Clip.mp4",
    bpm: BPM,
    beatPhaseMs: 0,
    range: { startMs: 0, endMs: DURATION_MS },
    mirror: opts.mirror ?? true,
    movePlacement: "holds",
    track: makeTrack(DURATION_MS, opts.world ?? (() => true)),
  });

describe("videoMotionSource", () => {
  const file = makeFile();
  const { source, rejected } = videoMotionSource(file);

  it("schneidet einen Clip je Haltepunkt-Paar mit Viertelbeat-Keyframes", () => {
    expect(rejected).toEqual([]);
    expect(source.clips).toHaveLength(5); // holds on beats 1, 3, …, 11
    expect(source.style).toBe("party");
    source.clips.forEach((c, i) => {
      expect(c.id).toBe(videoClipId(file.video, i + 1));
      expect(Number.isInteger(c.beats)).toBe(true);
      expect(c.beats).toBe(2);
      expect(c.anchorBeat).toBe(c.beats);
      expect(c.sourceBpm).toBe(BPM);
      expect(c.source).toBe("video:Dance Clip.mp4");
      expect(c.styles).toEqual(["party"]);
      expect(c).not.toHaveProperty("iconId");
      const beats = c.keyframes.map((k) => k.beat);
      expect(beats).toEqual(Array.from({ length: c.beats * 4 + 1 }, (_, k) => k * 0.25));
      expect(VIDEO_KEYFRAME_STEP_BEATS).toBe(0.25);
    });
  });

  it("Anker ist die gehaltene Pose im Spiegelraum, Start die vorige", () => {
    source.clips.forEach((c, i) => {
      const n = i + 1;
      const first = c.keyframes[0]!.pose3d;
      const anchor = c.keyframes[c.keyframes.length - 1]!.pose3d;
      expect(boneDistance(anchor, figure3d(poseOf(n)))).toBeLessThan(5);
      expect(boneDistance(first, figure3d(poseOf(n - 1)))).toBeLessThan(5);
    });
    // Without mirroring the clip stays in camera space: the mirror image of the pose.
    const plain = videoMotionSource(makeFile({ mirror: false })).source.clips[1]!;
    const anchor = plain.keyframes[plain.keyframes.length - 1]!.pose3d;
    expect(boneDistance(anchor, mirror3d(figure3d(A)))).toBeLessThan(5);
    expect(boneDistance(anchor, figure3d(A))).toBeGreaterThan(20);
  });

  it("Clips bestehen das Paket und sind MotionClipSchema-gültig", () => {
    const { pack, rejected: r } = buildMotionPack({ sources: [source], neutral: NEUTRAL });
    expect(r).toEqual([]);
    // A and B clips alternate; equal ones merge (same beats, styles, anchor).
    expect(pack.clips.length).toBeGreaterThanOrEqual(2);
    for (const c of pack.clips) expect(MotionClipSchema.safeParse(c).success).toBe(true);
  });

  it("eine Sequenz mit allen Clip-IDs in Reihenfolge, abgelehnte eingeschlossen", () => {
    expect(source.sequences).toEqual([source.clips.map((c) => c.id)]);
    // No world points around hold 2 (beat 5, t = 2500): clips 2 and 3 lose an end.
    const gap = makeFile({ world: (t) => Math.abs(t - 2500) > 300 });
    const res = videoMotionSource(gap);
    expect(res.rejected.map((r) => r.id)).toEqual([
      videoClipId(gap.video, 2),
      videoClipId(gap.video, 3),
    ]);
    for (const r of res.rejected) expect(r.reason.length).toBeGreaterThan(0);
    expect(res.source.clips.map((c) => c.id)).toEqual(
      [1, 4, 5].map((n) => videoClipId(gap.video, n)),
    );
    expect(res.source.sequences).toEqual([[1, 2, 3, 4, 5].map((n) => videoClipId(gap.video, n))]);
  });

  it("lehnt Haltepunkt-Abstände über 4 Beats ab", () => {
    // No person between 1.6 s and 4.4 s: the holds jump from beat 3 to beat 9.
    const f = makeFile();
    const samples = f.track.samples.map((s) =>
      s.timeMs > 1600 && s.timeMs < 4400 ? { ...s, landmarks: null, world: null } : s,
    );
    const res = videoMotionSource({ ...f, track: { ...f.track, samples } });
    expect(res.rejected.length).toBeGreaterThan(0);
    expect(res.rejected[0]!.reason).toMatch(/Beats/);
    for (const c of res.source.clips) expect(c.beats).toBeLessThanOrEqual(4);
    expect(res.source.sequences[0]).toContain(res.rejected[0]!.id);
  });

  it("v1-Datei ohne Weltpunkte: alle Clips abgelehnt, kein Fehler", () => {
    const f = makeFile();
    const v1: PoseTrackFile = {
      ...f,
      version: 1,
      track: { ...f.track, samples: f.track.samples.map(({ world: _, ...s }) => s) },
    };
    const res = videoMotionSource(v1);
    expect(res.source.clips).toEqual([]);
    expect(res.rejected).toHaveLength(5);
    expect(res.source.sequences).toEqual([res.rejected.map((r) => r.id)]);
  });

  it("Stil-Parameter, Determinismus und durchgereichte Importfehler", () => {
    const hiphop = videoMotionSource(file, "hiphop").source;
    expect(hiphop.style).toBe("hiphop");
    for (const c of hiphop.clips) expect(c.styles).toEqual(["hiphop"]);
    expect(videoMotionSource(file)).toEqual(videoMotionSource(file));
    const empty = { ...file, track: { ...file.track, samples: [] } };
    expect(() => videoMotionSource(empty)).toThrow();
  });
});

describe("videoClipId", () => {
  it("Slug klein, Sonderzeichen als Bindestrich, getrimmt, Rückfall 'video'", () => {
    expect(videoClipId("My Dance_Video!.MP4", 3)).toBe("video:my-dance-video-mp4:3");
    expect(videoClipId("--Foo--", 1)).toBe("video:foo:1");
    expect(videoClipId("", 2)).toBe("video:video:2");
    expect(videoClipId("äöü!!", 2)).toBe("video:video:2");
  });

  it("Slug höchstens 40 Zeichen, ID höchstens 80", () => {
    const id = videoClipId("a".repeat(100), 7);
    expect(id).toBe(`video:${"a".repeat(40)}:7`);
    expect(videoClipId("b".repeat(39) + " c", 1)).toBe(`video:${"b".repeat(39)}:1`);
    expect(videoClipId("x".repeat(200), 10 ** 40).length).toBeLessThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------------------------
// motionPack.ts changes of 13e-2

const rawClip = (id: string, sk: Skeleton3D, extra: Partial<RawClip> = {}): RawClip => ({
  id,
  label: id,
  styles: ["party"],
  beats: 1,
  anchorBeat: 0,
  keyframes: [
    { beat: 0, pose3d: sk },
    { beat: 1, pose3d: sk },
  ],
  source: "test",
  ...extra,
});

const tPose = (deg: number) => figure3d({ la: 90 + deg, ra: 90 });

describe("checkComplete", () => {
  it("ist der erste Filter, nimmt volle Posen an und lehnt fehlende Knochen ab", () => {
    expect(CLIP_FILTERS[0]).toBe(checkComplete);
    expect(checkComplete(rawClip("full", tPose(0)))).toBeNull();
    const { leftShin: _, ...bones } = tPose(0).bones;
    const partial = rawClip("partial", tPose(0), {
      keyframes: [
        { beat: 0, pose3d: tPose(0) },
        { beat: 1, pose3d: { ...tPose(0), bones } },
      ],
    });
    expect(checkComplete(partial)).toMatch(/11/);
    const res = buildMotionPack({
      sources: [{ clips: [partial], sequences: [], style: "party" }],
      neutral: NEUTRAL,
    });
    expect(res.rejected).toEqual([{ id: "partial", reason: checkComplete(partial) }]);
  });
});

describe("groupClips mit Priorität", () => {
  const clips = [rawClip("a", tPose(0)), rawClip("b", tPose(8)), rawClip("c", tPose(16))];

  it("ohne Priorität bleibt das Medoid", () => {
    const { kept, idMap } = groupClips(clips);
    expect(kept.map((c) => c.id)).toEqual(["b"]);
    expect([...idMap.values()]).toEqual(["b", "b", "b"]);
  });

  it("die niedrigste Priorität gewinnt, auch wenn sie nicht das Medoid ist", () => {
    const { kept, idMap } = groupClips(clips, 20, (c) => (c.id === "c" ? 0 : 1));
    expect(kept.map((c) => c.id)).toEqual(["c"]);
    expect(idMap.get("a")).toBe("c");
  });
});

describe("buildMotionPack mit Demo- und Video-Quelle", () => {
  const demo = demoMotionSource(DEMO_POSES, DEMO_SEQUENCES);
  const v = (n: number, deg: number) =>
    rawClip(videoClipId("x.mp4", n), tPose(deg), { anchorBeat: 1, source: "video:x.mp4" });
  const video: MotionSource = {
    clips: [v(1, 8), v(2, 16)], // v1 would be the plain medoid of {t-pose, v1, v2}
    sequences: [[v(2, 16).id, v(1, 8).id, v(2, 16).id]],
    style: "party",
  };

  it("der Demo-Clip bleibt Repräsentant und erbt die Übergänge", () => {
    const only = buildMotionPack({ sources: [demo], neutral: NEUTRAL }).pack;
    const both = buildMotionPack({ sources: [demo, video], neutral: NEUTRAL }).pack;
    expect(both.clips.map((c) => c.id)).toEqual(only.clips.map((c) => c.id));
    const t = demoClipId("t-pose");
    expect(both.clips.find((c) => c.id === t)?.iconId).toBe("t-pose");
    const before = only.transitions["party"]?.[t]?.[t] ?? 0;
    expect(both.transitions["party"]?.[t]?.[t]).toBe(before + 2);
  });
});
