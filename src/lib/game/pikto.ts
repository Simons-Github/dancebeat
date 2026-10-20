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

/** A stick figure in its own unit space: height 1, centered at x = 0, top at y = 0. */
export interface StickFigure {
  lines: [number, number, number, number][];
  head: { x: number; y: number; r: number } | null;
  /** Wrist movement since the previous move (arrows in the secondary color). */
  arrows: [number, number, number, number][];
  /** Width / height of the figure's bounding box. */
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

/**
 * Turns landmarks into a stick figure that fits a unit-height box (the head included). Invisible
 * landmarks are skipped. `prev` (the previous move's pose) adds wrist arrows when a hand moved far.
 */
export function stickFigure(lm: Landmark[], prev?: Landmark[] | null): StickFigure | null {
  const box = bodyBox([lm]);
  if (!box) return null;
  const head = lm[0];
  const top = Math.min(
    box.minY,
    head && isVisible(head) ? head[1] - HEAD_R * (box.maxY - box.minY) : box.minY,
  );
  const h = box.maxY - top;
  if (h <= 0) return null;
  const cx = (box.minX + box.maxX) / 2;
  const tx = (x: number) => (x - cx) / h;
  const ty = (y: number) => (y - top) / h;
  const lines: StickFigure["lines"] = [];
  for (const [a, b] of BONES) {
    const pa = lm[a],
      pb = lm[b];
    if (!pa || !pb || !isVisible(pa) || !isVisible(pb)) continue;
    lines.push([tx(pa[0]), ty(pa[1]), tx(pb[0]), ty(pb[1])]);
  }
  const arrows: StickFigure["arrows"] = [];
  if (prev) {
    for (const i of [15, 16]) {
      const p = prev[i],
        q = lm[i];
      if (!p || !q || !isVisible(p) || !isVisible(q)) continue;
      const x0 = tx(p[0]),
        y0 = ty(p[1]),
        x1 = tx(q[0]),
        y1 = ty(q[1]);
      if (Math.hypot(x1 - x0, y1 - y0) > 0.18) arrows.push([x0, y0, x1, y1]);
    }
  }
  return {
    lines,
    head: head && isVisible(head) ? { x: tx(head[0]), y: ty(head[1]), r: HEAD_R } : null,
    arrows,
    aspect: (box.maxX - box.minX) / h,
  };
}

/** Pose of each move (interpolated once) and its stick figure. */
export function moveFigures(
  choreo: Pick<Choreography, "moves" | "frames">,
): (StickFigure | null)[] {
  const poses = choreo.moves.map((m) => frameAt(choreo.frames, m.timeMs)?.landmarks ?? null);
  return poses.map((lm, i) => (lm ? stickFigure(lm, i > 0 ? poses[i - 1] : null) : null));
}

/**
 * Memoised `moveFigures`: a figure depends only on `frames`, its move's `timeMs` and the previous
 * move's `timeMs`, so an unchanged move keeps its figure object (e.g. after toggling gold) and
 * canvases keyed on it do not redraw. A new `frames` object drops everything; each call keeps only
 * the entries it used, so the cache does not grow.
 */
export function createMoveFigureCache() {
  let lastFrames: Choreography["frames"] | null = null;
  let entries = new Map<string, StickFigure | null>();
  return {
    figures(choreo: Pick<Choreography, "moves" | "frames">): (StickFigure | null)[] {
      if (choreo.frames !== lastFrames) {
        lastFrames = choreo.frames;
        entries = new Map();
      }
      const next = new Map<string, StickFigure | null>();
      const pose = (timeMs: number) => frameAt(choreo.frames, timeMs)?.landmarks ?? null;
      const result = choreo.moves.map((m, i) => {
        const prevTime = choreo.moves[i - 1]?.timeMs ?? null;
        const key = `${prevTime ?? "-"}|${m.timeMs}`;
        if (!next.has(key)) {
          if (entries.has(key)) next.set(key, entries.get(key) ?? null);
          else {
            const lm = pose(m.timeMs);
            next.set(key, lm ? stickFigure(lm, prevTime !== null ? pose(prevTime) : null) : null);
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
