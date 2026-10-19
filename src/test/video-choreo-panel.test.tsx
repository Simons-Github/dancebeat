import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddSongDialog } from "@/components/AddSongDialog";
import { VideoChoreoPanel } from "@/components/add-song/VideoChoreoPanel";
import type { VideoImportResult } from "@/lib/library/videoImport";
import type { PoseModel } from "@/lib/mediapipe";
import type { Song } from "@/lib/types";
import {
  fakeEstimator,
  figureLandmarks,
  patchVideoElement,
  type FakeEstimator,
} from "./videoAnalysisFakes";

const ID = "dQw4w9WgXcQ";
const BLOB_URL = "blob:video-1";

const createUrl = vi.fn(() => BLOB_URL);
const revokeUrl = vi.fn();
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = revokeUrl;
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  createUrl.mockClear();
  revokeUrl.mockClear();
});

function setup(estimators: FakeEstimator[]) {
  const onAdd = vi.fn<(s: Song, a?: Blob) => Promise<void>>().mockResolvedValue();
  const queue = [...estimators];
  const createEstimator = vi.fn((_m: PoseModel) => {
    const e = queue.shift();
    if (!e) throw new Error("no estimator left");
    return e;
  });
  render(<AddSongDialog onAdd={onAdd} createEstimator={createEstimator} />);
  fireEvent.click(screen.getByRole("button", { name: "Song hinzufügen" }));
  return { onAdd, createEstimator };
}

async function prepare(durationMs = 6000) {
  const tab = await screen.findByRole("tab", { name: "YouTube" });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
    target: { value: ID },
  });
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Videotanz" } });
  fireEvent.click(screen.getByRole("radio", { name: "Aus Video" }));
  fireEvent.change(screen.getByLabelText("Tanzvideo"), {
    target: { files: [new File(["v"], "tanz.mp4", { type: "video/mp4" })] },
  });
  const video = screen.getByLabelText<HTMLVideoElement>("Videovorschau");
  patchVideoElement(video, { durationMs });
  fireEvent.loadedMetadata(video);
  return video;
}

const submitButton = () => screen.getByRole("button", { name: "Hinzufügen" });
const analyzeButton = () => screen.getByRole("button", { name: /analysieren$/ });
const figureEstimator = () => fakeEstimator((t) => (t < 0 ? null : figureLandmarks(t)));

describe("VideoChoreoPanel im Dialog „Song hinzufügen“", () => {
  it("analysiert das Video und speichert Moves mit offsetMs und startOffsetMs", async () => {
    const { onAdd } = setup([figureEstimator()]);
    await prepare();
    expect(screen.getByLabelText("Ende (Sekunden)")).toHaveValue("6");
    expect(screen.queryByLabelText("Länge in Sekunden")).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Start (Sekunden)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Beat-Phase (ms)"), { target: { value: "100" } });
    fireEvent.click(analyzeButton());

    const summary = await screen.findByText(/Moves, davon \d+ Gold Moves/, {}, { timeout: 4000 });
    expect(summary).toHaveTextContent("Person in 100 % der Bilder erkannt");
    // The panel reports its result in an effect after the summary renders.
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const [song] = onAdd.mock.calls[0]!;
    expect(song.startOffsetMs).toBe(1000);
    // P − start = −900 → phase 100 within the 500 ms beat; offset = start + phase.
    expect(song.choreo.offsetMs).toBe(1100);
    expect(song.bpm).toBe(120);
    expect(song.choreo.title).toBe("Videotanz");
    expect(song.choreo.moves.length).toBeGreaterThanOrEqual(2);
    expect(summary).toHaveTextContent(`${song.choreo.moves.length} Moves`);
    expect(song.choreo.moves.every((m) => m.iconId === "video")).toBe(true);
    expect(revokeUrl).toHaveBeenCalledWith(BLOB_URL);
  });

  it("BPM-Änderung rechnet ohne neue Analyse neu, Bereichsänderung macht sie ungültig", async () => {
    const { createEstimator } = setup([figureEstimator(), figureEstimator()]);
    await prepare();
    fireEvent.click(analyzeButton());
    const summary = await screen.findByText(/Moves, davon/, {}, { timeout: 4000 });
    const before = summary.textContent;

    fireEvent.change(screen.getByLabelText("BPM"), { target: { value: "60" } });
    await waitFor(() => expect(screen.getByText(/Moves, davon/).textContent).not.toBe(before));
    expect(createEstimator).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Ende (Sekunden)"), { target: { value: "5" } });
    expect(screen.getByText(/Zeitbereich hat sich geändert/)).toBeInTheDocument();
    expect(screen.queryByText(/Moves, davon/)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Neu analysieren" }));
    await screen.findByText(/Moves, davon/, {}, { timeout: 4000 });
    expect(screen.queryByText(/Zeitbereich hat sich geändert/)).not.toBeInTheDocument();
    expect(createEstimator).toHaveBeenCalledTimes(2);
    // The panel reports its result in an effect after the summary renders.
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it("zeigt den Fortschritt und bricht auf Wunsch ab", async () => {
    const est = figureEstimator();
    setup([est]);
    await prepare(120_000);
    fireEvent.click(analyzeButton());
    const bar = await screen.findByRole("progressbar", { name: "Analysefortschritt" });
    await waitFor(
      () =>
        expect(
          Number(screen.getByRole("progressbar").getAttribute("aria-valuenow")),
        ).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByText(/Analysiere … \d+ %/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByText("Analyse abgebrochen.")).toBeInTheDocument();
    expect(est.closed).toBeGreaterThan(0);
    expect(submitButton()).toBeDisabled();
  });

  it("zeigt Fehler aus der Analyse und aus dem Choreo-Bau", async () => {
    const broken = fakeEstimator(() => null, false);
    setup([broken, fakeEstimator(() => null)]);
    await prepare();
    fireEvent.click(analyzeButton());
    await act(async () => {
      broken.rejectInit();
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Pose-Modell konnte nicht geladen werden.",
    );
    fireEvent.click(analyzeButton());
    expect(
      await screen.findByText(
        "Im Video wurde zu selten eine Person erkannt.",
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("meldet einen zu kurzen Bereich und sperrt die Analyse", async () => {
    setup([figureEstimator()]);
    await prepare();
    fireEvent.change(screen.getByLabelText("Start (Sekunden)"), { target: { value: "5" } });
    expect(screen.getByText(/mindestens 2 Sekunden/)).toBeInTheDocument();
    expect(analyzeButton()).toBeDisabled();
  });

  it("Schließen bricht die Analyse ab und gibt die Objekt-URL frei", async () => {
    const est = fakeEstimator(() => null, false);
    setup([est]);
    await prepare();
    fireEvent.click(analyzeButton());
    expect(screen.getByText("Lade Pose-Modell …")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(est.closed).toBeGreaterThan(0);
    expect(revokeUrl).toHaveBeenCalledWith(BLOB_URL);
  });

  it("Wechsel auf „Automatisch erzeugen“ während der Analyse schließt das Modell und gibt die URL frei", async () => {
    const est = figureEstimator();
    setup([est]);
    await prepare(120_000);
    fireEvent.click(analyzeButton());
    await screen.findByText(/Analysiere …/);
    fireEvent.click(screen.getByRole("radio", { name: "Automatisch erzeugen" }));
    expect(screen.queryByLabelText("Videovorschau")).not.toBeInTheDocument();
    expect(est.closed).toBeGreaterThan(0);
    expect(revokeUrl).toHaveBeenCalledWith(BLOB_URL);
    const calls = vi.mocked(est.detect).mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(vi.mocked(est.detect).mock.calls.length).toBe(calls);
  });

  it("erlaubt Abschnitte hinter Minute 10 bei langen Videos, begrenzt aber die Länge", async () => {
    setup([figureEstimator()]);
    await prepare(15 * 60_000);
    expect(screen.getByLabelText("Ende (Sekunden)")).toHaveValue("600");
    fireEvent.change(screen.getByLabelText("Start (Sekunden)"), { target: { value: "700" } });
    fireEvent.change(screen.getByLabelText("Ende (Sekunden)"), { target: { value: "760,5" } });
    expect(screen.queryByText(/Sekunden lang sein|Minuten lang sein/)).not.toBeInTheDocument();
    expect(analyzeButton()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Start (Sekunden)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Ende (Sekunden)"), { target: { value: "620" } });
    expect(screen.getByText(/höchstens 10 Minuten lang sein/)).toBeInTheDocument();
    expect(analyzeButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ende (Sekunden)"), { target: { value: "901" } });
    expect(screen.getByText("Das Ende liegt hinter dem Videoende.")).toBeInTheDocument();
  });
});

describe("VideoChoreoPanel", () => {
  it("Selfie-Schalter rechnet ohne neue Analyse neu", async () => {
    const est = figureEstimator();
    const onChange = vi.fn<(r: VideoImportResult | null) => void>();
    render(<VideoChoreoPanel bpm={120} onChange={onChange} createEstimator={() => est} />);
    fireEvent.change(screen.getByLabelText("Tanzvideo"), {
      target: { files: [new File(["v"], "tanz.mp4", { type: "video/mp4" })] },
    });
    const video = screen.getByLabelText<HTMLVideoElement>("Videovorschau");
    patchVideoElement(video, { durationMs: 6000 });
    fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole("button", { name: "Video analysieren" }));
    await screen.findByText(/Moves, davon/, {}, { timeout: 4000 });
    const latest = () => onChange.mock.calls.at(-1)?.[0] ?? null;
    await waitFor(() => expect(latest()).not.toBeNull());
    const mirrored = latest()!;
    const detects = vi.mocked(est.detect).mock.calls.length;

    fireEvent.click(screen.getByRole("switch", { name: "Video ist gespiegelt (Selfie-Aufnahme)" }));
    await waitFor(() => expect(latest()).not.toBe(mirrored));
    const plain = latest()!;
    expect(plain).not.toBeNull();
    expect(vi.mocked(est.detect).mock.calls.length).toBe(detects);
    expect(plain.choreo.frames.map((f) => f.angles)).not.toEqual(
      mirrored.choreo.frames.map((f) => f.angles),
    );
    expect(plain.choreo.moves.map((m) => m.timeMs)).toEqual(
      mirrored.choreo.moves.map((m) => m.timeMs),
    );
  });
});
