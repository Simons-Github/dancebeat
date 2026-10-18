import { OVERLAY_COLORS } from "@/theme";

import { BONES, isVisible } from "./pose";
import type { Landmark } from "./types";

/** Standing-person outline in normalized 0..1 frame coordinates, as a guide for the stance. */
function guidePath(w: number, h: number): Path2D {
  const p = new Path2D();
  const x = (v: number) => v * w;
  const y = (v: number) => v * h;
  const r = Math.min(w, h);
  p.arc(x(0.5), y(0.15), r * 0.07, 0, Math.PI * 2);
  p.moveTo(x(0.36), y(0.27));
  p.lineTo(x(0.64), y(0.27));
  p.lineTo(x(0.7), y(0.55));
  p.lineTo(x(0.6), y(0.55));
  p.lineTo(x(0.6), y(0.93));
  p.lineTo(x(0.52), y(0.93));
  p.lineTo(x(0.5), y(0.6));
  p.lineTo(x(0.48), y(0.93));
  p.lineTo(x(0.4), y(0.93));
  p.lineTo(x(0.4), y(0.55));
  p.lineTo(x(0.3), y(0.55));
  p.closePath();
  return p;
}

/**
 * Clears the canvas and draws the stance guide plus, if present, the skeleton. Called straight
 * from the detection loop; landmarks with low visibility are skipped, never drawn at 0.
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  landmarks: Landmark[] | null,
  opts: { ready: boolean },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);

  const unit = Math.min(w, h) / 480;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([12 * unit, 10 * unit]);
  ctx.lineWidth = 4 * unit;
  ctx.strokeStyle = opts.ready ? OVERLAY_COLORS.guideReady : OVERLAY_COLORS.guide;
  ctx.stroke(guidePath(w, h));
  ctx.setLineDash([]);

  if (!landmarks) return;
  ctx.strokeStyle = OVERLAY_COLORS.bone;
  ctx.lineWidth = 5 * unit;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!isVisible(pa) || !isVisible(pb) || !pa || !pb) continue;
    ctx.moveTo(pa[0] * w, pa[1] * h);
    ctx.lineTo(pb[0] * w, pb[1] * h);
  }
  ctx.stroke();
  ctx.fillStyle = OVERLAY_COLORS.joint;
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = landmarks[i];
    if (!isVisible(p) || !p) continue;
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, 6 * unit, 0, Math.PI * 2);
    ctx.fill();
  }
}
