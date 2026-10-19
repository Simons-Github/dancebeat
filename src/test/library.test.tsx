import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import type { Song } from "@/lib/types";
import { StorageFullError } from "@/lib/library/storage";
import { resetSettingsCacheForTests } from "@/lib/settings";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

const library = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    songs: [] as Song[],
    loading: false,
    remove: vi.fn<(s: Song) => Promise<void>>(),
    updateDetails:
      vi.fn<
        (
          s: Song,
          patch: { title: string; artist?: string; startOffsetMs?: number },
        ) => Promise<void>
      >(),
    exportChoreo: vi.fn<(s: Song) => Promise<string>>(),
    listeners,
    /** Replaces the songs and re-renders every mounted library, like a refresh would. */
    setSongs(songs: Song[]) {
      this.songs = songs;
      listeners.forEach((l) => l());
    },
  };
});
vi.mock("@/hooks/useSongLibrary", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (l: () => void) => {
    library.listeners.add(l);
    return () => library.listeners.delete(l);
  };
  return {
    useSongLibrary: () => ({
      songs: useSyncExternalStore(subscribe, () => library.songs),
      loading: library.loading,
      save: vi.fn(),
      remove: library.remove,
      updateDetails: library.updateDetails,
      exportChoreo: library.exportChoreo,
      refresh: vi.fn(),
    }),
  };
});

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
  library.remove.mockReset();
  library.updateDetails.mockReset();
  library.exportChoreo.mockReset();
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
    resetSettingsCacheForTests(); // storage was edited behind the settings module's back
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

  it("opens the add-song dialog", async () => {
    await renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Song hinzufügen" }));
    expect(await screen.findByRole("dialog", { name: "Song hinzufügen" })).toBeInTheDocument();
  });
});

describe("Edit song dialog", () => {
  async function openEditor() {
    const song = demoSong("Pink Pulse", 112, 1, "#FF2E93", "#00E5FF");
    library.songs = [song, demoSong("Sunset Kick", 124, 2, "#FF8A00", "#7CFF4F")];
    await renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Song bearbeiten" }));
    const dialog = await screen.findByRole("dialog", { name: "Song bearbeiten" });
    return { song, dialog };
  }

  it("has no edit button without songs", async () => {
    await renderAt("/");
    await screen.findByText("Noch keine Songs");
    expect(screen.queryByRole("button", { name: "Song bearbeiten" })).not.toBeInTheDocument();
  });

  it("renames the selected song", async () => {
    library.updateDetails.mockResolvedValue();
    const { song, dialog } = await openEditor();
    const title = within(dialog).getByLabelText("Titel");
    const artist = within(dialog).getByLabelText("Künstler");
    expect(title).toHaveValue("Pink Pulse");
    expect(artist).toHaveValue("DanceBeat Demo");

    fireEvent.change(title, { target: { value: "  Pinker Puls " } });
    fireEvent.change(artist, { target: { value: "Ich" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Song bearbeiten" })).not.toBeInTheDocument(),
    );
    expect(library.updateDetails).toHaveBeenCalledWith(song, {
      title: "Pinker Puls",
      artist: "Ich",
      startOffsetMs: 0,
    });
  });

  it("saves the start offset together with title and artist", async () => {
    library.updateDetails.mockResolvedValue();
    const { song, dialog } = await openEditor();
    const start = within(dialog).getByLabelText("Start ab (Sekunden)");
    expect(start).toHaveValue("0");
    expect(start).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(start, { target: { value: " 12,5 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Song bearbeiten" })).not.toBeInTheDocument(),
    );
    expect(library.updateDetails).toHaveBeenCalledWith(song, {
      title: "Pink Pulse",
      artist: "DanceBeat Demo",
      startOffsetMs: 12500,
    });
  });

  it("disables Speichern for an invalid start offset", async () => {
    const { dialog } = await openEditor();
    const start = within(dialog).getByLabelText("Start ab (Sekunden)");
    const save = within(dialog).getByRole("button", { name: "Speichern" });
    fireEvent.change(start, { target: { value: "abc" } });
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(save).toBeDisabled();
    expect(within(dialog).getByText(/zwischen 0 und 600 Sekunden/)).toBeInTheDocument();
    fireEvent.change(start, { target: { value: "601" } });
    expect(save).toBeDisabled();
    fireEvent.change(start, { target: { value: "600" } });
    expect(save).toBeEnabled();
  });

  it("disables Speichern for an empty title", async () => {
    const { dialog } = await openEditor();
    const save = within(dialog).getByRole("button", { name: "Speichern" });
    expect(save).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText("Titel"), { target: { value: "   " } });
    expect(save).toBeDisabled();
  });

  it("shows a rename error and stays open", async () => {
    library.updateDetails.mockRejectedValueOnce(new StorageFullError());
    const { dialog } = await openEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Der Speicher ist voll");
    expect(screen.getByRole("dialog", { name: "Song bearbeiten" })).toBeInTheDocument();

    library.updateDetails.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Speichern hat nicht geklappt",
    );
  });

  it("deletes only after confirmation", async () => {
    library.remove.mockResolvedValue();
    const { song, dialog } = await openEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "Song löschen" }));
    const confirm = await screen.findByRole("alertdialog", { name: "„Pink Pulse“ löschen?" });
    expect(confirm).toHaveTextContent("Highscore und Audio werden entfernt");

    fireEvent.click(within(confirm).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(library.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Song löschen" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Löschen" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(library.remove).toHaveBeenCalledWith(song);
  });

  it("selects the next song after a delete and shows the empty state after the last", async () => {
    library.remove.mockImplementation((s) => {
      library.setSongs(library.songs.filter((x) => x.id !== s.id));
      return Promise.resolve();
    });
    const deleteSelected = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Song bearbeiten" }));
      const dialog = await screen.findByRole("dialog", { name: "Song bearbeiten" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Song löschen" }));
      const confirm = await screen.findByRole("alertdialog");
      fireEvent.click(within(confirm).getByRole("button", { name: "Löschen" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    };
    const song = demoSong("Pink Pulse", 112, 1, "#FF2E93", "#00E5FF");
    library.songs = [song, demoSong("Sunset Kick", 124, 2, "#FF8A00", "#7CFF4F")];
    await renderAt("/");

    await deleteSelected();
    expect(library.remove).toHaveBeenLastCalledWith(song);
    const banner = screen.getByRole("region", { name: "Ausgewählter Song" });
    expect(within(banner).getByText("Sunset Kick")).toBeInTheDocument();
    const start = screen.getByRole("link", { name: "Los geht's" });
    expect(start).toHaveAttribute("href", `/setup/${library.songs[0]?.id ?? ""}`);
    await waitFor(() => expect(start).toHaveFocus());

    await deleteSelected();
    expect(await screen.findByText("Noch keine Songs")).toBeInTheDocument();
    expect(within(banner).getByText("Kein Song gewählt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Song bearbeiten" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Song hinzufügen" })).toHaveFocus(),
    );
  });

  it("shows a delete error inside the confirmation", async () => {
    library.remove.mockRejectedValueOnce(new Error("boom"));
    const { dialog } = await openEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "Song löschen" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Löschen" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(
      "Löschen hat nicht geklappt",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("Other routes", () => {
  it("reports an unknown song on the play route", async () => {
    await renderAt("/play/abc");
    expect(await screen.findByText("Song nicht gefunden")).toBeInTheDocument();
  });

  it("shows the settings screen", async () => {
    await renderAt("/settings");
    expect(await screen.findByRole("heading", { name: "Spiel" })).toBeInTheDocument();
  });

  it("shows the German 404 page for unknown paths", async () => {
    await renderAt("/gibt-es-nicht");
    expect(await screen.findByText("Seite nicht gefunden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Startseite" })).toHaveAttribute("href", "/");
  });

  it("exports the choreography as a .dancebeat.json download", async () => {
    const song = demoSong("Pink Pulse!", 112, 1, "#FF2E93", "#00E5FF");
    library.songs = [song];
    library.exportChoreo.mockResolvedValue('{"a":1}');
    // Capture the deferred revoke instead of faking all timers (the router needs real ones).
    const realSetTimeout = globalThis.setTimeout;
    const deferred: (() => void)[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 1000) {
        deferred.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);
    const createUrl = vi.fn(() => "blob:test");
    const revokeUrl = vi.fn();
    // jsdom has no object URLs: install stubs and restore the originals afterwards.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    onTestFinished(() => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      vi.mocked(globalThis.setTimeout).mockRestore();
    });
    let downloadName = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    await renderAt("/");

    fireEvent.click(await screen.findByRole("button", { name: "Song bearbeiten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choreografie exportieren" }));

    await vi.waitFor(() => expect(downloadName).toBe("pink-pulse.dancebeat.json"));
    expect(library.exportChoreo).toHaveBeenCalledWith(song);
    expect(revokeUrl).not.toHaveBeenCalled(); // deferred for Safari
    deferred.forEach((fn) => fn()); // includes unrelated 1 s timers (e.g. waitFor)
    expect(revokeUrl).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
  });

  it("shows an error when the export fails", async () => {
    library.songs = [demoSong("Pink Pulse", 112, 1, "#FF2E93", "#00E5FF")];
    library.exportChoreo.mockRejectedValue(new Error("x"));
    await renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Song bearbeiten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choreografie exportieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Choreografie konnte nicht exportiert werden.",
    );
  });
});
