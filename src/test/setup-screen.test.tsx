import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeChoreo, makeSong } from "./fixtures";

const library = vi.hoisted(() => ({ songs: [] as Song[], loading: false }));
vi.mock("@/hooks/useSongLibrary", () => ({
  useSongLibrary: () => ({ songs: library.songs, loading: library.loading }),
}));

const getUserMedia = vi.fn();

async function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  const song = { ...makeSong({ ...makeChoreo(), title: "Pink Pulse" }), title: "Pink Pulse" };
  library.songs = [{ ...song, id: "song-1" }];
  getUserMedia.mockReset();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: async () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Aufstellhilfe", () => {
  it("erklärt, nennt die externen Abrufe und fragt die Kamera erst nach dem Tippen an", async () => {
    await renderAt("/setup/song-1");
    expect(await screen.findByRole("button", { name: "Kamera starten" })).toBeInTheDocument();
    expect(screen.getByText(/Kamerabilder verlassen dein Gerät nie/)).toHaveTextContent(
      "jsDelivr und Google geladen; dabei wird deine IP-Adresse übertragen, keine Bilder.",
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("nennt bei lokalem Song keinen Musik-Abruf", async () => {
    await renderAt("/setup/song-1");
    const note = await screen.findByText(/Kamerabilder verlassen dein Gerät nie/);
    expect(note).not.toHaveTextContent("Die Musik");
  });

  it("nennt bei YouTube-Song YouTube und die IP-Adresse", async () => {
    library.songs = [{ ...library.songs[0]!, source: { type: "youtube", videoId: "dQw4w9WgXcQ" } }];
    await renderAt("/setup/song-1");
    const note = await screen.findByText(/Kamerabilder verlassen dein Gerät nie/);
    expect(note).toHaveTextContent(
      "Die Musik kommt von YouTube (Skript von youtube.com, Video über youtube-nocookie.com); YouTube sieht dabei deine IP-Adresse.",
    );
  });

  it("nennt bei URL-Song den Hostnamen", async () => {
    library.songs = [
      {
        ...library.songs[0]!,
        source: { type: "url", url: "https://media.example.org:8080/a/track.mp3" },
      },
    ];
    await renderAt("/setup/song-1");
    const note = await screen.findByText(/Kamerabilder verlassen dein Gerät nie/);
    expect(note).toHaveTextContent(
      "Die Musik wird von media.example.org:8080 geladen; der Server sieht deine IP-Adresse.",
    );
  });

  it("zeigt nach verweigerter Berechtigung eine Erklärung mit „Erneut versuchen“", async () => {
    getUserMedia.mockRejectedValue(new DOMException("x", "NotAllowedError"));
    await renderAt("/setup/song-1");
    fireEvent.click(await screen.findByRole("button", { name: "Kamera starten" }));
    expect(await screen.findByText("Kamera-Zugriff verweigert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Los geht's" })).toBeDisabled();

    getUserMedia.mockRejectedValue(new DOMException("x", "NotFoundError"));
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByText("Keine Kamera gefunden")).toBeInTheDocument();
  });

  it("meldet einen unbekannten Song", async () => {
    await renderAt("/setup/gibt-es-nicht");
    expect(await screen.findByText("Song nicht gefunden")).toBeInTheDocument();
  });
});
