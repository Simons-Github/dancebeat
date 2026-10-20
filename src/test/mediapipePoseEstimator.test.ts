import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaPipeEstimator } from "@/lib/mediapipePoseEstimator";

const mp = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/mediapipe", () => ({ createPoseLandmarker: mp.create }));

function fakeLandmarker() {
  return {
    close: vi.fn(),
    detectForVideo: vi.fn(() => ({ landmarks: [[{ x: 0.1, y: 0.2, z: 0 }]] })),
  };
}

describe("MediaPipe-Estimator", () => {
  beforeEach(() => mp.create.mockReset());

  it("schließt einen Landmarker, der erst nach close() fertig wird (kein Leck)", async () => {
    const landmarker = fakeLandmarker();
    let resolve: (v: unknown) => void = () => {};
    mp.create.mockReturnValue(new Promise((r) => (resolve = r)));
    const est = createMediaPipeEstimator();
    const init = est.init();
    est.close();
    resolve({ landmarker, delegate: "GPU" });
    await expect(init).rejects.toThrow(/closed/);
    expect(landmarker.close).toHaveBeenCalledTimes(1);
  });

  it("gibt den Delegate weiter und liefert Landmarks mit Sichtbarkeit 1 als Standard", async () => {
    const landmarker = fakeLandmarker();
    mp.create.mockResolvedValue({ landmarker, delegate: "CPU" });
    const est = createMediaPipeEstimator("lite", "CPU");
    expect(await est.init()).toEqual({ delegate: "CPU" });
    expect(mp.create).toHaveBeenCalledWith(expect.objectContaining({ delegate: "CPU" }));
    expect(est.detect(document.createElement("video"), 5)).toEqual([[0.1, 0.2, 1]]);
    est.close();
    expect(landmarker.close).toHaveBeenCalledTimes(1);
  });

  it("erkennt mit numPoses mehrere Personen, detect bleibt die erste", async () => {
    const landmarker = {
      close: vi.fn(),
      detectForVideo: vi.fn(() => ({
        landmarks: [[{ x: 0.1, y: 0.2, z: 0 }], [{ x: 0.7, y: 0.3, z: 0, visibility: 0.4 }]],
      })),
    };
    mp.create.mockResolvedValue({ landmarker, delegate: "GPU" });
    const est = createMediaPipeEstimator("lite", undefined, 3);
    await est.init();
    expect(mp.create).toHaveBeenCalledWith(expect.objectContaining({ numPoses: 3 }));
    const video = document.createElement("video");
    expect(est.detectAll?.(video, 1)).toEqual([[[0.1, 0.2, 1]], [[0.7, 0.3, 0.4]]]);
    expect(est.detect(video, 2)).toEqual([[0.1, 0.2, 1]]);
    landmarker.detectForVideo.mockReturnValue({ landmarks: [] });
    expect(est.detectAll?.(video, 3)).toEqual([]);
    est.close();
    expect(est.detectAll?.(video, 4)).toEqual([]);
  });

  it("nutzt für das Live-Spiel eine Person", async () => {
    mp.create.mockResolvedValue({ landmarker: fakeLandmarker(), delegate: "GPU" });
    await createMediaPipeEstimator().init();
    expect(mp.create).toHaveBeenCalledWith(expect.objectContaining({ numPoses: 1 }));
  });

  it("fragt ohne Vorgabe keinen bestimmten Delegate an", async () => {
    mp.create.mockResolvedValue({ landmarker: fakeLandmarker(), delegate: "GPU" });
    await createMediaPipeEstimator().init();
    expect(mp.create.mock.calls[0]?.[0]).not.toHaveProperty("delegate");
  });
});
