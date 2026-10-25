/**
 * Evaluation bench for choreographies from dance videos (Etappe 8, P1): builds the choreography
 * from a raw pose-track export exactly like the import dialog, then scores it with a simulated
 * player who dances the same video (self test), the same video late by ¼ and ½ beat (robustness)
 * and another video (negative test). Pure logic; the CLI is eval-video.ts.
 *
 * The simulated player is a live camera, not the reference itself: the dancer's raw landmarks
 * are resampled at `fps` (linear between analysis samples), get Gaussian noise on every
 * coordinate, a random timing error per camera frame and dropped frames. Everything is seeded,
 * so the bench itself is deterministic.
 */
import { mirrorAngles } from "../src/lib/choreo.ts";
import { computeAngles } from "../src/lib/pose.ts";
import { importOptions, type PoseTrackFile } from "../src/lib/poseTrackFile.ts";
import { gaussian, hashSeed, seededRandom } from "../src/lib/random.ts";
import { MOVE_WINDOW_MS, Scorer } from "../src/lib/scorer.ts";
import type { Angles, Choreography, Landmark, Rating } from "../src/lib/types.ts";
import {
  choreoFromPoseTrack,
  type OneEuroParams,
  type PoseTrack,
  type VideoChoreoOptions,
} from "../src/lib/videoChoreo.ts";

export interface PlayerSim {
  /** Camera frames per second of the simulated player. */
  fps: number;
  /** Standard deviation of the landmark noise in image heights (x is scaled by the aspect). */
  noise: number;
  /** Standard deviation of the per-frame timing error in ms (residual after latency compensation). */
  jitterMs: number;
  /** Share of camera frames without a pose. */
  missRate: number;
}

/**
 * Defaults, start values: 1 % of the image height is about 1.7 cm on a 1.7 m person filling the
 * picture, roughly the frame-to-frame jitter of the live "lite" model; 20 ms timing error is about
 * one camera frame; 5 % dropped frames.
 */
export const DEFAULT_SIM: PlayerSim = { fps: 30, noise: 0.01, jitterMs: 20, missRate: 0.05 };
export const DEFAULT_VIDEO_SEEDS = 5;

/**
 * Analysis samples further apart than this are not interpolated for the simulated player (the
 * dancer was not seen in between). Three samples of the 50 ms analysis grid.
 */
export const PLAYER_MAX_GAP_MS = 150;

/**
 * One-Euro parameters that pass the signal through unchanged (alpha ≈ 1 at every speed): the
 * variant "MediaPipe only" against the default "MediaPipe + One-Euro".
 */
export const NO_SMOOTHING: Partial<OneEuroParams> = { minCutoff: 1e9, beta: 0 };

export const VARIANTS = {
  "One-Euro": {},
  "ohne One-Euro": { filter: NO_SMOOTHING },
} satisfies Record<string, Partial<VideoChoreoOptions>>;
export type VariantName = keyof typeof VARIANTS;

export const SCENARIOS = ["selbst", "+¼ Beat", "+½ Beat", "fremd"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface EvalVideo {
  /** Short name for the report (file name). */
  name: string;
  file: PoseTrackFile;
  /**
   * Presentation times (ms) of all video frames, sorted (ffprobe). When given, the simulated player
   * sees each analysis sample at the time of the frame the browser really showed for it (the frame
   * whose display interval contains the sample time), while the reference keeps the recorded times.
   * Without it both use the recorded times.
   */
  frameTimesMs?: number[];
}

export interface EvalVideoParams {
  seeds: number;
  sim: PlayerSim;
  variants: readonly VariantName[];
}

const RATINGS: readonly Rating[] = ["PERFECT", "SUPER", "GOOD", "OK", "X"];

export interface VideoEvalRow {
  video: string;
  variant: VariantName;
  scenario: Scenario;
  seed: number;
  counts: Record<Rating, number>;
  stars: number;
  ratio: number;
  score: number;
}

export interface VideoEvalGroup {
  video: string;
  variant: VariantName;
  scenario: Scenario;
  /** Share of each rating over all seeds (0..1). */
  shares: Record<Rating, number>;
  stars: number;
  ratio: number;
  score: number;
}

export interface VideoEvalSummary {
  video: string;
  variant: VariantName;
  moves: number;
  /** Ratio of the self test minus ratio of the negative test (null without a second video). */
  separation: number | null;
  /** Two builds with the same input give the same JSON (apart from the random id). */
  deterministic: boolean;
}

/** Mean and maximum of |recorded time − time of the shown frame| over all samples, in ms. */
export interface TimeError {
  video: string;
  meanMs: number;
  maxMs: number;
}

/** Builds the choreography like the import dialog (`importOptions`), plus the variant's options. */
export function buildChoreo(file: PoseTrackFile, variant: VariantName): Choreography {
  const { track, opts } = importOptions(file);
  return choreoFromPoseTrack(track, { ...opts, ...VARIANTS[variant] });
}

/** Time of the frame shown for `timeMs`: the last frame starting at or before it (1 µs slack). */
export function shownFrameTime(frameTimesMs: readonly number[], timeMs: number): number {
  let lo = 0,
    hi = frameTimesMs.length - 1;
  if (hi < 0 || timeMs < frameTimesMs[0]! - 1e-3) return timeMs;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (frameTimesMs[m]! <= timeMs + 1e-3) lo = m;
    else hi = m - 1;
  }
  return frameTimesMs[lo]!;
}

/** The track as the camera saw it: sample times replaced by the shown frames' times. */
export function trueTrack(track: PoseTrack, frameTimesMs?: readonly number[]): PoseTrack {
  if (!frameTimesMs?.length) return track;
  return {
    aspect: track.aspect,
    samples: track.samples.map((s) => ({ ...s, timeMs: shownFrameTime(frameTimesMs, s.timeMs) })),
  };
}

export function timeError(video: EvalVideo): TimeError | null {
  const times = video.frameTimesMs;
  if (!times?.length) return null;
  let sum = 0,
    max = 0;
  const samples = video.file.track.samples;
  for (const s of samples) {
    const d = Math.abs(s.timeMs - shownFrameTime(times, s.timeMs));
    sum += d;
    max = Math.max(max, d);
  }
  return { video: video.name, meanMs: samples.length ? sum / samples.length : 0, maxMs: max };
}

/**
 * Landmarks of `track` at `timeMs`, linear between the neighbouring samples (visibility: the
 * lower one). null outside the track, next to a sample without a person, or across a gap over
 * PLAYER_MAX_GAP_MS.
 */
export function landmarksAt(track: PoseTrack, timeMs: number): Landmark[] | null {
  const s = track.samples;
  let lo = 0,
    hi = s.length - 1;
  const first = s[0],
    last = s[hi];
  if (!first || !last || timeMs < first.timeMs || timeMs > last.timeMs) return null;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (s[m]!.timeMs <= timeMs) lo = m;
    else hi = m;
  }
  const a = s[lo]!,
    b = s[hi]!;
  // Exactly on a sample: no neighbour needed.
  if (a.timeMs === timeMs) return a.landmarks;
  if (b.timeMs === timeMs) return b.landmarks;
  if (!a.landmarks || !b.landmarks) return null;
  if (b.timeMs - a.timeMs > PLAYER_MAX_GAP_MS) return null;
  const k =
    b.timeMs > a.timeMs ? Math.max(0, Math.min(1, (timeMs - a.timeMs) / (b.timeMs - a.timeMs))) : 0;
  return a.landmarks.map((p, i) => {
    const q = b.landmarks?.[i] ?? p;
    const v = Math.min(p[2] ?? 1, q[2] ?? 1);
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, v] as Landmark;
  });
}

/** Where the simulated player's movement comes from. */
interface PlayerSource {
  track: PoseTrack;
  /** Mirror the dancer's sides like the stored choreography (dancer facing the camera). */
  mirror: boolean;
  /** Video time the player dances at game time `t` (before the timing error). */
  sourceTime: (t: number) => number;
}

/** The simulated player's angles at game time `t`, or null (dropped frame, dancer not seen). */
function playerAngles(
  src: PlayerSource,
  t: number,
  sim: PlayerSim,
  random: () => number,
): Angles | null {
  // Fixed number of random draws per frame keeps the sequences of all scenarios aligned.
  const miss = random() < sim.missRate;
  const lag = gaussian(random) * sim.jitterMs;
  const lm = landmarksAt(src.track, src.sourceTime(t) - lag);
  const noisy = lm?.map((p) => {
    const nx = (gaussian(random) * sim.noise) / src.track.aspect;
    const ny = gaussian(random) * sim.noise;
    return [p[0] + nx, p[1] + ny, p[2] ?? 1] as Landmark;
  });
  if (miss || !noisy) return null;
  const angles = computeAngles(noisy, { aspect: src.track.aspect });
  return src.mirror ? mirrorAngles(angles) : angles;
}

/** Scores `choreo` against one simulated play-through. */
function play(choreo: Choreography, src: PlayerSource, sim: PlayerSim, seed: number) {
  const random = seededRandom(seed);
  const scorer = new Scorer(choreo);
  const lastMove = choreo.moves[choreo.moves.length - 1]?.timeMs ?? 0;
  const step = 1000 / sim.fps;
  for (let k = 0; !scorer.done(); k++) {
    const t = k * step;
    scorer.sample(t, playerAngles(src, t, sim, random));
    if (t > lastMove + MOVE_WINDOW_MS + 2 * step) break;
  }
  return scorer.snapshot();
}

/** Choreography time 0 in video time: range start plus the beat phase (`choreo.offsetMs`). */
const videoStart = (file: PoseTrackFile, choreo: Choreography) =>
  file.range.startMs + choreo.offsetMs;

function source(
  scenario: Scenario,
  self: EvalVideo,
  other: EvalVideo | undefined,
  choreo: Choreography,
): PlayerSource | null {
  const start = videoStart(self.file, choreo);
  const beatMs = 60000 / choreo.bpm;
  const own = (lateMs: number): PlayerSource => ({
    track: trueTrack(self.file.track, self.frameTimesMs),
    mirror: self.file.mirror,
    sourceTime: (t) => start + t - lateMs,
  });
  switch (scenario) {
    case "selbst":
      return own(0);
    case "+¼ Beat":
      return own(beatMs / 4);
    case "+½ Beat":
      return own(beatMs / 2);
    case "fremd": {
      if (!other) return null;
      const { startMs, endMs } = other.file.range;
      const span = endMs - startMs;
      // The other dance from its range start, looped if it is shorter.
      return {
        track: trueTrack(other.file.track, other.frameTimesMs),
        mirror: other.file.mirror,
        sourceTime: (t) => startMs + (((t % span) + span) % span),
      };
    }
  }
}

const withoutId = (c: Choreography) => JSON.stringify({ ...c, id: "" });

/**
 * Runs every video × variant × scenario × seed. The negative test of video i uses video i + 1
 * (cyclic); with a single video it is skipped. Seeds depend on video, scenario and seed number,
 * not on the variant, so both variants see the same simulated player.
 */
export function runVideoEval(videos: readonly EvalVideo[], params: EvalVideoParams) {
  const rows: VideoEvalRow[] = [];
  const summaries: VideoEvalSummary[] = [];
  videos.forEach((video, i) => {
    const other = videos.length > 1 ? videos[(i + 1) % videos.length] : undefined;
    for (const variant of params.variants) {
      const choreo = buildChoreo(video.file, variant);
      const deterministic = withoutId(choreo) === withoutId(buildChoreo(video.file, variant));
      const ratios: Partial<Record<Scenario, number[]>> = {};
      for (const scenario of SCENARIOS) {
        const src = source(scenario, video, other, choreo);
        if (!src) continue;
        for (let seed = 0; seed < params.seeds; seed++) {
          const snap = play(choreo, src, params.sim, hashSeed(`${video.name}|${scenario}|${seed}`));
          rows.push({
            video: video.name,
            variant,
            scenario,
            seed,
            counts: snap.counts,
            stars: snap.stars,
            ratio: snap.ratio,
            score: snap.score,
          });
          (ratios[scenario] ??= []).push(snap.ratio);
        }
      }
      const self = ratios.selbst,
        neg = ratios.fremd;
      summaries.push({
        video: video.name,
        variant,
        moves: choreo.moves.length,
        separation: self && neg ? mean(self) - mean(neg) : null,
        deterministic,
      });
    }
  });
  return { rows, groups: groupVideoRows(rows), summaries };
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function groupVideoRows(rows: readonly VideoEvalRow[]): VideoEvalGroup[] {
  const groups = new Map<string, VideoEvalRow[]>();
  for (const r of rows) {
    const key = `${r.video}\u0000${r.variant}\u0000${r.scenario}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()].map((list) => {
    const first = list[0]!;
    const total = list.reduce((s, r) => s + RATINGS.reduce((a, k) => a + r.counts[k], 0), 0) || 1;
    const shares = Object.fromEntries(
      RATINGS.map((k) => [k, list.reduce((s, r) => s + r.counts[k], 0) / total]),
    ) as Record<Rating, number>;
    return {
      video: first.video,
      variant: first.variant,
      scenario: first.scenario,
      shares,
      stars: mean(list.map((r) => r.stars)),
      ratio: mean(list.map((r) => r.ratio)),
      score: mean(list.map((r) => r.score)),
    };
  });
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const de = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");

/** Plain-text table; the first `left` columns are left-aligned, the rest right-aligned. */
function table(header: string[], body: string[][], left = 3): string {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  const line = (row: string[]) =>
    row.map((s, i) => (i < left ? s.padEnd(widths[i]!) : s.padStart(widths[i]!))).join(" | ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("-|-"), ...body.map(line)].join("\n");
}

export function formatVideoTable(groups: readonly VideoEvalGroup[]): string {
  return table(
    ["Video", "Variante", "Szenario", ...RATINGS, "Sterne", "Quote", "Score"],
    groups.map((g) => [
      g.video,
      g.variant,
      g.scenario,
      ...RATINGS.map((k) => pct(g.shares[k])),
      de(g.stars, 1),
      de(g.ratio, 3),
      String(Math.round(g.score)),
    ]),
  );
}

export function formatSummary(summaries: readonly VideoEvalSummary[]): string {
  return table(
    ["Video", "Variante", "Moves", "Trennschärfe", "deterministisch"],
    summaries.map((s) => [
      s.video,
      s.variant,
      String(s.moves),
      s.separation === null ? "–" : de(s.separation, 3),
      s.deterministic ? "ja" : "NEIN",
    ]),
    2,
  );
}

export function formatTimeErrors(errors: readonly TimeError[]): string {
  return table(
    ["Video", "Mittel ms", "Max ms"],
    errors.map((e) => [e.video, de(e.meanMs, 1), de(e.maxMs, 1)]),
    1,
  );
}
