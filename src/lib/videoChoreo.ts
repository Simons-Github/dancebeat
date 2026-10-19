import { mirrorChoreo } from "./choreo";
import { angleDiff, ARM_KEYS, computeAngles, frameAt, isVisible, LEG_KEYS } from "./pose";
import { CHOREO_VERSION, ChoreographySchema } from "./schema";
import type { Angles, Choreography, Frame, Landmark, Move } from "./types";
import { SONG_PALETTES } from "@/theme";

/** Raw pose track from a video analysis (MediaPipe output, per-axis normalized landmarks). */
export interface PoseTrack {
  /** Source video width / height. Landmarks are normalized per axis (MediaPipe). */
  aspect: number;
  /** Sorted by timeMs (video time). landmarks null = no person detected. */
  samples: { timeMs: number; landmarks: Landmark[] | null }[];
}

export interface OneEuroParams {
  /** Cutoff frequency at rest in Hz; lower = smoother. Default 1. */
  minCutoff: number;
  /** Speed coefficient; higher = less lag on fast movement. Default 10 (coordinates in 0..1). */
  beta: number;
  /** Cutoff for the derivative in Hz. Default 1. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1, beta: 10, dCutoff: 1 };

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

/** One causal One-Euro pass; time must increase. */
function onePass(samples: Sample[], p: OneEuroParams, maxGapMs: number): Sample[] {
  const filters = new Map<number, { fx: OneEuroFilter; fy: OneEuroFilter; last: number }>();
  return samples.map(({ timeMs, landmarks }) => {
    if (!landmarks) {
      filters.clear();
      return { timeMs, landmarks: null };
    }
    // Landmarks absent from this sample are a gap as well.
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

/**
 * Smooths every landmark coordinate with a One-Euro filter, run forward and backward and
 * averaged: the analysis is offline, and the zero-phase result has no lag that would shift the
 * reference poses off the beat. Points with visibility < 0.5 never feed a filter: they are
 * passed through unchanged (still marked not visible), and the filter of that landmark restarts
 * on its next visible sample, as it does after null samples and gaps longer than maxGapMs.
 */
export function smoothTrack(
  samples: Sample[],
  params: Partial<OneEuroParams> = {},
  maxGapMs = 250,
): Sample[] {
  const p = { ...DEFAULT_ONE_EURO, ...params };
  const fwd = onePass(samples, p, maxGapMs);
  const reversed = samples.map((s) => ({ timeMs: -s.timeMs, landmarks: s.landmarks })).reverse();
  const bwd = onePass(reversed, p, maxGapMs).reverse();
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
  const moves: Move[] = [];
  for (let n = Math.ceil(-offset / step); offset + n * step <= durationMs; n++) {
    const t = offset + n * step;
    const f = nearest(t);
    if (!f || f.lowVisibility || limbAngleCount(f.angles) < MIN_LIMB_ANGLES) continue;
    moves.push({ timeMs: t, label: "Move", iconId: "video", gold: false });
  }
  if (moves.length < 2) throw new Error("Zu wenige auswertbare Moves im gewählten Abschnitt.");

  // Beat phase goes into choreo.offsetMs (play time = audio − offsetMs): beat pulse and sync
  // test expect moves on k · beat. Times shift back by the phase, the audio alignment stays.
  const beatMs = 60000 / opts.bpm;
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
