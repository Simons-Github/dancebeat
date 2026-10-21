import { afterEach, describe, expect, it, vi } from "vitest";

import { figure, type FigureParams } from "@/lib/pose";
import { ChoreographySchema } from "@/lib/schema";
import type { Landmark } from "@/lib/types";
import {
  analyzeVideo,
  FRAME_FALLBACK_MS,
  PROGRESS_INTERVAL_MS,
  VideoAnalysisError,
} from "@/lib/videoAnalysis";
import { defaultTarget, trackTarget } from "@/lib/targetPerson";
import { choreoFromPoseTrack } from "@/lib/videoChoreo";
import { fakeEstimator, FakeVideo, fakeWorldEstimator, worldOf } from "./videoAnalysisFakes";

const someone: Landmark[] = [[0.5, 0.5, 1]];

afterEach(() => {
  vi.useRealTimers();
});

describe("analyzeVideo", () => {
  it("tastet das ganze Video im Raster ab, mit Seitenverhältnis und pausiertem Video", async () => {
    const video = new FakeVideo({ width: 720, height: 1280, durationMs: 230 });
    const est = fakeEstimator(() => someone);
    const track = await analyzeVideo(video.asVideo(), est);
    expect(track.aspect).toBeCloseTo(720 / 1280, 10);
    expect(track.samples.map((s) => s.timeMs)).toEqual([0, 50, 100, 150, 200]);
    expect(video.seeks).toEqual([0, 50, 100, 150, 200]);
    // Detection ran on the frame of each sample.
    expect(est.seen).toEqual([0, 50, 100, 150, 200]);
    expect(video.paused).toBe(true);
    expect(video.listeners).toBe(0);
  });

  it("hält sich an Abschnitt und Intervall, Zeiten bleiben Videozeit", async () => {
    const video = new FakeVideo({ durationMs: 1000 });
    const est = fakeEstimator();
    const track = await analyzeVideo(video.asVideo(), est, {
      intervalMs: 100,
      range: { startMs: 600, endMs: 5000 },
    });
    expect(track.samples.map((s) => s.timeMs)).toEqual([600, 700, 800, 900, 1000]);
  });

  it("behält Samples ohne Person als leere Liste", async () => {
    const video = new FakeVideo({ durationMs: 200 });
    const est = fakeEstimator((t) => (t === 100 ? null : someone));
    const track = await analyzeVideo(video.asVideo(), est);
    expect(track.samples.map((s) => s.poses)).toEqual([
      [someone],
      [someone],
      [],
      [someone],
      [someone],
    ]);
  });

  it("übernimmt mit detectAll alle erkannten Personen je Sample", async () => {
    const video = new FakeVideo({ durationMs: 100 });
    const other: Landmark[] = [[0.2, 0.5, 1]];
    const est = fakeEstimator(() => someone);
    const all = vi.fn((_v: HTMLVideoElement, _ts: number) => [someone, other]);
    est.detectAll = all;
    const track = await analyzeVideo(video.asVideo(), est);
    expect(track.samples.map((s) => s.poses)).toEqual([
      [someone, other],
      [someone, other],
      [someone, other],
    ]);
    expect(all.mock.calls.map((c) => c[1])).toEqual([0, 50, 100]);
    expect(est.detect).not.toHaveBeenCalled();
  });

  it("bevorzugt detectAllWorld und legt die Weltpunkte parallel zu den Personen ab", async () => {
    const video = new FakeVideo({ durationMs: 100 });
    const other: Landmark[] = [[0.2, 0.5, 1]];
    const est = fakeWorldEstimator(() => [someone, other], [1]);
    const track = await analyzeVideo(video.asVideo(), est);
    expect(track.samples.map((s) => s.poses)).toEqual([
      [someone, other],
      [someone, other],
      [someone, other],
    ]);
    for (const s of track.samples) expect(s.worlds).toEqual([worldOf(someone), null]);
    expect(est.detectAll).not.toHaveBeenCalled();
    expect(est.detect).not.toHaveBeenCalled();
  });

  it("ohne detectAllWorld bleiben die Samples ohne Weltpunkte", async () => {
    const video = new FakeVideo({ durationMs: 100 });
    const track = await analyzeVideo(
      video.asVideo(),
      fakeEstimator(() => someone),
    );
    for (const s of track.samples) expect(s).not.toHaveProperty("worlds");
  });

  it("übergibt streng steigende Zeitstempel, auch über mehrere Läufe mit demselben Modell", async () => {
    const video = new FakeVideo({ durationMs: 300 });
    const est = fakeEstimator();
    await analyzeVideo(video.asVideo(), est);
    await analyzeVideo(video.asVideo(), est, { range: { startMs: 0, endMs: 100 } });
    await analyzeVideo(video.asVideo(), est, { range: { startMs: 200, endMs: 300 } });
    const ts = est.timestamps;
    expect(ts).toHaveLength(7 + 3 + 3);
    for (let i = 1; i < ts.length; i++) expect(ts[i]!).toBeGreaterThan(ts[i - 1]!);
    // Spacing follows video time.
    expect(ts[8]! - ts[7]!).toBe(50);
  });

  it("wirft typisierte Fehler ohne Metadaten, bei Videofehler und leerem Abschnitt", async () => {
    const est = fakeEstimator();
    const noSize = new FakeVideo({ width: 0 });
    await expect(analyzeVideo(noSize.asVideo(), est)).rejects.toMatchObject({
      code: "no-metadata",
    });
    const noDuration = new FakeVideo();
    noDuration.duration = NaN;
    await expect(analyzeVideo(noDuration.asVideo(), est)).rejects.toBeInstanceOf(
      VideoAnalysisError,
    );
    const broken = new FakeVideo();
    broken.error = { code: 4 } as MediaError;
    await expect(analyzeVideo(broken.asVideo(), est)).rejects.toMatchObject({
      code: "video-error",
    });
    await expect(
      analyzeVideo(new FakeVideo({ durationMs: 1000 }).asVideo(), est, {
        range: { startMs: 2000, endMs: 3000 },
      }),
    ).rejects.toMatchObject({ code: "empty-range" });
    expect(est.detect).not.toHaveBeenCalled();
  });

  it("meldet ein error-Event des Videos während des Spulens", async () => {
    const video = new FakeVideo({ stuck: true });
    const run = analyzeVideo(video.asVideo(), fakeEstimator());
    video.dispatchEvent(new Event("error"));
    await expect(run).rejects.toMatchObject({ code: "video-error" });
    expect(video.listeners).toBe(0);
  });

  it("bricht mitten im Lauf mit AbortError ab und räumt Listener weg", async () => {
    const video = new FakeVideo({ durationMs: 10_000 });
    const controller = new AbortController();
    const est = fakeEstimator((t) => {
      if (t === 100) controller.abort();
      return null;
    });
    await expect(
      analyzeVideo(video.asVideo(), est, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(est.timestamps).toHaveLength(3);
    expect(video.listeners).toBe(0);
  });

  it("bricht auch während eines hängenden Spulvorgangs sofort ab", async () => {
    const video = new FakeVideo({ stuck: true, vfc: "never" });
    const controller = new AbortController();
    const run = analyzeVideo(video.asVideo(), fakeEstimator(), { signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(video.listeners).toBe(0);
    expect(video.frameCallbacks.size).toBe(0);
  });

  it("lehnt ein schon abgebrochenes Signal ab, ohne zu spulen", async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeVideo(video.asVideo(), fakeEstimator(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(video.seeks).toEqual([]);
  });

  it("meldet hängendes Spulen nach seekTimeoutMs als seek-timeout", async () => {
    vi.useFakeTimers();
    const video = new FakeVideo({ stuck: true });
    const run = analyzeVideo(video.asVideo(), fakeEstimator(), { seekTimeoutMs: 2000 });
    const caught = run.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1999);
    expect(video.listeners).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    const e = await caught;
    expect(e).toBeInstanceOf(VideoAnalysisError);
    expect((e as VideoAnalysisError).code).toBe("seek-timeout");
    expect(video.listeners).toBe(0);
  });

  it("wartet nach seeked auf den Frame-Callback (Safari zeigt sonst das alte Bild)", async () => {
    const video = new FakeVideo({ durationMs: 150, vfc: "after-seeked" });
    const est = fakeEstimator();
    await analyzeVideo(video.asVideo(), est);
    expect(est.seen).toEqual([0, 50, 100, 150]);
    expect(video.frameCallbacks.size).toBe(0);
  });

  it("nimmt einen Frame-Callback, der schon vor seeked kommt", async () => {
    const video = new FakeVideo({ durationMs: 100, vfc: "before-seeked" });
    const est = fakeEstimator();
    await analyzeVideo(video.asVideo(), est);
    expect(est.seen).toEqual([0, 50, 100]);
  });

  it("ignoriert einen verspäteten Frame der vorigen Position und wartet auf den richtigen", async () => {
    const video = new FakeVideo({ durationMs: 500, vfc: "stale-first" });
    const est = fakeEstimator();
    await analyzeVideo(video.asVideo(), est, {
      intervalMs: 100,
      range: { startMs: 200, endMs: 500 },
    });
    // Without the mediaTime check every step would read the previous frame.
    expect(est.seen).toEqual([200, 300, 400, 500]);
    expect(video.frameCallbacks.size).toBe(0);
  });

  it("hängt nicht, wenn der Frame-Callback nie kommt", async () => {
    vi.useFakeTimers();
    const video = new FakeVideo({ durationMs: 100, vfc: "never" });
    const est = fakeEstimator();
    const run = analyzeVideo(video.asVideo(), est);
    await vi.advanceTimersByTimeAsync(3 * (FRAME_FALLBACK_MS + 1));
    const track = await run;
    expect(track.samples).toHaveLength(3);
    expect(est.seen).toEqual([0, 50, 100]);
    // Pending callbacks are cancelled, nothing stays registered.
    expect(video.frameCallbacks.size).toBe(0);
    expect(video.cancelled).toHaveLength(3);
    expect(video.listeners).toBe(0);
  });

  it("drosselt Fortschrittsmeldungen und meldet zum Schluss 1", async () => {
    const video = new FakeVideo({ durationMs: 950 }); // 20 steps
    let clock = 0;
    const progress: number[] = [];
    await analyzeVideo(video.asVideo(), fakeEstimator(), {
      now: () => (clock += 100), // 100 ms wall clock per step
      onProgress: (p) => progress.push(p),
    });
    // First step, then every third step (>= 250 ms), plus the final 1.
    expect(progress[0]).toBeCloseTo(1 / 20);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeLessThanOrEqual(Math.ceil((20 * 100) / PROGRESS_INTERVAL_MS) + 1);
    expect(progress.length).toBeGreaterThan(2);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]!).toBeGreaterThan(progress[i - 1]!);
  });
});

describe("analyzeVideo → choreoFromPoseTrack", () => {
  it("erzeugt aus synthetischen Figuren eine gültige Choreografie", async () => {
    const pose = (t: number): FigureParams => ({
      la: 90 + 60 * Math.sin((2 * Math.PI * t) / 2000),
      ra: 90 - 50 * Math.sin((2 * Math.PI * t) / 3000),
      le: 30,
      re: 20,
    });
    // Square video: per-axis normalized landmarks equal the figure's square space.
    const video = new FakeVideo({ width: 720, height: 720, durationMs: 8000 });
    const est = fakeEstimator((t) => figure(pose(t)));
    const track = await analyzeVideo(video.asVideo(), est, { intervalMs: 50 });
    const choreo = choreoFromPoseTrack(trackTarget(track, defaultTarget(track)), {
      title: "Video",
      bpm: 120,
      mirror: false,
      range: { startMs: 1000, endMs: 7000 },
      now: 1_760_000_000_000,
    });
    expect(ChoreographySchema.safeParse(choreo).success).toBe(true);
    expect(choreo.moves.length).toBeGreaterThanOrEqual(2);
    expect(choreo.frames.length).toBeGreaterThan(2);
  });
});
