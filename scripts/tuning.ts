/**
 * Parameter search for the video import (Etappe 8g-3): runs `trackMetrics` over raw pose-track
 * exports for every point of a parameter grid. Pure logic; the CLI is tune-video-choreo.ts.
 * The ranking uses the hold-out error; the move placement (Etappe 8g-4c) does not change it and is
 * compared by the column "Bew. °/s" (pose motion at the moves, lower = clearer poses).
 */
import type { PoseTrackFile } from "../src/lib/poseTrackFile.ts";
import { importOptions } from "../src/lib/poseTrackFile.ts";
import {
  DEFAULT_ONE_EURO,
  MOVE_PLACEMENTS,
  trackMetrics,
  type MovePlacement,
  type TrackMetrics,
} from "../src/lib/videoChoreo.ts";

export interface TuningParams {
  minCutoff: number;
  beta: number;
  maxGapMs: number;
  beatsPerMove: number;
  /** Move placement (Etappe 8g-4c); compared via TrackMetrics.moveMotionDegPerS, not the score. */
  placement: MovePlacement;
}

export type TuningGrid = { [K in keyof TuningParams]: TuningParams[K][] };

/** What choreoFromPoseTrack uses today; marked in the report. */
export const CURRENT: TuningParams = {
  minCutoff: DEFAULT_ONE_EURO.minCutoff,
  beta: DEFAULT_ONE_EURO.beta,
  maxGapMs: 250,
  beatsPerMove: 2,
  placement: "grid",
};

export const DEFAULT_GRID: TuningGrid = {
  minCutoff: [0.5, 1, 2, 4],
  beta: [2, 5, 10, 20, 40],
  maxGapMs: [150, 250, 400],
  beatsPerMove: [2],
  placement: ["grid"],
};

export function gridPoints(grid: TuningGrid): TuningParams[] {
  const out: TuningParams[] = [];
  for (const minCutoff of grid.minCutoff)
    for (const beta of grid.beta)
      for (const maxGapMs of grid.maxGapMs)
        for (const beatsPerMove of grid.beatsPerMove)
          for (const placement of grid.placement)
            out.push({ minCutoff, beta, maxGapMs, beatsPerMove, placement });
  return out;
}

export const sameParams = (a: TuningParams, b: TuningParams) =>
  a.minCutoff === b.minCutoff &&
  a.beta === b.beta &&
  a.maxGapMs === b.maxGapMs &&
  a.beatsPerMove === b.beatsPerMove &&
  a.placement === b.placement;

/**
 * Ranking value in degrees: the hold-out error (see TrackMetrics.holdoutDeg). On synthetic tracks
 * its best setting lies within about 0.6° of the truly best one. null if the build failed.
 */
export function score(m: TrackMetrics): number | null {
  if (m.error || m.holdoutDeg === null) return null;
  return m.holdoutDeg;
}

export interface TuningRow {
  params: TuningParams;
  metrics: TrackMetrics;
  score: number | null;
}

/** All grid points for one file, best score first (unscored rows last). */
export function tuneFile(file: PoseTrackFile, points: TuningParams[]): TuningRow[] {
  const { track, opts } = importOptions(file);
  const rows = points.map((params): TuningRow => {
    const metrics = trackMetrics(track, {
      ...opts,
      filter: { minCutoff: params.minCutoff, beta: params.beta },
      maxGapMs: params.maxGapMs,
      beatsPerMove: params.beatsPerMove,
      movePlacement: params.placement,
    });
    return { params, metrics, score: score(metrics) };
  });
  return rows.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
}

/**
 * Mean score of each grid point over all files, best first. A point that failed on any file is
 * dropped: new defaults must work for every video.
 */
export function overall(results: TuningRow[][]): { params: TuningParams; score: number }[] {
  const first = results[0];
  if (!first) return [];
  const out: { params: TuningParams; score: number }[] = [];
  for (const { params } of first) {
    const scores = results.map(
      (rows) => rows.find((r) => sameParams(r.params, params))?.score ?? null,
    );
    if (scores.some((s) => s === null)) continue;
    out.push({ params, score: (scores as number[]).reduce((a, b) => a + b, 0) / scores.length });
  }
  return out.sort((a, b) => a.score - b.score);
}

const f2 = (v: number | null) => (v === null ? "–" : v.toFixed(2));
const pct = (v: number) => `${Math.round(v * 100)} %`;
const paramText = (p: TuningParams) =>
  `minCutoff ${p.minCutoff}, beta ${p.beta}, maxGap ${p.maxGapMs}, Beats/Move ${p.beatsPerMove}, ${p.placement}`;
const mark = (p: TuningParams) => (sameParams(p, CURRENT) ? " ← aktuell" : "");

/** Plain-text report for one file: header figures and the best `top` rows plus the current one. */
export function formatFileReport(file: PoseTrackFile, rows: TuningRow[], top = 10): string {
  const any = rows[0]?.metrics;
  const lines = [
    `## ${file.video}${file.model ? ` (Modell ${file.model})` : ""}`,
    any
      ? `Proben ${any.samples}, Erkennung ${pct(any.detectionRatio)}, Zittern roh ${f2(any.jitterRawDeg)}°, BPM ${file.bpm}`
      : "Keine Daten.",
    "",
    "Rang | Holdout | Zittern | Moves         | Bew. °/s | Parameter",
  ];
  const current = rows.findIndex((r) => sameParams(r.params, CURRENT));
  rows.forEach((r, i) => {
    if (i >= top && i !== current) return;
    const m = r.metrics;
    const moves = r.metrics.error
      ? r.metrics.error
      : `${m.moves}/${m.moveSlots} (${pct(m.usableMoveRatio)})`;
    lines.push(
      `${String(i + 1).padStart(4)} | ${f2(r.score).padStart(7)} | ${f2(m.jitterSmoothDeg).padStart(7)} | ${moves.padEnd(13)} | ${f2(m.moveMotionDegPerS).padStart(8)} | ${paramText(r.params)}${mark(r.params)}`,
    );
  });
  return lines.join("\n");
}

export function formatOverall(ranking: { params: TuningParams; score: number }[], top = 10) {
  const lines = ["## Über alle Videos (mittlere Wertung)", ""];
  const current = ranking.findIndex((r) => sameParams(r.params, CURRENT));
  ranking.forEach((r, i) => {
    if (i >= top && i !== current) return;
    lines.push(
      `${String(i + 1).padStart(4)} | ${r.score.toFixed(2).padStart(7)} | ${paramText(r.params)}${mark(r.params)}`,
    );
  });
  if (current < 0) lines.push("Die aktuellen Werte scheitern an mindestens einem Video.");
  lines.push(
    "",
    "Holdout enthält das Rauschen der Rohwerte; Unterschiede unter etwa 0,1° sind nicht",
    "aussagekräftig. Neue Standardwerte im Spiel gegenprüfen.",
  );
  return lines.join("\n");
}

/** "0.5,1,2" → [0.5, 1, 2]; throws on anything that is not a list of positive numbers. */
export function parseList(text: string, name: string): number[] {
  const values = text.split(",").map((s) => Number(s.trim()));
  if (!values.length || values.some((v) => !Number.isFinite(v) || v <= 0)) {
    throw new Error(`--${name}: erwartet positive Zahlen, durch Kommas getrennt (z. B. 1,2,4).`);
  }
  return values;
}

/** "grid,holds" → ["grid", "holds"]; throws on an unknown placement. */
export function parsePlacements(text: string): MovePlacement[] {
  const values = text.split(",").map((s) => s.trim());
  const valid = (v: string): v is MovePlacement =>
    (MOVE_PLACEMENTS as readonly string[]).includes(v);
  if (!values.length || !values.every(valid)) {
    throw new Error(
      `--placement: erwartet ${MOVE_PLACEMENTS.join(" oder ")}, durch Kommas getrennt (z. B. grid,holds).`,
    );
  }
  return values.filter(valid);
}
