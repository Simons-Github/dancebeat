import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorageFullError } from "@/lib/library/storage";
import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

const library = vi.hoisted(() => ({
  songs: [] as Song[],
  updateDetails:
    vi.fn<
      (s: Song, patch: { title: string; artist?: string; startOffsetMs?: number }) => Promise<void>
    >(),
  regenerateChoreo: vi.fn<(s: Song, difficulty: 1 | 2 | 3) => Promise<Song>>(),
}));
vi.mock("@/hooks/useSongLibrary", () => ({
  useSongLibrary: () => ({
    songs: library.songs,
    loading: false,
    save: vi.fn(),
    remove: vi.fn(),
    updateDetails: library.updateDetails,
    regenerateChoreo: library.regenerateChoreo,
    setVideo: vi.fn(),
    musicIsVideo: () => Promise.resolve(false),
    exportChoreo: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const CONFIRM = "Choreografie von „Pink Pulse“ neu erzeugen?";
const FAILED = "Neu erzeugen hat nicht geklappt. Versuch es noch einmal.";

function song(difficulty: 1 | 2 | 3 = 1): Song {
  return { ...makeSong({ ...makeChoreo(), title: "Pink Pulse" }), title: "Pink Pulse", difficulty };
}

/** The song as the hook would return it after regenerating: new choreography, new difficulty. */
function regenerated(s: Song, difficulty: 1 | 2 | 3): Song {
  const choreo = makeChoreo([
    { la: 10, ra: 170 },
    { la: 170, ra: 10 },
    { la: 45, ra: 45 },
  ]);
  return { ...s, difficulty, choreo: { ...choreo, id: s.choreo.id, updatedAt: 999 } };
}

async function openEditor(s: Song = song()) {
  library.songs = [s];
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "Song bearbeiten" }));
  const dialog = await screen.findByRole("dialog", { name: "Song bearbeiten" });
  return { song: s, dialog };
}

async function openConfirm(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Choreografie neu erzeugen" }));
  return screen.findByRole("alertdialog", { name: CONFIRM });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  library.songs = [];
  library.updateDetails.mockReset();
  library.regenerateChoreo.mockReset();
});

describe("Regenerate choreography in the edit dialog", () => {
  it("offers three difficulties, preset to the song's", async () => {
    const { dialog } = await openEditor(song(2));
    const select = within(dialog).getByRole("combobox", { name: "Schwierigkeit" });
    expect(select).toHaveValue("2");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["1 – Leicht", "2 – Mittel", "3 – Schwer"]);
  });

  it("presets the difficulty again when the dialog reopens", async () => {
    const { dialog } = await openEditor(song(3));
    const select = within(dialog).getByRole("combobox", { name: "Schwierigkeit" });
    expect(select).toHaveValue("3");
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Song bearbeiten" }));
    const again = await screen.findByRole("dialog", { name: "Song bearbeiten" });
    expect(within(again).getByRole("combobox", { name: "Schwierigkeit" })).toHaveValue("3");
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const { dialog } = await openEditor();
    const confirm = await openConfirm(dialog);
    fireEvent.click(within(confirm).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(library.regenerateChoreo).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Song bearbeiten" })).toBeInTheDocument();
  });

  it("regenerates with the chosen difficulty and keeps the edit dialog open", async () => {
    const s = song(1);
    library.regenerateChoreo.mockImplementation((x, d) => Promise.resolve(regenerated(x, d)));
    const { dialog } = await openEditor(s);
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Schwierigkeit" }), {
      target: { value: "3" },
    });
    const confirm = await openConfirm(dialog);
    fireEvent.click(within(confirm).getByRole("button", { name: "Neu erzeugen" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(library.regenerateChoreo).toHaveBeenCalledTimes(1);
    expect(library.regenerateChoreo).toHaveBeenCalledWith(s, 3);
    const edit = screen.getByRole("dialog", { name: "Song bearbeiten" });
    expect(within(edit).getByRole("status")).toHaveTextContent("Neue Choreografie gespeichert.");
  });

  it("saves the details on top of the regenerated song, not the old snapshot", async () => {
    const s = song(1);
    const fresh = regenerated(s, 2);
    library.regenerateChoreo.mockResolvedValue(fresh);
    library.updateDetails.mockResolvedValue();
    const { dialog } = await openEditor(s);
    const confirm = await openConfirm(dialog);
    fireEvent.click(within(confirm).getByRole("button", { name: "Neu erzeugen" }));
    await within(dialog).findByText("Neue Choreografie gespeichert.");

    fireEvent.change(within(dialog).getByLabelText("Titel"), { target: { value: "Neu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(library.updateDetails).toHaveBeenCalledTimes(1));
    const [saved, patch] = library.updateDetails.mock.calls[0]!;
    expect(saved).toBe(fresh);
    expect(saved.choreo).not.toBe(s.choreo);
    expect(patch).toEqual({ title: "Neu", artist: s.artist, startOffsetMs: 0 });
  });

  it("shows an error inside the confirmation when regenerating fails", async () => {
    library.regenerateChoreo.mockRejectedValueOnce(new Error("boom"));
    const { dialog } = await openEditor();
    const confirm = await openConfirm(dialog);
    fireEvent.click(within(confirm).getByRole("button", { name: "Neu erzeugen" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(FAILED);
    expect(screen.getByRole("alertdialog", { name: CONFIRM })).toBeInTheDocument();
    expect(within(dialog).queryByText("Neue Choreografie gespeichert.")).not.toBeInTheDocument();
  });

  it("shows the storage-full message of a StorageFullError", async () => {
    const err = new StorageFullError();
    library.regenerateChoreo.mockRejectedValueOnce(err);
    const { dialog } = await openEditor();
    const confirm = await openConfirm(dialog);
    fireEvent.click(within(confirm).getByRole("button", { name: "Neu erzeugen" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(err.message);
  });

  it("can retry after a failure", async () => {
    const s = song();
    library.regenerateChoreo
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce((x, d) => Promise.resolve(regenerated(x, d)));
    const { dialog } = await openEditor(s);
    const confirm = await openConfirm(dialog);
    fireEvent.click(within(confirm).getByRole("button", { name: "Neu erzeugen" }));
    await within(confirm).findByRole("alert");
    fireEvent.click(within(confirm).getByRole("button", { name: "Neu erzeugen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(library.regenerateChoreo).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Neue Choreografie gespeichert.");
  });
});
