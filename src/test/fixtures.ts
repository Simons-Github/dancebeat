import { computeAngles, figure, type FigureParams } from "@/lib/pose";
import { CHOREO_VERSION } from "@/lib/schema";
import type { Choreography, Song } from "@/lib/types";

export function makeChoreo(poses: FigureParams[] = [{ la: 90, ra: 90 }]): Choreography {
  const frames = poses.map((p, i) => {
    const landmarks = figure(p);
    return { timeMs: i * 500, landmarks, angles: computeAngles(landmarks) };
  });
  return {
    version: CHOREO_VERSION,
    id: crypto.randomUUID(),
    title: "Test",
    bpm: 120,
    offsetMs: 0,
    accentColor: "#FF2E93",
    secondaryColor: "#00E5FF",
    frames,
    moves: frames.map((f, i) => ({ timeMs: f.timeMs, label: `M${i}`, iconId: "x", gold: false })),
    createdAt: 1,
    updatedAt: 1,
  };
}

export function makeSong(choreo = makeChoreo()): Song {
  return {
    id: crypto.randomUUID(),
    title: "Song",
    artist: "Artist",
    bpm: 120,
    difficulty: 2,
    source: { type: "local", blobId: "blob-1" },
    syncOffsetMs: 0,
    startOffsetMs: 0,
    choreo,
    highscore: 1234,
    stars: 3,
    createdAt: 1,
    updatedAt: 1,
  };
}
