import { QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  setSong(3);
  repo.saved = [];
  repo.fail = null;
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

  it("YouTube und Spotify: Tempo gesperrt mit Hinweis, Wert sichtbar", async () => {
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

  it("zeigt Speicherfehler, YouTube-Hinweis zum Tempo", async () => {
    setSong(3, { source: { type: "youtube", videoId: "dQw4w9WgXcQ" } });
    repo.fail = new Error("boom");
    await renderAt(`/edit/${SONG_ID}`);
    expect(screen.getByRole("note")).toHaveTextContent("YouTube spielt immer mit normalem Tempo.");
    expect(screen.getByRole("button", { name: "0,75×" })).toBeDisabled();
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
