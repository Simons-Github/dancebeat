import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePoseTracking, type PoseTrackingOptions } from "@/hooks/usePoseTracking";
import type { PoseEstimator } from "@/lib/poseEstimator";
import type { Landmark } from "@/lib/types";

const flush = () => new Promise((r) => setTimeout(r, 0));

const getUserMedia = vi.fn();
let renders = 0;
let frameCallbacks: Array<() => void> = [];
let cancelled: number[] = [];

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  readyState: "live" | "ended";
  onended: (() => void) | null;
}
type FakeStream = MediaStream & { track: FakeTrack };

/** Every stream handed out, so a test can tell which camera was stopped. */
let streams: FakeStream[] = [];

function fakeStream(deviceId = "cam-1"): FakeStream {
  const track: FakeTrack & { getSettings: () => { deviceId: string } } = {
    stop: vi.fn(),
    readyState: "live",
    onended: null,
    getSettings: () => ({ deviceId }),
  };
  const stream = {
    track,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as FakeStream;
  streams.push(stream);
  return stream;
}

const stopped = (s: FakeStream | undefined) => (s?.track.stop.mock.calls.length ?? 0) > 0;
const activeStreams = () => streams.filter((s) => !stopped(s));

interface FakeEstimator extends PoseEstimator {
  closed: boolean;
  resolveInit: () => void;
  rejectInit: () => void;
}

function fakeEstimator(
  landmarks: Landmark[] | null = null,
  autoInit = false,
  delegate: "GPU" | "CPU" = "GPU",
): FakeEstimator {
  let resolve: (v: { delegate: "GPU" | "CPU" }) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const pending = new Promise<{ delegate: "GPU" | "CPU" }>((res, rej) => {
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
    resolveInit: () => resolve({ delegate }),
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
    streams = [];
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
    const late = fakeStream();
    resolveStream(late);
    await flush();
    expect(stopped(late)).toBe(true);
  });

  it("schließt einen Estimator, der erst nach dem Unmount fertig wird, und stoppt die Kamera", async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    const est = fakeEstimator();
    const { unmount } = render(<Probe enabled createEstimator={() => est} />);
    await flush();
    unmount();
    expect(activeStreams()).toHaveLength(0);
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
    expect(activeStreams()).toHaveLength(0);
    expect(est.closed).toBe(true);
    expect(cancelled.length).toBeGreaterThan(0);
  });

  it("stoppt die alte Kamera beim Kamerawechsel und startet die neue", async () => {
    const a = fakeStream("a");
    const b = fakeStream("b");
    getUserMedia.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
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
    expect(a.track.stop).toHaveBeenCalledTimes(1);
    expect(b.track.stop).not.toHaveBeenCalled();
    expect(estimators[0]?.closed).toBe(true);
    expect(estimators[1]?.closed).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("fällt bei veralteter Kamera-ID auf die Standardkamera zurück", async () => {
    getUserMedia
      .mockRejectedValueOnce(
        Object.assign(new DOMException("gone", "OverconstrainedError"), { constraint: "deviceId" }),
      )
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
    expect(activeStreams()).toHaveLength(0);
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

  it("hält unter StrictMode (doppelter Mount) genau einen aktiven Stream", async () => {
    getUserMedia.mockImplementation(async () => fakeStream());
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(
      <StrictMode>
        <Probe
          enabled
          onState={(s) => (last = s)}
          createEstimator={() => fakeEstimator(null, true)}
        />
      </StrictMode>,
    );
    await act(flush);
    expect(streams.length).toBeGreaterThanOrEqual(2);
    expect(activeStreams()).toHaveLength(1);
    expect(last?.status).toBe("ready");
  });

  it("verwirft den Stream einer alten Kamera, die nach der neuen ankommt", async () => {
    const resolvers: Record<string, (s: MediaStream) => void> = {};
    getUserMedia.mockImplementation(
      (c: { video: { deviceId?: { exact: string } } }) =>
        new Promise<MediaStream>((res) => {
          resolvers[c.video.deviceId?.exact ?? ""] = res;
        }),
    );
    const create = () => fakeEstimator(null, true);
    const { rerender } = render(<Probe enabled cameraId="a" createEstimator={create} />);
    rerender(<Probe enabled cameraId="b" createEstimator={create} />);
    const a = fakeStream("a");
    const b = fakeStream("b");
    // The newer request answers first, the stale one arrives afterwards.
    resolvers["b"]?.(b);
    await act(flush);
    resolvers["a"]?.(a);
    await act(flush);
    expect(stopped(a)).toBe(true);
    expect(stopped(b)).toBe(false);
    expect(activeStreams()).toEqual([b]);
  });

  it("startet nach einem Fehler über retryKey neu", async () => {
    getUserMedia
      .mockRejectedValueOnce(new DOMException("x", "NotAllowedError"))
      .mockResolvedValueOnce(fakeStream());
    let last: ReturnType<typeof usePoseTracking> | undefined;
    const create = () => fakeEstimator(null, true);
    const { rerender } = render(
      <Probe enabled retryKey={0} createEstimator={create} onState={(s) => (last = s)} />,
    );
    await act(flush);
    expect(last?.error?.kind).toBe("denied");
    rerender(<Probe enabled retryKey={1} createEstimator={create} onState={(s) => (last = s)} />);
    await act(flush);
    expect(last?.error).toBeNull();
    expect(last?.status).toBe("ready");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("fällt ohne requestVideoFrameCallback auf rAF zurück und überspringt gleiche Bilder", async () => {
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: undefined,
    });
    const rafs: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => rafs.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let time = 1;
    vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() => time);
    getUserMedia.mockResolvedValue(fakeStream());
    const est = fakeEstimator(null, true);
    render(<Probe enabled createEstimator={() => est} />);
    await act(flush);
    const frame = () => rafs.splice(0).forEach((cb) => cb());
    frame();
    expect(est.detect).toHaveBeenCalledTimes(1);
    frame(); // same picture
    expect(est.detect).toHaveBeenCalledTimes(1);
    time = 2;
    frame();
    expect(est.detect).toHaveBeenCalledTimes(2);
  });

  it("setzt srcObject nach dem Aufräumen auf null", async () => {
    const stream = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    let last: ReturnType<typeof usePoseTracking> | undefined;
    const { unmount } = render(
      <Probe
        enabled
        createEstimator={() => fakeEstimator(null, true)}
        onState={(s) => (last = s)}
      />,
    );
    await act(flush);
    const video = last?.videoRef.current;
    expect(video?.srcObject).toBe(stream);
    unmount();
    expect(video?.srcObject).toBeNull();
  });

  it("merkt sich den Zeitpunkt des letzten Frames", async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(
      <Probe
        enabled
        createEstimator={() => fakeEstimator(null, true)}
        onState={(s) => (last = s)}
      />,
    );
    await act(flush);
    expect(last?.lastFrameAtRef.current).toBe(0);
    tick();
    expect(last?.lastFrameAtRef.current).toBeGreaterThan(0);
  });

  describe("wenn detect wirft", () => {
    const throwing = (delegate: "GPU" | "CPU") => {
      const est = fakeEstimator(null, true, delegate);
      est.detect = vi.fn(() => {
        throw new Error("webgl lost");
      });
      return est;
    };
    const ticks = (n: number) => {
      for (let i = 0; i < n; i++) tick();
    };

    it("überspringt einzelne Fehler und zählt nur Fehler in Folge", async () => {
      getUserMedia.mockResolvedValue(fakeStream());
      let fail = true;
      const est = fakeEstimator(null, true);
      est.detect = vi.fn(() => {
        if (fail) throw new Error("x");
        return null;
      });
      const create = vi.fn(() => est);
      render(<Probe enabled createEstimator={create} />);
      await act(flush);
      ticks(9);
      fail = false;
      tick();
      fail = true;
      ticks(9);
      expect(create).toHaveBeenCalledTimes(1);
      expect(est.closed).toBe(false);
    });

    it("wechselt nach 10 Fehlern in Folge von GPU auf CPU", async () => {
      getUserMedia.mockResolvedValue(fakeStream());
      const gpu = throwing("GPU");
      const cpu = fakeEstimator(null, true, "CPU");
      const create = vi.fn((d?: "GPU" | "CPU") => (d === "CPU" ? cpu : gpu));
      let last: ReturnType<typeof usePoseTracking> | undefined;
      render(<Probe enabled createEstimator={create} onState={(s) => (last = s)} />);
      await act(flush);
      ticks(10);
      await act(flush);
      expect(gpu.closed).toBe(true);
      expect(create).toHaveBeenLastCalledWith("CPU");
      expect(last?.delegate).toBe("CPU");
      expect(last?.status).toBe("ready");
      tick();
      expect(cpu.detect).toHaveBeenCalled();
    });

    it("meldet den Modellfehler, wenn auch CPU nicht läuft, und gibt die Kamera frei", async () => {
      getUserMedia.mockResolvedValue(fakeStream());
      const create = vi.fn((d?: "GPU" | "CPU") => throwing(d === "CPU" ? "CPU" : "GPU"));
      let last: ReturnType<typeof usePoseTracking> | undefined;
      render(<Probe enabled createEstimator={create} onState={(s) => (last = s)} />);
      await act(flush);
      ticks(10);
      await act(flush);
      ticks(10);
      await act(flush);
      expect(last?.error?.kind).toBe("model");
      expect(activeStreams()).toHaveLength(0);
    });

    it("meldet den Modellfehler, wenn der CPU-Start scheitert", async () => {
      getUserMedia.mockResolvedValue(fakeStream());
      const cpu = fakeEstimator();
      const create = vi.fn((d?: "GPU" | "CPU") => (d === "CPU" ? cpu : throwing("GPU")));
      let last: ReturnType<typeof usePoseTracking> | undefined;
      render(<Probe enabled createEstimator={create} onState={(s) => (last = s)} />);
      await act(flush);
      ticks(10);
      await act(async () => {
        cpu.rejectInit();
        await flush();
      });
      expect(last?.error?.kind).toBe("model");
      expect(activeStreams()).toHaveLength(0);
    });
  });

  describe("Unterbrechung", () => {
    it("startet neu, wenn die Kamera-Spur endet", async () => {
      const first = fakeStream("a");
      getUserMedia.mockResolvedValueOnce(first).mockResolvedValue(fakeStream("a"));
      render(<Probe enabled createEstimator={() => fakeEstimator(null, true)} />);
      await act(flush);
      await act(async () => {
        first.track.onended?.();
        await flush();
      });
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(stopped(first)).toBe(true);
      expect(activeStreams()).toHaveLength(1);
    });

    it("gibt nach drei Neustarts auf und meldet einen Fehler", async () => {
      getUserMedia.mockImplementation(async () => fakeStream());
      let last: ReturnType<typeof usePoseTracking> | undefined;
      render(
        <Probe
          enabled
          createEstimator={() => fakeEstimator(null, true)}
          onState={(s) => (last = s)}
        />,
      );
      await act(flush);
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          streams.at(-1)?.track.onended?.();
          await flush();
        });
      }
      expect(getUserMedia).toHaveBeenCalledTimes(4);
      expect(last?.status).toBe("error");
      expect(activeStreams()).toHaveLength(0);
    });

    it("spielt das Video nach der Rückkehr in den Vordergrund wieder ab", async () => {
      getUserMedia.mockResolvedValue(fakeStream());
      render(<Probe enabled createEstimator={() => fakeEstimator(null, true)} />);
      await act(flush);
      const play = vi.mocked(HTMLMediaElement.prototype.play);
      play.mockClear();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(play).toHaveBeenCalledTimes(1);
    });

    it("entfernt die Handler beim Aufräumen", async () => {
      const stream = fakeStream();
      getUserMedia.mockResolvedValue(stream);
      const { unmount } = render(
        <Probe enabled createEstimator={() => fakeEstimator(null, true)} />,
      );
      await act(flush);
      expect(stream.track.onended).not.toBeNull();
      unmount();
      expect(stream.track.onended).toBeNull();
      const play = vi.mocked(HTMLMediaElement.prototype.play);
      play.mockClear();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(play).not.toHaveBeenCalled();
    });
  });

  it("meldet wenig Licht aus dem Kamerabild (Fake-Kontext mit festen Pixeln)", async () => {
    const dark = new Uint8ClampedArray(16 * 12 * 4).fill(20);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: dark }),
    } as unknown as CanvasRenderingContext2D);
    getUserMedia.mockResolvedValue(fakeStream());
    let last: ReturnType<typeof usePoseTracking> | undefined;
    render(
      <Probe
        enabled
        createEstimator={() => fakeEstimator(null, true)}
        onState={(s) => (last = s)}
      />,
    );
    await act(flush);
    expect(last?.lowLight).toBe(false);
    act(() => tick());
    expect(last?.lowLight).toBe(true);
  });
});
