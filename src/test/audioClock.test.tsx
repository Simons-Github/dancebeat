import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAudioClock, type AudioClockOptions } from "@/hooks/useAudioClock";
import { audioTimeMs, frameGameTimeMs, gameTimeMs, MAX_FRAME_AGE_MS } from "@/lib/audio/clock";
import {
  CONTEXT_RESUME_TIMEOUT_MS,
  createSource,
  PlayRefusedError,
  type AudioSource,
} from "@/lib/audio/sources";
import {
  claimSharedElement,
  mediaVolumeIgnored,
  musicGainFor,
  resetAudioUnlockForTests,
  sharedAudioContext,
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

  it("Rate skaliert die Latenz (Wandzeit), Umkehrung stimmt, ohne Rate wie vorher", () => {
    const r = { ...o, rate: 1.25 };
    expect(gameTimeMs(10_000, r)).toBe(10_000 - 80 * 1.25 - 30 + 10);
    expect(audioTimeMs(gameTimeMs(10_000, r), r)).toBeCloseTo(10_000, 9);
    expect(gameTimeMs(10_000, { ...o, rate: 1 })).toBe(gameTimeMs(10_000, o));
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

  it("timeMs skaliert die Latenz mit der effektiven Rate (url, YouTube), nicht bei Spotify", async () => {
    const base = makeSong({ ...makeChoreo(), offsetMs: 0 });
    const url = {
      ...base,
      playbackRate: 1.25,
      source: { type: "url" as const, url: "https://x/a.mp3" },
    };
    const yt = { ...url, source: { type: "youtube" as const, videoId: "abcdefghijk" } };
    const sp = { ...url, source: { type: "spotify" as const, trackUri: "spotify:track:x" } };
    for (const [song, expected] of [
      [url, 5000 - 100 * 1.25],
      [yt, 5000 - 100 * 1.25],
      [sp, 5000 - 100],
    ] as const) {
      const src = fakeSource();
      const { unmount } = render(
        <Probe song={song} opts={{ latencyMs: 100, volume: 1, create: () => src }} />,
      );
      await flush();
      src.t = 5000;
      expect(api!.timeMs()).toBe(expected);
      unmount();
    }
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

  it("play(): NotAllowedError und AbortError → PlayRefusedError", async () => {
    const { el, src } = await loadedUrlSource();
    for (const name of ["NotAllowedError", "AbortError"]) {
      vi.spyOn(el, "play").mockRejectedValueOnce(new DOMException("x", name));
      await expect(src.play()).rejects.toBeInstanceOf(PlayRefusedError);
    }
    src.destroy();
  });

  it("play(): andere Ablehnung (NotSupportedError) → normaler Fehler mit Meldung", async () => {
    const { el, src } = await loadedUrlSource();
    vi.spyOn(el, "play").mockRejectedValueOnce(new DOMException("x", "NotSupportedError"));
    const e: unknown = await src.play().catch((err: unknown) => err);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(PlayRefusedError);
    expect((e as Error).message).toMatch(/Audio-URL konnte nicht geladen werden/);
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

describe("URL-Quelle: destroy während des Ladens", () => {
  afterEach(() => {
    resetAudioUnlockForTests();
    vi.useRealTimers();
  });

  it("lässt das gemeinsame Element nach dem Lade-Timeout unberührt", async () => {
    vi.useFakeTimers();
    const el = claimSharedElement();
    const song = makeSong();
    song.source = { type: "url", url: "https://example.org/d.mp3" };
    song.playbackRate = 0.75;
    const src = createSource(song, { element: el });
    const loading = src.load();
    await Promise.resolve();
    src.destroy();
    await expect(loading).resolves.toBeUndefined();
    // The next source (normal tempo) takes the element over.
    el.defaultPlaybackRate = 1;
    el.playbackRate = 1;
    await vi.advanceTimersByTimeAsync(5000);
    expect(el.playbackRate).toBe(1);
    expect(el.defaultPlaybackRate).toBe(1);
    expect(el.onerror).toBeNull();
    expect(el.onwaiting).toBeNull();
    expect(el.onplaying).toBeNull();
    expect(el.oncanplay).toBeNull();
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

  it("reicht onExternalPause der Quelle an die Option durch (aus dem Ref)", async () => {
    let paused = () => {};
    const src = fakeSource({ onExternalPause: (cb) => (paused = cb) });
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Probe
        song={makeSong()}
        opts={{ latencyMs: 0, volume: 1, create: () => src, onExternalPause: first }}
      />,
    );
    await flush();
    rerender(
      <Probe
        song={makeSong()}
        opts={{ latencyMs: 0, volume: 1, create: () => src, onExternalPause: second }}
      />,
    );
    act(() => paused());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reportError setzt denselben Fehlerzustand wie ein Laufzeitfehler", async () => {
    const src = fakeSource();
    render(<Probe song={makeSong()} opts={{ latencyMs: 0, volume: 1, create: () => src }} />);
    await flush();
    expect(api!.state).toBe("ready");
    const report = api!.reportError;
    act(() => report("Startfehler"));
    expect(api!.state).toBe("error");
    expect(api!.error).toBe("Startfehler");
    expect(api!.reportError).toBe(report);
  });

  it("element-Fabrik erhält den Quelltyp des Songs", async () => {
    const audio = document.createElement("audio");
    const element = vi.fn((_type: "local" | "url") => audio);
    const song = makeSong();
    song.source = { type: "url", url: "https://example.org/e.mp3" };
    const { unmount } = render(<Probe song={song} opts={{ latencyMs: 0, volume: 1, element }} />);
    expect(element).toHaveBeenCalledWith("url");
    unmount();
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

/** Minimal AudioContext with the routing graph the iOS volume path builds. */
class FakeAudioContext {
  state: AudioContextState = "suspended";
  /** State `resume()` switches to; "suspended" models a context that never starts. */
  resumeTo: AudioContextState = "running";
  destination = {};
  gainNode = { gain: { value: 1 }, connect: vi.fn() };
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));
  createGain = vi.fn(() => this.gainNode);
  resume = vi.fn(async () => {
    this.state = this.resumeTo;
  });
  createBufferSource = () => ({ buffer: null, connect: () => {}, start: () => {} });
  createBuffer = () => ({});
}
const fakeCtx = () => sharedAudioContext() as unknown as FakeAudioContext;

describe("Lautstärke bei ignoriertem media.volume (iOS)", () => {
  const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
  /** iOS Safari: the volume setter is a no-op, the getter always reports 1. */
  function ignoreMediaVolume() {
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      configurable: true,
      get: () => 1,
      set: () => {},
    });
  }
  afterEach(() => {
    if (volume) Object.defineProperty(HTMLMediaElement.prototype, "volume", volume);
    resetAudioUnlockForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function routedSource() {
    const el = claimSharedElement("local");
    // A URL song on the routed element exercises the same ElementSource without IndexedDB.
    const song = makeSong();
    song.source = { type: "url", url: "https://example.org/r.mp3" };
    const src = createSource(song, { element: el });
    const loading = src.load();
    await Promise.resolve();
    el.dispatchEvent(new Event("loadedmetadata"));
    await loading;
    return { el, src };
  }

  it("Standard (jsdom): kein Routing, beide Typen erhalten das normale Element", () => {
    const ctor = vi.fn();
    vi.stubGlobal("AudioContext", ctor);
    expect(mediaVolumeIgnored()).toBe(false);
    const el = sharedAudioElement();
    expect(claimSharedElement("local")).toBe(el);
    expect(claimSharedElement("url")).toBe(el);
    expect(musicGainFor(el)).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it.each([
    [
      "iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      5,
      true,
    ],
    [
      "iPad (Desktop-UA)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      5,
      true,
    ],
    ["Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0, false],
    ["Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129", 5, false],
  ])("%s: Erkennung auch, wenn volume den Wert zurückliest", (_, ua, touch, expected) => {
    vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints: touch });
    expect(mediaVolumeIgnored()).toBe(expected);
  });

  it("ohne AudioContext bleibt es beim normalen Element", () => {
    ignoreMediaVolume();
    vi.stubGlobal("AudioContext", undefined);
    expect(mediaVolumeIgnored()).toBe(true);
    expect(claimSharedElement("local")).toBe(sharedAudioElement());
  });

  it("Dateien laufen über das geroutete Element (einmal verbunden), URLs über das normale", () => {
    ignoreMediaVolume();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const local = claimSharedElement("local");
    expect(local).not.toBe(sharedAudioElement());
    expect(claimSharedElement("local")).toBe(local);
    expect(claimSharedElement("url")).toBe(sharedAudioElement());
    const ctx = fakeCtx();
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(ctx.createMediaElementSource).toHaveBeenCalledWith(local);
    expect(ctx.gainNode.connect).toHaveBeenCalledWith(ctx.destination);
    expect(musicGainFor(local)).toBe(ctx.gainNode);
    expect(musicGainFor(sharedAudioElement())).toBeNull();
  });

  it("schlägt das Routing fehl, gibt es das normale Element", () => {
    ignoreMediaVolume();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const ctx = fakeCtx();
    ctx.createMediaElementSource.mockImplementation(() => {
      throw new DOMException("x", "InvalidStateError");
    });
    expect(claimSharedElement("local")).toBe(sharedAudioElement());
    expect(claimSharedElement("local")).toBe(sharedAudioElement());
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("setVolume setzt den Gain des gerouteten Elements", async () => {
    ignoreMediaVolume();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const { src } = await routedSource();
    src.setVolume(0.3);
    expect(fakeCtx().gainNode.gain.value).toBe(0.3);
    src.destroy();
  });

  it("Entsperren spielt die stille Datei auf beiden Elementen an", () => {
    ignoreMediaVolume();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    unlockAudio();
    const local = claimSharedElement("local");
    expect(play).toHaveBeenCalledTimes(2);
    expect(play.mock.contexts).toContain(sharedAudioElement());
    expect(play.mock.contexts).toContain(local);
    expect(local.src.startsWith("data:audio/wav;base64,")).toBe(true);
  });

  it("play(): Kontext erreicht nie running → PlayRefusedError, Element pausiert", async () => {
    ignoreMediaVolume();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.useFakeTimers();
    const { el, src } = await routedSource();
    const ctx = fakeCtx();
    ctx.resumeTo = "suspended";
    const pause = vi.spyOn(el, "pause");
    const result = src.play().catch((e: unknown) => e);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CONTEXT_RESUME_TIMEOUT_MS);
    expect(await result).toBeInstanceOf(PlayRefusedError);
    expect(pause).toHaveBeenCalled();
    src.destroy();
  });

  it("play(): Kontext läuft → normaler Start", async () => {
    ignoreMediaVolume();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const { el, src } = await routedSource();
    const pause = vi.spyOn(el, "pause");
    await expect(src.play()).resolves.toBeUndefined();
    expect(fakeCtx().resume).toHaveBeenCalled();
    expect(fakeCtx().state).toBe("running");
    expect(pause).not.toHaveBeenCalled();
    src.destroy();
  });
});
