import { describe, expect, it } from "vitest";

import { createVideoFollower } from "@/lib/game/videoFollower";
import {
  VIDEO_PLAY_RETRY_MS,
  VIDEO_SEEK_COOLDOWN_MS,
  VIDEO_SYNC_TOLERANCE_MS,
} from "@/lib/game/videoSync";

/** Minimal media element: play() resolves (or rejects when `refuse`), currentTime records seeks. */
function fakeVideo() {
  const state = {
    paused: true,
    seeking: false,
    ended: false,
    duration: Number.NaN,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    time: 0,
    refuse: false,
    seeks: [] as number[],
    plays: 0,
    pauses: 0,
  };
  const el = {
    get paused() {
      return state.paused;
    },
    get seeking() {
      return state.seeking;
    },
    get ended() {
      return state.ended;
    },
    get duration() {
      return state.duration;
    },
    get playbackRate() {
      return state.playbackRate;
    },
    set playbackRate(r: number) {
      state.playbackRate = r;
    },
    get defaultPlaybackRate() {
      return state.defaultPlaybackRate;
    },
    set defaultPlaybackRate(r: number) {
      state.defaultPlaybackRate = r;
    },
    get currentTime() {
      return state.time;
    },
    set currentTime(s: number) {
      state.time = s;
      state.seeks.push(s * 1000);
    },
    play() {
      state.plays++;
      if (state.refuse) return Promise.reject(new DOMException("refused", "NotAllowedError"));
      state.paused = false;
      return Promise.resolve();
    },
    pause() {
      state.pauses++;
      state.paused = true;
    },
  };
  return { state, el: el as unknown as HTMLVideoElement };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createVideoFollower", () => {
  it("seeks to the target when off and only plays while playing", () => {
    const { state, el } = fakeVideo();
    const f = createVideoFollower();
    f.step(el, { nowMs: 0, targetMs: 3000, playing: false, rate: 1 });
    expect(state.seeks).toEqual([3000]);
    expect(state.plays).toBe(0);
    expect(state.paused).toBe(true);
    f.step(el, { nowMs: 16, targetMs: 3000, playing: true, rate: 1 });
    expect(state.plays).toBe(1);
    expect(state.paused).toBe(false);
    // Within the tolerance: no seek.
    f.step(el, {
      nowMs: 1000,
      targetMs: 3000 + VIDEO_SYNC_TOLERANCE_MS,
      playing: true,
      rate: 1,
    });
    expect(state.seeks).toEqual([3000]);
    f.step(el, { nowMs: 1016, targetMs: 3000, playing: false, rate: 1 });
    expect(state.paused).toBe(true);
  });

  it("throttles seeks by the cooldown", () => {
    const { state, el } = fakeVideo();
    const f = createVideoFollower();
    f.step(el, { nowMs: 0, targetMs: 3000, playing: false, rate: 1 });
    f.step(el, { nowMs: VIDEO_SEEK_COOLDOWN_MS - 1, targetMs: 6000, playing: false, rate: 1 });
    expect(state.seeks).toEqual([3000]);
    f.step(el, { nowMs: VIDEO_SEEK_COOLDOWN_MS, targetMs: 6000, playing: false, rate: 1 });
    expect(state.seeks).toEqual([3000, 6000]);
  });

  it("applies the rate to playbackRate and defaultPlaybackRate", () => {
    const { state, el } = fakeVideo();
    createVideoFollower().step(el, { nowMs: 0, targetMs: 0, playing: false, rate: 0.75 });
    expect(state.playbackRate).toBe(0.75);
    expect(state.defaultPlaybackRate).toBe(0.75);
  });

  it("retries a refused play() after the wait, or right away when playing changes", async () => {
    const { state, el } = fakeVideo();
    state.refuse = true;
    const f = createVideoFollower();
    const at = (nowMs: number, playing = true) =>
      f.step(el, { nowMs, targetMs: 1000, playing, rate: 1 });
    at(100);
    expect(state.plays).toBe(1);
    // Pending: no second call.
    at(116);
    expect(state.plays).toBe(1);
    await settle();
    at(132);
    expect(state.plays).toBe(1);
    // The refusal counts from the frame before it settled (116).
    at(116 + VIDEO_PLAY_RETRY_MS - 1);
    expect(state.plays).toBe(1);
    at(116 + VIDEO_PLAY_RETRY_MS);
    expect(state.plays).toBe(2);
    await settle();
    // Stop and start again: tried at once.
    at(116 + VIDEO_PLAY_RETRY_MS + 16, false);
    at(116 + VIDEO_PLAY_RETRY_MS + 32);
    expect(state.plays).toBe(3);
  });

  it("starts fresh bookkeeping for a new element", async () => {
    const a = fakeVideo();
    a.state.refuse = true;
    const f = createVideoFollower();
    f.step(a.el, { nowMs: 0, targetMs: 1000, playing: true, rate: 1 });
    await settle();
    const b = fakeVideo();
    f.step(b.el, { nowMs: 16, targetMs: 1000, playing: true, rate: 1 });
    expect(b.state.plays).toBe(1);
    expect(b.state.paused).toBe(false);
  });

  it("aims a seek ahead by the measured seek lag while playing", () => {
    const { state, el } = fakeVideo();
    const f = createVideoFollower();
    f.step(el, { nowMs: 0, targetMs: 5000, playing: true, rate: 1 });
    expect(state.seeks).toEqual([5000]);
    // The seek takes 300 ms of wall time.
    state.seeking = true;
    f.step(el, { nowMs: 100, targetMs: 5100, playing: true, rate: 1 });
    state.seeking = false;
    f.step(el, { nowMs: 300, targetMs: 5300, playing: true, rate: 1 });
    // Drifted again after the cooldown: lands 300 ms ahead.
    state.time = 0;
    f.step(el, { nowMs: 1000, targetMs: 6000, playing: true, rate: 1 });
    expect(state.seeks).toEqual([5000, 6300]);
  });
});
