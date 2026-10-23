import { describe, expect, it } from "vitest";

import {
  MAX_SEEK_LEAD_MS,
  VIDEO_PLAY_RETRY_MS,
  VIDEO_SEEK_COOLDOWN_MS,
  VIDEO_SYNC_TOLERANCE_MS,
  seekLeadMs,
  videoSyncStep,
  videoTargetMs,
  type VideoSyncInput,
} from "@/lib/game/videoSync";

const base: VideoSyncInput = {
  currentMs: 5000,
  targetMs: 5000,
  playing: true,
  paused: false,
  seeking: false,
  msSinceSeek: Infinity,
  ended: false,
  playPending: false,
  msSinceRefusal: Infinity,
  seekLeadMs: 0,
};
const step = (patch: Partial<VideoSyncInput>) => videoSyncStep({ ...base, ...patch });

describe("videoTargetMs", () => {
  it("adds the choreography offset to the game time", () => {
    expect(videoTargetMs(1000, 2500)).toBe(3500);
    expect(videoTargetMs(0, 0)).toBe(0);
  });

  it("clamps to 0 before the video starts and for non-finite input", () => {
    expect(videoTargetMs(-3000, 1000)).toBe(0);
    expect(videoTargetMs(Number.NaN, 1000)).toBe(0);
  });
});

describe("videoSyncStep", () => {
  it("leaves a running video alone within the tolerance", () => {
    expect(step({ currentMs: 5000 + VIDEO_SYNC_TOLERANCE_MS })).toEqual({
      play: false,
      pause: false,
      seekMs: null,
    });
    expect(step({ currentMs: 5000 - VIDEO_SYNC_TOLERANCE_MS }).seekMs).toBeNull();
  });

  it("seeks to the target when the drift exceeds the tolerance", () => {
    expect(step({ currentMs: 5000 + VIDEO_SYNC_TOLERANCE_MS + 1 }).seekMs).toBe(5000);
    expect(step({ currentMs: 4000 }).seekMs).toBe(5000);
  });

  it("starts a paused video while playing", () => {
    expect(step({ paused: true })).toEqual({ play: true, pause: false, seekMs: null });
  });

  it("pauses and parks the video while the clock stands still", () => {
    expect(step({ playing: false })).toEqual({ play: false, pause: true, seekMs: null });
    expect(step({ playing: false, paused: true })).toEqual({
      play: false,
      pause: false,
      seekMs: null,
    });
    expect(step({ playing: false, paused: true, currentMs: 9000 }).seekMs).toBe(5000);
  });

  it("does not seek again while a seek is pending or within the cooldown", () => {
    expect(step({ currentMs: 0, seeking: true }).seekMs).toBeNull();
    expect(step({ currentMs: 0, msSinceSeek: VIDEO_SEEK_COOLDOWN_MS - 1 }).seekMs).toBeNull();
    expect(step({ currentMs: 0, msSinceSeek: VIDEO_SEEK_COOLDOWN_MS }).seekMs).toBe(5000);
  });

  it("waits on the first frame while the target is clamped to 0", () => {
    expect(step({ targetMs: 0, currentMs: 0, paused: true })).toEqual({
      play: false,
      pause: false,
      seekMs: null,
    });
  });

  it("clamps the target to the duration and never restarts a finished video", () => {
    const end = { durationMs: 6000, targetMs: 8000, paused: true };
    expect(step({ ...end, currentMs: 6000 })).toEqual({ play: false, pause: false, seekMs: null });
    expect(step({ ...end, currentMs: 1000 }).seekMs).toBe(6000);
    expect(step({ ...end, paused: false, currentMs: 5990 }).pause).toBe(true);
  });

  it("ignores an unknown duration", () => {
    expect(step({ durationMs: Number.NaN, targetMs: 8000, currentMs: 8000 })).toEqual({
      play: false,
      pause: false,
      seekMs: null,
    });
  });

  it("never plays an ended video, also with an unknown (Infinity) duration", () => {
    expect(step({ paused: true, ended: true, durationMs: Infinity })).toEqual({
      play: false,
      pause: false,
      seekMs: null,
    });
  });

  it("does not call play() again while one is pending", () => {
    expect(step({ paused: true, playPending: true }).play).toBe(false);
  });

  it("waits after a refusal before trying play() again", () => {
    expect(step({ paused: true, msSinceRefusal: VIDEO_PLAY_RETRY_MS - 1 }).play).toBe(false);
    expect(step({ paused: true, msSinceRefusal: VIDEO_PLAY_RETRY_MS }).play).toBe(true);
  });

  it("aims a seek ahead by the lead while playing, clamped to the duration", () => {
    expect(step({ currentMs: 0, seekLeadMs: 300 }).seekMs).toBe(5300);
    expect(step({ currentMs: 0, seekLeadMs: 300, durationMs: 5200 }).seekMs).toBe(5200);
    expect(step({ playing: false, paused: true, currentMs: 0, seekLeadMs: 300 }).seekMs).toBe(5000);
  });
});

describe("seekLeadMs", () => {
  it("is the measured seek lag while playing, clamped", () => {
    expect(seekLeadMs(250, true)).toBe(250);
    expect(seekLeadMs(5000, true)).toBe(MAX_SEEK_LEAD_MS);
    expect(seekLeadMs(-10, true)).toBe(0);
    expect(seekLeadMs(Number.NaN, true)).toBe(0);
  });

  it("is 0 when not playing", () => {
    expect(seekLeadMs(250, false)).toBe(0);
  });
});
