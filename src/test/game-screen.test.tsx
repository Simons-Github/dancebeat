import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { getLastResult, isAutoStartArmed, resetSessionForTests } from "@/lib/game/session";
import type { PoseEstimator } from "@/lib/poseEstimator";
import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

const library = vi.hoisted(() => ({ songs: [] as Song[] }));
vi.mock("@/hooks/useSongLibrary", () => ({
  useSongLibrary: () => ({ songs: library.songs, loading: false }),
}));

/** Fake audio: time runs (on the fake clock) only while playing. */
const audio = vi.hoisted(() => ({
  created: 0,
  playing: false,
  base: 0,
  at: 0,
  refuse: false,
  loadFails: false,
  ended: null as null | (() => void),
  failed: null as null | ((message: string) => void),
  calls: [] as string[],
}));
vi.mock("@/lib/audio/sources", () => ({
  createSource: () => {
    audio.created++;
    const now = () => performance.now();
    const time = () => (audio.playing ? audio.base + (now() - audio.at) : audio.base);
    return {
      type: "local",
      lowPrecision: false,
      load: async () => {
        audio.calls.push("load");
        if (audio.loadFails) throw new Error("Die Audiodatei konnte nicht dekodiert werden.");
      },
      play: async () => {
        audio.calls.push("play");
        if (audio.refuse) throw new DOMException("gesture", "NotAllowedError");
        audio.base = time();
        audio.at = now();
        audio.playing = true;
      },
      pause: () => {
        audio.calls.push("pause");
        audio.base = time();
        audio.playing = false;
      },
      seek: (ms: number) => {
        audio.calls.push(`seek:${ms}`);
        audio.base = ms;
        audio.at = now();
      },
      getTimeMs: time,
      setVolume: () => {},
      onEnded: (cb: () => void) => (audio.ended = cb),
      onError: (cb: (message: string) => void) => (audio.failed = cb),
      destroy: () => audio.calls.push("destroy"),
    };
  },
}));

const scene = vi.hoisted(() => ({ estimators: [] as { closed: boolean }[] }));
vi.mock("@/lib/mediapipePoseEstimator", () => ({
  createMediaPipeEstimator: (): PoseEstimator => {
    const e = { closed: false };
    scene.estimators.push(e);
    return {
      name: "Fake",
      init: async () => ({ delegate: "GPU" }),
      detect: () => null,
      close: () => void (e.closed = true),
    };
  },
}));

const SONG_ID = "song-1";
let router: ReturnType<typeof createRouter>;

async function renderAt(path: string) {
  router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    await router.load();
  });
  const view = render(<RouterProvider router={router} />);
  await advance(0);
  return view;
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const phase = () => screen.queryByTestId("phase")?.textContent;
const path = () => router.state.location.pathname;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "Date",
    ],
  });
  // Four moves at 0, 500, 1000, 1500 ms.
  const choreo = makeChoreo([
    { la: 90, ra: 90 },
    { la: 170, ra: 170 },
    { la: 20, ra: 160 },
    { la: 90, ra: 90, le: 90, re: 90 },
  ]);
  library.songs = [{ ...makeSong(choreo), id: SONG_ID, title: "Pink Pulse" }];
  Object.assign(audio, {
    created: 0,
    playing: false,
    base: 0,
    at: 0,
    refuse: false,
    loadFails: false,
    ended: null,
    failed: null,
    calls: [],
  });
  scene.estimators = [];
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSessionForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Spielscreen (Simulationsmodus)", () => {
  it("startet automatisch mit Vorlauf und Countdown, dann läuft die Musik ab dem Start-Offset", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    expect(phase()).toBe("countdown");
    expect(screen.getByText("Bereit machen!")).toBeInTheDocument();
    expect(audio.calls).toContain("seek:0");
    await advance(2000);
    expect(screen.getByRole("timer")).toHaveTextContent("3");
    await advance(2000);
    expect(screen.getByRole("timer")).toHaveTextContent("1");
    expect(audio.playing).toBe(false);
    await advance(1000);
    expect(phase()).toBe("playing");
    expect(audio.playing).toBe(true);
    expect(screen.getByText(/SIMULATION/)).toBeInTheDocument();
  });

  it("Abbrechen im Countdown führt zur Aufstellhilfe und setzt den Auto-Start aus", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(2500);
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await advance(10);
    expect(path()).toBe(`/setup/${SONG_ID}`);
    expect(isAutoStartArmed(SONG_ID)).toBe(false);
    expect(audio.playing).toBe(false);
  });

  it("pausiert bei visibilitychange und spielt nach „Weiter“ mit Countdown weiter", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5100);
    expect(phase()).toBe("playing");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(phase()).toBe("paused");
    expect(audio.playing).toBe(false);
    expect(screen.getByText(/im Hintergrund/)).toBeInTheDocument();
    const t = audio.base;
    await advance(3000);
    expect(audio.base).toBe(t);
    visibility.mockReturnValue("visible");
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await advance(3000);
    expect(phase()).toBe("playing");
    expect(audio.base).toBeGreaterThanOrEqual(t);
  });

  it("Pause-Knopf öffnet das Menü; Beenden führt zur Bibliothek", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5100);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("dialog", { name: "Pause" })).toBeInTheDocument();
    expect(audio.playing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Beenden" }));
    await advance(10);
    expect(path()).toBe("/");
  });

  it("Perfekter simulierter Spieler: alle Moves PERFECT, Ende führt zum Ergebnis", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5000);
    for (let i = 0; i < 40; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    const r = getLastResult(SONG_ID)!;
    expect(r.counts.PERFECT).toBe(4);
    expect(r.maxCombo).toBe(4);
    expect(screen.getByTestId("result-score")).toHaveTextContent("4.000");
  });

  it("öffnet keine Kamera: kein getUserMedia, kein Video, keine Pose-Erkennung", async () => {
    const getUserMedia = vi.fn();
    const enumerateDevices = vi.fn(async () => []);
    vi.stubGlobal("isSecureContext", true);
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia, enumerateDevices },
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(navigator, "mediaDevices", original);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    });
    // A saved camera must not tempt the simulation into opening it either.
    localStorage.setItem("dancebeat.settings", JSON.stringify({ cameraId: "cam-1" }));
    const { container } = await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5000);
    for (let i = 0; i < 40; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(enumerateDevices).not.toHaveBeenCalled();
    expect(container.querySelector("video")).toBeNull();
    expect(scene.estimators).toHaveLength(0);
    // The result comes from the choreography's own angles only.
    expect(getLastResult(SONG_ID)!.counts.PERFECT).toBe(4);
  });

  it("Totalausfall im Simulationsmodus: Hinweis statt stiller X", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1&miss=1`);
    await advance(5000);
    await advance(2700);
    expect(screen.getByText(/Wir sehen dich nicht/)).toBeInTheDocument();
  });

  it("verweigertes play(): „Zum Starten tippen“ startet die Musik in der Geste", async () => {
    audio.refuse = true;
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5100);
    expect(phase()).toBe("blocked");
    audio.refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Zum Starten tippen" }));
    await advance(20);
    expect(phase()).toBe("playing");
  });

  it("Audio nicht ladbar: Meldung und Weg zurück", async () => {
    audio.loadFails = true;
    await renderAt(`/play/${SONG_ID}?sim=1`);
    expect(screen.getByText("Die Musik konnte nicht geladen werden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Bibliothek" })).toBeInTheDocument();
  });

  it("Musik bricht im Spiel ab: Spiel stoppt, Meldung und Weg zurück", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5100);
    expect(phase()).toBe("playing");
    act(() => audio.failed?.("Die Verbindung zur Musik ist abgebrochen."));
    await advance(20);
    expect(phase()).toBe("preparing");
    expect(audio.playing).toBe(false);
    expect(screen.getByText("Die Musik ist abgebrochen")).toBeInTheDocument();
    expect(screen.getByText("Die Verbindung zur Musik ist abgebrochen.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Bibliothek" })).toBeInTheDocument();
  });

  it("räumt beim Verlassen Audio, Schleife und Timer auf", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5100);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    cleanup();
    expect(audio.calls).toContain("destroy");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Spielscreen mit (Fake-)Kamera", () => {
  let tracks: {
    stop: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
    readyState: string;
  }[];

  beforeEach(() => {
    tracks = [];
    vi.stubGlobal("isSecureContext", true);
    const getUserMedia = vi.fn(async () => {
      const track = {
        stop: vi.fn(),
        onended: null,
        readyState: "live",
        getSettings: () => ({ deviceId: "cam" }),
      };
      tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  });

  it("wartet auf die Kamera, verliert sie → Pause, beim Verlassen ist alles freigegeben", async () => {
    await renderAt(`/play/${SONG_ID}`);
    await advance(10);
    expect(tracks).toHaveLength(1);
    expect(phase()).toBe("countdown");
    await advance(5100);
    expect(phase()).toBe("playing");
    // Track ended (call, other app): the hook restarts the camera, the game pauses.
    await act(async () => tracks[0]!.onended?.());
    await advance(10);
    expect(phase()).toBe("paused");
    expect(screen.getByText(/Kamera wurde unterbrochen/)).toBeInTheDocument();
    expect(audio.playing).toBe(false);
    cleanup();
    expect(tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
    expect(scene.estimators.every((e) => e.closed)).toBe(true);
    expect(audio.calls).toContain("destroy");
  });
});
