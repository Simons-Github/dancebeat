import { mirrorChoreo } from "./choreo";
import {
  angleDiff,
  ARM_KEYS,
  computeAngles,
  frameAt,
  isVisible,
  lerpAngle,
  LEG_KEYS,
} from "./pose";
import { CHOREO_VERSION, ChoreographySchema } from "./schema";
import type { Angles, Choreography, Frame, Landmark, Landmark3d, Move } from "./types";
import { SONG_PALETTES } from "@/theme";

/** Raw pose track from a video analysis (MediaPipe output, per-axis normalized landmarks). */
export interface PoseTrack {
  /** Source video width / height. Landmarks are normalized per axis (MediaPipe). */
  aspect: number;
  /**
   * Sorted by timeMs (video time). landmarks null = no person detected. `world` (Etappe 13c):
   * MediaPipe world landmarks of the same person, null if none; absent (or undefined, as zod
   * parses it) if the analysis recorded no world landmarks. The choreography is still built from
   * the 2D landmarks only.
   */
  samples: {
    timeMs: number;
    landmarks: Landmark[] | null;
    world?: Landmark3d[] | null | undefined;
  }[];
}

export interface OneEuroParams {
  /** Cutoff frequency at rest in Hz; lower = smoother. Default 2. */
  minCutoff: number;
  /** Speed coefficient; higher = less lag on fast movement. Default 40 (coordinates in 0..1). */
  beta: number;
  /** Cutoff for the derivative in Hz. Default 1. */
  dCutoff: number;
}

/**
 * Tuned on real dance videos (Etappe 8g-3, `bun run tune-video`): lowest hold-out error over a
 * BTS dance practice and a TikTok dance. The former 1 / 10 cut off fast moves (worse than no
 * smoothing on the TikTok dance); see docs/choreography-format.md#video-import.
 */
export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 2, beta: 40, dCutoff: 1 };

/**
 * Where the video import puts the moves: "grid" every `beatsPerMove` beats, "holds" on the beat
 * with the stillest pose within each window of `beatsPerMove` beats (Etappe 8g-4c).
 */
export const MOVE_PLACEMENTS = ["grid", "holds"] as const;
export type MovePlacement = (typeof MOVE_PLACEMENTS)[number];
/**
 * Default since Etappe 8g-3: same hold-out error as "grid", but calmer target poses at the move
 * times (lower moveMotionDegPerS) and on the BTS video more usable moves.
 */
export const DEFAULT_MOVE_PLACEMENT: MovePlacement = "holds";

/**
 * Minimum distance between two moves: a playability limit that keeps the order strict and allows
 * one-beat spacing up to 200 BPM. Overlapping judging windows (±MOVE_WINDOW_MS) are fine, as the
 * scorer tracks the best deviation per move. Shared by the editor and the hold-point placement.
 */
export const MIN_MOVE_GAP_MS = 300;

export interface VideoChoreoOptions {
  title: string;
  bpm: number;
  /** Time of any beat in the output timeline (after trimming). Default 0. */
  beatOffsetMs?: number;
  /** Video section to use; it is shifted so that startMs becomes 0. Default: whole track. */
  range?: { startMs: number; endMs: number };
  /**
   * Relabel left/right so the player mirrors the dancer (dancer facing the camera in an
   * unmirrored video). false for recordings that are already mirrored (selfie). Default true.
   */
  mirror?: boolean;
  /** Beats between two scored moves. Default 2. */
  beatsPerMove?: number;
  /**
   * Default DEFAULT_MOVE_PLACEMENT ("holds"). "grid": a move every `beatsPerMove` beats. "holds": windows of k beats, k =
   * `beatsPerMove` rounded to a whole number (at least 1); each window starts on a grid point
   * offset + n · k beats inside [0, duration], so there are as many windows as grid points with
   * step k beats. Per window the beat with the least pose motion, at least max(MIN_MOVE_GAP_MS,
   * one beat) after the previous move; without a measurable beat the window's grid point if
   * usable. At most one move per window, about as many as the grid.
   */
  movePlacement?: MovePlacement;
  /** Target spacing of stored frames. Default 100. */
  frameIntervalMs?: number;
  /** [accent, secondary]. Default: first song palette. */
  colors?: [string, string];
  filter?: Partial<OneEuroParams>;
  /** A gap longer than this resets a landmark's filter. Default 250. */
  maxGapMs?: number;
  /** Timestamp for createdAt/updatedAt. Default Date.now(). */
  now?: number;
}

/** Arm/leg angles a frame needs at a move time so the move can be scored meaningfully. */
const MIN_LIMB_ANGLES = 4;
const TORSO = [11, 12, 23, 24];

/** One-Euro filter (Casiez et al. 2012) for a single scalar signal; time in ms. */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(private readonly p: OneEuroParams = DEFAULT_ONE_EURO) {}

  reset() {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, timeMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = timeMs;
      return value;
    }
    if (timeMs <= this.t) return this.x;
    const dt = (timeMs - this.t) / 1000;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.p.dCutoff) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff) * (value - this.x);
    this.t = timeMs;
    return this.x;
  }
}

/**
 * Converts per-axis normalized landmarks of a `aspect` (width / height) image into the square
 * choreography space: the longer image side maps to 0..1, the shorter one is centered.
 * s = max(aspect, 1); x' = 0.5 + (x - 0.5) * aspect / s; y' = 0.5 + (y - 0.5) / s.
 * Angles are unchanged: computeAngles(toSquare(lm, a)) equals computeAngles(lm, { aspect: a }).
 */
export function toSquareSpace(lm: Landmark[], aspect: number): Landmark[] {
  const s = Math.max(aspect, 1);
  return lm.map((p) => {
    const x = 0.5 + ((p[0] - 0.5) * aspect) / s;
    const y = 0.5 + (p[1] - 0.5) / s;
    return p.length > 2 ? ([x, y, p[2] as number] as Landmark) : ([x, y] as Landmark);
  });
}

type Sample = PoseTrack["samples"][number];

/** A point whose first `dims` entries are coordinates, optionally followed by its visibility. */
type Point = readonly number[];

/** Same rule as `isVisible`: visibility (entry `dims`, default 1) of at least 0.5. */
const visibleAt = (pt: Point, dims: number) => (pt.length > dims ? pt[dims]! : 1) >= 0.5;

/** `pt` with its first coordinates replaced by `coords`; visibility and the rest stay. */
const withCoords = <P extends Point>(pt: P, coords: number[]): P =>
  [...coords, ...pt.slice(coords.length)] as unknown as P;

/**
 * Causal One-Euro filtering of one point list (2D landmarks or world landmarks) over time:
 * one filter per point and coordinate. A missing list resets all filters; invisible points are
 * passed through and reset their filter; gaps longer than maxGapMs restart it as well.
 */
function pointFilter(dims: number, p: OneEuroParams, maxGapMs: number) {
  const filters = new Map<number, { f: OneEuroFilter[]; last: number }>();
  return <P extends Point>(points: readonly P[] | null | undefined, timeMs: number): P[] | null => {
    if (!points) {
      filters.clear();
      return null;
    }
    // Points absent from this sample are a gap as well.
    for (const i of filters.keys()) if (i >= points.length) filters.delete(i);
    return points.map((pt, i) => {
      if (!visibleAt(pt, dims)) {
        filters.delete(i);
        return pt;
      }
      let f = filters.get(i);
      if (!f || timeMs - f.last > maxGapMs) {
        f = { f: Array.from({ length: dims }, () => new OneEuroFilter(p)), last: timeMs };
        filters.set(i, f);
      }
      f.last = timeMs;
      return withCoords(
        pt,
        f.f.map((fd, d) => fd.filter(pt[d]!, timeMs)),
      );
    });
  };
}

/** Mean of a forward and a backward pass; invisible points and points without partner stay. */
function averagePasses<P extends Point>(
  fwd: P[] | null,
  bwd: readonly P[] | null | undefined,
  dims: number,
): P[] | null {
  if (!fwd || !bwd) return fwd;
  return fwd.map((pt, i) => {
    const q = bwd[i];
    if (!q || !visibleAt(pt, dims)) return pt;
    return withCoords(
      pt,
      Array.from({ length: dims }, (_, d) => (pt[d]! + q[d]!) / 2),
    );
  });
}

/** One causal One-Euro pass over 2D landmarks and world landmarks; time must increase. */
function onePass(samples: Sample[], p: OneEuroParams, maxGapMs: number): Sample[] {
  const flat = pointFilter(2, p, maxGapMs);
  const world = pointFilter(3, p, maxGapMs);
  return samples.map((s) => {
    const landmarks = flat(s.landmarks, s.timeMs);
    // A sample without world landmarks is a gap for the world filters.
    const w = world(s.world, s.timeMs);
    return s.world === undefined
      ? { timeMs: s.timeMs, landmarks }
      : { timeMs: s.timeMs, landmarks, world: w };
  });
}

/**
 * Smooths every landmark coordinate with a One-Euro filter, run forward and backward and
 * averaged: the analysis is offline, and the zero-phase result has no lag that would shift the
 * reference poses off the beat. Points with visibility < 0.5 never feed a filter: they are
 * passed through unchanged (still marked not visible), and the filter of that landmark restarts
 * on its next visible sample, as it does after null samples and gaps longer than maxGapMs.
 * World landmarks (x, y, z) are smoothed the same way with the same parameters; samples without
 * `world` stay without.
 */
export function smoothTrack(
  samples: Sample[],
  params: Partial<OneEuroParams> = {},
  maxGapMs = 250,
): Sample[] {
  const p = { ...DEFAULT_ONE_EURO, ...params };
  const fwd = onePass(samples, p, maxGapMs);
  const reversed = samples.map((s) => ({ ...s, timeMs: -s.timeMs })).reverse();
  const bwd = onePass(reversed, p, maxGapMs).reverse();
  return fwd.map((s, k) => {
    const back = bwd[k];
    const landmarks = averagePasses(s.landmarks, back?.landmarks, 2);
    if (s.world === undefined) return { timeMs: s.timeMs, landmarks };
    return { timeMs: s.timeMs, landmarks, world: averagePasses(s.world, back?.world, 3) };
  });
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f + 0;
};

/**
 * Visibility is rounded down so a point below the 0.5 threshold never becomes visible in the
 * stored data. From 0.99 on it is dropped: `[x, y]` means fully visible and keeps files small.
 */
function roundLandmark(p: Landmark): Landmark {
  const x = round(p[0], 4),
    y = round(p[1], 4);
  if (p.length < 3) return [x, y];
  const v = Math.floor((p[2] as number) * 100) / 100;
  return v >= 0.99 ? [x, y] : [x, y, v];
}

function roundFrame(timeMs: number, lm: Landmark[], angles: Angles): Frame {
  const landmarks = lm.map(roundLandmark);
  const a: Angles = {};
  for (const [k, v] of Object.entries(angles) as [keyof Angles, number][]) a[k] = round(v, 1);
  const frame: Frame = { timeMs: round(timeMs, 1), landmarks, angles: a };
  if (!TORSO.every((i) => isVisible(lm[i]))) frame.lowVisibility = true;
  return frame;
}

const limbAngleCount = (a: Angles) => [...ARM_KEYS, ...LEG_KEYS].filter((k) => a[k] != null).length;

/** Whether a frame is a reliable reference pose: torso visible and enough limb angles. */
export const isUsablePose = (f: Frame) =>
  !f.lowVisibility && limbAngleCount(f.angles) >= MIN_LIMB_ANGLES;

/**
 * Whether the target pose at `t` is reliable, with the same lookup the scorer uses (`frameAt`):
 * the interpolated angles need enough limb angles, and no frame it is interpolated from may be
 * marked `lowVisibility` (the interpolated frame drops that flag).
 */
export function poseUsableAt(frames: Frame[], t: number): boolean {
  const f = frameAt(frames, t);
  if (!f) return false;
  // The frames `frameAt` interpolates between, or the edge frame it returns.
  const i = frames.findIndex((x) => x.timeMs > t);
  const used =
    i < 0 ? [frames[frames.length - 1]] : i === 0 ? [frames[0]] : [frames[i - 1], frames[i]];
  if (used.some((x) => x?.lowVisibility)) return false;
  return limbAngleCount(f.angles) >= MIN_LIMB_ANGLES;
}

/**
 * Suggests gold moves: the moves with the largest change of target angles against the previous
 * move (sum of |angleDiff|), spread over the song by a minimum index spacing. Returns copies of
 * all moves with `gold` set (existing flags are replaced).
 */
export function suggestGoldMoves(moves: Move[], frames: Frame[]): Move[] {
  const n = moves.length;
  const count = Math.min(n, Math.max(2, Math.min(4, Math.round(n / 8))));
  const angles = moves.map((m) => frameAt(frames, m.timeMs)?.angles ?? {});
  const score = angles.map((a, i) => {
    const prev = angles[i - 1];
    if (!prev) return 0;
    let s = 0;
    for (const [k, v] of Object.entries(a) as [keyof Angles, number][]) {
      const pv = prev[k];
      if (pv != null) s += Math.abs(angleDiff(v, pv));
    }
    return s;
  });
  const order = score.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s || a.i - b.i);
  const spacing = Math.max(1, Math.floor(n / (2 * count)));
  const picked: number[] = [];
  for (const { i } of order) {
    if (picked.length >= count) break;
    if (picked.every((j) => Math.abs(i - j) >= spacing)) picked.push(i);
  }
  // Spacing could not be met everywhere: fill up with the next best moves.
  for (const { i } of order) {
    if (picked.length >= count) break;
    if (!picked.includes(i)) picked.push(i);
  }
  return moves.map((m, i) => ({ ...m, gold: picked.includes(i) }));
}

/** Grid points offset + n · step in [0, durationMs]: the candidate move times. */
function beatSlots(offset: number, step: number, durationMs: number): number[] {
  const out: number[] = [];
  for (let n = Math.ceil(-offset / step); offset + n * step <= durationMs; n++) {
    out.push(offset + n * step);
  }
  return out;
}

/**
 * Pose motion around `t` in degrees per second: mean |angle change| of the arm and leg angles
 * between `frameAt(t - w)` and `frameAt(t + w)`, divided by 2w. Only angles present on both sides
 * count; null if fewer than MIN_LIMB_ANGLES do, or if t ± w leaves the frames (`frameAt` would
 * clamp and the change would cover less than 2w). Low values mean a held, readable pose.
 */
export function poseMotionAt(frames: Frame[], t: number, w: number): number | null {
  const first = frames[0],
    last = frames[frames.length - 1];
  if (!first || !last || t - w < first.timeMs || t + w > last.timeMs) return null;
  const a = frameAt(frames, t - w);
  const b = frameAt(frames, t + w);
  if (!a || !b || !(w > 0)) return null;
  let sum = 0,
    n = 0;
  for (const k of [...ARM_KEYS, ...LEG_KEYS]) {
    const x = a.angles[k],
      y = b.angles[k];
    if (x == null || y == null) continue;
    sum += Math.abs(angleDiff(y, x));
    n++;
  }
  return n >= MIN_LIMB_ANGLES ? sum / n / ((2 * w) / 1000) : null;
}

/**
 * Hold-point placement (see VideoChoreoOptions.movePlacement): beats are grouped into windows of
 * `beatsPerWindow` beats; window n starts at grid point offset + n · beatsPerWindow beats, and
 * only windows starting inside [0, durationMs] count (the same points as beatSlots with that
 * step). Per window the usable beat with the least motion wins (ties: the earlier one), skipping
 * beats closer than max(MIN_MOVE_GAP_MS, one beat) to the previous move. If no beat of a window is
 * measurable (e.g. at the track edges), its grid point is taken when usable and spaced.
 */
function holdTimes(
  frames: Frame[],
  offset: number,
  beatMs: number,
  beatsPerWindow: number,
  durationMs: number,
  usable: (t: number) => boolean,
): number[] {
  const w = beatMs / 4;
  const minGap = Math.max(MIN_MOVE_GAP_MS, beatMs);
  const out: number[] = [];
  let window: number | null = null;
  let best: { t: number; motion: number } | null = null;
  let fallback: number | null = null;
  const flush = () => {
    const t = best ? best.t : fallback;
    if (t !== null) out.push(t);
    best = null;
    fallback = null;
  };
  // First window whose grid point lies at or after 0; m is the global beat index.
  const firstWindow = Math.ceil(-offset / (beatMs * beatsPerWindow));
  const firstBeat = Math.max(firstWindow * beatsPerWindow, Math.ceil(-offset / beatMs));
  for (let m = firstBeat; offset + m * beatMs <= durationMs; m++) {
    const t = offset + m * beatMs;
    const win = Math.floor(m / beatsPerWindow);
    if (win !== window) {
      flush();
      window = win;
    }
    const prev = out[out.length - 1];
    // Small tolerance: beats exactly one beat apart must not fail on rounding.
    if (prev !== undefined && t - prev < minGap - 1e-6) continue;
    if (!usable(t)) continue;
    if (m === win * beatsPerWindow) fallback = t;
    const motion = poseMotionAt(frames, t, w);
    if (motion === null) continue;
    if (!best || motion < best.motion) best = { t, motion };
  }
  flush();
  return out;
}

/** Builds a choreography from a raw video pose track. Throws (German message) if unusable. */
export function choreoFromPoseTrack(track: PoseTrack, opts: VideoChoreoOptions): Choreography {
  const interval = opts.frameIntervalMs ?? 100;
  const beatsPerMove = opts.beatsPerMove ?? 2;
  const offset = opts.beatOffsetMs ?? 0;
  const start = opts.range?.startMs ?? 0;
  const end = opts.range?.endMs ?? Infinity;
  const [accent, secondary] = opts.colors ?? [SONG_PALETTES[0].accent, SONG_PALETTES[0].secondary];
  if (!(interval > 0 && opts.bpm > 0 && beatsPerMove > 0) || !Number.isFinite(offset)) {
    throw new Error("Ungültige Einstellungen für den Video-Import.");
  }

  // 1. Trim and shift.
  const trimmed = track.samples
    .filter((s) => s.timeMs >= start && s.timeMs <= end)
    // `world` is dropped on purpose: the choreography uses 2D only until Etappe 13d.
    .map((s) => ({ timeMs: s.timeMs - start, landmarks: s.landmarks }));
  const last = trimmed[trimmed.length - 1];
  const durationMs = Number.isFinite(end) ? end - start : (last?.timeMs ?? 0);

  // 2. Smooth, 5. downsample: per slot the nearest sample with a detected person.
  const smoothed = smoothTrack(trimmed, opts.filter, opts.maxGapMs).filter(
    (s): s is { timeMs: number; landmarks: Landmark[] } => s.landmarks !== null,
  );
  const frames: Frame[] = [];
  let j = 0;
  let lastIdx = -1;
  for (let slot = 0; slot <= durationMs; slot += interval) {
    while (j + 1 < smoothed.length && smoothed[j + 1]!.timeMs <= slot) j++;
    let best = -1;
    for (const k of [j, j + 1]) {
      const s = smoothed[k];
      if (!s || Math.abs(s.timeMs - slot) > interval / 2) continue;
      if (best < 0 || Math.abs(s.timeMs - slot) < Math.abs(smoothed[best]!.timeMs - slot)) best = k;
    }
    if (best < 0 || best === lastIdx) continue;
    lastIdx = best;
    const s = smoothed[best]!;
    // 3. Angles from the source landmarks with the source aspect; landmarks stored square.
    const angles = computeAngles(s.landmarks, { aspect: track.aspect });
    frames.push(roundFrame(s.timeMs, toSquareSpace(s.landmarks, track.aspect), angles));
  }
  if (frames.length < 2) throw new Error("Im Video wurde zu selten eine Person erkannt.");

  // 6. Moves on the beat grid where the reference pose is reliable.
  const step = (60000 / opts.bpm) * beatsPerMove;
  const nearest = (t: number) => {
    const f = frames.reduce((a, b) => (Math.abs(b.timeMs - t) < Math.abs(a.timeMs - t) ? b : a));
    return Math.abs(f.timeMs - t) <= interval ? f : null;
  };
  const usable = (t: number) => {
    const f = nearest(t);
    return f !== null && isUsablePose(f);
  };
  const beatMs = 60000 / opts.bpm;
  const times =
    (opts.movePlacement ?? DEFAULT_MOVE_PLACEMENT) === "holds"
      ? holdTimes(frames, offset, beatMs, Math.max(1, Math.round(beatsPerMove)), durationMs, usable)
      : beatSlots(offset, step, durationMs).filter(usable);
  const moves: Move[] = times.map((t) => ({
    timeMs: t,
    label: "Move",
    iconId: "video",
    gold: false,
  }));
  if (moves.length < 2) throw new Error("Zu wenige auswertbare Moves im gewählten Abschnitt.");

  // Beat phase goes into choreo.offsetMs (play time = audio − offsetMs): beat pulse and sync
  // test expect moves on k · beat. Times shift back by the phase, the audio alignment stays.
  const phase = round(((offset % beatMs) + beatMs) % beatMs, 1);
  const shifted = frames
    .map((f) => ({ ...f, timeMs: round(f.timeMs - phase, 1) }))
    .filter((f) => f.timeMs >= 0);
  const shiftedMoves = moves.map((m) => ({ ...m, timeMs: Math.max(0, m.timeMs - phase) }));

  const now = opts.now ?? Date.now();
  const choreo: Choreography = {
    version: CHOREO_VERSION,
    id: crypto.randomUUID(),
    title: opts.title,
    bpm: opts.bpm,
    offsetMs: phase,
    accentColor: accent,
    secondaryColor: secondary,
    frames: shifted,
    // 7. Gold moves (mirroring does not change angle distances).
    moves: suggestGoldMoves(shiftedMoves, shifted),
    createdAt: now,
    updatedAt: now,
  };
  // 4. Stored choreos live in mirror space.
  return ChoreographySchema.parse(opts.mirror === false ? choreo : mirrorChoreo(choreo));
}

/** Quality figures of a video import, for tuning on real videos (dev diagnostics, script). */
export interface TrackMetrics {
  /** Samples in the range. */
  samples: number;
  /** Samples with a detected person / samples (0..1). */
  detectionRatio: number;
  /**
   * Mean |second difference| of the joint angles over consecutive samples, in degrees per
   * sample. Real movement is smooth and contributes little; detection noise dominates. Raw
   * and after `smoothTrack` with the given filter. null without three usable samples in a row.
   */
  jitterRawDeg: number | null;
  jitterSmoothDeg: number | null;
  /**
   * Hold-out error in degrees: every second sample is left out, the rest is smoothed, and the
   * left-out raw angles are predicted by interpolating their neighbours. The raw noise adds about
   * the same to every filter setting, so the setting closest to the true movement scores lowest;
   * too little smoothing keeps the noise, too much cuts off real movement. Needs no ground truth.
   * null without a predictable sample.
   */
  holdoutDeg: number | null;
  /** Grid points where a move could sit. */
  moveSlots: number;
  /** Moves the choreography got (0 if the build failed). */
  moves: number;
  /** moves / moveSlots (0..1). */
  usableMoveRatio: number;
  /**
   * Mean pose motion at the moves in degrees per second (`poseMotionAt` with a quarter beat on
   * each side, on the built choreography). Lower = moves sit on clearer, held poses. null if the
   * build failed or no move was measurable.
   */
  moveMotionDegPerS: number | null;
  /** German message if `choreoFromPoseTrack` refused the track, else null. */
  error: string | null;
}

const JITTER_KEYS = [...ARM_KEYS, ...LEG_KEYS, "torsoLean"] as const;

/** See TrackMetrics.jitterRawDeg; triples with a gap over maxGapMs or a null sample are skipped. */
function angleJitter(samples: Sample[], aspect: number, maxGapMs: number): number | null {
  let sum = 0,
    n = 0;
  let prev: { timeMs: number; angles: Angles }[] = [];
  for (const s of samples) {
    if (!s.landmarks) {
      prev = [];
      continue;
    }
    const cur = { timeMs: s.timeMs, angles: computeAngles(s.landmarks, { aspect }) };
    const last = prev[prev.length - 1];
    if (last && cur.timeMs - last.timeMs > maxGapMs) prev = [];
    const [a, b] = prev.length >= 2 ? prev.slice(-2) : [];
    if (a && b) {
      for (const k of JITTER_KEYS) {
        const x = a.angles[k],
          y = b.angles[k],
          z = cur.angles[k];
        if (x == null || y == null || z == null) continue;
        sum += Math.abs(angleDiff(z, y) - angleDiff(y, x));
        n++;
      }
    }
    prev.push(cur);
    if (prev.length > 2) prev.shift();
  }
  return n ? sum / n : null;
}

/** See TrackMetrics.holdoutDeg. */
function holdoutError(
  samples: Sample[],
  aspect: number,
  filter: Partial<OneEuroParams> | undefined,
  maxGapMs: number,
): number | null {
  const kept = samples.filter((_, i) => i % 2 === 0);
  // Twice the sample spacing: the gap limit must not split the thinned track.
  const smoothed = smoothTrack(kept, filter, maxGapMs * 2);
  let sum = 0,
    n = 0;
  for (let i = 1; i < samples.length - 1; i += 2) {
    const s = samples[i]!;
    const prev = smoothed[(i - 1) / 2],
      next = smoothed[(i + 1) / 2];
    if (!s.landmarks || !prev?.landmarks || !next?.landmarks) continue;
    if (next.timeMs - prev.timeMs > maxGapMs * 2) continue;
    const u = (s.timeMs - prev.timeMs) / (next.timeMs - prev.timeMs);
    const a = computeAngles(prev.landmarks, { aspect });
    const b = computeAngles(next.landmarks, { aspect });
    const raw = computeAngles(s.landmarks, { aspect });
    for (const k of JITTER_KEYS) {
      const x = a[k],
        y = b[k],
        r = raw[k];
      if (x == null || y == null || r == null) continue;
      sum += Math.abs(angleDiff(lerpAngle(x, y, u), r));
      n++;
    }
  }
  return n ? sum / n : null;
}

/**
 * Measures a video import with the same options `choreoFromPoseTrack` gets: detection rate,
 * angle jitter before and after smoothing, the share of grid points that got a move and the pose
 * motion at the moves.
 */
export function trackMetrics(track: PoseTrack, opts: VideoChoreoOptions): TrackMetrics {
  const start = opts.range?.startMs ?? 0;
  const end = opts.range?.endMs ?? Infinity;
  const maxGapMs = opts.maxGapMs ?? 250;
  const trimmed = track.samples
    .filter((s) => s.timeMs >= start && s.timeMs <= end)
    // `world` is dropped on purpose: the choreography uses 2D only until Etappe 13d.
    .map((s) => ({ timeMs: s.timeMs - start, landmarks: s.landmarks }));
  const detected = trimmed.filter((s) => s.landmarks !== null).length;
  const durationMs = Number.isFinite(end)
    ? end - start
    : (trimmed[trimmed.length - 1]?.timeMs ?? 0);
  const step = (60000 / opts.bpm) * (opts.beatsPerMove ?? 2);
  const moveSlots =
    step > 0 && Number.isFinite(step)
      ? beatSlots(opts.beatOffsetMs ?? 0, step, durationMs).length
      : 0;

  let moves = 0;
  let moveMotionDegPerS: number | null = null;
  let error: string | null = null;
  try {
    const choreo = choreoFromPoseTrack(track, opts);
    moves = choreo.moves.length;
    const w = 60000 / choreo.bpm / 4;
    const motions = choreo.moves
      .map((m) => poseMotionAt(choreo.frames, m.timeMs, w))
      .filter((v): v is number => v !== null);
    if (motions.length) moveMotionDegPerS = motions.reduce((a, b) => a + b, 0) / motions.length;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return {
    samples: trimmed.length,
    detectionRatio: trimmed.length ? detected / trimmed.length : 0,
    jitterRawDeg: angleJitter(trimmed, track.aspect, maxGapMs),
    jitterSmoothDeg: angleJitter(
      smoothTrack(trimmed, opts.filter, maxGapMs),
      track.aspect,
      maxGapMs,
    ),
    holdoutDeg: holdoutError(trimmed, track.aspect, opts.filter, maxGapMs),
    moveSlots,
    moves,
    usableMoveRatio: moveSlots ? moves / moveSlots : 0,
    moveMotionDegPerS,
    error,
  };
}
