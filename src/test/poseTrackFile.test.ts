import { describe, expect, it } from "vitest";

import { buildVideoChoreo } from "@/lib/library/videoImport";
import {
  buildPoseTrackFile,
  importOptions,
  parsePoseTrackFile,
  POSE_TRACK_FORMAT,
} from "@/lib/poseTrackFile";
import { figure } from "@/lib/pose";
import type { Landmark, Landmark3d } from "@/lib/types";
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

  it("Version 2 speichert Weltpunkte gerundet, Version 1 bleibt lesbar", () => {
    const withWorld: PoseTrack = {
      ...track,
      samples: track.samples.map((s, i) =>
        i === 3
          ? s
          : {
              ...s,
              world: s.landmarks
                ? s.landmarks.map((p): Landmark3d => [p[0] - 0.5123456, p[1] / 3, 0.1, 0.8])
                : null,
            },
      ),
    };
    const file = buildPoseTrackFile({ ...input, track: withWorld });
    expect(file.version).toBe(2);
    const parsed = parsePoseTrackFile(JSON.stringify(file));
    expect(parsed).toEqual(file);
    const first = parsed.track.samples[0]!.world![0]!;
    expect(first[0]).toBe(
      Math.round((track.samples[0]!.landmarks![0]![0] - 0.5123456) * 1e4) / 1e4,
    );
    expect(first[3]).toBe(0.8);
    const { track: t } = importOptions(parsed);
    expect(t.samples[3]).not.toHaveProperty("world");
    expect(t.samples[5]!.world).toBeNull();
    expect(t.samples[0]!.world).toEqual(parsed.track.samples[0]!.world);

    // A version-1 export (before 13c) still parses and builds the same choreography.
    const v1 = { ...buildPoseTrackFile(input), version: 1 };
    const old = parsePoseTrackFile(JSON.stringify(v1));
    expect(old.version).toBe(1);
    const { track: oldTrack, opts } = importOptions(old);
    expect(oldTrack.samples.every((s) => !("world" in s))).toBe(true);
    expect(choreoFromPoseTrack(oldTrack, opts).moves.length).toBe(
      choreoFromPoseTrack(importOptions(buildPoseTrackFile(input)).track, opts).moves.length,
    );
    // Version 1 knows no world landmarks; unknown versions are rejected.
    expect(() => parsePoseTrackFile(JSON.stringify({ ...file, version: 1 }))).toThrow();
    expect(() => parsePoseTrackFile(JSON.stringify({ ...file, version: 3 }))).toThrow();
    const bad = structuredClone(file);
    bad.track.samples[0]!.world = [[0, 0, 0, 2]];
    expect(() => parsePoseTrackFile(JSON.stringify(bad))).toThrow();
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
