import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePoseTracking, type PoseTrackingOptions } from "@/hooks/usePoseTracking";
import type { PoseEstimator } from "@/lib/poseEstimator";
import type { Landmark } from "@/lib/types";

const flush = () => new Promise((r) => setTimeout(r, 0));

const stop = vi.fn();
const getUserMedia = vi.fn();
let renders = 0;
let frameCallbacks: Array<() => void> = [];
let cancelled: number[] = [];

function fakeStream(deviceId = "cam-1") {
  const track = { stop, getSettings: () => ({ deviceId }) };
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

interface FakeEstimator extends PoseEstimator {
  closed: boolean;
  resolveInit: () => void;
  rejectInit: () => void;
}

function fakeEstimator(landmarks: Landmark[] | null = null, autoInit = false): FakeEstimator {
  let resolve: (v: { delegate: "GPU" }) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const pending = new Promise<{ delegate: "GPU" }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const est: FakeEstimator = {
    name: "Fake",
    closed: false,
    init: () => pending,
    detect: vi.fn(() => landmarks),
    close: () => {
      est.closed = true;
    },
    resolveInit: () => resolve({ delegate: "GPU" }),
    rejectInit: () => reject(new Error("model")),
  };
  if (autoInit) est.resolveInit();
  return est;
}

function Probe(
  props: PoseTrackingOptions & { onState?: (s: ReturnType<typeof usePoseTracking>) => void },
) {
  renders++;
  const { onState, ...opts } = props;
  const state = usePoseTracking(opts);
  onState?.(state);
  return <video ref={state.videoRef} />;
}

describe("usePoseTracking", () => {
  beforeEach(() => {
    stop.mockClear();
    getUserMedia.mockReset();
    renders = 0;
    frameCallbacks = [];
    cancelled = [];
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    // jsdom has no canvas backend; the light check just gets skipped.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // Manual video-frame clock.
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: (cb: () => void) => frameCallbacks.push(cb),
    });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
      configurable: true,
      value: (id: number) => cancelled.push(id),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const tick = () => {
    const cb = frameCallbacks.pop();
    frameCallbacks = [];
    cb?.();
  };

  it("startet ohne enabled weder Kamera noch Modell", async () => {
    const est = fakeEstimator();
    render(<Probe enabled={false} createEstimator={() => est} />);
    await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("stoppt einen Stream, der erst nach dem Unmount ankommt", async () => {
    let resolveStream: (s: MediaStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise((res) => (resolveStream = res)));
    const { unmount } = render(<Probe enabled createEstimator={() => fakeEstimator()} />);
    unmount();
    resolveStream(fakeStream());
    await flush();
    expect(stop).toHaveBeenCalled();
  });

  it("schließt einen Estimator, der erst nach dem Unmount fertig wird, und stoppt die Kamera", async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    const est = fakeEstimator();
    const { unmount } = render(<Probe enabled createEstimator={() => est} />);
    await flush();
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(est.closed).toBe(true);
    est.resolveInit();
    await flush();
    expect(est.closed).toBe(true);
    // No detection loop was left behind.
    expect(est.detect).not.toHaveBeenCalled();
  });

  it("räumt beim Verlassen nach laufender Erkennung auf", async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    const est = fakeEstimator(null, true);
    const { unmount } = render(<Probe enabled createEstimator={() => est} />);
    await act(flush);
    tick();
    expect(est.detect).toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(est.closed).toBe(true);
    expect(cancelled.length).toBeGreaterThan(0);
  });

  it("stoppt die alte Kamera beim Kamerawechsel und startet die neue", async () => {
    getUserMedia.mockResolvedValueOnce(fakeStream("a")).mockResolvedValueOnce(fakeStream("b"));
    const estimators: FakeEstimator[] = [];
    const create = () => {
      const e = fakeEstimator(null, true);
      estimators.push(e);
      return e;
    };
    const { rerender } = render(<Probe enabled cameraId="a" createEstimator={create} />);
    await act(flush);
    rerender(<Probe enabled cameraId="b" createEstimator={create} />);
    await act(flush);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(estimators[0]?.closed).toBe(true);
    expect(estimators[1]?.closed).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("fällt bei veralteter Kamera-ID auf die Standardkamera zurück", async () => {
    getUserMedia
      .mockRejectedValueOnce(new DOMException("gone", "OverconstrainedError"))
      .mockResolvedValueOnce(fakeStream("default"));
    const onStale = vi.fn();
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(
      <Probe
        enabled
        cameraId="old"
        onStaleCamera={onStale}
        createEstimator={() => fakeEstimator(null, true)}
        onState={(s) => (last = s)}
      />,
    );
    await act(flush);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const second = getUserMedia.mock.calls[1]?.[0] as { video: MediaTrackConstraints };
    expect(second.video.deviceId).toBeUndefined();
    expect(second.video.facingMode).toBe("user");
    expect(last?.status).toBe("ready");
    expect(last?.activeDeviceId).toBe("default");
  });

  it.each([
    ["NotAllowedError", "denied"],
    ["NotFoundError", "nocamera"],
    ["NotReadableError", "busy"],
  ])("meldet %s als %s", async (name, kind) => {
    getUserMedia.mockRejectedValue(new DOMException("x", name));
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(<Probe enabled onState={(s) => (last = s)} createEstimator={() => fakeEstimator()} />);
    await act(flush);
    expect(last?.status).toBe("error");
    expect(last?.error?.kind).toBe(kind);
  });

  it("meldet unsicheren Kontext, ohne die Kamera anzufragen", async () => {
    vi.stubGlobal("isSecureContext", false);
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(<Probe enabled onState={(s) => (last = s)} createEstimator={() => fakeEstimator()} />);
    await act(flush);
    expect(last?.error?.kind).toBe("insecure");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("gibt die Kamera frei, wenn das Modell nicht lädt", async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    const est = fakeEstimator();
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(<Probe enabled onState={(s) => (last = s)} createEstimator={() => est} />);
    await act(flush);
    await act(async () => {
      est.rejectInit();
      await flush();
    });
    expect(last?.error?.kind).toBe("model");
    expect(stop).toHaveBeenCalled();
    expect(est.closed).toBe(true);
  });

  it("liefert Frames an onFrame, ohne pro Frame zu rendern", async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    const lm = Array.from({ length: 33 }, () => [0.5, 0.5, 1] as Landmark);
    const est = fakeEstimator(lm, true);
    const onFrame = vi.fn();
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(
      <Probe enabled onFrame={onFrame} createEstimator={() => est} onState={(s) => (last = s)} />,
    );
    await act(flush);
    const before = renders;
    for (let i = 0; i < 60; i++) tick();
    expect(onFrame).toHaveBeenCalledTimes(60);
    expect(renders - before).toBeLessThanOrEqual(1);
    expect(last?.poseRef.current?.landmarks).toHaveLength(33);
    expect(last?.statsRef.current.delegate).toBe("GPU");
  });
});
