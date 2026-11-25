import { t } from "./i18n";
import { bodyCheck, isVisible } from "./pose";
import type { Landmark } from "./types";

/** How long the whole body must be seen without interruption before the game may start. */
export const HOLD_MS = 1000;
/** A pause between two frames longer than this restarts the hold (video stalled). */
export const MAX_FRAME_GAP_MS = 600;
/** Frames without the full body for up to this long do not interrupt the hold (model jitter). */
export const DROPOUT_MS = 200;
/** A changed checklist state is shown only after it stayed the same this long. */
export const STABLE_MS = 300;

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
  /** Uninterrupted time with a placed body (visible, distance ok, centred), in ms. */
  heldMs: number;
  /** Whole body, at a good distance and centred, held for at least `HOLD_MS`. */
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

/** Hips in the middle half of the frame width. */
export function isCentered(lm: Landmark[] | null): boolean {
  const hx = lm ? mid(lm[23], lm[24], 0) : null;
  return hx === null || (hx >= 0.25 && hx <= 0.75);
}

export function hintFor(lm: Landmark[] | null, parts: BodyStatus["parts"], ready: boolean): string {
  if (!lm) return t("settings.body.hint.none");
  if (!parts.ankles || !parts.knees) {
    return parts.ankles
      ? t("settings.body.hint.kneesMissing")
      : t("settings.body.hint.feetMissing");
  }
  if (!parts.shoulders || !parts.hips) return t("settings.body.hint.torsoMissing");
  const distance = distanceOf(lm);
  if (distance === "near") return t("settings.body.hint.near");
  if (distance === "far") return t("settings.body.hint.far");
  if (!isCentered(lm)) return t("settings.body.hint.center");
  return ready ? t("settings.body.hint.ready") : t("settings.body.hint.hold");
}

/** Stateful body check: feed one landmark set per processed frame. No React, no timers. */
export function createBodyTracker(holdMs = HOLD_MS) {
  let since: number | null = null;
  let lastAt: number | null = null;
  let lostSince: number | null = null;

  return {
    update(lm: Landmark[] | null, nowMs: number): BodyStatus {
      const parts = bodyCheck(lm);
      const allVisible = parts.shoulders && parts.hips && parts.knees && parts.ankles;
      const distance = distanceOf(lm);
      // Ready must never contradict a hint, so distance and centring count like visibility.
      const placed = allVisible && distance === "ok" && isCentered(lm);
      if (lastAt !== null && nowMs - lastAt > MAX_FRAME_GAP_MS) since = null;
      lastAt = nowMs;
      // Landmarks below visibility 0.5 still count as missing; a short dropout only does not
      // restart the hold.
      if (placed) lostSince = null;
      else {
        lostSince ??= nowMs;
        if (nowMs - lostSince > DROPOUT_MS) since = null;
      }
      if (placed && since === null) since = nowMs;
      const heldMs = since === null ? 0 : nowMs - since;
      const ready = placed && heldMs >= holdMs;
      return {
        parts,
        allVisible,
        heldMs,
        ready,
        distance,
        hint: hintFor(lm, parts, ready),
      };
    },
    reset() {
      since = null;
      lastAt = null;
      lostSince = null;
    },
  };
}

/** Fingerprint of what the UI shows, so React only renders when the display would change. */
export const statusKey = (b: BodyStatus) =>
  [b.ready, b.allVisible, b.distance, b.hint, Object.values(b.parts).join()].join("|");

/**
 * Keeps checklist and hint from flickering at frame rate: a changed state is passed on only
 * after it was stable for `stableMs`. The first status after a reset is shown immediately.
 */
export function createStatusSmoother(stableMs = STABLE_MS) {
  let shown: BodyStatus | null = null;
  let shownKey = "";
  let candKey = "";
  let candSince = 0;

  return {
    next(s: BodyStatus, nowMs: number): BodyStatus {
      const key = statusKey(s);
      if (shown === null || key === shownKey) {
        shown = s;
        shownKey = key;
        candKey = key;
      } else if (key !== candKey) {
        candKey = key;
        candSince = nowMs;
      } else if (nowMs - candSince >= stableMs) {
        shown = s;
        shownKey = key;
      }
      return shown;
    },
    reset() {
      shown = null;
      shownKey = "";
      candKey = "";
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
  let bodyRow: StatusRow = { id: "body", state: "pending", label: t("settings.body.row.visible") };
  if (body) {
    if (body.allVisible) bodyRow = { ...bodyRow, state: "ok" };
    else if (!body.parts.ankles)
      bodyRow = { ...bodyRow, state: "warn", label: t("settings.body.row.feet") };
    else if (!body.parts.knees)
      bodyRow = { ...bodyRow, state: "warn", label: t("settings.body.row.knees") };
    else bodyRow = { ...bodyRow, state: "warn", label: t("settings.body.row.torso") };
  }
  const light: StatusRow = lowLight
    ? { id: "light", state: "warn", label: t("settings.body.row.lightLow") }
    : { id: "light", state: seen ? "ok" : "pending", label: t("settings.body.row.light") };
  const d = body?.distance ?? "unknown";
  const distance: StatusRow =
    d === "ok"
      ? { id: "distance", state: "ok", label: t("settings.body.row.distanceOk") }
      : d === "near"
        ? { id: "distance", state: "warn", label: t("settings.body.row.near") }
        : d === "far"
          ? { id: "distance", state: "warn", label: t("settings.body.row.far") }
          : { id: "distance", state: "pending", label: t("settings.body.row.distanceOk") };
  return [bodyRow, light, distance];
}

/** Extra advice for dark rooms; shown next to the body hint. */
export const lightHint = () => t("settings.setup.lightHint");
