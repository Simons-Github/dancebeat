import { bodyCheck, isVisible } from "./pose";
import type { Landmark } from "./types";

/** How long the whole body must be seen without interruption before the game may start. */
export const HOLD_MS = 1000;
/** A pause between two frames longer than this restarts the hold (video stalled). */
export const MAX_FRAME_GAP_MS = 300;

/** Shoulders-to-ankles height as a fraction of the frame height. */
export const SPAN_MIN = 0.4;
export const SPAN_MAX = 0.85;
/** Landmarks closer to the frame edge than this count as cut off. */
export const EDGE_MARGIN = 0.03;

export type Distance = "ok" | "near" | "far" | "unknown";

export interface BodyStatus {
  parts: ReturnType<typeof bodyCheck>;
  /** Shoulders, hips, knees and ankles all visible in this frame. */
  allVisible: boolean;
  /** Uninterrupted time with `allVisible`, in ms. */
  heldMs: number;
  /** Held for at least `HOLD_MS`. */
  ready: boolean;
  distance: Distance;
  hint: string;
}

const mid = (a: Landmark | undefined, b: Landmark | undefined, axis: 0 | 1) =>
  a && b ? (a[axis] + b[axis]) / 2 : null;

export function distanceOf(lm: Landmark[] | null): Distance {
  if (!lm) return "unknown";
  const sy = mid(lm[11], lm[12], 1);
  const ay = mid(lm[27], lm[28], 1);
  if (sy === null || ay === null || !isVisible(lm[27]) || !isVisible(lm[28])) return "unknown";
  const span = ay - sy;
  const cutOff = [lm[27], lm[28]].some((p) => p && p[1] > 1 - EDGE_MARGIN);
  if (span > SPAN_MAX || cutOff) return "near";
  if (span < SPAN_MIN) return "far";
  return "ok";
}

export function hintFor(lm: Landmark[] | null, parts: BodyStatus["parts"], ready: boolean): string {
  if (!lm) return "Stell dich vor die Kamera. Ich sehe dich noch nicht.";
  if (!parts.ankles || !parts.knees) {
    return parts.ankles
      ? "Knie nicht im Bild. Geh einen Schritt zurück."
      : "Füße nicht im Bild. Geh einen Schritt zurück.";
  }
  if (!parts.shoulders || !parts.hips) return "Oberkörper nicht im Bild. Geh einen Schritt zurück.";
  const distance = distanceOf(lm);
  if (distance === "near") return "Geh einen Schritt zurück.";
  if (distance === "far") return "Komm einen Schritt näher.";
  const hx = mid(lm[23], lm[24], 0);
  if (hx !== null && (hx < 0.25 || hx > 0.75)) return "Stell dich in die Bildmitte.";
  return ready ? "Alles bereit. Los geht's!" : "Super, bleib kurz so stehen.";
}

/** Stateful body check: feed one landmark set per processed frame. No React, no timers. */
export function createBodyTracker(holdMs = HOLD_MS) {
  let since: number | null = null;
  let lastAt: number | null = null;

  return {
    update(lm: Landmark[] | null, nowMs: number): BodyStatus {
      const parts = bodyCheck(lm);
      const allVisible = parts.shoulders && parts.hips && parts.knees && parts.ankles;
      if (lastAt !== null && nowMs - lastAt > MAX_FRAME_GAP_MS) since = null;
      lastAt = nowMs;
      if (!allVisible) since = null;
      else if (since === null) since = nowMs;
      const heldMs = since === null ? 0 : nowMs - since;
      const ready = allVisible && heldMs >= holdMs;
      return {
        parts,
        allVisible,
        heldMs,
        ready,
        distance: distanceOf(lm),
        hint: hintFor(lm, parts, ready),
      };
    },
    reset() {
      since = null;
      lastAt = null;
    },
  };
}

export type RowState = "ok" | "warn" | "pending";
export interface StatusRow {
  id: "body" | "light" | "distance";
  state: RowState;
  label: string;
}

/** Checklist lines for the setup screen. `body` is null until the first frame was analysed. */
export function statusRows(body: BodyStatus | null, lowLight: boolean): StatusRow[] {
  const seen = body !== null;
  let bodyRow: StatusRow = { id: "body", state: "pending", label: "Kopf bis Fuß sichtbar" };
  if (body) {
    if (body.allVisible) bodyRow = { ...bodyRow, state: "ok" };
    else if (!body.parts.ankles)
      bodyRow = { ...bodyRow, state: "warn", label: "Füße nicht im Bild" };
    else if (!body.parts.knees)
      bodyRow = { ...bodyRow, state: "warn", label: "Knie nicht im Bild" };
    else bodyRow = { ...bodyRow, state: "warn", label: "Oberkörper nicht im Bild" };
  }
  const light: StatusRow = lowLight
    ? { id: "light", state: "warn", label: "Mehr Licht nötig" }
    : { id: "light", state: seen ? "ok" : "pending", label: "Genug Licht" };
  const d = body?.distance ?? "unknown";
  const distance: StatusRow =
    d === "ok"
      ? { id: "distance", state: "ok", label: "Abstand passt" }
      : d === "near"
        ? { id: "distance", state: "warn", label: "Zu nah dran" }
        : d === "far"
          ? { id: "distance", state: "warn", label: "Zu weit weg" }
          : { id: "distance", state: "pending", label: "Abstand passt" };
  return [bodyRow, light, distance];
}

/** Extra advice for dark rooms; shown next to the body hint. */
export const LIGHT_HINT = "Mehr Licht: schalte eine Lampe an oder stell dich vor ein Fenster.";
