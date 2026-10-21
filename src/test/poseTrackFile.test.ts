import { describe, expect, it } from "vitest";

import { buildVideoChoreo } from "@/lib/library/videoImport";
import {
  buildPoseTrackFile,
  importOptions,
  parsePoseTrackFile,
  POSE_TRACK_FORMAT,
} from "@/lib/poseTrackFile";
import { figure } from "@/lib/pose";
import type { Landmark } from "@/lib/types";
import { choreoFromPoseTrack, type PoseTrack } from "@/lib/videoChoreo";

const track: PoseTrack = {
  aspect: 16 / 9,
  samples: Array.from({ length: 200 }, (_, i) => ({
    timeMs: i * 50,
    landmarks:
      i % 17 === 5
        ? null
        : figure({ la: 90 + 40 * Math.sin(i / 10), ra: 60, le: 20, re: 10, ll: 5, rl: 5 }).map(
            (p): Landmark => [p[0], p[1], 0.9],
          ),
  })),
};

const input = {
  exportedAt: 1_760_000_000_000,
  video: "tanz.mp4",
  bpm: 124,
  beatPhaseMs: 1830,
  range: { startMs: 1500, endMs: 9500 },
  mirror: true,
  track,
};

describe("poseTrackFile", () => {
  it("übersteht JSON hin und zurück", () => {
    const file = buildPoseTrackFile(input);
    expect(file.format).toBe(POSE_TRACK_FORMAT);
    expect(parsePoseTrackFile(JSON.stringify(file))).toEqual(file);
  });

  it("speichert das Modell der Analyse, ältere Exporte ohne Modell bleiben lesbar", () => {
    const withModel = buildPoseTrackFile({ ...input, model: "full" });
    expect(parsePoseTrackFile(JSON.stringify(withModel)).model).toBe("full");
    const old = parsePoseTrackFile(JSON.stringify(buildPoseTrackFile(input)));
    expect(old.model).toBeUndefined();
    expect(() => parsePoseTrackFile(JSON.stringify({ ...withModel, model: "heavy" }))).toThrow();
  });

  it("speichert die Move-Platzierung und gibt sie an die Import-Optionen weiter", () => {
    const withHolds = parsePoseTrackFile(
      JSON.stringify(buildPoseTrackFile({ ...input, movePlacement: "holds" })),
    );
    expect(withHolds.movePlacement).toBe("holds");
    expect(importOptions(withHolds).opts.movePlacement).toBe("holds");
    const old = parsePoseTrackFile(JSON.stringify(buildPoseTrackFile(input)));
    expect(old.movePlacement).toBeUndefined();
    // Older exports were built on the fixed grid; the new default must not change them.
    expect(importOptions(old).opts.movePlacement).toBe("grid");
    expect(() =>
      parsePoseTrackFile(JSON.stringify({ ...withHolds, movePlacement: "raster" })),
    ).toThrow();
    const { track: t, opts } = importOptions(withHolds);
    const dialog = buildVideoChoreo({
      ...input,
      movePlacement: "holds",
      title: "tanz.mp4",
      now: input.exportedAt,
    });
    expect(choreoFromPoseTrack(t, opts).moves.map((m) => m.timeMs)).toEqual(
      dialog.choreo.moves.map((m) => m.timeMs),
    );
  });

  it("lehnt fremde Dateien ab", () => {
    expect(() => parsePoseTrackFile('{"format":"dancebeat-choreo"}')).toThrow();
    expect(() => parsePoseTrackFile("kein json")).toThrow();
  });

  it("liefert dieselben Moves wie der Import-Dialog", () => {
    const { track: t, opts } = importOptions(buildPoseTrackFile(input));
    const dialog = buildVideoChoreo({ ...input, title: "tanz.mp4", now: input.exportedAt });
    expect(choreoFromPoseTrack(t, opts).moves.length).toBe(dialog.choreo.moves.length);
  });
});
