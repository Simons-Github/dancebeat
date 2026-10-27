import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddSongDialog } from "@/components/AddSongDialog";
import { VideoChoreoPanel } from "@/components/add-song/VideoChoreoPanel";
import type { VideoImportResult } from "@/lib/library/videoImport";
import type { PoseModel } from "@/lib/mediapipe";
import { parsePoseTrackFile } from "@/lib/poseTrackFile";
import type { Song } from "@/lib/types";
import {
  fakeEstimator,
  fakeMultiEstimator,
  figureLandmarks,
  patchVideoElement,
  shiftedFigure,
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

  it("zeigt im Dev-Modus die Diagnose und exportiert die Rohdaten", async () => {
    setup([figureEstimator()]);
    await prepare();
    fireEvent.change(screen.getByLabelText("Beat-Phase (ms)"), { target: { value: "100" } });
    fireEvent.click(analyzeButton());

    const diag = await screen.findByRole("region", { name: "Diagnose (Dev)" }, { timeout: 4000 });
    expect(diag).toHaveTextContent(/Moves \d+ von \d+ Rasterpunkten/);
    expect(diag).toHaveTextContent("BPM 120, Beat-Phase 100 ms");
    // jsdom has no frame callbacks: every sample is a fallback (Etappe 8i-2).
    expect(diag).toHaveTextContent(/Ohne bestätigte Bildzeit \(Rückfall\) [1-9]\d* Proben/);
    await waitFor(() => expect(diag).toHaveTextContent(/Analyse \d+\.\d s/));

    createUrl.mockClear();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Rohdaten exportieren" }));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
    const blob = (createUrl.mock.calls[0] as unknown as [Blob])[0];
    const file = parsePoseTrackFile(await blob.text());
    expect(file.video).toBe("tanz.mp4");
    expect(file.range).toEqual({ startMs: 0, endMs: 6000 });
    expect(file.mirror).toBe(true);
    expect(file.model).toBe("lite");
    expect(file.track.samples.length).toBeGreaterThan(0);
  });

  it("analysiert standardmäßig mit „Schnell“, „Genau“ nimmt das volle Modell", async () => {
    const { createEstimator } = setup([figureEstimator(), figureEstimator()]);
    await prepare();
    expect(screen.getByRole("button", { name: "Schnell" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Genau" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(analyzeButton());
    const summary = await screen.findByText(/Moves, davon/, {}, { timeout: 4000 });
    expect(summary).toHaveTextContent("Modell: Schnell.");
    expect(createEstimator).toHaveBeenLastCalledWith("lite");
    await waitFor(() => expect(submitButton()).toBeEnabled());

    // Switching the model makes the finished analysis stale, like a range change.
    fireEvent.click(screen.getByRole("button", { name: "Genau" }));
    expect(screen.getByRole("button", { name: "Genau" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Das Modell hat sich geändert/)).toBeInTheDocument();
    expect(screen.queryByText(/Moves, davon/)).not.toBeInTheDocument();
    await waitFor(() => expect(submitButton()).toBeDisabled());

    // Switching back to the analyzed model makes it current again without a new analysis.
    fireEvent.click(screen.getByRole("button", { name: "Schnell" }));
    expect(screen.queryByText(/Modell hat sich geändert/)).not.toBeInTheDocument();
    expect(createEstimator).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Genau" }));
    fireEvent.click(screen.getByRole("button", { name: "Neu analysieren" }));
    expect(screen.getByRole("button", { name: "Schnell" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Genau" })).toBeDisabled();
    const again = await screen.findByText(/Moves, davon/, {}, { timeout: 4000 });
    expect(again).toHaveTextContent("Modell: Genau.");
    expect(createEstimator).toHaveBeenCalledTimes(2);
    expect(createEstimator).toHaveBeenLastCalledWith("full");
    expect(screen.queryByText(/Modell hat sich geändert/)).not.toBeInTheDocument();

    createUrl.mockClear();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Rohdaten exportieren" }));
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("tanz-full.posetrack.json");
    click.mockRestore();
    const blob = (createUrl.mock.calls[0] as unknown as [Blob])[0];
    expect(parsePoseTrackFile(await blob.text()).model).toBe("full");
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

describe("VideoChoreoPanel: Selfie-Schalter aus dem Dateinamen", () => {
  const SWITCH = "Video ist gespiegelt (Selfie-Aufnahme)";
  const choose = (name: string) => {
    fireEvent.change(screen.getByLabelText("Tanzvideo"), {
      target: { files: [new File(["v"], name, { type: "video/mp4" })] },
    });
    const video = screen.getByLabelText<HTMLVideoElement>("Videovorschau");
    patchVideoElement(video, { durationMs: 6000 });
    fireEvent.loadedMetadata(video);
  };

  it("schaltet bei „Mirrored“ im Namen ein und nennt den Grund", () => {
    render(<VideoChoreoPanel bpm={120} onChange={() => {}} />);
    choose("Dance Practice (Mirrored).mp4");
    const sw = screen.getByRole("switch", { name: SWITCH });
    expect(sw).toBeChecked();
    expect(sw).toHaveAccessibleDescription(/weil der Dateiname auf ein gespiegeltes Video/);

    // Touching the switch drops the reason; the general hint stays.
    fireEvent.click(sw);
    expect(sw).not.toBeChecked();
    expect(sw).not.toHaveAccessibleDescription(/weil der Dateiname/);
    expect(sw).toHaveAccessibleDescription(/„Mirrored“ im Titel/);
  });

  it("setzt den Schalter für jede neue Datei nach ihrem Namen", () => {
    render(<VideoChoreoPanel bpm={120} onChange={() => {}} />);
    choose("tanz.mp4");
    expect(screen.getByRole("switch", { name: SWITCH })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: SWITCH }));
    expect(screen.getByRole("switch", { name: SWITCH })).toBeChecked();
    choose("zumba.mp4");
    expect(screen.getByRole("switch", { name: SWITCH })).not.toBeChecked();
    choose("kpop_mirror.mp4");
    expect(screen.getByRole("switch", { name: SWITCH })).toBeChecked();
  });
});

describe("VideoChoreoPanel: Moves", () => {
  it("startet mit „Haltepunkte“, „Fester Takt“ rechnet ohne neue Analyse neu", async () => {
    const est = figureEstimator();
    const onChange = vi.fn<(r: VideoImportResult | null) => void>();
    render(<VideoChoreoPanel bpm={120} onChange={onChange} createEstimator={() => est} />);
    fireEvent.change(screen.getByLabelText("Tanzvideo"), {
      target: { files: [new File(["v"], "tanz.mp4", { type: "video/mp4" })] },
    });
    const video = screen.getByLabelText<HTMLVideoElement>("Videovorschau");
    patchVideoElement(video, { durationMs: 6000 });
    fireEvent.loadedMetadata(video);
    const grid = screen.getByRole("button", { name: "Fester Takt" });
    const holds = screen.getByRole("button", { name: "Haltepunkte" });
    expect(holds).toHaveAttribute("aria-pressed", "true");
    expect(grid).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Haltepunkte: Moves auf Beats/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Video analysieren" }));
    const summary = await screen.findByText(/Moves, davon/, {}, { timeout: 4000 });
    expect(summary).toHaveTextContent("Moves: Haltepunkte.");
    const latest = () => onChange.mock.calls.at(-1)?.[0] ?? null;
    await waitFor(() => expect(latest()).not.toBeNull());
    const before = latest()!;
    const detects = vi.mocked(est.detect).mock.calls.length;

    fireEvent.click(grid);
    expect(grid).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(latest()).not.toBe(before));
    const after = latest()!;
    expect(after).not.toBeNull();
    expect(vi.mocked(est.detect).mock.calls.length).toBe(detects);
    expect(screen.queryByText(/Bitte das Video neu analysieren/)).not.toBeInTheDocument();
    expect(after.choreo.moves.map((m) => m.timeMs)).not.toEqual(
      before.choreo.moves.map((m) => m.timeMs),
    );
    expect(after.choreo.frames).toEqual(before.choreo.frames);
    const now = screen.getByText(/Moves, davon/);
    expect(now).toHaveTextContent("Moves: Fester Takt.");
    expect(now).toHaveTextContent(`${after.stats.moves} Moves`);

    createUrl.mockClear();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Rohdaten exportieren" }));
    click.mockRestore();
    const blob = (createUrl.mock.calls[0] as unknown as [Blob])[0];
    expect(parsePoseTrackFile(await blob.text()).movePlacement).toBe("grid");
  });
});

describe("VideoChoreoPanel: Zielperson", () => {
  function renderPanel(est: FakeEstimator) {
    const onChange = vi.fn<(r: VideoImportResult | null) => void>();
    render(<VideoChoreoPanel bpm={120} onChange={onChange} createEstimator={() => est} />);
    fireEvent.change(screen.getByLabelText("Tanzvideo"), {
      target: { files: [new File(["v"], "tanz.mp4", { type: "video/mp4" })] },
    });
    const video = screen.getByLabelText<HTMLVideoElement>("Videovorschau");
    patchVideoElement(video, { durationMs: 6000 });
    fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole("button", { name: "Video analysieren" }));
    const latest = () => onChange.mock.calls.at(-1)?.[0] ?? null;
    return { video, latest };
  }

  it("bietet bei zwei Personen die Auswahl an und rechnet ohne neue Analyse neu", async () => {
    // Model order swaps every 100 ms; the left dancer waves, the right one moves out of phase.
    const left = (t: number) => shiftedFigure(t, { dx: -0.22 });
    const right = (t: number) => shiftedFigure(t + 1000, { dx: 0.22, scale: 0.9 });
    const est = fakeMultiEstimator((t) =>
      t < 0 ? [] : Math.floor(t / 100) % 2 ? [right(t), left(t)] : [left(t), right(t)],
    );
    const { video, latest } = renderPanel(est);
    expect(
      await screen.findByText("Mehrere Personen erkannt", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tippe auf die Person/)).toBeInTheDocument();
    const p1 = screen.getByRole("button", { name: "Person 1" });
    const p2 = screen.getByRole("button", { name: "Person 2" });
    // Default: the larger person, numbered left to right.
    expect(p1).toHaveAttribute("aria-pressed", "true");
    expect(p2).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Moves, davon/)).toHaveTextContent(/^Person 1 von 2: /);
    await waitFor(() => expect(latest()).not.toBeNull());
    const first = latest()!;
    const detects = vi.mocked(est.detectAll!).mock.calls.length;

    fireEvent.click(p2);
    expect(screen.getByRole("button", { name: "Person 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Moves, davon/)).toHaveTextContent(/^Person 2 von 2: /);
    await waitFor(() => expect(latest()).not.toBe(first));
    const second = latest()!;
    expect(second.choreo.frames.map((f) => f.angles)).not.toEqual(
      first.choreo.frames.map((f) => f.angles),
    );
    // Person 2 is followed through the order swaps: every frame is the right dancer.
    expect(second.choreo.frames.every((f) => f.landmarks[0]![0] > 0.5)).toBe(true);
    expect(first.choreo.frames.every((f) => f.landmarks[0]![0] < 0.5)).toBe(true);
    expect(second.stats.detectionRatio).toBe(1);
    expect(vi.mocked(est.detectAll!).mock.calls.length).toBe(detects);
    expect(est.detect).not.toHaveBeenCalled();

    // "Aktuelles Bild" shows the sample at the preview position and keeps the choice.
    video.currentTime = 3.03;
    fireEvent.click(screen.getByRole("button", { name: "Aktuelles Bild" }));
    expect(screen.getByRole("button", { name: "Person 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(latest()).toBe(second);
  });

  it("neue Analyse setzt die Wahl auf die Vorauswahl zurück, die Vorschauposition bleibt", async () => {
    const left = (t: number) => shiftedFigure(t, { dx: -0.22 });
    const right = (t: number) => shiftedFigure(t + 1000, { dx: 0.22, scale: 0.9 });
    const est = fakeMultiEstimator((t) => (t < 0 ? [] : [left(t), right(t)]));
    const { video, latest } = renderPanel(est);
    await screen.findByText("Mehrere Personen erkannt", {}, { timeout: 4000 });
    // The still is grabbed at the seed sample (0 s), then the position before it comes back.
    await waitFor(() => expect(video.currentTime).toBe(6));
    fireEvent.click(screen.getByRole("button", { name: "Person 2" }));
    expect(screen.getByRole("button", { name: "Person 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(screen.getByText(/Moves, davon/)).toHaveTextContent(/^Person 2/));
    const chosen = latest();

    fireEvent.click(screen.getByRole("button", { name: "Neu analysieren" }));
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "Person 1" })).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
      { timeout: 4000 },
    );
    expect(screen.getByRole("button", { name: "Person 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() => expect(latest()).not.toBe(chosen));
    expect(latest()!.choreo.frames.every((f) => f.landmarks[0]![0] < 0.5)).toBe(true);
  });

  it("zeigt bei nur einer Person keine Auswahl", async () => {
    const est = fakeMultiEstimator((t) => (t < 0 ? [] : [figureLandmarks(t)]));
    renderPanel(est);
    await screen.findByText(/Moves, davon/, {}, { timeout: 4000 });
    expect(screen.getByText(/Moves, davon/)).not.toHaveTextContent(/von \d+:/);
    expect(screen.queryByText("Mehrere Personen erkannt")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Person / })).not.toBeInTheDocument();
  });
});
