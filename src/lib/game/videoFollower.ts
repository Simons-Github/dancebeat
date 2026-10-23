import { seekLeadMs, videoSyncStep } from "./videoSync";

export interface VideoFollowInput {
  /** Wall time of this frame (the rAF timestamp); only throttles and measures, never positions. */
  nowMs: number;
  /** Video position that matches the clock (`videoTargetMs`). */
  targetMs: number;
  /** The clock runs; otherwise the video is paused and parked at the target. */
  playing: boolean;
  /** Playback rate of the music; the video runs at the same rate. */
  rate: number;
}

/** Keeps one dance video on its target, frame by frame (see `createVideoFollower`). */
export interface VideoFollower {
  step(el: HTMLVideoElement, input: VideoFollowInput): void;
}

/**
 * Per-loop bookkeeping around `videoSyncStep` (Etappe 8h-2a, shared by game and editor preview
 * since 8h-2b-2b-1): seek cooldown and measured seek lag, a pending or refused `play()`, the
 * playback rate. Call `step` once per animation frame; a new element (the setting toggled back on)
 * starts with fresh bookkeeping, and a change of `playing` allows a new `play()` right away.
 * No React, no game time of its own: the caller hands in the target.
 */
export function createVideoFollower(): VideoFollower {
  let videoEl: HTMLVideoElement | null = null;
  let lastSeekAt = -Infinity;
  let seekIssuedAt: number | null = null;
  let seekLag = 0;
  let playPending = false;
  let refusedAt = -Infinity;
  let lastPlaying: boolean | null = null;
  /** Timestamp of the latest frame (a refusal settles between frames). */
  let lastFrameAt = 0;

  return {
    step(v, { nowMs, targetMs, playing, rate }) {
      const now = Number.isFinite(nowMs) ? nowMs : 0;
      if (v !== videoEl) {
        videoEl = v;
        lastSeekAt = refusedAt = -Infinity;
        seekIssuedAt = null;
        seekLag = 0;
        playPending = false;
      }
      if (playing !== lastPlaying) {
        // E.g. "Weiter" after a refusal: play() may be tried right away.
        lastPlaying = playing;
        refusedAt = -Infinity;
      }
      if (seekIssuedAt !== null && !v.seeking) {
        seekLag = now - seekIssuedAt;
        seekIssuedAt = null;
      }
      if (v.playbackRate !== rate) v.playbackRate = rate;
      if (v.defaultPlaybackRate !== rate) v.defaultPlaybackRate = rate;
      const action = videoSyncStep({
        currentMs: v.currentTime * 1000,
        targetMs,
        playing,
        paused: v.paused,
        seeking: v.seeking,
        msSinceSeek: now - lastSeekAt,
        ...(Number.isFinite(v.duration) ? { durationMs: v.duration * 1000 } : {}),
        ended: v.ended,
        playPending,
        msSinceRefusal: now - refusedAt,
        seekLeadMs: seekLeadMs(seekLag, playing),
      });
      if (action.seekMs !== null) {
        lastSeekAt = now;
        seekIssuedAt = now;
        v.currentTime = action.seekMs / 1000;
      }
      if (action.pause) v.pause();
      if (action.play) {
        // Muted inline video may autoplay; a refusal leaves the still picture until the retry.
        playPending = true;
        const el = v;
        void Promise.resolve(v.play()).then(
          () => {
            if (el === videoEl) playPending = false;
          },
          () => {
            if (el !== videoEl) return;
            playPending = false;
            refusedAt = lastFrameAt;
          },
        );
      }
      lastFrameAt = now;
    },
  };
}
