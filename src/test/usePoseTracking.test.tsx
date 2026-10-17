import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn();
let resolveLandmarker: (v: unknown) => void = () => {};
vi.mock("@/lib/mediapipe", () => ({
  createPoseLandmarker: () =>
    new Promise((res) => {
      resolveLandmarker = res;
    }),
}));

import { usePoseTracking } from "@/hooks/usePoseTracking";

function Probe({ enabled }: { enabled: boolean }) {
  const { videoRef } = usePoseTracking({ enabled });
  return <video ref={videoRef} />;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("usePoseTracking: Aufräumen bei späten Ergebnissen", () => {
  const stop = vi.fn();
  let resolveStream: (s: MediaStream) => void = () => {};

  beforeEach(() => {
    stop.mockClear();
    close.mockClear();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((res) => {
            resolveStream = res;
          }),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    // jsdom has no canvas backend; the light check just gets skipped.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  const fakeStream = () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream;

  it("stoppt einen Stream, der erst nach dem Unmount ankommt", async () => {
    const { unmount } = render(<Probe enabled />);
    unmount();
    resolveStream(fakeStream());
    await flush();
    expect(stop).toHaveBeenCalled();
  });

  it("schließt einen Landmarker, der erst nach dem Unmount fertig wird, und stoppt die Kamera", async () => {
    const { unmount } = render(<Probe enabled />);
    resolveStream(fakeStream());
    await flush();
    unmount();
    expect(stop).toHaveBeenCalled();
    resolveLandmarker({ close, detectForVideo: vi.fn() });
    await flush();
    expect(close).toHaveBeenCalled();
  });
});
