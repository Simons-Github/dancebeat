import { COACH, GAME, GOLD, GOLD_DEEP, PIKTO_FIGURE } from "@/theme";

import { BONES, isVisible } from "../pose";
import type { Landmark } from "../types";
import { PIKTO, type MoveArrow, type MoveFigure, type PiktoItem } from "./pikto";

/** Keeps the canvas backing store at CSS size × devicePixelRatio. Returns the CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  const pw = Math.round(w * dpr),
    ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Pictogram look: gold moves in gold with a halo, others in the song colors. */
interface PiktoStyle {
  fill: string;
  rim: string;
  arrow: string;
  gold: boolean;
}

function piktoStyle(gold: boolean, colors: { accent: string; secondary: string }): PiktoStyle {
  return gold
    ? { fill: GOLD, rim: GOLD_DEEP, arrow: GOLD, gold }
    : { fill: colors.accent, rim: GAME.outline, arrow: colors.secondary, gold };
}

/** One curved arrow: dark outline pass, colored pass, filled head along the end tangent. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  a: MoveArrow,
  X: (v: number) => number,
  Y: (v: number) => number,
  height: number,
  color: string,
) {
  const A = PIKTO_FIGURE.arrow;
  const x1 = X(a.x1),
    y1 = Y(a.y1);
  let tx = x1 - X(a.cx),
    ty = y1 - Y(a.cy);
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const len = A.headLength * height,
    half = A.headHalfWidth * height;
  const bx = x1 - tx * len,
    by = y1 - ty * len;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(X(a.x0), Y(a.y0));
    ctx.quadraticCurveTo(X(a.cx), Y(a.cy), bx, by);
  };
  const head = () => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(bx - ty * half, by + tx * half);
    ctx.lineTo(bx + ty * half, by - tx * half);
    ctx.closePath();
  };
  const w = A.width * height,
    o = A.outline * height;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = GAME.outline;
  ctx.fillStyle = GAME.outline;
  ctx.lineWidth = w + o * 2;
  path();
  ctx.stroke();
  head();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = w;
  path();
  ctx.stroke();
  head();
  ctx.fill();
}

/**
 * Draws a pictogram with its unit-space origin at (cx, top), `height` px tall: optional gold halo,
 * dark rim, fill, then the movement arrows. No shadowBlur anywhere (cheap on every frame).
 */
function drawPikto(
  ctx: CanvasRenderingContext2D,
  fig: MoveFigure,
  cx: number,
  top: number,
  height: number,
  style: PiktoStyle,
) {
  const X = (v: number) => cx + v * height;
  const Y = (v: number) => top + v * height;
  const toPx = (p: Landmark) => [X(p[0]), Y(p[1])] as const;
  const unit = height * PIKTO_FIGURE.unit;
  if (style.gold) {
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * PIKTO_FIGURE.halo.alpha;
    drawFigure(ctx, fig.landmarks, {
      toPx,
      unit,
      fill: GOLD,
      grow: PIKTO_FIGURE.halo.grow * height,
    });
    ctx.globalAlpha = base;
  }
  drawFigure(ctx, fig.landmarks, {
    toPx,
    unit,
    fill: style.rim,
    grow: PIKTO_FIGURE.rim * unit * 2,
  });
  drawFigure(ctx, fig.landmarks, { toPx, unit, fill: style.fill, grow: 0 });
  for (const a of fig.arrows) drawArrow(ctx, a, X, Y, height, style.arrow);
}

/**
 * One static pictogram centered in its canvas (editor timeline). Drawn on demand, not per frame;
 * a missing figure clears the canvas.
 */
export function drawMoveFigure(
  canvas: HTMLCanvasElement,
  fig: MoveFigure | null,
  gold: boolean,
  colors: { accent: string; secondary: string },
) {
  const { ctx, w, h } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!fig) return;
  // Fit height and width (the figure is `aspect` times as wide as tall).
  const fh = Math.min(h * 0.9, (w * 0.9) / Math.max(fig.aspect, 0.01));
  drawPikto(ctx, fig, w / 2, (h - fh) / 2, fh, piktoStyle(gold, colors));
}

/** Pictograms on the bar canvas (the bar shape and marker are DOM; only figures move). */
export function drawPiktos(
  canvas: HTMLCanvasElement,
  items: readonly PiktoItem[],
  figures: readonly (MoveFigure | null)[],
  colors: { accent: string; secondary: string },
) {
  const { ctx, w, h } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  const fh = h * 0.9;
  const top = (h - fh) / 2;
  const markerPx = PIKTO.markerX * w;
  // Draw from right to left so the figure on the marker is on top.
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    const fig = it ? figures[it.index] : null;
    if (!it || !fig || it.alpha <= 0) continue;
    const cx =
      markerPx + ((it.x - PIKTO.markerX) / (1 - PIKTO.markerX)) * (w - markerPx - fh * 0.3);
    ctx.globalAlpha = it.alpha;
    const style = piktoStyle(it.gold, colors);
    if (it.flash > 0) style.fill = mix(style.fill, GAME.flash, it.flash);
    drawPikto(ctx, fig, cx, top, fh, style);
  }
  ctx.globalAlpha = 1;
}

/** Look of {@link drawFigure}. All sizes in px. */
export interface CoachFigureStyle {
  /** Landmark (normalized) to canvas px. */
  toPx: (p: Landmark) => readonly [number, number];
  /** Px per body unit; COACH widths are multiplied by it. */
  unit: number;
  fill: string | CanvasGradient;
  /** Extra px added to every width and radius (rim/mask pass). */
  grow: number;
}

/**
 * Silhouette of a pose: filled torso, round-capped limb capsules, head, hands and feet. Parts with
 * a landmark below the visibility threshold are left out, never drawn at 0/0. Uses only path
 * primitives and sets no shadow, so the caller decides about glow. Few stroke() calls: one per
 * width class.
 */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly Landmark[],
  style: CoachFigureStyle,
) {
  const { toPx, unit, fill, grow } = style;
  const W = COACH.width;
  const pt = (i: number) => {
    const p = landmarks[i];
    return p && isVisible(p) ? toPx(p) : null;
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = fill;
  ctx.fillStyle = fill;

  const strokeGroup = (segs: readonly (readonly [number, number])[], width: number) => {
    let any = false;
    ctx.beginPath();
    for (const [a, b] of segs) {
      const pa = pt(a),
        pb = pt(b);
      if (!pa || !pb) continue;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      any = true;
    }
    if (!any) return;
    ctx.lineWidth = width * unit + grow;
    ctx.stroke();
  };
  const disc = (c: readonly [number, number], r: number) => {
    ctx.beginPath();
    ctx.arc(c[0], c[1], r * unit + grow / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  // Torso: filled quad, corners rounded by the round-join stroke.
  const ls = pt(11),
    rs = pt(12),
    rh = pt(24),
    lh = pt(23);
  if (ls && rs && rh && lh) {
    ctx.beginPath();
    ctx.moveTo(ls[0], ls[1]);
    ctx.lineTo(rs[0], rs[1]);
    ctx.lineTo(rh[0], rh[1]);
    ctx.lineTo(lh[0], lh[1]);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = W.upperArm * unit + grow;
    ctx.stroke();
  }

  // Head: center between the ears, else the nose.
  const le = pt(7),
    re = pt(8);
  const head = le && re ? ([(le[0] + re[0]) / 2, (le[1] + re[1]) / 2] as const) : pt(0);

  // Neck: shoulder midpoint to head.
  if (ls && rs && head) {
    ctx.beginPath();
    ctx.moveTo((ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2);
    ctx.lineTo(head[0], head[1]);
    ctx.lineWidth = W.neck * unit + grow;
    ctx.stroke();
  }

  strokeGroup(
    [
      [11, 13],
      [12, 14],
    ],
    W.upperArm,
  );
  strokeGroup(
    [
      [13, 15],
      [14, 16],
    ],
    W.forearm,
  );
  strokeGroup(
    [
      [23, 25],
      [24, 26],
    ],
    W.thigh,
  );
  strokeGroup(
    [
      [25, 27],
      [26, 28],
    ],
    W.shin,
  );
  strokeGroup(
    [
      [27, 31],
      [28, 32],
    ],
    W.foot,
  );

  if (head) disc(head, COACH.headRadius);
  for (const i of [15, 16]) {
    const h = pt(i);
    if (h) disc(h, COACH.handRadius);
  }
}

/** Offscreen rim layers, one per coach canvas; created lazily on first use. */
const rimLayers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function rimLayer(canvas: HTMLCanvasElement) {
  let layer = rimLayers.get(canvas);
  if (!layer) {
    layer = document.createElement("canvas");
    rimLayers.set(canvas, layer);
  }
  if (layer.width !== canvas.width || layer.height !== canvas.height) {
    layer.width = canvas.width;
    layer.height = canvas.height;
  }
  return layer;
}

/**
 * Coach: the interpolated choreography pose as a filled silhouette in the song color (vertical
 * gradient), with a light rim and one glow per frame, in a fixed view.
 */
export function drawCoach(
  canvas: HTMLCanvasElement,
  landmarks: Landmark[] | null,
  view: { x: number; y: number; size: number },
  color: string,
) {
  const { ctx, w, h } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  const s = Math.min(w, h) / view.size;
  const ox = (w - view.size * s) / 2,
    oy = (h - view.size * s) / 2;
  const toPx = (p: Landmark) => [ox + (p[0] - view.x) * s, oy + (p[1] - view.y) * s] as const;
  const unit = Math.min(w, h);

  // Glow + rim: the rimmed figure goes through an offscreen layer, so the blur runs once per frame.
  const layer = rimLayer(canvas);
  const lctx = layer.getContext("2d");
  if (lctx) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(layer.width / w, 0, 0, layer.height / h, 0, 0);
    drawFigure(lctx, landmarks, { toPx, unit, fill: COACH.rimColor, grow: COACH.rim * unit * 2 });
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = COACH.glowBlur * unit * (layer.width / w);
    ctx.drawImage(layer, 0, 0, w, h);
    ctx.restore();
  }

  // Fill: lighter at the top, song color at the bottom. Falls back to flat for non-#RRGGBB input.
  let fill: string | CanvasGradient = color;
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    const g = ctx.createLinearGradient(0, oy, 0, oy + view.size * s);
    g.addColorStop(0, mix(color, "#FFFFFF", COACH.gradientLight));
    g.addColorStop(1, color);
    fill = g;
  }
  drawFigure(ctx, landmarks, { toPx, unit, fill, grow: 0 });
}

/**
 * Player skeleton on a canvas whose backing store has the video's pixel size (CSS object-cover
 * crops it exactly like the video). Low-visibility landmarks are skipped.
 */
export function drawSkeleton(canvas: HTMLCanvasElement, landmarks: Landmark[] | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  const unit = Math.min(w, h) / 480;
  ctx.lineCap = "round";
  ctx.strokeStyle = GAME.skeleton;
  ctx.lineWidth = 5 * unit;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    const pa = landmarks[a],
      pb = landmarks[b];
    if (!pa || !pb || !isVisible(pa) || !isVisible(pb)) continue;
    ctx.moveTo(pa[0] * w, pa[1] * h);
    ctx.lineTo(pb[0] * w, pb[1] * h);
  }
  ctx.stroke();
  ctx.fillStyle = GAME.skeletonJoint;
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = landmarks[i];
    if (!p || !isVisible(p)) continue;
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, 5 * unit, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Linear mix of two #RRGGBB colors. */
function mix(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1, 7), 16),
    pb = parseInt(b.slice(1, 7), 16);
  const ch = (s: number) => {
    const x = (pa >> s) & 255,
      y = (pb >> s) & 255;
    return Math.round(x + (y - x) * k);
  };
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
}
