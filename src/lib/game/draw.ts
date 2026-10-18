import { GAME, GOLD, GOLD_DEEP } from "@/theme";

import { BONES, isVisible } from "../pose";
import type { Landmark } from "../types";
import { PIKTO, type PiktoItem, type StickFigure } from "./pikto";

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

interface FigureStyle {
  color: string;
  arrowColor?: string;
  outline?: string;
  glow?: string;
  /** Line width as a fraction of the figure height. */
  weight?: number;
}

/** Draws a unit stick figure with its top center at (cx, top), `height` pixels tall. */
export function drawStickFigure(
  ctx: CanvasRenderingContext2D,
  fig: StickFigure,
  cx: number,
  top: number,
  height: number,
  style: FigureStyle,
) {
  const X = (v: number) => cx + v * height;
  const Y = (v: number) => top + v * height;
  const lw = height * (style.weight ?? 0.075);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = new Path2D();
  for (const [x0, y0, x1, y1] of fig.lines) {
    path.moveTo(X(x0), Y(y0));
    path.lineTo(X(x1), Y(y1));
  }
  const head = fig.head;
  if (style.outline) {
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = lw * 1.7;
    ctx.stroke(path);
    if (head) {
      ctx.fillStyle = style.outline;
      ctx.beginPath();
      ctx.arc(X(head.x), Y(head.y), head.r * height + lw * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.save();
  if (style.glow) {
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = lw * 2.5;
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = lw;
  ctx.stroke(path);
  if (head) {
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(X(head.x), Y(head.y), head.r * height, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (style.arrowColor) {
    ctx.strokeStyle = style.arrowColor;
    ctx.fillStyle = style.arrowColor;
    ctx.lineWidth = lw * 0.55;
    for (const [x0, y0, x1, y1] of fig.arrows) {
      const ax = X(x0),
        ay = Y(y0),
        bx = X(x1),
        by = Y(y1);
      // Shortened so the arrow does not cover the hand.
      const ex = ax + (bx - ax) * 0.8,
        ey = ay + (by - ay) * 0.8;
      ctx.beginPath();
      ctx.moveTo(ax + (bx - ax) * 0.15, ay + (by - ay) * 0.15);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const ang = Math.atan2(ey - ay, ex - ax);
      const s = lw * 1.4;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * s, ey + Math.sin(ang) * s);
      ctx.lineTo(ex + Math.cos(ang + 2.4) * s, ey + Math.sin(ang + 2.4) * s);
      ctx.lineTo(ex + Math.cos(ang - 2.4) * s, ey + Math.sin(ang - 2.4) * s);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Pictograms on the bar canvas (the bar shape and marker are DOM; only figures move). */
export function drawPiktos(
  canvas: HTMLCanvasElement,
  items: readonly PiktoItem[],
  figures: readonly (StickFigure | null)[],
  colors: { accent: string; secondary: string },
) {
  const { ctx, w, h } = fitCanvas(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  const fh = h * 0.8;
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
    const style: FigureStyle = it.gold
      ? { color: GOLD, outline: GOLD_DEEP, glow: GOLD, arrowColor: GOLD }
      : { color: colors.accent, outline: GAME.outline, arrowColor: colors.secondary };
    if (it.flash > 0) style.color = mix(style.color, GAME.flash, it.flash);
    drawStickFigure(ctx, fig, cx, top, fh, style);
  }
  ctx.globalAlpha = 1;
}

/** Coach: the interpolated choreography pose, one color with glow, in a fixed view. */
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
  const P = (p: Landmark) => [ox + (p[0] - view.x) * s, oy + (p[1] - view.y) * s] as const;
  const lw = Math.max(3, Math.min(w, h) * 0.045);
  const path = new Path2D();
  for (const [a, b] of BONES) {
    const pa = landmarks[a],
      pb = landmarks[b];
    if (!pa || !pb || !isVisible(pa) || !isVisible(pb)) continue;
    const [ax, ay] = P(pa),
      [bx, by] = P(pb);
    path.moveTo(ax, ay);
    path.lineTo(bx, by);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = GAME.outline;
  ctx.lineWidth = lw * 1.6;
  ctx.stroke(path);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = lw * 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke(path);
  const head = landmarks[0];
  if (head && isVisible(head)) {
    const [hx, hy] = P(head);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(hx, hy, lw * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
