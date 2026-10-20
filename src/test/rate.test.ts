import { describe, expect, it } from "vitest";

import { appliesPlaybackRate, effectivePlaybackRate } from "@/lib/audio/rate";
import { supportsTempo } from "@/lib/choreoEditor";
import { makeSong } from "./fixtures";

const withSource = (source: ReturnType<typeof makeSong>["source"], playbackRate?: number) => {
  const song = { ...makeSong(), source };
  if (playbackRate !== undefined) song.playbackRate = playbackRate;
  return song;
};

describe("effectivePlaybackRate", () => {
  it("local and url apply the stored rate, 1 when missing", () => {
    expect(effectivePlaybackRate(withSource({ type: "local", blobId: "b" }, 1.25))).toBe(1.25);
    expect(effectivePlaybackRate(withSource({ type: "url", url: "https://x/a.mp3" }, 0.75))).toBe(
      0.75,
    );
    expect(effectivePlaybackRate(withSource({ type: "local", blobId: "b" }))).toBe(1);
  });

  it("youtube applies the stored rate (N10), spotify always plays at 1", () => {
    expect(
      effectivePlaybackRate(withSource({ type: "youtube", videoId: "abcdefghijk" }, 1.25)),
    ).toBe(1.25);
    expect(effectivePlaybackRate(withSource({ type: "youtube", videoId: "abcdefghijk" }))).toBe(1);
    expect(
      effectivePlaybackRate(withSource({ type: "spotify", trackUri: "spotify:track:x" }, 1.25)),
    ).toBe(1);
  });

  it("supportsTempo uses the same predicate", () => {
    const s = withSource({ type: "youtube", videoId: "abcdefghijk" });
    expect(supportsTempo(s)).toBe(appliesPlaybackRate(s.source));
    expect(supportsTempo(withSource({ type: "local", blobId: "b" }))).toBe(true);
    expect(supportsTempo(s)).toBe(true);
    expect(supportsTempo(withSource({ type: "spotify", trackUri: "spotify:track:x" }))).toBe(false);
  });
});
