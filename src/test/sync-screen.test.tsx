import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { SYNC_DISCARD_TAPS, SYNC_MIN_TAPS } from "@/lib/sync";
import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeSong } from "./fixtures";

/** In-memory repository; the real useSongLibrary runs on top of it. */
const repo = vi.hoisted(() => ({ songs: [] as Song[], saved: [] as Song[] }));
vi.mock("@/lib/library/repository", () => ({
  songRepository: {
    list: async () => repo.songs,
    get: async (id: string) => repo.songs.find((s) => s.id === id),
    save: async (song: Song) => {
      repo.saved.push(song);
      repo.songs = repo.songs.map((s) => (s.id === song.id ? song : s));
      return song;
    },
    delete: async () => {},
    export: async () => "{}",
    getAudio: async () => undefined,
  },
}));
vi.mock("@/data/demo", () => ({ seedDemos: async () => {}, markDemoDeleted: () => {} }));

/** Fake audio: time runs (on the fake clock) only while playing. */
const audio = vi.hoisted(() => ({
  playing: false,
  base: 0,
  at: 0,
  loadFails: false,
  created: 0,
  calls: [] as string[],
}));
vi.mock("@/lib/audio/sources", () => ({
  isLowPrecision: (song: Song) => song.source.type === "youtube" || song.source.type === "spotify",
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
        audio.base = time();
        audio.at = now();
        audio.playing = true;
      },
      pause: () => {
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
      onEnded: () => {},
      onError: () => {},
      onExternalStart: () => {},
      destroy: () => void audio.calls.push("destroy"),
    };
  },
}));

const SONG_ID = "6f1c1b7e-2f7a-4c1e-9a55-0c2b8d1e4f10";
let router: ReturnType<typeof createRouter>;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function renderAt(path: string) {
  router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    await router.load();
  });
  render(<RouterProvider router={router} />);
  await advance(0);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });
  repo.songs = [{ ...makeSong(), id: SONG_ID, title: "Pink Pulse", startOffsetMs: 1000 }];
  repo.saved = [];
  Object.assign(audio, { playing: false, base: 0, at: 0, loadFails: false, created: 0, calls: [] });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("Sync-Test", () => {
  it("Taps im Takt ergeben einen Vorschlag, Speichern schreibt syncOffsetMs", async () => {
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("heading", { name: "Sync-Test" })).toBeInTheDocument();
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("0 ms");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    const pad = screen.getByRole("button", { name: "Im Takt tippen" });
    // Before the start taps do not count.
    fireEvent.pointerDown(pad);
    expect(screen.getByTestId("tap-count")).toHaveTextContent("0 Taps");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // seek and play() run synchronously inside the tap (user gesture), before any await.
    expect(audio.calls.slice(-2)).toEqual(["seek:1000", "play"]);
    await advance(0);

    // 120 BPM (500 ms), the player taps 40 ms after each beat (audio 1000 is on the grid).
    await advance(40);
    for (let i = 0; i < SYNC_MIN_TAPS + SYNC_DISCARD_TAPS; i++) {
      if (i % 2) fireEvent.keyDown(window, { key: " ", code: "Space" });
      else fireEvent.pointerDown(pad);
      await advance(500);
    }
    expect(screen.getByTestId("proposed-offset")).toHaveTextContent("+40 ms");
    expect(screen.queryByText(/Ungleichmäßig/)).not.toBeInTheDocument();

    // The proposal only becomes the working value; nothing is written yet.
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Vorschlag übernehmen/ }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+40 ms");
    expect(screen.getByRole("button", { name: /Vorschlag übernehmen/ })).toBeDisabled();
    expect(repo.saved).toHaveLength(0);

    fireEvent.click(save);
    await advance(10);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]?.syncOffsetMs).toBe(40);
    expect(router.state.location.pathname).toBe("/");
    expect(audio.calls).toContain("destroy");
  });

  it("Nochmal verwirft die Taps, Auf 0 zurücksetzen speichert 0", async () => {
    repo.songs = repo.songs.map((s) => ({ ...s, syncOffsetMs: 55 }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("+55 ms");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const pad = screen.getByRole("button", { name: "Im Takt tippen" });
    fireEvent.pointerDown(pad);
    fireEvent.pointerDown(pad);
    expect(screen.getByTestId("tap-count")).toHaveTextContent("2 Taps");
    fireEvent.click(screen.getByRole("button", { name: /Nochmal/ }));
    expect(screen.getByTestId("tap-count")).toHaveTextContent("0 Taps");

    fireEvent.click(screen.getByRole("button", { name: "Auf 0 zurücksetzen" }));
    await advance(10);
    expect(repo.saved.at(-1)?.syncOffsetMs).toBe(0);
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("0 ms");
  });

  it("Auf 0 zurücksetzen schreibt nicht, wenn 0 schon gespeichert ist", async () => {
    await renderAt(`/sync/${SONG_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+10 ms");
    fireEvent.click(screen.getByRole("button", { name: "Auf 0 zurücksetzen" }));
    await advance(10);
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("0 ms");
    expect(repo.saved).toHaveLength(0);
  });

  it("Feinjustierung ändert den Arbeitswert, Speichern schreibt ihn", async () => {
    repo.songs = repo.songs.map((s) => ({ ...s, syncOffsetMs: 995 }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+995 ms");
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms verringern" }));
    fireEvent.click(screen.getByRole("button", { name: "Offset um 1 ms verringern" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+984 ms");
    expect(save).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Offset um 1 ms erhöhen" }));
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+995 ms");
    expect(save).toBeDisabled();
    // Clamped at +1000 ms.
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+1000 ms");
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("+995 ms");
    expect(repo.saved).toHaveLength(0);

    fireEvent.click(save);
    await advance(10);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]?.syncOffsetMs).toBe(1000);
    expect(router.state.location.pathname).toBe("/");
  });

  it("Beat-Licht folgt der Uhr mit dem Arbeitswert, ohne React-Render pro Frame", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    onTestFinished(() => void vi.unstubAllGlobals());
    // 120 BPM, start offset 1000 ms: audio 1000 is on a beat; latency and offsets are 0.
    await renderAt(`/sync/${SONG_ID}`);
    const light = screen.getByTestId("beat-light");
    const candidate = screen.getByTestId("candidate-offset");
    expect(light.style.opacity).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const runFrame = () => {
      const cb = frames.shift();
      expect(cb).toBeDefined();
      cb?.(performance.now());
    };
    runFrame();
    expect(Number(light.style.opacity)).toBe(1);
    expect(light.style.transform).toBe("scale(1.12)");

    const before = candidate.textContent;
    await advance(300); // well past the fade
    runFrame();
    expect(Number(light.style.opacity)).toBe(0);
    // Frames do not re-render: the rendered value node is the same and the loop keeps going.
    expect(screen.getByTestId("candidate-offset")).toBe(candidate);
    expect(candidate.textContent).toBe(before);
    expect(frames).toHaveLength(1);

    // +10 ms candidate: audio 1300 → game 1290, still dark; at audio 1510 the light is on.
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    await advance(210);
    runFrame();
    expect(Number(light.style.opacity)).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Stopp" }));
    expect(light.style.opacity).toBe("0");
  });

  it("warnt bei YouTube vor ungenauer Zeitmessung und nennt den Abruf", async () => {
    repo.songs = repo.songs.map((s) => ({
      ...s,
      source: { type: "youtube", videoId: "dQw4w9WgXcQ" },
    }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("note")).toHaveTextContent(/YouTube ist die Zeitmessung ungenauer/);
    expect(screen.getByText(/youtube-nocookie\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/Kamerabilder/)).not.toBeInTheDocument();
  });

  it("unbekannter Song zeigt „Song nicht gefunden“", async () => {
    await renderAt("/sync/00000000-0000-4000-8000-000000000000");
    expect(screen.getByRole("heading", { name: "Song nicht gefunden" })).toBeInTheDocument();
  });

  it("Stopp pausiert die Musik; danach zählen Taps nicht mehr", async () => {
    await renderAt(`/sync/${SONG_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const pad = screen.getByRole("button", { name: "Im Takt tippen" });
    fireEvent.pointerDown(pad);
    fireEvent.click(screen.getByRole("button", { name: "Stopp" }));
    expect(audio.playing).toBe(false);
    fireEvent.pointerDown(pad);
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(screen.getByTestId("tap-count")).toHaveTextContent("1 Taps");
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("zeigt einen Ladefehler und lässt keinen Start zu", async () => {
    audio.loadFails = true;
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Die Musik konnte nicht geladen werden\. Die Audiodatei konnte nicht dekodiert werden/,
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("nennt bei URL-Songs den Host der Audio-URL", async () => {
    repo.songs = repo.songs.map((s) => ({
      ...s,
      source: { type: "url", url: "https://music.example.org/song.mp3" },
    }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByText(/von music\.example\.org geladen/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("Spotify: kein Audio, Hinweis auf Etappe 10", async () => {
    repo.songs = repo.songs.map((s) => ({
      ...s,
      source: { type: "spotify", trackUri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" },
    }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sync-Test für Spotify folgt mit Etappe 10.",
    );
    expect(audio.created).toBe(0);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
});
