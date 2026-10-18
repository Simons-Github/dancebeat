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

  it("fragt ohne Vorgabe keinen bestimmten Delegate an", async () => {
    mp.create.mockResolvedValue({ landmarker: fakeLandmarker(), delegate: "GPU" });
    await createMediaPipeEstimator().init();
    expect(mp.create.mock.calls[0]?.[0]).not.toHaveProperty("delegate");
  });
});
