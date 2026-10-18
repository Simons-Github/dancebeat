import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

const library = vi.hoisted(() => ({ songs: [] as Song[], loading: false }));
vi.mock("@/hooks/useSongLibrary", () => ({
  useSongLibrary: () => ({
    songs: library.songs,
    loading: library.loading,
    save: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function demoSong(
  title: string,
  bpm: number,
  difficulty: 1 | 2 | 3,
  accent: string,
  second: string,
) {
  const choreo = { ...makeChoreo(), title, bpm, accentColor: accent, secondaryColor: second };
  return {
    ...makeSong(choreo),
    title,
    artist: "DanceBeat Demo",
    bpm,
    difficulty,
    stars: 0,
    highscore: 0,
  };
}

async function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  library.songs = [];
  library.loading = false;
});

describe("Song library", () => {
  it("renders both demo songs with their details", async () => {
    library.songs = [
      demoSong("Pink Pulse", 112, 1, "#FF2E93", "#00E5FF"),
      demoSong("Sunset Kick", 124, 2, "#FF8A00", "#7CFF4F"),
    ];
    await renderAt("/");

    const list = await screen.findByRole("list", { name: "Songs" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(within(list).getByText("Pink Pulse")).toBeInTheDocument();
    expect(within(list).getByText("124 BPM")).toBeInTheDocument();
    expect(within(list).getByRole("img", { name: "Schwierigkeit 2 von 3" })).toBeInTheDocument();
    expect(within(list).getAllByRole("img", { name: "0 von 5 Sternen" })).toHaveLength(2);
  });

  it("shows the empty state without songs", async () => {
    await renderAt("/");
    expect(await screen.findByText("Noch keine Songs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Los geht's" })).toBeDisabled();
  });

  it("shows a loading state", async () => {
    library.loading = true;
    await renderAt("/");
    expect(await screen.findByRole("status", { name: "Songs werden geladen" })).toBeInTheDocument();
  });

  it("points the start button at the selected song", async () => {
    const a = demoSong("Pink Pulse", 112, 1, "#FF2E93", "#00E5FF");
    const b = demoSong("Sunset Kick", 124, 2, "#FF8A00", "#7CFF4F");
    library.songs = [a, b];
    await renderAt("/");

    const start = await screen.findByRole("link", { name: "Los geht's" });
    expect(start).toHaveAttribute("href", `/setup/${a.id}`);

    fireEvent.click(screen.getByRole("button", { name: /Sunset Kick/ }));
    expect(screen.getByRole("link", { name: "Los geht's" })).toHaveAttribute(
      "href",
      `/setup/${b.id}`,
    );
    expect(screen.getByRole("button", { name: /Sunset Kick/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("remembers the last selected song and falls back to the first", async () => {
    const a = demoSong("Pink Pulse", 112, 1, "#FF2E93", "#00E5FF");
    const b = demoSong("Sunset Kick", 124, 2, "#FF8A00", "#7CFF4F");
    library.songs = [a, b];
    await renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: /Sunset Kick/ }));
    cleanup();

    await renderAt("/");
    expect(await screen.findByRole("button", { name: /Sunset Kick/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    cleanup();

    localStorage.setItem("dancebeat.settings", JSON.stringify({ lastSongId: "gone" }));
    await renderAt("/");
    expect(await screen.findByRole("button", { name: /Pink Pulse/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("labels the highscore", async () => {
    library.songs = [{ ...demoSong("Pink Pulse", 112, 1, "#FF2E93", "#00E5FF"), highscore: 12345 }];
    await renderAt("/");
    expect(
      await screen.findByRole("img", { name: "Highscore: 12.345 Punkte" }),
    ).toBeInTheDocument();
  });

  it("opens the add-song dialog with the stage hint", async () => {
    await renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Song hinzufügen" }));
    expect(await screen.findByText("Folgt in Etappe 5")).toBeInTheDocument();
  });
});

describe("Other routes", () => {
  it("shows the setup placeholder with a back link", async () => {
    await renderAt("/setup/abc");
    expect(await screen.findByText("Aufstellhilfe folgt in Etappe 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zurück" })).toHaveAttribute("href", "/");
  });

  it("shows the settings placeholder", async () => {
    await renderAt("/settings");
    expect(await screen.findByText("Einstellungen folgen")).toBeInTheDocument();
  });

  it("shows the German 404 page for unknown paths", async () => {
    await renderAt("/gibt-es-nicht");
    expect(await screen.findByText("Seite nicht gefunden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Startseite" })).toHaveAttribute("href", "/");
  });
});
