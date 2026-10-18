import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disarmAutoStart, resetSessionForTests } from "@/lib/game/session";
import type { PoseEstimator } from "@/lib/poseEstimator";
import type { Landmark, Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

const library = vi.hoisted(() => ({ songs: [] as Song[] }));
vi.mock("@/hooks/useSongLibrary", () => ({
  useSongLibrary: () => ({ songs: library.songs, loading: false }),
}));

// The game route mounts after an auto-start; it must not load real audio.
vi.mock("@/lib/audio/sources", () => ({
  createSource: () => ({
    type: "local",
    lowPrecision: false,
    load: () => new Promise(() => {}),
    play: async () => {},
    pause: () => {},
    seek: () => {},
    getTimeMs: () => 0,
    setVolume: () => {},
    onEnded: () => {},
    destroy: () => {},
  }),
}));

// What the fake model "sees"; tests change it between frames.
const scene = vi.hoisted(() => ({ landmarks: null as unknown as Landmark[] | null }));
vi.mock("@/lib/mediapipePoseEstimator", () => ({
  createMediaPipeEstimator: (): PoseEstimator => ({
    name: "Fake",
    init: async () => ({ delegate: "GPU" }),
    detect: () => scene.landmarks,
    close: () => {},
  }),
}));

function standing(): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  const at: Array<[number, number, number]> = [
    [11, 0.55, 0.25],
    [12, 0.45, 0.25],
    [23, 0.53, 0.5],
    [24, 0.47, 0.5],
    [25, 0.53, 0.7],
    [26, 0.47, 0.7],
    [27, 0.53, 0.9],
    [28, 0.47, 0.9],
  ];
  for (const [i, x, y] of at) lm[i] = [x, y, 0.95];
  return lm;
}

let frameCallbacks: Array<() => void> = [];

/** One camera frame every `stepMs`, for `ms` in total, on the fake clock. */
async function runFrames(ms: number, stepMs = 33) {
  for (let t = 0; t < ms; t += stepMs) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(stepMs);
      const cbs = frameCallbacks;
      frameCallbacks = [];
      cbs.forEach((cb) => cb());
    });
  }
}
const idle = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const goButton = () => screen.getByRole("button", { name: "Los geht's" });

async function startSetup() {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/setup/song-1"] }),
  });
  await act(async () => {
    await router.load();
  });
  render(<RouterProvider router={router} />);
  await idle(0);
  fireEvent.click(screen.getByRole("button", { name: "Kamera starten" }));
  await idle(10);
  return router;
}

describe("Aufstellhilfe: Einrasten und Heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // These tests look at the unlock itself; auto-start would leave the screen.
    disarmAutoStart("song-1");
    const song = { ...makeSong({ ...makeChoreo(), title: "Pink Pulse" }), title: "Pink Pulse" };
    library.songs = [{ ...song, id: "song-1" }];
    scene.landmarks = standing();
    frameCallbacks = [];
    vi.stubGlobal("isSecureContext", true);
    const track = { stop: vi.fn(), getSettings: () => ({ deviceId: "cam" }), onended: null };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
        enumerateDevices: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: (cb: () => void) => frameCallbacks.push(cb),
    });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
      configurable: true,
      value: () => {},
    });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    resetSessionForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Auto-Start: wechselt nach dem Einrasten von selbst ins Spiel", async () => {
    resetSessionForTests(); // armed
    const router = await startSetup();
    expect(screen.getByText("Sobald alles passt, geht es von selbst los.")).toBeInTheDocument();
    await runFrames(500);
    expect(router.state.location.pathname).toBe("/setup/song-1");
    await runFrames(700);
    expect(router.state.location.pathname).toBe("/play/song-1");
  });

  it("nach Abbruch kein Auto-Start, „Los geht's“ startet und schaltet ihn wieder ein", async () => {
    const router = await startSetup();
    expect(screen.getByText(/Automatischer Start ist aus/)).toBeInTheDocument();
    await runFrames(1500);
    expect(router.state.location.pathname).toBe("/setup/song-1");
    fireEvent.click(goButton());
    await idle(10);
    expect(router.state.location.pathname).toBe("/play/song-1");
  });

  it("schaltet erst nach einer Sekunde im Bild frei", async () => {
    await startSetup();
    await runFrames(500);
    expect(goButton()).toBeDisabled();
    await runFrames(700);
    expect(goButton()).toBeEnabled();
    // The hint follows after the display has been stable for a moment.
    await runFrames(400);
    expect(screen.getByText("Alles bereit. Los geht's!")).toBeInTheDocument();
  });

  it("bleibt freigeschaltet, wenn der Körper das Bild verlässt", async () => {
    await startSetup();
    await runFrames(1500);
    expect(goButton()).toBeEnabled();
    scene.landmarks = null; // walks to the phone
    await runFrames(2000);
    expect(goButton()).toBeEnabled();
  });

  it("setzt die Anzeige zurück, wenn keine Frames mehr kommen, die Freigabe bleibt", async () => {
    await startSetup();
    await runFrames(1500);
    expect(screen.getByText("Alles bereit. Los geht's!")).toBeInTheDocument();
    // Tab in the background / locked screen: no more frames.
    await idle(1000);
    expect(screen.queryByText("Alles bereit. Los geht's!")).not.toBeInTheDocument();
    expect(screen.getByText("Stell dich vor die Kamera.")).toBeInTheDocument();
    expect(goButton()).toBeEnabled();
  });

  it("zeigt kurz nach dem Ausfall noch den letzten Stand (Heartbeat erst nach 500 ms)", async () => {
    await startSetup();
    await runFrames(1500);
    await idle(300);
    expect(screen.getByText("Alles bereit. Los geht's!")).toBeInTheDocument();
  });

  it("flackert nicht: ein kurzer Ausfall ändert weder Freigabe noch Hinweis", async () => {
    await startSetup();
    await runFrames(500);
    scene.landmarks = null;
    await runFrames(100);
    scene.landmarks = standing();
    await runFrames(700);
    expect(goButton()).toBeEnabled();
  });
});
