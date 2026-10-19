import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddSongDialog } from "@/components/AddSongDialog";
import { StorageFullError } from "@/lib/library/storage";
import { buildChoreoFile } from "@/lib/library/choreoFile";
import type { Song } from "@/lib/types";
import { makeSong } from "./fixtures";

const analyze = vi.hoisted(() => vi.fn());
vi.mock("@/lib/beat", async (orig) => ({
  ...(await orig<typeof import("@/lib/beat")>()),
  analyzeAudio: analyze,
}));

afterEach(() => {
  cleanup();
  analyze.mockReset();
});

const ID = "dQw4w9WgXcQ";

function setup(onAdd = vi.fn<(s: Song, a?: Blob) => Promise<void>>().mockResolvedValue()) {
  const onAdded = vi.fn();
  render(<AddSongDialog onAdd={onAdd} onAdded={onAdded} />);
  fireEvent.click(screen.getByRole("button", { name: "Song hinzufügen" }));
  return { onAdd, onAdded };
}

const submitButton = () => screen.getByRole("button", { name: "Hinzufügen" });

async function openYouTube() {
  const tab = await screen.findByRole("tab", { name: "YouTube" });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

function chooseFile(label: string, file: File) {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

describe("AddSongDialog", () => {
  it("adds a YouTube song", async () => {
    const { onAdd, onAdded } = setup();
    await openYouTube();
    fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
      target: { value: `https://youtu.be/${ID}` },
    });
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Mein Lied" } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const [song, audio] = onAdd.mock.calls[0]!;
    expect(song.source).toEqual({ type: "youtube", videoId: ID });
    expect(song.title).toBe("Mein Lied");
    expect(audio).toBeUndefined();
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(song));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("flags an invalid YouTube link and disables the button", async () => {
    setup();
    await openYouTube();
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "X" } });
    const field = screen.getByLabelText("YouTube-Link oder Video-ID");
    fireEvent.change(field, { target: { value: "https://example.com/x" } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/kein gültiger YouTube-Link/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("analyzes a file, prefills bpm and title, and passes the Blob", async () => {
    analyze.mockResolvedValue({ bpm: 126, durationMs: 95_000 });
    const { onAdd } = setup();
    chooseFile("Audiodatei", new File(["x"], "Cool Song.mp3", { type: "audio/mpeg" }));

    expect(await screen.findByDisplayValue("126")).toBeInTheDocument();
    expect(screen.getByDisplayValue("95")).toBeInTheDocument();
    expect(screen.getByText("Geschätzt, bitte prüfen.")).toBeInTheDocument();
    expect(screen.getByLabelText("Titel")).toHaveValue("Cool Song");
    fireEvent.click(submitButton());

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const [song, audio] = onAdd.mock.calls[0]!;
    expect(audio).toBeInstanceOf(Blob);
    expect(song.source.type).toBe("local");
    expect(song.bpm).toBe(126);
  });

  it("shows the decode error and keeps saving disabled", async () => {
    analyze.mockRejectedValue(
      new Error("Diese Datei lässt sich nicht abspielen. Bitte MP3, M4A, WAV oder OGG verwenden."),
    );
    setup();
    chooseFile("Audiodatei", new File(["x"], "kaputt.mp3"));
    expect(await screen.findByRole("alert")).toHaveTextContent("lässt sich nicht abspielen");
    expect(submitButton()).toBeDisabled();
  });

  it("shows the storage message and stays open when the store is full", async () => {
    const onAdd = vi.fn().mockRejectedValue(new StorageFullError());
    const { onAdded } = setup(onAdd);
    await openYouTube();
    fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
      target: { value: ID },
    });
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Voll" } });
    fireEvent.click(submitButton());

    expect(await screen.findByText(/Der Speicher ist voll/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("shows a generic message for other errors", async () => {
    setup(vi.fn().mockRejectedValue(new Error("boom")));
    await openYouTube();
    fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
      target: { value: ID },
    });
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "T" } });
    fireEvent.click(submitButton());
    expect(
      await screen.findByText("Der Song konnte nicht gespeichert werden."),
    ).toBeInTheDocument();
  });

  it("shows the error for an invalid choreography file", async () => {
    setup();
    await openYouTube();
    fireEvent.click(screen.getByRole("radio", { name: "Aus Datei importieren" }));
    chooseFile("Choreografie-Datei", new File(["{nope"], "x.json", { type: "application/json" }));
    expect(await screen.findByText("Die Datei ist kein gültiges JSON.")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("imports a valid choreography, prefills fields and shows the move count", async () => {
    const song = makeSong();
    const json = JSON.stringify(buildChoreoFile({ ...song, title: "Aus Datei", artist: "Wer" }));
    const { onAdd } = setup();
    await openYouTube();
    fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
      target: { value: ID },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Aus Datei importieren" }));
    chooseFile("Choreografie-Datei", new File([json], "x.json", { type: "application/json" }));

    expect(await screen.findByText(`${song.choreo.moves.length} Moves`)).toBeInTheDocument();
    expect(screen.getByLabelText("Titel")).toHaveValue("Aus Datei");
    expect(screen.getByLabelText("Künstler")).toHaveValue("Wer");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0]![0].choreo.moves).toEqual(song.choreo.moves);
  });

  it("a decode error on the Datei tab does not block a YouTube submit", async () => {
    analyze.mockRejectedValue(new Error("kaputt"));
    const { onAdd } = setup();
    chooseFile("Audiodatei", new File(["x"], "kaputt.mp3"));
    expect(await screen.findByRole("alert")).toHaveTextContent("kaputt");
    await openYouTube();
    fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
      target: { value: ID },
    });
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Ok" } });
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
  });

  it("overwrites a prefilled title but keeps one the player typed", async () => {
    analyze.mockRejectedValueOnce(new Error("kaputt"));
    analyze.mockResolvedValue({ bpm: 100, durationMs: 60_000 });
    setup();
    chooseFile("Audiodatei", new File(["x"], "fake.mp3"));
    await waitFor(() => expect(screen.getByLabelText("Titel")).toHaveValue("fake"));
    await screen.findByRole("alert");
    chooseFile("Audiodatei", new File(["x"], "echt.mp3"));
    await waitFor(() => expect(screen.getByLabelText("Titel")).toHaveValue("echt"));
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Mein Titel" } });
    chooseFile("Audiodatei", new File(["x"], "dritte.mp3"));
    await screen.findByDisplayValue("100");
    expect(screen.getByLabelText("Titel")).toHaveValue("Mein Titel");
  });

  it("clamps a long file to the maximum length and says so", async () => {
    analyze.mockResolvedValue({ bpm: 100, durationMs: 900_000 });
    setup();
    chooseFile("Audiodatei", new File(["x"], "lang.mp3"));
    expect(await screen.findByDisplayValue("600")).toBeInTheDocument();
    expect(
      screen.getByText("Die Choreografie deckt die ersten 10 Minuten ab."),
    ).toBeInTheDocument();
  });

  it("keeps separate links for the URL and YouTube tabs", async () => {
    const { onAdd } = setup();
    await openYouTube();
    fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
      target: { value: ID },
    });
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "T" } });
    const urlTab = screen.getByRole("tab", { name: "URL" });
    fireEvent.mouseDown(urlTab);
    fireEvent.click(urlTab);
    expect(await screen.findByLabelText("Adresse der Audiodatei")).toHaveValue("");
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Adresse der Audiodatei"), {
      target: { value: "https://example.com/a.mp3" },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0]![0].source).toEqual({
      type: "url",
      url: "https://example.com/a.mp3",
    });
  });
});
