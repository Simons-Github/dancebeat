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
    onError: vi.fn(),
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

describe("useAudioClock: Laufzeitfehler", () => {
  afterEach(() => {
    api = null;
  });

  it("onError nach dem Laden setzt den Fehlerzustand", async () => {
    let fail = (_m: string) => {};
    const src = fakeSource({ onError: (cb) => (fail = cb) });
    render(<Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create: () => src }} />);
    await flush();
    expect(api!.state).toBe("ready");
    act(() => fail("Verbindung weg"));
    expect(api!.state).toBe("error");
    expect(api!.error).toBe("Verbindung weg");
  });

  it("ein später Fehler des alten Songs wird verworfen", async () => {
    const fails: ((m: string) => void)[] = [];
    const make = () => fakeSource({ onError: (cb) => fails.push(cb) });
    const sources = [make(), make()];
    const create = () => sources.shift()!;
    const { rerender } = render(
      <Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create }} />,
    );
    await flush();
    rerender(<Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create }} />);
    await flush();
    act(() => fails[0]!("alt"));
    expect(api!.state).toBe("ready");
    expect(api!.error).toBe("");
  });
});

describe("URL-Quelle: Puffern und Laufzeitfehler", () => {
  afterEach(() => {
    resetAudioUnlockForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function loadedUrlSource() {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
    });
    const el = document.createElement("audio");
    const song = makeSong();
    song.source = { type: "url", url: "https://example.org/c.mp3" };
    const src = createSource(song, { element: el });
    const loading = src.load();
    await Promise.resolve();
    el.dispatchEvent(new Event("loadedmetadata"));
    await loading;
    vi.spyOn(el, "play").mockResolvedValue();
    return { el, src };
  }

  it("waiting hält die Uhr an, playing setzt sie fort", async () => {
    const { el, src } = await loadedUrlSource();
    // The element's position advances with real playback until it stalls.
    let stalled = false;
    let pos = 1000;
    let last = performance.now();
    Object.defineProperty(el, "currentTime", {
      get: () => {
        const now = performance.now();
        if (!stalled) pos += now - last;
        last = now;
        return pos / 1000;
      },
    });
    await src.play();
    await vi.advanceTimersByTimeAsync(1000);
    expect(src.getTimeMs()).toBeCloseTo(2000, -2);
    stalled = true;
    el.dispatchEvent(new Event("waiting"));
    const held = src.getTimeMs();
    await vi.advanceTimersByTimeAsync(1000);
    expect(src.getTimeMs()).toBe(held);
    stalled = false;
    el.dispatchEvent(new Event("playing"));
    await vi.advanceTimersByTimeAsync(500);
    expect(src.getTimeMs()).toBeGreaterThan(held + 400);
    src.destroy();
  });

  it("Fehler nach dem Laden ruft onError mit Verbindungstext und hält die Uhr an", async () => {
    const { el, src } = await loadedUrlSource();
    const cb = vi.fn();
    src.onError(cb);
    el.dispatchEvent(new Event("error"));
    expect(cb).toHaveBeenCalledWith("Die Verbindung zur Musik ist abgebrochen.");
    src.destroy();
  });

  it("destroy entfernt die Handler", async () => {
    const { el, src } = await loadedUrlSource();
    const cb = vi.fn();
    src.onError(cb);
    src.destroy();
    expect(el.onerror).toBeNull();
    expect(el.onwaiting).toBeNull();
    expect(el.onplaying).toBeNull();
    el.dispatchEvent(new Event("error"));
    expect(cb).not.toHaveBeenCalled();
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

describe("useAudioClock: Start von außen", () => {
  afterEach(() => {
    api = null;
  });

  it("reicht onExternalStart der Quelle an die Option durch", async () => {
    let started = () => {};
    const src = fakeSource({ onExternalStart: (cb) => (started = cb) });
    const onExternalStart = vi.fn();
    render(
      <Probe
        song={makeSong()}
        opts={{ latencyMs: 0, volume: 1, create: () => src, onExternalStart }}
      />,
    );
    await flush();
    act(() => started());
    expect(onExternalStart).toHaveBeenCalledTimes(1);
  });

  it("ein spätes Signal des alten Songs wird verworfen", async () => {
    const starts: (() => void)[] = [];
    const make = () => fakeSource({ onExternalStart: (cb) => starts.push(cb) });
    const sources = [make(), make()];
    const create = () => sources.shift()!;
    const onExternalStart = vi.fn();
    const { rerender } = render(
      <Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create, onExternalStart }} />,
    );
    await flush();
    rerender(
      <Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create, onExternalStart }} />,
    );
    await flush();
    act(() => starts[0]!());
    expect(onExternalStart).not.toHaveBeenCalled();
    act(() => starts[1]!());
    expect(onExternalStart).toHaveBeenCalledTimes(1);
  });

  it("Quellen ohne onExternalStart funktionieren unverändert", async () => {
    const src = fakeSource();
    render(
      <Probe
        song={makeSong()}
        opts={{ latencyMs: 0, volume: 1, create: () => src, onExternalStart: vi.fn() }}
      />,
    );
    await flush();
    expect(api!.state).toBe("ready");
  });
});
