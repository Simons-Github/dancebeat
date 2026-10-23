import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VIDEO_BEAT_MAX_BYTES } from "@/components/add-song/VideoChoreoPanel";
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
  setVideo: vi.fn<(s: Song, video: Blob | undefined) => Promise<Song>>(),
  musicIsVideo: vi.fn<(s: Song) => Promise<boolean>>(),
}));
vi.mock("@/hooks/useSongLibrary", () => ({
  useSongLibrary: () => ({
    songs: library.songs,
    loading: false,
    save: vi.fn(),
    remove: vi.fn(),
    updateDetails: library.updateDetails,
    regenerateChoreo: vi.fn(),
    setVideo: library.setVideo,
    musicIsVideo: library.musicIsVideo,
    exportChoreo: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const REMOVE_CONFIRM = "Tanzvideo von „Pink Pulse“ entfernen?";

function song(extra: Partial<Song> = {}): Song {
  return { ...makeSong({ ...makeChoreo(), title: "Pink Pulse" }), title: "Pink Pulse", ...extra };
}

/** A file whose size is reported as given without allocating it. */
function videoFile(size = 1024 * 1024) {
  const f = new File(["v"], "dance.mp4", { type: "video/mp4" });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

async function openEditor(s: Song) {
  library.songs = [s];
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "Song bearbeiten" }));
  return screen.findByRole("dialog", { name: "Song bearbeiten" });
}

function chooseVideo(dialog: HTMLElement, file: File) {
  fireEvent.change(within(dialog).getByLabelText("Tanzvideo wählen"), {
    target: { files: [file] },
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  library.songs = [];
  library.updateDetails.mockReset();
  library.setVideo.mockReset();
  library.musicIsVideo.mockReset();
});

describe("Dance video in the edit dialog (8h-2b-2a)", () => {
  it("is offered for local, URL and Spotify songs, not for YouTube", async () => {
    library.musicIsVideo.mockResolvedValue(false);
    const sources: Song["source"][] = [
      { type: "local", blobId: "b" },
      { type: "url", url: "https://example.com/a.mp3" },
      { type: "spotify", trackUri: "spotify:track:abc" },
    ];
    for (const source of sources) {
      const dialog = await openEditor(song({ source }));
      expect(within(dialog).getByRole("region", { name: "Tanzvideo" })).toBeInTheDocument();
      expect(within(dialog).getByText("Kein Video angehängt.")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Video anhängen" })).toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: "Video entfernen" })).toBeNull();
      cleanup();
    }
    const dialog = await openEditor(song({ source: { type: "youtube", videoId: "dQw4w9WgXcQ" } }));
    expect(within(dialog).queryByRole("region", { name: "Tanzvideo" })).toBeNull();
  });

  it("offers replace and remove when a video is attached", async () => {
    library.musicIsVideo.mockResolvedValue(false);
    const dialog = await openEditor(song({ videoBlobId: "v1" }));
    expect(within(dialog).getByText(/^Angehängt\./)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Video ersetzen" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Video entfernen" })).toBeInTheDocument();
  });

  it("says when the music itself is already a video", async () => {
    library.musicIsVideo.mockResolvedValue(true);
    const dialog = await openEditor(song());
    expect(await within(dialog).findByText(/Die Musik ist schon ein Video/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Video anhängen" })).toBeEnabled();
  });

  it("rejects a video above the limit without saving", async () => {
    library.musicIsVideo.mockResolvedValue(false);
    const dialog = await openEditor(song());
    chooseVideo(dialog, videoFile(VIDEO_BEAT_MAX_BYTES + 1));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/zu groß.*höchstens 250 MB/);
    expect(library.setVideo).not.toHaveBeenCalled();
  });

  it("attaches a video and saves the details on top of the new snapshot", async () => {
    library.musicIsVideo.mockResolvedValue(false);
    library.updateDetails.mockResolvedValue();
    const s = song();
    const withVideo: Song = { ...s, videoBlobId: "new", updatedAt: 999 };
    library.setVideo.mockResolvedValue(withVideo);
    const dialog = await openEditor(s);
    const file = videoFile(3 * 1024 * 1024);
    chooseVideo(dialog, file);

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Tanzvideo gespeichert. Es belegt 3 MB in der Bibliothek.",
    );
    expect(library.setVideo).toHaveBeenCalledWith(s, file);
    expect(within(dialog).getByRole("button", { name: "Video ersetzen" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(library.updateDetails).toHaveBeenCalledTimes(1));
    expect(library.updateDetails.mock.calls[0]![0]).toBe(withVideo);
  });

  it("shows the storage-full message when attaching fails", async () => {
    library.musicIsVideo.mockResolvedValue(false);
    const err = new StorageFullError();
    library.setVideo.mockRejectedValueOnce(err);
    const dialog = await openEditor(song());
    chooseVideo(dialog, videoFile());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(err.message);
    expect(within(dialog).getByRole("button", { name: "Video anhängen" })).toBeInTheDocument();
  });

  it("removes the video only after confirmation, and Speichern keeps it removed", async () => {
    library.musicIsVideo.mockResolvedValue(false);
    library.updateDetails.mockResolvedValue();
    const s = song({ videoBlobId: "v1" });
    const { videoBlobId: _gone, ...rest } = s;
    const without: Song = { ...rest, updatedAt: 999 };
    library.setVideo.mockResolvedValue(without);
    const dialog = await openEditor(s);

    fireEvent.click(within(dialog).getByRole("button", { name: "Video entfernen" }));
    let confirm = await screen.findByRole("alertdialog", { name: REMOVE_CONFIRM });
    fireEvent.click(within(confirm).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(library.setVideo).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Video entfernen" }));
    confirm = await screen.findByRole("alertdialog", { name: REMOVE_CONFIRM });
    fireEvent.click(within(confirm).getByRole("button", { name: "Entfernen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(library.setVideo).toHaveBeenCalledWith(s, undefined);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Tanzvideo entfernt.");
    expect(within(dialog).getByText("Kein Video angehängt.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Video anhängen" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(library.updateDetails).toHaveBeenCalledTimes(1));
    const saved = library.updateDetails.mock.calls[0]![0];
    expect(saved).toBe(without);
    expect("videoBlobId" in saved).toBe(false);
  });

  it("shows an error inside the confirmation when removing fails", async () => {
    library.musicIsVideo.mockResolvedValue(false);
    library.setVideo.mockRejectedValueOnce(new Error("boom"));
    const dialog = await openEditor(song({ videoBlobId: "v1" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Video entfernen" }));
    const confirm = await screen.findByRole("alertdialog", { name: REMOVE_CONFIRM });
    fireEvent.click(within(confirm).getByRole("button", { name: "Entfernen" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(
      "Entfernen hat nicht geklappt. Versuch es noch einmal.",
    );
  });
});
