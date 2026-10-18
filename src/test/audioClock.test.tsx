import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAudioClock, type AudioClockOptions } from "@/hooks/useAudioClock";
import { audioTimeMs, frameGameTimeMs, gameTimeMs, MAX_FRAME_AGE_MS } from "@/lib/audio/clock";
import { createSource, type AudioSource } from "@/lib/audio/sources";
import {
  claimSharedElement,
  resetAudioUnlockForTests,
  sharedAudioElement,
  unlockAudio,
} from "@/lib/audio/unlock";
import type { Song } from "@/lib/types";
import { makeChoreo, makeSong } from "./fixtures";

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("Offsets", () => {
  const o = { latencyMs: 80, syncOffsetMs: 30, choreoOffsetMs: -10 };

  it("Spielzeit = Audio − Latenz − Song-Offset − Choreo-Offset", () => {
    expect(gameTimeMs(10_000, o)).toBe(10_000 - 80 - 30 + 10);
    expect(audioTimeMs(gameTimeMs(10_000, o), o)).toBe(10_000);
  });

  it("positive Offsets lassen die Choreografie später kommen", () => {
    // A move at game time 1000 is reached at a later audio position when offsets are positive.
    expect(audioTimeMs(1000, { latencyMs: 100, syncOffsetMs: 0, choreoOffsetMs: 0 })).toBe(1100);
    expect(audioTimeMs(1000, { latencyMs: 0, syncOffsetMs: 50, choreoOffsetMs: 0 })).toBe(1050);
    expect(audioTimeMs(1000, { latencyMs: 0, syncOffsetMs: 0, choreoOffsetMs: 20 })).toBe(1020);
  });

  it("Bildalter: Aufnahmezeitpunkt statt Ankunftszeit, unplausible Werte zählen als 0", () => {
    expect(frameGameTimeMs(5000, 60)).toBe(4940);
    expect(frameGameTimeMs(5000, 60, 0.5)).toBe(4970);
    expect(frameGameTimeMs(5000, -5)).toBe(5000);
    expect(frameGameTimeMs(5000, MAX_FRAME_AGE_MS + 1)).toBe(5000);
    expect(frameGameTimeMs(5000, NaN)).toBe(5000);
  });
});

function fakeSource(over: Partial<AudioSource> = {}): AudioSource & { t: number } {
  const s: AudioSource & { t: number } = {
    t: 0,
    type: "local" as const,
    lowPrecision: false,
    load: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    seek: vi.fn(),
    getTimeMs: (): number => s.t,
    setVolume: vi.fn(),
    onEnded: vi.fn(),
    destroy: vi.fn(),
    ...over,
  };
  return s;
}

let api: ReturnType<typeof useAudioClock> | null = null;
function Probe({ song, opts }: { song: Song | null; opts: AudioClockOptions }) {
  api = useAudioClock(song, opts);
  return null;
}

describe("useAudioClock", () => {
  afterEach(() => {
    api = null;
  });

  it("timeMs zieht globale Latenz, Song- und Choreo-Offset ab", async () => {
    const src = fakeSource();
    const song = { ...makeSong({ ...makeChoreo(), offsetMs: 20 }), syncOffsetMs: 30 };
    render(<Probe song={song} opts={{ latencyMs: 100, volume: 1, create: () => src }} />);
    await flush();
    expect(api!.state).toBe("ready");
    src.t = 5000;
    expect(api!.timeMs()).toBe(5000 - 100 - 30 - 20);
  });

  it("räumt die Quelle beim Verlassen auf", async () => {
    const src = fakeSource();
    const { unmount } = render(
      <Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create: () => src }} />,
    );
    await flush();
    unmount();
    expect(src.destroy).toHaveBeenCalledTimes(1);
  });

  it("ein spät fertiges Laden des alten Songs verändert den neuen nicht", async () => {
    let failOld = (_e: Error) => {};
    const old = fakeSource({ load: () => new Promise((_, rej) => (failOld = rej)) });
    const next = fakeSource({ load: () => new Promise(() => {}) });
    const sources = [old, next];
    const create = () => sources.shift()!;
    const a = makeSong();
    const b = makeSong();
    const { rerender } = render(<Probe song={a} opts={{ latencyMs: 0, volume: 1, create }} />);
    rerender(<Probe song={b} opts={{ latencyMs: 0, volume: 1, create }} />);
    expect(old.destroy).toHaveBeenCalled();
    failOld(new Error("alt"));
    await flush();
    expect(api!.state).toBe("loading");
    expect(api!.error).toBe("");
  });

  it("meldet einen Ladefehler verständlich", async () => {
    const src = fakeSource({ load: async () => Promise.reject(new Error("kaputt")) });
    render(<Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create: () => src }} />);
    await flush();
    expect(api!.state).toBe("error");
    expect(api!.error).toBe("kaputt");
  });
});

describe("Audio-Entsperrung (iOS)", () => {
  afterEach(() => {
    resetAudioUnlockForTests();
    vi.restoreAllMocks();
  });

  it("spielt im Tipp eine stille Datei auf dem gemeinsamen Element an", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    unlockAudio();
    const el = sharedAudioElement();
    expect(play).toHaveBeenCalledTimes(1);
    expect(el.src.startsWith("data:audio/wav;base64,")).toBe(true);
  });

  it("der Song spielt über genau dieses Element, das beim Verlassen erhalten bleibt", async () => {
    unlockAudio();
    const el = claimSharedElement();
    const song = makeSong();
    song.source = { type: "url", url: "https://example.org/a.mp3" };
    const src = createSource(song, { element: el });
    const loading = src.load();
    await Promise.resolve();
    el.dispatchEvent(new Event("loadedmetadata"));
    await loading;
    expect(el.src).toBe("https://example.org/a.mp3");
    src.destroy();
    expect(el.hasAttribute("src")).toBe(false);
    expect(sharedAudioElement()).toBe(el);
  });

  it("Laden hängt nicht, wenn iOS vor der Geste nichts lädt (Timeout)", async () => {
    vi.useFakeTimers();
    const song = makeSong();
    song.source = { type: "url", url: "https://example.org/b.mp3" };
    const src = createSource(song, { element: claimSharedElement() });
    const loading = src.load();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(loading).resolves.toBeUndefined();
    src.destroy();
    vi.useRealTimers();
  });
});
