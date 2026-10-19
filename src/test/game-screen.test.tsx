import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { RESULT_SAVE_TIMEOUT_MS } from "@/lib/game/results";
import { getLastResult, isAutoStartArmed, resetSessionForTests } from "@/lib/game/session";
import type { PoseEstimator } from "@/lib/poseEstimator";
import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

const library = vi.hoisted(() => ({ songs: [] as Song[] }));
vi.mock("@/hooks/useSongLibrary", () => ({
  useSongLibrary: () => ({ songs: library.songs, loading: false }),
}));
/** In-memory repository over library.songs (the game stores the best result through it). */
const repo = vi.hoisted(() => ({ failSave: false, hangSave: false, missing: false }));
vi.mock("@/lib/library/repository", () => ({
  songRepository: {
    get: async (id: string) => (repo.missing ? undefined : library.songs.find((s) => s.id === id)),
    save: async (song: Song) => {
      if (repo.failSave) throw new Error("Der Speicher ist voll.");
      if (repo.hangSave) await new Promise(() => {});
      library.songs = library.songs.map((s) => (s.id === song.id ? song : s));
      return song;
    },
  },
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
  external: null as null | (() => void),
  calls: [] as string[],
  opts: null as null | { container?: HTMLElement },
}));
vi.mock("@/lib/audio/sources", () => ({
  createSource: (_song: unknown, opts: { container?: HTMLElement } = {}) => {
    audio.created++;
    audio.opts = opts;
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
      onExternalStart: (cb: () => void) => (audio.external = cb),
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
    external: null,
    calls: [],
    opts: null,
  });
  scene.estimators = [];
  Object.assign(repo, { failSave: false, hangSave: false, missing: false });
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

  it("hält den Bildschirm wach und vibriert bei PERFECT", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release, addEventListener: () => {} }));
    const vibrate = vi.fn();
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), { wakeLock: { request }, vibrate }),
    );
    await renderAt(`/play/${SONG_ID}?sim=1`);
    expect(request).toHaveBeenCalledWith("screen");
    await advance(5000);
    for (let i = 0; i < 40; i++) await advance(100);
    // Four PERFECT moves, one buzz each.
    expect(vibrate).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalled();
  });

  it("gibt die Bildschirmsperre in der Pause frei", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release, addEventListener: () => {} }));
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { wakeLock: { request } }));
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5100);
    expect(release).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(10);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("Perfekter simulierter Spieler: alle Moves PERFECT, Ende führt zum Ergebnis", async () => {
    library.songs = library.songs.map((s) => ({ ...s, stars: 0 }));
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5000);
    for (let i = 0; i < 40; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    const r = getLastResult(SONG_ID)!;
    expect(r.counts.PERFECT).toBe(4);
    expect(r.maxCombo).toBe(4);
    expect(screen.getByTestId("result-score")).toHaveTextContent("4.000");
    // 4 × PERFECT = 4000 of 8000 reference points (ratio 0.5 → 3 stars), beats the stored 1234.
    expect(r.stars).toBe(3);
    expect(r.newHighscore).toBe(true);
    expect(library.songs[0]).toMatchObject({ highscore: 4000, stars: 3 });
    expect(screen.getByTestId("new-highscore")).toBeInTheDocument();
  });

  it("Speicherfehler beim Highscore: Ergebnis erscheint trotzdem", async () => {
    repo.failSave = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5000);
    for (let i = 0; i < 40; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    expect(getLastResult(SONG_ID)?.newHighscore).toBe(false);
    expect(library.songs[0]?.highscore).toBe(1234);
    expect(warn).toHaveBeenCalled();
    expect(screen.getByTestId("result-score")).toHaveTextContent("4.000");
    expect(screen.queryByTestId("new-highscore")).toBeNull();
  });

  it("Song nicht in der Bibliothek gespeichert: Ergebnis ohne Highscore", async () => {
    repo.missing = true;
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5000);
    for (let i = 0; i < 40; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    expect(getLastResult(SONG_ID)?.newHighscore).toBe(false);
    expect(screen.getByTestId("result-score")).toHaveTextContent("4.000");
    expect(library.songs[0]?.highscore).toBe(1234);
  });

  it("Speichern hängt: nach dem Timeout erscheint das Ergebnis trotzdem", async () => {
    repo.hangSave = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5000);
    for (let i = 0; i < 40; i++) await advance(100);
    expect(phase()).toBe("ended");
    expect(path()).toBe(`/play/${SONG_ID}`);
    await advance(RESULT_SAVE_TIMEOUT_MS);
    expect(path()).toBe(`/result/${SONG_ID}`);
    expect(getLastResult(SONG_ID)?.newHighscore).toBe(false);
    expect(screen.getByTestId("result-score")).toHaveTextContent("4.000");
    expect(warn).toHaveBeenCalled();
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

/** Synthetic `devicemotion` event (jsdom has no DeviceMotionEvent). */
function shake(magnitude: number) {
  const e = Object.assign(new Event("devicemotion"), {
    acceleration: { x: magnitude, y: 0, z: 0 },
    accelerationIncludingGravity: { x: magnitude, y: 9.81, z: 0 },
  });
  act(() => void window.dispatchEvent(e));
}

describe("Spielscreen im Bewegungsmodus", () => {
  function stubCamera() {
    const getUserMedia = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(navigator, "mediaDevices", original);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    });
    return getUserMedia;
  }

  it("startet ohne Kamera; Bewegung im Takt ergibt Urteile statt X", async () => {
    const getUserMedia = stubCamera();
    localStorage.setItem("dancebeat.settings", JSON.stringify({ cameraId: "cam-1" }));
    const { container } = await renderAt(`/play/${SONG_ID}?mode=motion`);
    expect(phase()).toBe("countdown");
    expect(screen.getByText("Bewegungsmodus")).toBeInTheDocument();
    // Shaking during the countdown must not count (the clock stands still there).
    shake(30);
    await advance(5000);
    expect(phase()).toBe("playing");
    for (let i = 0; i < 200 && phase() === "playing"; i++) {
      shake(7);
      await advance(20);
    }
    expect(path()).toBe(`/result/${SONG_ID}`);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(container.querySelector("video")).toBeNull();
    expect(scene.estimators).toHaveLength(0);
    const r = getLastResult(SONG_ID)!;
    expect(r.counts.X).toBe(0);
    expect(r.counts.PERFECT).toBeGreaterThan(0);
  });

  it("ohne Sensordaten: Hinweis statt Kamera-Hinweis, alle Moves X", async () => {
    stubCamera();
    await renderAt(`/play/${SONG_ID}?mode=motion`);
    await advance(5000);
    await advance(2700);
    expect(screen.getByText(/Keine Bewegung erkannt/)).toBeInTheDocument();
    expect(screen.queryByText(/Wir sehen dich nicht/)).toBeNull();
    for (let i = 0; i < 20; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    expect(getLastResult(SONG_ID)!.counts.X).toBe(4);
  });

  it("Pause mitten im Move-Fenster: Messungen davor zählen nach „Weiter“ weiter", async () => {
    stubCamera();
    await renderAt(`/play/${SONG_ID}?mode=motion`);
    await advance(5000);
    expect(phase()).toBe("playing");
    // Move 2 at 500 ms, window 250–750 ms: two measurements before the pause, two after.
    await advance(400);
    shake(7);
    await advance(20);
    shake(7);
    await advance(20);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await advance(10);
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await advance(3000);
    expect(phase()).toBe("playing");
    shake(7);
    await advance(20);
    shake(7);
    for (let i = 0; i < 60 && phase() === "playing"; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    // Moves 1, 3 and 4 had no measurements; move 2 counts all four (alone it would be X).
    expect(getLastResult(SONG_ID)!.counts.X).toBe(3);
  });

  it("Neustart leert den Messpuffer", async () => {
    stubCamera();
    await renderAt(`/play/${SONG_ID}?mode=motion`);
    await advance(5000);
    for (let i = 0; i < 10; i++) {
      shake(7);
      await advance(20);
    }
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Neustart" }));
    await advance(5000);
    expect(phase()).toBe("playing");
    for (let i = 0; i < 60 && phase() === "playing"; i++) await advance(100);
    expect(path()).toBe(`/result/${SONG_ID}`);
    expect(getLastResult(SONG_ID)!.counts.X).toBe(4);
  });

  it("Pausenmenü ohne Skelett-Schalter, „Weiter“ spielt weiter", async () => {
    stubCamera();
    await renderAt(`/play/${SONG_ID}?mode=motion`);
    await advance(5000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("dialog", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Skelett anzeigen")).toBeNull();
    expect(screen.getByLabelText("Beat-Puls am Rand")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await advance(3000);
    expect(phase()).toBe("playing");
  });
});

describe("Spielscreen mit YouTube-Quelle", () => {
  it("zeigt den Player-Container statt des Coach-Canvas und reicht ihn an die Quelle", async () => {
    const song = library.songs[0];
    if (!song) throw new Error("no song");
    library.songs = [{ ...song, source: { type: "youtube", videoId: "aaaaaaaaaaa" } }];
    await renderAt(`/play/${SONG_ID}?sim=1`);
    const host = screen.getByLabelText("YouTube-Video");
    expect(screen.queryByRole("img", { name: "Coach" })).toBeNull();
    expect(audio.opts?.container).toBe(host);
    await advance(5100);
    expect(phase()).toBe("playing");
  });

  it("blocked: Hinweis aufs Video, Host antippbar; Start im Video führt nach playing", async () => {
    const song = library.songs[0];
    if (!song) throw new Error("no song");
    library.songs = [{ ...song, source: { type: "youtube", videoId: "aaaaaaaaaaa" } }];
    audio.refuse = true;
    await renderAt(`/play/${SONG_ID}?sim=1`);
    const host = screen.getByLabelText("YouTube-Video");
    expect(host).toHaveClass("pointer-events-none");
    await advance(5100);
    expect(phase()).toBe("blocked");
    expect(screen.getByText("Falls nichts passiert, tippe direkt auf das Video.")).toBeVisible();
    expect(host).toHaveClass("pointer-events-auto", "z-40");
    expect(host).not.toHaveClass("pointer-events-none");

    // Tap inside the iframe: the page sees no click, only the source's signal.
    audio.refuse = false;
    audio.at = performance.now();
    audio.playing = true;
    act(() => audio.external?.());
    await advance(20);
    expect(phase()).toBe("playing");
    expect(screen.queryByText(/tippe direkt auf das Video/)).toBeNull();
    expect(host).toHaveClass("pointer-events-none", "z-20");
    expect(audio.calls.filter((c) => c === "play")).toHaveLength(1);
  });

  it("blocked ohne YouTube: kein Hinweis aufs Video", async () => {
    audio.refuse = true;
    await renderAt(`/play/${SONG_ID}?sim=1`);
    await advance(5100);
    expect(phase()).toBe("blocked");
    expect(screen.getByRole("button", { name: "Zum Starten tippen" })).toBeInTheDocument();
    expect(screen.queryByText(/tippe direkt auf das Video/)).toBeNull();
  });

  it("Lokale Songs behalten den Coach und bekommen keinen Container", async () => {
    await renderAt(`/play/${SONG_ID}?sim=1`);
    expect(screen.getByRole("img", { name: "Coach" })).toBeInTheDocument();
    expect(screen.queryByLabelText("YouTube-Video")).toBeNull();
    expect(audio.opts?.container).toBeUndefined();
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
