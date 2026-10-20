import { QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { StorageFullError } from "@/lib/library/storage";
import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

/** In-memory repository; the real useSongLibrary runs on top of it. */
const repo = vi.hoisted(() => ({
  songs: [] as Song[],
  saved: [] as Song[],
  fail: null as Error | null,
}));
vi.mock("@/lib/library/repository", () => ({
  songRepository: {
    list: async () => repo.songs,
    get: async (id: string) => repo.songs.find((s) => s.id === id),
    save: async (song: Song) => {
      if (repo.fail) throw repo.fail;
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

/** Fake audio (same approach as sync-screen.test.tsx): time runs on the fake clock while playing. */
const audio = vi.hoisted(() => ({
  playing: false,
  base: 0,
  at: 0,
  playFails: false,
  /** Set: play() rejects with this real error (not a refusal). */
  playError: null as string | null,
  externalPause: null as null | (() => void),
  playGate: null as Promise<void> | null,
  rates: [] as number[],
  calls: [] as string[],
}));
vi.mock("@/lib/audio/sources", async () => {
  const { PlayRefusedError } = await import("@/lib/audio/errors");
  return {
    isLowPrecision: (song: Song) =>
      song.source.type === "youtube" || song.source.type === "spotify",
    createSource: (song: Song) => {
      audio.rates.push(song.playbackRate ?? 1);
      const now = () => performance.now();
      const time = () => (audio.playing ? audio.base + (now() - audio.at) : audio.base);
      return {
        type: song.source.type,
        lowPrecision: false,
        load: async () => void audio.calls.push("load"),
        play: async () => {
          audio.calls.push("play");
          if (audio.playFails) throw new PlayRefusedError();
          if (audio.playError) throw new Error(audio.playError);
          if (audio.playGate) await audio.playGate;
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
        onEnded: () => {},
        onError: () => {},
        onExternalStart: () => {},
        onExternalPause: (cb: () => void) => (audio.externalPause = cb),
        destroy: () => {
          audio.calls.push("destroy");
          audio.playing = false;
        },
      };
    },
  };
});
const ticks = vi.hoisted(() => ({ click: 0, gold: 0 }));
vi.mock("@/lib/sfx", () => ({
  sfx: {
    click: () => void ticks.click++,
    beep: (hi?: boolean) => void (hi ? ticks.gold++ : undefined),
    gold: () => {},
    perfect: () => {},
  },
  setSfxVolume: () => {},
  resumeSfx: () => {},
}));

const SONG_ID = "0b6f1d1e-6c1a-4b7e-9f1a-2d3c4b5a6e7f";
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
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Pink Pulse" });
}

const poses = (n: number) => Array.from({ length: n }, (_, i) => ({ la: (i * 37) % 180, ra: 90 }));
const timeline = () => screen.getByRole("list", { name: "Timeline" });
const cards = () => within(timeline()).getAllByRole("button");
const saveBtn = () => screen.getByRole("button", { name: "Speichern" });

function setSong(moves: number, extra: Partial<Song> = {}) {
  const choreo = { ...makeChoreo(poses(moves)), offsetMs: 1000 };
  repo.songs = [{ ...makeSong(choreo), id: SONG_ID, title: "Pink Pulse", ...extra }];
}

/** Frames every 500 ms from 0 to 4000 ms, moves only at 0, 2000 and 4000 ms (room to edit). */
function setSparseSong() {
  const base = makeChoreo(poses(9));
  const moves = [0, 2000, 4000].map((t) => ({ timeMs: t, label: "", iconId: "x", gold: false }));
  repo.songs = [
    { ...makeSong({ ...base, offsetMs: 1000, moves }), id: SONG_ID, title: "Pink Pulse" },
  ];
}
const timeGroup = () => screen.getByRole("group", { name: "Zeit" });
const insertBtn = () => screen.getByRole("button", { name: "Move danach einfügen" });

beforeEach(() => {
  setSong(3);
  repo.saved = [];
  repo.fail = null;
  Object.assign(audio, {
    playing: false,
    base: 0,
    at: 0,
    playFails: false,
    playError: null,
    externalPause: null,
    playGate: null,
    rates: [],
    calls: [],
  });
  Object.assign(ticks, { click: 0, gold: 0 });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Choreografie-Editor", () => {
  it("zeigt die Moves in Musikzeit, Auswahl per Tippen", async () => {
    await renderAt(`/edit/${SONG_ID}`);
    expect(cards().map((c) => c.getAttribute("aria-label"))).toEqual([
      "Move 1, 00:01,0",
      "Move 2, 00:01,5",
      "Move 3, 00:02,0",
    ]);
    expect(cards()[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cards()[2]!);
    expect(cards()[2]).toHaveAttribute("aria-pressed", "true");
    expect(cards()[0]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Move 3" })).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verwerfen" })).toBeDisabled();
  });

  it("Gold umschalten, Speichern schreibt den Song", async () => {
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(cards()[1]!);
    fireEvent.click(screen.getByRole("switch", { name: "Gold Move" }));
    expect(cards()[1]).toHaveAccessibleName("Move 2, 00:01,5, Gold Move");
    expect(saveBtn()).toBeEnabled();

    fireEvent.click(saveBtn());
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(repo.saved).toHaveLength(1);
    const saved = repo.saved[0]!;
    expect(saved.choreo.moves.map((m) => m.gold)).toEqual([false, true, false]);
    expect(saved.choreo.offsetMs).toBe(1000);
    expect(saved.choreo.updatedAt).toBeGreaterThan(1);
    expect("playbackRate" in saved).toBe(false);
  });

  it("Löschen bis MIN_MOVES, dann gesperrt mit Hinweis", async () => {
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(cards()[2]!);
    const del = screen.getByRole("button", { name: "Move löschen" });
    fireEvent.click(del);
    expect(cards()).toHaveLength(2);
    // Selection moves to the last remaining move.
    expect(cards()[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Move löschen" })).toBeDisabled();
    expect(screen.getByText("Mindestens 2 Moves müssen bleiben.")).toBeInTheDocument();
  });

  it("Move-Zeit verschieben ändert die Anzeige, Speichern schreibt die Zeiten", async () => {
    setSparseSong();
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(cards()[1]!);
    const time = screen.getByTestId("selected-time");
    expect(time).toHaveTextContent("00:03,0");
    fireEvent.click(within(timeGroup()).getByRole("button", { name: "Move um 1 Beat später" }));
    expect(time).toHaveTextContent("00:03,5");
    fireEvent.click(within(timeGroup()).getByRole("button", { name: "Move um ½ Beat früher" }));
    expect(time).toHaveTextContent("00:03,3");
    expect(cards()[1]).toHaveAccessibleName("Move 2, 00:03,3");
    expect(saveBtn()).toBeEnabled();

    fireEvent.click(saveBtn());
    await waitFor(() => expect(repo.saved).toHaveLength(1));
    expect(repo.saved[0]!.choreo.moves.map((m) => m.timeMs)).toEqual([0, 2250, 4000]);
  });

  it("Move einfügen: neuer Move auf dem Beat, Auswahl folgt, wird gespeichert", async () => {
    setSparseSong();
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(insertBtn());
    expect(cards()).toHaveLength(4);
    expect(cards()[1]).toHaveAttribute("aria-pressed", "true");
    expect(cards()[1]).toHaveAccessibleName("Move 2, 00:02,0");
    expect(screen.getByRole("heading", { name: "Move 2" })).toBeInTheDocument();
    expect(screen.getByTestId("selected-time")).toHaveTextContent("00:02,0");

    fireEvent.click(saveBtn());
    await waitFor(() => expect(repo.saved).toHaveLength(1));
    expect(repo.saved[0]!.choreo.moves.map((m) => m.timeMs)).toEqual([0, 1000, 2000, 4000]);
  });

  it("Zeit-Tasten und Einfügen gesperrt mit Hinweis, wenn kein Platz ist", async () => {
    // Moves 500 ms apart: ½ beat leaves 250 ms (< 300), frames end at the last move.
    await renderAt(`/edit/${SONG_ID}`);
    const hint = screen.getByText(/^Gesperrt, wenn der Abstand zum Nachbar-Move/);
    expect(timeGroup()).toHaveAttribute("aria-describedby", hint.id);
    const buttons = [...within(timeGroup()).getAllByRole("button"), insertBtn()];
    expect(buttons).toHaveLength(5);
    for (const b of buttons) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("aria-describedby", hint.id);
    }
    expect(saveBtn()).toBeDisabled();
  });

  it("am Rand: nur die erlaubten Richtungen sind aktiv", async () => {
    setSparseSong();
    await renderAt(`/edit/${SONG_ID}`);
    // First move at 0 ms: earlier is impossible, later is fine.
    const group = timeGroup();
    expect(within(group).getByRole("button", { name: "Move um 1 Beat früher" })).toBeDisabled();
    expect(within(group).getByRole("button", { name: "Move um ½ Beat früher" })).toBeDisabled();
    expect(within(group).getByRole("button", { name: "Move um 1 Beat später" })).toBeEnabled();
    expect(insertBtn()).toBeEnabled();
    expect(insertBtn()).not.toHaveAttribute("aria-describedby");
    // Last move at the end of the frames: nothing to insert after it.
    fireEvent.click(cards()[2]!);
    expect(insertBtn()).toBeDisabled();
    expect(within(group).getByRole("button", { name: "Move um 1 Beat früher" })).toBeEnabled();
  });

  it("Offset-Tasten und Tempo; Verwerfen setzt zurück", async () => {
    await renderAt(`/edit/${SONG_ID}`);
    const offset = screen.getByTestId("choreo-offset");
    expect(offset).toHaveTextContent("+1000 ms");
    fireEvent.click(screen.getByRole("button", { name: "Offset um 100 ms erhöhen" }));
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms verringern" }));
    expect(offset).toHaveTextContent("+1090 ms");
    // 120 BPM: one beat = 500 ms.
    fireEvent.click(screen.getByRole("button", { name: "Offset um 1 Beat verringern" }));
    expect(offset).toHaveTextContent("+590 ms");
    expect(cards()[0]).toHaveAccessibleName("Move 1, 00:00,6");

    const tempo = screen.getByRole("group", { name: "Tempo" });
    expect(within(tempo).getByRole("button", { name: "1×" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(tempo).getByRole("button", { name: "0,75×" }));
    expect(within(tempo).getByRole("button", { name: "0,75×" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Änderungen verwerfen?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Weiter bearbeiten" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(offset).toHaveTextContent("+590 ms");

    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwerfen" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(offset).toHaveTextContent("+1000 ms");
    expect(within(tempo).getByRole("button", { name: "1×" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(saveBtn()).toBeDisabled();
  });

  it("speichert Tempo und Offset; 1× entfernt playbackRate", async () => {
    setSong(3, { playbackRate: 1.25 });
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "1×" }));
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(repo.saved).toHaveLength(1));
    expect("playbackRate" in repo.saved[0]!).toBe(false);
    expect(repo.saved[0]!.choreo.offsetMs).toBe(1010);
  });

  it("Gold-Vorschlag übernimmt Gold Moves für die ganze Choreografie", async () => {
    setSong(16);
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Gold-Vorschlag übernehmen" }));
    expect(
      cards().filter((c) => /Gold Move/.test(c.getAttribute("aria-label") ?? "")),
    ).toHaveLength(2);
  });

  it("Spotify: Tempo gesperrt mit Hinweis, Wert sichtbar", async () => {
    setSong(3, {
      source: { type: "spotify", trackUri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" },
      playbackRate: 1.25,
    });
    await renderAt(`/edit/${SONG_ID}`);
    expect(screen.getByRole("note")).toHaveTextContent("Spotify spielt immer mit normalem Tempo.");
    const tempo = screen.getByRole("group", { name: "Tempo" });
    for (const b of within(tempo).getAllByRole("button")) expect(b).toBeDisabled();
    expect(within(tempo).getByRole("button", { name: "1,25×" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("zeigt Speicherfehler; YouTube: Tempo wählbar, kein Hinweis (N10)", async () => {
    setSong(3, { source: { type: "youtube", videoId: "dQw4w9WgXcQ" } });
    repo.fail = new Error("boom");
    await renderAt(`/edit/${SONG_ID}`);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("button", { name: "0,75×" })).toBeEnabled();
    fireEvent.click(screen.getByRole("switch", { name: "Gold Move" }));
    fireEvent.click(saveBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Speichern hat nicht geklappt");
    expect(saveBtn()).toBeEnabled();
    expect(router.state.location.pathname).toBe(`/edit/${SONG_ID}`);
    expect(repo.saved).toHaveLength(0);
  });

  it("zeigt die Meldung bei vollem Speicher", async () => {
    repo.fail = new StorageFullError();
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(screen.getByRole("switch", { name: "Gold Move" }));
    fireEvent.click(saveBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Der Speicher ist voll.");
  });

  it("Zurück mit ungespeicherten Änderungen fragt nach", async () => {
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(screen.getByRole("switch", { name: "Gold Move" }));
    fireEvent.click(screen.getByRole("link", { name: "Zurück" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Änderungen verwerfen?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Weiter bearbeiten" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`/edit/${SONG_ID}`);

    fireEvent.click(screen.getByRole("link", { name: "Zurück" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Verwerfen und verlassen",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(repo.saved).toHaveLength(0);
  });

  it("Browser-Zurück mit ungespeicherten Änderungen fragt nach", async () => {
    // Memory history does not block back/forward; only the browser history does (popstate).
    window.history.replaceState(null, "", "/");
    router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createBrowserHistory(),
    });
    await act(async () => {
      await router.load();
    });
    render(<RouterProvider router={router} />);
    await act(async () => {
      await router.navigate({ to: "/edit/$songId", params: { songId: SONG_ID } });
    });
    await screen.findByRole("heading", { name: "Pink Pulse" });
    fireEvent.click(screen.getByRole("switch", { name: "Gold Move" }));

    act(() => window.history.back());
    const dialog = await screen.findByRole("alertdialog", { name: "Änderungen verwerfen?" });
    expect(dialog).toHaveTextContent("Beim Verlassen gehen sie verloren.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Weiter bearbeiten" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`/edit/${SONG_ID}`);

    act(() => window.history.back());
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Verwerfen und verlassen",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(window.location.pathname).toBe("/");
  });

  it("Verwerfen hält die Auswahl gültig", async () => {
    await renderAt(`/edit/${SONG_ID}`);
    fireEvent.click(cards()[2]!);
    fireEvent.click(screen.getByRole("button", { name: "Move löschen" }));
    expect(cards()[1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwerfen" }),
    );
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(cards()[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Move 2" })).toBeInTheDocument();
  });

  it("Zurück ohne Änderungen ist ein direkter Link", async () => {
    await renderAt(`/edit/${SONG_ID}`);
    expect(screen.getByRole("link", { name: "Zurück" })).toHaveAttribute("href", "/");
  });

  it("unbekannter Song", async () => {
    router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({ initialEntries: ["/edit/unknown"] }),
    });
    await act(async () => {
      await router.load();
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Song nicht gefunden" })).toBeInTheDocument();
  });
});

describe("Vorschau im Editor", () => {
  const frames: FrameRequestCallback[] = [];
  /** Fake clock for performance.now (timers stay real so findBy* keeps working). */
  beforeEach(() => {
    frames.length = 0;
    vi.useFakeTimers({ toFake: ["performance"] });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    onTestFinished(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });
  });
  const flush = () => act(async () => {});
  const runFrame = () =>
    act(() => {
      const cb = frames.shift();
      expect(cb).toBeDefined();
      cb?.(performance.now());
    });
  /** Advances the fake clock in frame-sized steps, running one frame per step. */
  const play = (ms: number, step = 50) => {
    for (let t = 0; t < ms; t += step) {
      vi.advanceTimersByTime(step);
      runFrame();
    }
  };
  const preview = () => screen.getByRole("region", { name: "Vorschau" });
  const btn = (name: string | RegExp) => within(preview()).getByRole("button", { name });
  const current = () => cards().findIndex((c) => c.getAttribute("aria-current") === "true");

  async function loaded() {
    await renderAt(`/edit/${SONG_ID}`);
    await waitFor(() => expect(btn("Abspielen")).toBeEnabled());
  }

  it("Abspielen startet ab startOffsetMs, Stopp pausiert", async () => {
    setSong(3, { startOffsetMs: 300 });
    await loaded();
    expect(screen.getByTestId("preview-time")).toHaveTextContent("--:--,-");
    fireEvent.click(btn("Abspielen"));
    // seek and play() run synchronously in the tap (user gesture).
    expect(audio.calls.slice(-2)).toEqual(["seek:300", "play"]);
    await flush();
    expect(audio.playing).toBe(true);
    runFrame();
    // Music time = game time + offset: audio 300 → game −700 → 00:00,3.
    expect(screen.getByTestId("preview-time")).toHaveTextContent("00:00,3");
    fireEvent.click(btn("Stopp"));
    expect(audio.playing).toBe(false);
    expect(btn("Abspielen")).toBeEnabled();
    expect(current()).toBe(-1);
  });

  it("Ab Move N: zwei Beats vorher, Markierung und Klick folgen der Spielzeit", async () => {
    // Moves at 0, 500, 1000 ms, offset 1000 ms; move 3 is gold.
    setSong(3);
    repo.songs = repo.songs.map((s) => ({
      ...s,
      choreo: {
        ...s.choreo,
        moves: s.choreo.moves.map((m, i) => ({ ...m, gold: i === 2 })),
      },
    }));
    await loaded();
    fireEvent.click(cards()[2]!);
    fireEvent.click(btn("Ab Move 3 abspielen"));
    // Move 3 at game 1000 − 2 beats (1000 ms) = game 0 → audio 0 + offset 1000.
    expect(audio.calls.slice(-2)).toEqual(["seek:1000", "play"]);
    await flush();
    runFrame();
    expect(current()).toBe(0);
    // Move 1 sits exactly at the start position and still clicks.
    expect(ticks).toEqual({ click: 1, gold: 0 });
    expect(cards()[2]).toHaveAttribute("aria-pressed", "true");
    play(500);
    expect(current()).toBe(1);
    expect(ticks).toEqual({ click: 2, gold: 0 });
    play(500);
    expect(current()).toBe(2);
    expect(ticks).toEqual({ click: 2, gold: 1 });
    expect(screen.getByTestId("preview-time")).toHaveTextContent("00:02,0");
    // The loop keeps exactly one frame queued.
    expect(frames).toHaveLength(1);
  });

  it("Seek während der Wiedergabe und Klick aus: keine Klicks", async () => {
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    runFrame();
    play(400);
    expect(ticks.click).toBe(0);
    // Jump back to two beats before move 3 while playing: seek only, no new play().
    fireEvent.click(cards()[2]!);
    fireEvent.click(btn("Ab Move 3 abspielen"));
    expect(audio.calls.slice(-1)).toEqual(["seek:1000"]);
    fireEvent.click(screen.getByRole("switch", { name: "Klick bei jedem Move" }));
    play(1100);
    expect(ticks.click).toBe(0);
    expect(current()).toBe(2);
  });

  it("Klick auf der Musik, Markierung mit Verzögerung und Sync-Offset", async () => {
    localStorage.setItem("dancebeat.settings", JSON.stringify({ latencyMs: 100 }));
    setSong(3, { syncOffsetMs: 100 });
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    runFrame();
    // Audio 1000: tick time 0 (move 1 clicks), game time −200 (not marked yet).
    play(1000);
    expect(ticks.click).toBe(1);
    expect(current()).toBe(-1);
    // Without the latency it would be marked from audio 1100 on.
    play(150);
    expect(current()).toBe(-1);
    play(50);
    expect(current()).toBe(0);
    expect(ticks.click).toBe(1);
  });

  it("Offset-Änderung beim Abspielen: übersprungene Moves klicken nicht", async () => {
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    runFrame();
    // Audio 950 → tick time −50, just before move 1 (0 ms).
    play(950);
    expect(ticks.click).toBe(0);
    // Offset −100 ms: tick time jumps to +50 and skips move 1 silently.
    fireEvent.click(screen.getByRole("button", { name: "Offset um 100 ms verringern" }));
    play(400);
    expect(ticks.click).toBe(0);
    expect(current()).toBe(0);
    // Move 2 (500 ms) is reached normally.
    play(100);
    expect(ticks.click).toBe(1);
  });

  it("Klick ab Start: Move genau an startOffsetMs klickt", async () => {
    setSong(3, { startOffsetMs: 1000 });
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    runFrame();
    expect(ticks.click).toBe(1);
  });

  it("Offset-Änderung wirkt sofort, ohne Neustart", async () => {
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    runFrame();
    // Audio 0 → game −1000: before the first move.
    expect(current()).toBe(-1);
    // Offset −1 Beat (500 ms): audio 0 → game −500; after 500 ms move 1 is due.
    fireEvent.click(screen.getByRole("button", { name: "Offset um 1 Beat verringern" }));
    play(500);
    expect(current()).toBe(0);
    expect(audio.calls.filter((c) => c === "play")).toHaveLength(1);
    expect(audio.rates).toEqual([1]);
  });

  it("Tempo-Wechsel stoppt und baut die Quelle mit neuem Tempo neu", async () => {
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    runFrame();
    expect(btn("Stopp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "0,75×" }));
    expect(audio.calls).toContain("destroy");
    expect(audio.rates).toEqual([1, 0.75]);
    await waitFor(() => expect(btn("Abspielen")).toBeEnabled());
    expect(current()).toBe(-1);
  });

  it("Klick-Schalter bleibt beim Tempo-Wechsel erhalten", async () => {
    await loaded();
    const sw = () => screen.getByRole("switch", { name: "Klick bei jedem Move" });
    expect(sw()).toBeChecked();
    fireEvent.click(sw());
    fireEvent.click(screen.getByRole("button", { name: "1,25×" }));
    expect(audio.rates).toEqual([1, 1.25]);
    expect(sw()).not.toBeChecked();
  });

  it("Seite verborgen stoppt die Wiedergabe", async () => {
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    onTestFinished(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(audio.playing).toBe(false);
    expect(btn("Abspielen")).toBeInTheDocument();
  });

  it("Pause direkt im YouTube-Player stoppt die Vorschau", async () => {
    setSong(3, { source: { type: "youtube", videoId: "dQw4w9WgXcQ" } });
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    expect(btn("Stopp")).toBeInTheDocument();
    // Tap on the video pauses YouTube itself; the source reports it.
    audio.playing = false;
    act(() => audio.externalPause?.());
    expect(btn("Abspielen")).toBeEnabled();
    expect(current()).toBe(-1);
  });

  it("echter Startfehler zeigt die Meldung statt „Tippe noch einmal“", async () => {
    audio.playError = "Die Audiodatei konnte nicht dekodiert werden.";
    await loaded();
    fireEvent.click(btn("Abspielen"));
    const alert = await within(preview()).findByRole("alert");
    expect(alert).toHaveTextContent("Die Audiodatei konnte nicht dekodiert werden.");
    expect(alert).not.toHaveTextContent("Tippe");
  });

  it("Verlassen zerstört die Quelle", async () => {
    await loaded();
    fireEvent.click(btn("Abspielen"));
    await flush();
    cleanup();
    expect(audio.calls).toContain("destroy");
  });

  it("YouTube: blockierter Start zeigt den Hinweis, Abruf wird genannt", async () => {
    setSong(3, { source: { type: "youtube", videoId: "dQw4w9WgXcQ" } });
    audio.playFails = true;
    await loaded();
    expect(within(preview()).getByLabelText("YouTube-Video")).toBeInTheDocument();
    expect(within(preview()).getByText(/youtube-nocookie\.com/)).toBeInTheDocument();
    fireEvent.click(btn("Abspielen"));
    expect(await within(preview()).findByRole("alert")).toHaveTextContent(
      "Der Start wurde blockiert. Tippe direkt auf das Video.",
    );
    expect(btn("Abspielen")).toBeEnabled();

    // Second try waits (play() pending): Stopp is offered and the hint stays visible.
    let release: () => void = () => {};
    audio.playFails = false;
    audio.playGate = new Promise<void>((r) => (release = r));
    fireEvent.click(btn("Abspielen"));
    await flush();
    expect(btn("Stopp")).toBeInTheDocument();
    expect(within(preview()).getByRole("alert")).toHaveTextContent("Tippe direkt auf das Video.");
    fireEvent.click(btn("Stopp"));
    expect(btn("Abspielen")).toBeEnabled();
    // The late play() of the stopped start is paused again.
    release();
    await flush();
    expect(audio.playing).toBe(false);
    expect(btn("Abspielen")).toBeInTheDocument();
  });

  it("URL: nennt den Host", async () => {
    setSong(3, { source: { type: "url", url: "https://music.example.org/song.mp3" } });
    await loaded();
    expect(within(preview()).getByText(/von music\.example\.org geladen/)).toBeInTheDocument();
  });

  it("Spotify: gesperrt mit Hinweis, keine Quelle", async () => {
    setSong(3, { source: { type: "spotify", trackUri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" } });
    await renderAt(`/edit/${SONG_ID}`);
    expect(
      within(preview()).getByText("Abspielen mit Spotify folgt mit Etappe 10."),
    ).toBeInTheDocument();
    expect(btn("Abspielen")).toBeDisabled();
    expect(btn("Ab Move 1 abspielen")).toBeDisabled();
    expect(audio.rates).toEqual([]);
  });
});
