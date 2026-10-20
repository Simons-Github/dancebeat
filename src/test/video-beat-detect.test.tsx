import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddSongDialog } from "@/components/AddSongDialog";
import {
  VIDEO_BEAT_MAX_BYTES,
  VIDEO_BEAT_MAX_MS,
  VideoChoreoPanel,
} from "@/components/add-song/VideoChoreoPanel";
import { onsetEnvelope, type AudioAnalysis, type DecodedAudio } from "@/lib/beat";
import type { Song } from "@/lib/types";
import { patchVideoElement } from "./videoAnalysisFakes";

const analyze = vi.hoisted(() => vi.fn<(file: Blob) => Promise<AudioAnalysis>>());
vi.mock("@/lib/beat", async (orig) => ({
  ...(await orig<typeof import("@/lib/beat")>()),
  analyzeAudio: analyze,
}));

const SR = 22050;
const ID = "dQw4w9WgXcQ";

/** Click on every beat from `firstMs` on, like beat.test.ts. */
function clicks(bpm: number, seconds: number, firstMs: number): Float32Array {
  const data = new Float32Array(SR * seconds);
  for (let t = (firstMs / 1000) * SR; t < data.length; t += (60 / bpm) * SR) {
    const start = Math.round(t);
    for (let k = 0; k < 400 && start + k < data.length; k++) {
      data[start + k] = Math.sin(k * 0.6) * Math.exp(-k / 80);
    }
  }
  return data;
}

/** What analyzeAudio returns for a decoded click track (real estimator, no AudioContext). */
async function analysisOf(bpm: number, firstMs: number, seconds = 30): Promise<AudioAnalysis> {
  const { analyzeAudio } = await vi.importActual<typeof import("@/lib/beat")>("@/lib/beat");
  const data = clicks(bpm, seconds, firstMs);
  const decoded: DecodedAudio = { sampleRate: SR, duration: seconds, getChannelData: () => data };
  return analyzeAudio(new Blob(["x"]), async () => decoded);
}

/** Distance of `t` to the nearest beat of the grid `first + k · beat`. */
function gridError(t: number, first: number, bpm: number) {
  const beat = 60_000 / bpm;
  const d = (((t - first) % beat) + beat) % beat;
  return Math.min(d, beat - d);
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:video");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  analyze.mockReset();
});

function chooseVideo(
  file = new File(["v"], "tanz.mp4", { type: "video/mp4" }),
  durationMs = 30_000,
) {
  fireEvent.change(screen.getByLabelText("Tanzvideo"), { target: { files: [file] } });
  const video = screen.getByLabelText<HTMLVideoElement>("Videovorschau");
  patchVideoElement(video, { durationMs });
  fireEvent.loadedMetadata(video);
}

const phaseField = () => screen.getByLabelText<HTMLInputElement>("Beat-Phase (ms)");
const detectButton = () => screen.getByRole("button", { name: "Takt erkennen" });

describe("VideoChoreoPanel: Takt erkennen", () => {
  it("liest BPM und Beat-Phase aus dem Ton des Videos und folgt Bereich und BPM", async () => {
    const audio = await analysisOf(128, 401);
    analyze.mockResolvedValue(audio);
    const onBpmDetected = vi.fn();
    const { rerender } = render(
      <VideoChoreoPanel bpm={120} onChange={() => {}} onBpmDetected={onBpmDetected} />,
    );
    chooseVideo();
    fireEvent.click(detectButton());
    await waitFor(() => expect(onBpmDetected).toHaveBeenCalledWith(audio.bpm));
    expect(Math.abs(audio.bpm - 128)).toBeLessThanOrEqual(2);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/erkannt aus dem Ton des Videos/)).toBeInTheDocument();

    // The dialog takes the BPM; the phase follows without another decode.
    rerender(<VideoChoreoPanel bpm={128} onChange={() => {}} onBpmDetected={onBpmDetected} />);
    const first = Number(phaseField().value);
    expect(first).toBeLessThan(60_000 / 128);
    expect(gridError(first, 401, 128)).toBeLessThanOrEqual(15);

    fireEvent.change(screen.getByLabelText("Start (Sekunden)"), { target: { value: "10" } });
    const later = Number(phaseField().value);
    expect(later).toBeGreaterThanOrEqual(10_000);
    expect(gridError(later, 401, 128)).toBeLessThanOrEqual(15);
    expect(analyze).toHaveBeenCalledTimes(1);

    // Typing switches to the hand-entered value.
    fireEvent.change(phaseField(), { target: { value: "50" } });
    expect(phaseField()).toHaveValue("50");
    expect(screen.getByText(/Zeitpunkt eines Beats im Video/)).toBeInTheDocument();
  });

  it("nimmt die Musikdatei, wenn es eine gibt, ohne den Ton des Videos zu lesen", async () => {
    const music = await analysisOf(100, 250);
    const onBpmDetected = vi.fn();
    render(
      <VideoChoreoPanel
        bpm={100}
        onChange={() => {}}
        musicBeat={music.envelope}
        onBpmDetected={onBpmDetected}
      />,
    );
    chooseVideo();
    fireEvent.click(detectButton());
    expect(gridError(Number(phaseField().value), 250, 100)).toBeLessThanOrEqual(15);
    expect(screen.getByText(/erkannt aus der Musikdatei/)).toBeInTheDocument();
    expect(analyze).not.toHaveBeenCalled();
    expect(onBpmDetected).not.toHaveBeenCalled();
  });

  it("meldet zu große Videos, unlesbaren Ton und Stille", async () => {
    render(<VideoChoreoPanel bpm={120} onChange={() => {}} />);
    const big = new File(["v"], "gross.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: VIDEO_BEAT_MAX_BYTES + 1 });
    chooseVideo(big);
    fireEvent.click(detectButton());
    expect(screen.getByRole("alert")).toHaveTextContent(/zu groß für die Takterkennung/);
    expect(analyze).not.toHaveBeenCalled();

    chooseVideo();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    analyze.mockRejectedValueOnce(new Error("decode"));
    fireEvent.click(detectButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Der Ton des Videos lässt sich nicht auswerten. Bitte die Beat-Phase von Hand eintragen.",
    );

    analyze.mockResolvedValueOnce({
      bpm: 120,
      durationMs: 30_000,
      envelope: onsetEnvelope(new Float32Array(SR * 30), SR),
    });
    fireEvent.click(detectButton());
    expect(await screen.findByText(/kein Takt erkennbar/)).toBeInTheDocument();
    expect(phaseField()).toHaveValue("0");
  });

  it("schaut bei langen Abschnitten nur auf den Anfang (BPM um eins daneben)", async () => {
    // True tempo 128, the form says 127: over 3 minutes the grid drifts by more than a second.
    const audio = await analysisOf(128, 401, 200);
    analyze.mockResolvedValue(audio);
    render(<VideoChoreoPanel bpm={127} onChange={() => {}} />);
    chooseVideo(undefined, 200_000);
    fireEvent.change(screen.getByLabelText("Start (Sekunden)"), { target: { value: "5" } });
    fireEvent.click(detectButton());
    await screen.findByText(/erkannt aus dem Ton des Videos/);
    const t = Number(phaseField().value);
    expect(t).toBeGreaterThanOrEqual(5000);
    expect(gridError(t, 401, 128)).toBeLessThanOrEqual(50);
  });

  it("meldet zu lange Videos, ohne den Ton zu lesen", () => {
    render(<VideoChoreoPanel bpm={120} onChange={() => {}} />);
    chooseVideo(undefined, VIDEO_BEAT_MAX_MS + 1000);
    fireEvent.click(detectButton());
    expect(screen.getByRole("alert")).toHaveTextContent(/zu lang für die Takterkennung/);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("fällt nicht still auf den alten Wert zurück, wenn die Quelle wegfällt", async () => {
    const music = await analysisOf(100, 250);
    const onChange = vi.fn();
    const { rerender } = render(
      <VideoChoreoPanel bpm={100} onChange={onChange} musicBeat={music.envelope} />,
    );
    chooseVideo();
    fireEvent.change(phaseField(), { target: { value: "123" } });
    fireEvent.click(detectButton());
    expect(phaseField().value).not.toBe("123");

    rerender(<VideoChoreoPanel bpm={100} onChange={onChange} musicBeat={null} />);
    expect(phaseField()).toHaveValue("");
    expect(screen.getByText(/erkannte Takt lässt sich gerade nicht berechnen/)).toBeInTheDocument();
    fireEvent.change(phaseField(), { target: { value: "40" } });
    expect(phaseField()).toHaveValue("40");
    expect(screen.queryByText(/gerade nicht berechnen/)).not.toBeInTheDocument();
  });

  it("verwirft das Ergebnis eines vorherigen Videos", async () => {
    let finish: (a: AudioAnalysis) => void = () => {};
    analyze.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const onBpmDetected = vi.fn();
    render(<VideoChoreoPanel bpm={120} onChange={() => {}} onBpmDetected={onBpmDetected} />);
    chooseVideo();
    fireEvent.click(detectButton());
    expect(screen.getByRole("button", { name: "Werte den Ton aus …" })).toBeDisabled();
    chooseVideo(new File(["w"], "neu.mp4", { type: "video/mp4" }));
    finish(await analysisOf(128, 401));
    await new Promise((r) => setTimeout(r, 0));
    expect(onBpmDetected).not.toHaveBeenCalled();
    expect(phaseField()).toHaveValue("0");
    expect(detectButton()).toBeEnabled();
  });
});

describe("Takt erkennen im Dialog „Song hinzufügen“", () => {
  function openDialog() {
    const onAdd = vi.fn<(s: Song, a?: Blob) => Promise<void>>().mockResolvedValue();
    render(<AddSongDialog onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Song hinzufügen" }));
  }

  async function youtubeWithVideo() {
    const tab = await screen.findByRole("tab", { name: "YouTube" });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    fireEvent.change(screen.getByLabelText("YouTube-Link oder Video-ID"), {
      target: { value: ID },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Aus Video" }));
    chooseVideo();
  }

  it("übernimmt die BPM aus dem Video, solange sie nicht von Hand geändert wurden", async () => {
    const audio = await analysisOf(128, 401);
    analyze.mockResolvedValue(audio);
    openDialog();
    await youtubeWithVideo();
    fireEvent.click(detectButton());
    await waitFor(() => expect(screen.getByLabelText("BPM")).toHaveValue(audio.bpm));
    expect(screen.getByText("Geschätzt, bitte prüfen.")).toBeInTheDocument();
    // Computed with the estimated (integer) BPM, so it may sit a little off the true grid.
    expect(gridError(Number(phaseField().value), 401, 128)).toBeLessThanOrEqual(50);

    fireEvent.change(screen.getByLabelText("BPM"), { target: { value: "125" } });
    fireEvent.click(detectButton());
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(detectButton()).toBeEnabled());
    expect(screen.getByLabelText("BPM")).toHaveValue(125);
  });

  it("übernimmt keine Video-BPM, wenn während des Lesens auf den Datei-Tab gewechselt wurde", async () => {
    let finish: (a: AudioAnalysis) => void = () => {};
    analyze.mockReturnValueOnce(new Promise((r) => (finish = r)));
    openDialog();
    await youtubeWithVideo();
    fireEvent.click(detectButton());
    const fileTab = screen.getByRole("tab", { name: "Datei" });
    fireEvent.mouseDown(fileTab);
    fireEvent.click(fileTab);
    finish(await analysisOf(128, 401));
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    const ytTab = screen.getByRole("tab", { name: "YouTube" });
    fireEvent.mouseDown(ytTab);
    fireEvent.click(ytTab);
    expect(screen.getByLabelText("BPM")).toHaveValue(120);
  });

  it("nutzt beim Datei-Tab die Hüllkurve der Musikdatei", async () => {
    const audio = await analysisOf(100, 250);
    analyze.mockResolvedValue(audio);
    openDialog();
    fireEvent.change(await screen.findByLabelText("Audiodatei"), {
      target: { files: [new File(["a"], "song.mp3", { type: "audio/mpeg" })] },
    });
    await waitFor(() => expect(screen.getByLabelText("BPM")).toHaveValue(audio.bpm));
    fireEvent.click(screen.getByRole("radio", { name: "Aus Video" }));
    chooseVideo();
    fireEvent.click(detectButton());
    expect(screen.getByText(/erkannt aus der Musikdatei/)).toBeInTheDocument();
    expect(gridError(Number(phaseField().value), 250, audio.bpm)).toBeLessThanOrEqual(15);
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
