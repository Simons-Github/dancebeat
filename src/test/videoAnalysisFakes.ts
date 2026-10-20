import { vi } from "vitest";

import { figure } from "@/lib/pose";
import type { PoseEstimator } from "@/lib/poseEstimator";
import type { Landmark } from "@/lib/types";

export interface FakeVideoOptions {
  width?: number;
  height?: number;
  durationMs?: number;
  /** Simulate requestVideoFrameCallback; "never" registers but never fires. */
  /**
   * Simulate requestVideoFrameCallback; "never" registers but never fires; "stale-first" first
   * delivers a late frame of the previous position, then the real one after `seeked`.
   */
  vfc?: "none" | "after-seeked" | "before-seeked" | "never" | "stale-first";
  /** Do not answer seeks (timeout tests). */
  stuck?: boolean;
}

/**
 * Minimal stand-in for a paused HTMLVideoElement: setting currentTime dispatches `seeked`
 * asynchronously. `shownMs` is the frame the "decoder" shows; with a frame callback it only
 * updates when the callback fires (like Safari showing the old frame at `seeked`).
 */
export class FakeVideo extends EventTarget {
  videoWidth: number;
  videoHeight: number;
  duration: number;
  error: MediaError | null = null;
  paused = false;
  shownMs = -1;
  seeks: number[] = [];
  frameCallbacks = new Map<number, VideoFrameRequestCallback>();
  cancelled: number[] = [];
  private nextHandle = 1;
  private time = 0;
  requestVideoFrameCallback?: (cb: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (h: number) => void;

  constructor(private readonly o: FakeVideoOptions = {}) {
    super();
    this.videoWidth = o.width ?? 1280;
    this.videoHeight = o.height ?? 720;
    this.duration = (o.durationMs ?? 1000) / 1000;
    if ((o.vfc ?? "none") !== "none") {
      this.requestVideoFrameCallback = (cb) => {
        const h = this.nextHandle++;
        this.frameCallbacks.set(h, cb);
        return h;
      };
      this.cancelVideoFrameCallback = (h) => {
        this.cancelled.push(h);
        this.frameCallbacks.delete(h);
      };
    }
  }

  pause() {
    this.paused = true;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(s: number) {
    this.time = s;
    this.seeks.push(s * 1000);
    if (this.o.stuck) return;
    const vfc = this.o.vfc ?? "none";
    const fireFrames = (mediaMs = s * 1000) => {
      this.shownMs = mediaMs;
      const cbs = [...this.frameCallbacks.values()];
      this.frameCallbacks.clear();
      const meta = { mediaTime: mediaMs / 1000 } as VideoFrameCallbackMetadata;
      cbs.forEach((cb) => cb(0, meta));
    };
    const previous = this.shownMs;
    setTimeout(() => {
      if (vfc === "none" || vfc === "never") this.shownMs = s * 1000;
      if (vfc === "stale-first") fireFrames(previous);
      if (vfc === "before-seeked") fireFrames();
      this.dispatchEvent(new Event("seeked"));
      if (vfc === "after-seeked" || vfc === "stale-first") setTimeout(() => fireFrames(), 5);
    }, 1);
  }

  /** Registered event listeners (seeked, error). */
  listeners = 0;

  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    this.listeners++;
    super.addEventListener(...args);
  }

  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners--;
    super.removeEventListener(...args);
  }

  asVideo() {
    return this as unknown as HTMLVideoElement;
  }
}

export interface FakeEstimator extends PoseEstimator {
  timestamps: number[];
  /** Video frame (shownMs) seen at each detect call. */
  seen: number[];
  closed: number;
  resolveInit: () => void;
  rejectInit: () => void;
}

/** `pose` maps the shown video time to the landmarks the model "finds". */
export function fakeEstimator(
  pose: (timeMs: number) => Landmark[] | null = () => null,
  autoInit = true,
): FakeEstimator {
  let resolve: () => void = () => {};
  let reject: () => void = () => {};
  const pending = new Promise<{ delegate: "GPU" }>((res, rej) => {
    resolve = () => res({ delegate: "GPU" });
    reject = () => rej(new Error("model"));
  });
  const est: FakeEstimator = {
    name: "Fake",
    timestamps: [],
    seen: [],
    closed: 0,
    init: () => pending,
    detect: vi.fn((video: HTMLVideoElement, ts: number) => {
      const shown = (video as unknown as FakeVideo).shownMs;
      est.timestamps.push(ts);
      est.seen.push(shown);
      return pose(shown);
    }),
    close: () => {
      est.closed++;
    },
    resolveInit: resolve,
    rejectInit: reject,
  };
  if (autoInit) resolve();
  return est;
}

/** A waving stick figure at video time `t`, per-axis normalized for a `aspect` video. */
export function figureLandmarks(t: number, aspect = 16 / 9): Landmark[] {
  const s = Math.max(aspect, 1);
  const lm = figure({
    la: 90 + 60 * Math.sin((2 * Math.PI * t) / 2000),
    ra: 90 - 50 * Math.sin((2 * Math.PI * t) / 3000),
    le: 30,
    re: 20,
    ll: 10,
    rl: 10,
  });
  return lm.map((p) => [0.5 + ((p[0] - 0.5) * s) / aspect, 0.5 + (p[1] - 0.5) * s, p[2] ?? 1]);
}

/**
 * Gives a jsdom <video> what analyzeVideo needs: size, duration and a currentTime setter that
 * answers with `seeked` (and sets `shownMs` for fakeEstimator), like FakeVideo.
 */
export function patchVideoElement(
  el: HTMLVideoElement,
  { durationMs = 6000, width = 1280, height = 720 } = {},
) {
  let time = 0;
  const target = el as HTMLVideoElement & { shownMs: number };
  target.shownMs = -1;
  Object.defineProperties(el, {
    videoWidth: { configurable: true, get: () => width },
    videoHeight: { configurable: true, get: () => height },
    duration: { configurable: true, get: () => durationMs / 1000 },
    currentTime: {
      configurable: true,
      get: () => time,
      set: (s: number) => {
        time = s;
        setTimeout(() => {
          target.shownMs = s * 1000;
          el.dispatchEvent(new Event("seeked"));
        }, 1);
      },
    },
  });
}

/** Estimator that finds several people: `poses` maps the shown video time to all of them. */
export function fakeMultiEstimator(poses: (timeMs: number) => Landmark[][]): FakeEstimator {
  const est = fakeEstimator((t) => poses(t)[0] ?? null);
  est.detectAll = vi.fn((video: HTMLVideoElement, ts: number) => {
    const shown = (video as unknown as FakeVideo).shownMs;
    est.timestamps.push(ts);
    est.seen.push(shown);
    return poses(shown);
  });
  return est;
}

/**
 * `figureLandmarks` moved sideways by `dx` and down by `dy` (per-axis normalized) and scaled by
 * `scale` around the hip center: a second dancer in the same frame.
 */
export function shiftedFigure(
  t: number,
  {
    dx = 0,
    dy = 0,
    scale = 1,
    aspect = 16 / 9,
  }: { dx?: number; dy?: number; scale?: number; aspect?: number } = {},
): Landmark[] {
  return figureLandmarks(t, aspect).map((p) => [
    0.5 + (p[0] - 0.5) * scale + dx,
    0.58 + (p[1] - 0.58) * scale + dy,
    p[2] ?? 1,
  ]);
}
