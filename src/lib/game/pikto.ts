import { BONES, frameAt, isVisible } from "../pose";
import type { Choreography, Landmark, Move } from "../types";

/** Pictogram bar timing and geometry (fractions of the bar width). */
export const PIKTO = {
  /** How far ahead a move appears at the right edge. */
  previewMs: 4000,
  /** Position of the target marker. */
  markerX: 0.14,
  /** Fade-in at the right edge. */
  fadeInMs: 300,
  /** White flash at the marker. */
  flashMs: 150,
  /** Fade-out after the move time. */
  fadeOutMs: 500,
  /** Flashes closer than this are skipped: never more than 3 flashes per second. */
  minFlashGapMs: 334,
  /** Inset of the body inside the figure's unit box: room for capsule widths, head disc and rim. */
  pad: 0.07,
  /**
   * Shortest path (in figure heights) that gets an arrow. 0.15 is roughly an arm's length third:
   * smaller paths are hand jitter between two similar poses and would only clutter the figure.
   */
  arrowMinDist: 0.15,
  /** At most this many arrows per figure (the longest paths), to stay readable at 2 to 3 m. */
  maxArrows: 2,
  /** Arrow ends are pulled in by this much (figure heights) so they do not cover hand or foot. */
  arrowTrim: 0.04,
  /** Curve bulge as a fraction of the arrow length, away from the torso. */
  arrowBend: 0.25,
} as const;

export interface PiktoItem {
  index: number;
  /** Center x as a fraction of the bar width (marker = PIKTO.markerX, right edge = 1). */
  x: number;
  /** 0..1 */
  alpha: number;
  /** White flash intensity 0..1 (0 when reduced motion or too close to the previous flash). */
  flash: number;
  gold: boolean;
  /** The move time has passed; the pictogram sits on the marker and fades. */
  past: boolean;
}

/** Which moves may flash: greedy, at least `minGap` after the last flash. */
export function flashSchedule(moves: readonly Move[], minGap: number = PIKTO.minFlashGapMs) {
  let last = -Infinity;
  return moves.map((m) => {
    if (m.timeMs - last < minGap) return false;
    last = m.timeMs;
    return true;
  });
}

/**
 * Visible pictograms at game time `t`. A move travels linearly from the right edge to the marker
 * during the `previewMs` before its time, flashes there and fades out.
 */
export function piktoLayout(
  moves: readonly Move[],
  t: number,
  opts: { flashes?: readonly boolean[]; reducedMotion?: boolean } = {},
): PiktoItem[] {
  const { previewMs, markerX, fadeInMs, flashMs, fadeOutMs } = PIKTO;
  const out: PiktoItem[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!m) continue;
    const dt = m.timeMs - t;
    if (dt > previewMs) break; // moves are sorted
    if (dt < -fadeOutMs) continue;
    if (dt >= 0) {
      out.push({
        index: i,
        x: markerX + (1 - markerX) * (dt / previewMs),
        alpha: Math.min(1, (previewMs - dt) / fadeInMs),
        flash: 0,
        gold: m.gold,
        past: false,
      });
    } else {
      const since = -dt;
      const canFlash = !opts.reducedMotion && (opts.flashes?.[i] ?? true);
      out.push({
        index: i,
        x: markerX,
        alpha: Math.max(0, 1 - since / fadeOutMs),
        flash: canFlash && since < flashMs ? 1 - since / flashMs : 0,
        gold: m.gold,
        past: true,
      });
    }
  }
  return out;
}

/** A curved movement arrow in figure unit space (quadratic curve, already shortened at both ends). */
export interface MoveArrow {
  x0: number;
  y0: number;
  /** Control point. */
  cx: number;
  cy: number;
  x1: number;
  y1: number;
}

/**
 * A pictogram figure in its own unit space: the pose's landmarks scaled to height 1 (head
 * included), centered at x = 0, top at y = 0. Landmarks keep their visibility, so the drawer skips
 * unsure ones. The body is inset by `PIKTO.pad` on every side to leave room for the silhouette's
 * widths, so a drawn figure stays within the unit box.
 */
export interface MoveFigure {
  landmarks: Landmark[];
  /** Strongest movements since the previous move (at most `PIKTO.maxArrows`, longest first). */
  arrows: MoveArrow[];
  /** Width / height of the unit box. */
  aspect: number;
}

const BODY_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of the visible body points of one or more poses. */
export function bodyBox(poses: readonly Landmark[][]): Box | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const lm of poses)
    for (const i of BODY_POINTS) {
      const p = lm[i];
      if (!p || !isVisible(p)) continue;
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  if (!Number.isFinite(minX) || maxY - minY <= 0) return null;
  return { minX, minY, maxX, maxY };
}

const HEAD_R = 0.07;

/** Landmark indices whose path between two moves may become an arrow (hip midpoint is extra). */
const TRACKED = [15, 16, 27, 28];

type Pt = readonly [number, number];

/** Maps a landmark-space point into figure unit space. */
type ToUnit = (x: number, y: number) => Pt;

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Point of a pose in unit space, or null when the landmark is missing or unsure. */
function unitPoint(lm: readonly Landmark[], i: number, to: ToUnit): Pt | null {
  const p = lm[i];
  return p && isVisible(p) ? to(p[0], p[1]) : null;
}

/** Hip midpoint (both hips visible) of a pose in unit space. */
function hipMid(lm: readonly Landmark[], to: ToUnit): Pt | null {
  const a = unitPoint(lm, 23, to),
    b = unitPoint(lm, 24, to);
  return a && b ? mid(a, b) : null;
}

/** Torso center in unit space: middle of shoulder and hip midpoints, whichever exist. */
function torsoCenter(lm: readonly Landmark[], to: ToUnit): Pt | null {
  const a = unitPoint(lm, 11, to),
    b = unitPoint(lm, 12, to);
  const sh = a && b ? mid(a, b) : null;
  const hip = hipMid(lm, to);
  if (sh && hip) return mid(sh, hip);
  return sh ?? hip;
}

/**
 * Movement arrows between two poses, already in the current figure's unit space (`to` maps
 * landmark space into it). Tracked: both hands, both ankles and the hip midpoint. A path shorter
 * than `PIKTO.arrowMinDist` is dropped, the longest `PIKTO.maxArrows` remain (longest first). A
 * point that is unsure in either pose is skipped. Each arrow is a quadratic curve bending away
 * from the torso center (to a fixed side when it is unknown), trimmed by `PIKTO.arrowTrim` at both
 * ends so it does not cover the hand or foot.
 */
export function selectArrows(
  prev: readonly Landmark[],
  cur: readonly Landmark[],
  to: ToUnit,
): MoveArrow[] {
  const paths: { a: Pt; b: Pt; len: number }[] = [];
  const add = (a: Pt | null, b: Pt | null) => {
    if (!a || !b) return;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len >= PIKTO.arrowMinDist) paths.push({ a, b, len });
  };
  for (const i of TRACKED) add(unitPoint(prev, i, to), unitPoint(cur, i, to));
  add(hipMid(prev, to), hipMid(cur, to));
  paths.sort((p, q) => q.len - p.len);

  const center = torsoCenter(cur, to);
  return paths.slice(0, PIKTO.maxArrows).map(({ a, b, len }) => {
    const ux = (b[0] - a[0]) / len,
      uy = (b[1] - a[1]) / len;
    const t = PIKTO.arrowTrim;
    const x0 = a[0] + ux * t,
      y0 = a[1] + uy * t,
      x1 = b[0] - ux * t,
      y1 = b[1] - uy * t;
    const mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    let nx = -uy,
      ny = ux;
    if (center && nx * (mx - center[0]) + ny * (my - center[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const bend = (len - 2 * t) * PIKTO.arrowBend;
    return { x0, y0, cx: mx + nx * bend, cy: my + ny * bend, x1, y1 };
  });
}

/**
 * Turns landmarks into a figure that fits a unit-height box (head and the `PIKTO.pad` inset
 * included). `prev` (the previous move's pose) adds movement arrows.
 */
export function moveFigure(lm: Landmark[], prev?: Landmark[] | null): MoveFigure | null {
  const box = bodyBox([lm]);
  if (!box) return null;
  const head = lm[0];
  const top = Math.min(
    box.minY,
    head && isVisible(head) ? head[1] - HEAD_R * (box.maxY - box.minY) : box.minY,
  );
  const h = box.maxY - top;
  if (h <= 0) return null;
  const s = (1 - 2 * PIKTO.pad) / h;
  const cx = (box.minX + box.maxX) / 2;
  const to: ToUnit = (x, y) => [(x - cx) * s, (y - top) * s + PIKTO.pad];
  const landmarks = lm.map((p): Landmark => {
    const [x, y] = to(p[0], p[1]);
    return p.length > 2 ? [x, y, p[2] as number] : [x, y];
  });
  return {
    landmarks,
    arrows: prev ? selectArrows(prev, lm, to) : [],
    aspect: (box.maxX - box.minX) * s + 2 * PIKTO.pad,
  };
}

/** Pose of each move (interpolated once) and its figure. */
export function moveFigures(choreo: Pick<Choreography, "moves" | "frames">): (MoveFigure | null)[] {
  const poses = choreo.moves.map((m) => frameAt(choreo.frames, m.timeMs)?.landmarks ?? null);
  return poses.map((lm, i) => (lm ? moveFigure(lm, i > 0 ? poses[i - 1] : null) : null));
}

/**
 * Memoised `moveFigures`: a figure depends only on `frames`, its move's `timeMs` and the previous
 * move's `timeMs`, so an unchanged move keeps its figure object (e.g. after toggling gold) and
 * canvases keyed on it do not redraw. A new `frames` object drops everything; each call keeps only
 * the entries it used, so the cache does not grow.
 */
export function createMoveFigureCache() {
  let lastFrames: Choreography["frames"] | null = null;
  let entries = new Map<string, MoveFigure | null>();
  return {
    figures(choreo: Pick<Choreography, "moves" | "frames">): (MoveFigure | null)[] {
      if (choreo.frames !== lastFrames) {
        lastFrames = choreo.frames;
        entries = new Map();
      }
      const next = new Map<string, MoveFigure | null>();
      const pose = (timeMs: number) => frameAt(choreo.frames, timeMs)?.landmarks ?? null;
      const result = choreo.moves.map((m, i) => {
        const prevTime = choreo.moves[i - 1]?.timeMs ?? null;
        const key = `${prevTime ?? "-"}|${m.timeMs}`;
        if (!next.has(key)) {
          if (entries.has(key)) next.set(key, entries.get(key) ?? null);
          else {
            const lm = pose(m.timeMs);
            next.set(key, lm ? moveFigure(lm, prevTime !== null ? pose(prevTime) : null) : null);
          }
        }
        return next.get(key) ?? null;
      });
      entries = next;
      return result;
    },
  };
}

/**
 * Fixed square view for the coach, covering every pose of the choreography (plus a margin), so the
 * coach does not jump or zoom between frames. Returned in landmark space.
 */
export function coachView(frames: readonly { landmarks: Landmark[] }[]) {
  const box = bodyBox(frames.map((f) => f.landmarks)) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 1.25 || 1;
  const cx = (box.minX + box.maxX) / 2,
    cy = (box.minY + box.maxY) / 2;
  return { x: cx - size / 2, y: cy - size / 2, size };
}

/** Coach pose at game time `t`: interpolated from the choreography frames. */
export function coachPose(frames: Choreography["frames"], t: number): Landmark[] | null {
  return frameAt(frames, t)?.landmarks ?? null;
}
