import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { saveSettings } from "@/lib/settings";
import { SYNC_DISCARD_TAPS, SYNC_MIN_TAPS } from "@/lib/sync";
import type { Song } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { makeSong } from "./fixtures";

/** In-memory repository; the real useSongLibrary runs on top of it. */
const repo = vi.hoisted(() => ({
  songs: [] as Song[],
  saved: [] as Song[],
  /** Music blob of local songs (a video blob is music from the dance video). */
  blob: undefined as Blob | undefined,
  /** Kept dance videos by id (8h-2b-1). */
  videos: {} as Record<string, Blob>,
}));
vi.mock("@/lib/library/repository", () => ({
  songRepository: {
    list: async () => repo.songs,
    get: async (id: string) => repo.songs.find((s) => s.id === id),
    save: async (song: Song) => {
      repo.saved.push(song);
      repo.songs = repo.songs.map((s) => (s.id === song.id ? song : s));
      return song;
    },
    delete: async () => {},
    export: async () => "{}",
    getAudio: async () => repo.blob,
    getVideo: async (id: string) => repo.videos[id],
  },
}));
vi.mock("@/data/demo", () => ({
  seedDemos: async () => {},
  markDemoDeleted: () => {},
  DEMO_TITLES: [],
}));

/** Fake audio: time runs (on the fake clock) only while playing. */
const audio = vi.hoisted(() => ({
  playing: false,
  base: 0,
  at: 0,
  loadFails: false,
  /** Set: load() rejects with this message (overrides the default load error text). */
  loadError: null as string | null,
  /** Set: load() waits for this promise (to observe the loading state). */
  loadGate: null as Promise<void> | null,
  /** Set: play() rejects with this real error (not a refusal). */
  playError: null as string | null,
  created: 0,
  /** Source type of every created source. */
  types: [] as string[],
  calls: [] as string[],
  externalPause: null as null | (() => void),
}));
vi.mock("@/lib/audio/sources", () => ({
  isLowPrecision: (song: Song) => song.source.type === "youtube" || song.source.type === "spotify",
  createSource: (song: Song) => {
    audio.created++;
    audio.types.push(song.source.type);
    const now = () => performance.now();
    const time = () => (audio.playing ? audio.base + (now() - audio.at) : audio.base);
    return {
      type: song.source.type,
      lowPrecision: false,
      load: async () => {
        audio.calls.push("load");
        if (audio.loadGate) await audio.loadGate;
        if (audio.loadError) throw new Error(audio.loadError);
        if (audio.loadFails) throw new Error("Die Audiodatei konnte nicht dekodiert werden.");
      },
      play: async () => {
        audio.calls.push("play");
        if (audio.playError) throw new Error(audio.playError);
        audio.base = time();
        audio.at = now();
        audio.playing = true;
      },
      pause: () => {
        audio.base = time();
        audio.playing = false;
      },
      seek: (ms: number) => {
        audio.calls.push(`seek:${ms}`);
        audio.base = ms;
        audio.at = now();
      },
      getTimeMs: time,
      setVolume: () => {},
      onEnded: () => {},
      onError: () => {},
      onExternalStart: () => {},
      onExternalPause: (cb: () => void) => (audio.externalPause = cb),
      destroy: () => void audio.calls.push("destroy"),
    };
  },
}));

const SONG_ID = "6f1c1b7e-2f7a-4c1e-9a55-0c2b8d1e4f10";
let router: ReturnType<typeof createRouter>;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function renderAt(path: string) {
  router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    await router.load();
  });
  render(<RouterProvider router={router} />);
  await advance(0);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });
  repo.songs = [{ ...makeSong(), id: SONG_ID, title: "Pink Pulse", startOffsetMs: 1000 }];
  repo.saved = [];
  repo.blob = undefined;
  repo.videos = {};
  Object.assign(audio, {
    playing: false,
    base: 0,
    at: 0,
    loadFails: false,
    loadError: null,
    loadGate: null,
    playError: null,
    created: 0,
    types: [],
    calls: [],
    externalPause: null,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("Sync-Test", () => {
  it("Taps im Takt ergeben einen Vorschlag, Speichern schreibt syncOffsetMs", async () => {
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("heading", { name: "Sync-Test" })).toBeInTheDocument();
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("0 ms");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    const pad = screen.getByRole("button", { name: "Im Takt tippen" });
    // Before the start taps do not count.
    fireEvent.pointerDown(pad);
    expect(screen.getByTestId("tap-count")).toHaveTextContent("0 Taps");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // seek and play() run synchronously inside the tap (user gesture), before any await.
    expect(audio.calls.slice(-2)).toEqual(["seek:1000", "play"]);
    await advance(0);

    // 120 BPM (500 ms), the player taps 40 ms after each beat (audio 1000 is on the grid).
    await advance(40);
    for (let i = 0; i < SYNC_MIN_TAPS + SYNC_DISCARD_TAPS; i++) {
      if (i % 2) fireEvent.keyDown(window, { key: " ", code: "Space" });
      else fireEvent.pointerDown(pad);
      await advance(500);
    }
    expect(screen.getByTestId("proposed-offset")).toHaveTextContent("+40 ms");
    expect(screen.queryByText(/Ungleichmäßig/)).not.toBeInTheDocument();

    // The proposal only becomes the working value; nothing is written yet.
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Vorschlag übernehmen/ }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+40 ms");
    expect(screen.getByRole("button", { name: /Vorschlag übernehmen/ })).toBeDisabled();
    expect(repo.saved).toHaveLength(0);

    fireEvent.click(save);
    await advance(10);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]?.syncOffsetMs).toBe(40);
    expect(router.state.location.pathname).toBe("/");
    expect(audio.calls).toContain("destroy");
  });

  it("Nochmal verwirft die Taps, Auf 0 zurücksetzen speichert 0", async () => {
    repo.songs = repo.songs.map((s) => ({ ...s, syncOffsetMs: 55 }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("+55 ms");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const pad = screen.getByRole("button", { name: "Im Takt tippen" });
    fireEvent.pointerDown(pad);
    fireEvent.pointerDown(pad);
    expect(screen.getByTestId("tap-count")).toHaveTextContent("2 Taps");
    fireEvent.click(screen.getByRole("button", { name: /Nochmal/ }));
    expect(screen.getByTestId("tap-count")).toHaveTextContent("0 Taps");

    fireEvent.click(screen.getByRole("button", { name: "Auf 0 zurücksetzen" }));
    await advance(10);
    expect(repo.saved.at(-1)?.syncOffsetMs).toBe(0);
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("0 ms");
  });

  it("Auf 0 zurücksetzen schreibt nicht, wenn 0 schon gespeichert ist", async () => {
    await renderAt(`/sync/${SONG_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+10 ms");
    fireEvent.click(screen.getByRole("button", { name: "Auf 0 zurücksetzen" }));
    await advance(10);
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("0 ms");
    expect(repo.saved).toHaveLength(0);
  });

  it("Feinjustierung ändert den Arbeitswert, Speichern schreibt ihn", async () => {
    repo.songs = repo.songs.map((s) => ({ ...s, syncOffsetMs: 995 }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+995 ms");
    const save = screen.getByRole("button", { name: "Speichern" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms verringern" }));
    fireEvent.click(screen.getByRole("button", { name: "Offset um 1 ms verringern" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+984 ms");
    expect(save).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Offset um 1 ms erhöhen" }));
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+995 ms");
    expect(save).toBeDisabled();
    // Clamped at +1000 ms.
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    expect(screen.getByTestId("candidate-offset")).toHaveTextContent("+1000 ms");
    expect(screen.getByTestId("saved-offset")).toHaveTextContent("+995 ms");
    expect(repo.saved).toHaveLength(0);

    fireEvent.click(save);
    await advance(10);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]?.syncOffsetMs).toBe(1000);
    expect(router.state.location.pathname).toBe("/");
  });

  it("Beat-Licht folgt der Uhr mit dem Arbeitswert, ohne React-Render pro Frame", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    onTestFinished(() => void vi.unstubAllGlobals());
    // 120 BPM, start offset 1000 ms: audio 1000 is on a beat; latency and offsets are 0.
    await renderAt(`/sync/${SONG_ID}`);
    const light = screen.getByTestId("beat-light");
    const candidate = screen.getByTestId("candidate-offset");
    expect(light.style.opacity).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const runFrame = () => {
      const cb = frames.shift();
      expect(cb).toBeDefined();
      cb?.(performance.now());
    };
    runFrame();
    expect(Number(light.style.opacity)).toBe(1);
    expect(light.style.transform).toBe("scale(1.12)");

    const before = candidate.textContent;
    await advance(300); // well past the fade
    runFrame();
    expect(Number(light.style.opacity)).toBe(0);
    // Frames do not re-render: the rendered value node is the same and the loop keeps going.
    expect(screen.getByTestId("candidate-offset")).toBe(candidate);
    expect(candidate.textContent).toBe(before);
    expect(frames).toHaveLength(1);

    // +10 ms candidate: audio 1300 → game 1290, still dark; at audio 1510 the light is on.
    fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
    await advance(210);
    runFrame();
    expect(Number(light.style.opacity)).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Stopp" }));
    expect(light.style.opacity).toBe("0");
  });

  it("warnt bei YouTube vor ungenauer Zeitmessung und nennt den Abruf", async () => {
    repo.songs = repo.songs.map((s) => ({
      ...s,
      source: { type: "youtube", videoId: "dQw4w9WgXcQ" },
    }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("note")).toHaveTextContent(/YouTube ist die Zeitmessung ungenauer/);
    expect(screen.getByText(/youtube-nocookie\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/Kamerabilder/)).not.toBeInTheDocument();
  });

  it("unbekannter Song zeigt „Song nicht gefunden“", async () => {
    await renderAt("/sync/00000000-0000-4000-8000-000000000000");
    expect(screen.getByRole("heading", { name: "Song nicht gefunden" })).toBeInTheDocument();
  });

  it("Stopp pausiert die Musik; danach zählen Taps nicht mehr", async () => {
    await renderAt(`/sync/${SONG_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const pad = screen.getByRole("button", { name: "Im Takt tippen" });
    fireEvent.pointerDown(pad);
    fireEvent.click(screen.getByRole("button", { name: "Stopp" }));
    expect(audio.playing).toBe(false);
    fireEvent.pointerDown(pad);
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(screen.getByTestId("tap-count")).toHaveTextContent("1 Taps");
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("Pause direkt im YouTube-Player stoppt wie Stopp; danach zählen Taps nicht mehr", async () => {
    await renderAt(`/sync/${SONG_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const pad = screen.getByRole("button", { name: "Im Takt tippen" });
    fireEvent.pointerDown(pad);
    audio.playing = false;
    act(() => audio.externalPause?.());
    fireEvent.pointerDown(pad);
    expect(screen.getByTestId("tap-count")).toHaveTextContent("1 Taps");
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("zeigt einen Ladefehler und lässt keinen Start zu", async () => {
    audio.loadFails = true;
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Die Musik konnte nicht geladen werden\. Die Audiodatei konnte nicht dekodiert werden/,
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("nennt bei URL-Songs den Host der Audio-URL", async () => {
    repo.songs = repo.songs.map((s) => ({
      ...s,
      source: { type: "url", url: "https://music.example.org/song.mp3" },
    }));
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByText(/von music\.example\.org geladen/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  const SPOTIFY = { type: "spotify", trackUri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" } as const;
  const settingsLink = () => screen.queryByRole("link", { name: /Zu den Einstellungen/ });

  it("Spotify: Quelle wird geladen, Start spielt ab startOffsetMs, Hinweise sichtbar", async () => {
    repo.songs = repo.songs.map((s) => ({ ...s, source: SPOTIFY }));
    let release: () => void = () => {};
    audio.loadGate = new Promise<void>((r) => (release = r));
    await renderAt(`/sync/${SONG_ID}`);
    expect(audio.types).toEqual(["spotify"]);
    expect(audio.calls).toEqual(["load"]);
    expect(screen.getByRole("button", { name: "Musik lädt …" })).toBeDisabled();

    await act(async () => release());
    await advance(0);
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeEnabled();
    expect(screen.getByRole("note")).toHaveTextContent(/Bei Spotify ist die Zeitmessung ungenauer/);
    expect(screen.getByText(/sdk\.scdn\.co/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(settingsLink()).not.toBeInTheDocument();

    fireEvent.click(start);
    // seek and play() run synchronously inside the tap (user gesture), before any await.
    expect(audio.calls.slice(-2)).toEqual(["seek:1000", "play"]);
    await advance(0);
    expect(audio.playing).toBe(true);
    expect(screen.getByRole("button", { name: "Stopp" })).toBeInTheDocument();
  });

  it("Spotify: Ladefehler zeigt die Meldung und einen Link zu den Einstellungen", async () => {
    repo.songs = repo.songs.map((s) => ({ ...s, source: SPOTIFY }));
    audio.loadError = "Spotify ist nicht verbunden.";
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Die Musik konnte nicht geladen werden. Spotify ist nicht verbunden.",
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    const link = settingsLink();
    expect(link).toHaveAttribute("href", "/settings");
    fireEvent.click(link as HTMLElement);
    await advance(10);
    expect(router.state.location.pathname).toBe("/settings");
  });

  it("Spotify: echter Startfehler zeigt die Meldung und einen Link zu den Einstellungen", async () => {
    repo.songs = repo.songs.map((s) => ({ ...s, source: SPOTIFY }));
    audio.playError = "Die Spotify-Sitzung ist abgelaufen.";
    await renderAt(`/sync/${SONG_ID}`);
    expect(settingsLink()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await advance(0);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Die Spotify-Sitzung ist abgelaufen.");
    expect(alert).not.toHaveTextContent("Tippe");
    expect(settingsLink()).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("Ladefehler ohne Spotify: kein Link zu den Einstellungen", async () => {
    audio.loadFails = true;
    await renderAt(`/sync/${SONG_ID}`);
    expect(screen.getByRole("alert")).toHaveTextContent(/Die Musik konnte nicht geladen werden/);
    expect(settingsLink()).not.toBeInTheDocument();
  });

  describe("mit Tanzvideo (8h-2b-2b-2)", () => {
    let created: string[];
    let revoked: string[];
    let frames: FrameRequestCallback[];
    /** Fake media element state: play() starts it, currentTime records seeks (ms). */
    const media = { paused: true, time: 0, seeks: [] as number[], rate: 1 };
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

    beforeEach(() => {
      created = [];
      revoked = [];
      frames = [];
      // jsdom has no object URLs.
      URL.createObjectURL = () => {
        const url = `blob:video-${created.length}`;
        created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url: string) => void revoked.push(url);
      Object.assign(media, { paused: true, time: 0, seeks: [], rate: 1 });
      const proto = HTMLMediaElement.prototype;
      vi.spyOn(proto, "paused", "get").mockImplementation(() => media.paused);
      vi.spyOn(proto, "currentTime", "get").mockImplementation(() => media.time);
      vi.spyOn(proto, "currentTime", "set").mockImplementation((v: number) => {
        media.time = v;
        media.seeks.push(Math.round(v * 1000));
      });
      vi.spyOn(proto, "playbackRate", "get").mockImplementation(() => media.rate);
      vi.spyOn(proto, "playbackRate", "set").mockImplementation((r: number) => {
        media.rate = r;
      });
      vi.spyOn(proto, "play").mockImplementation(() => {
        media.paused = false;
        return Promise.resolve();
      });
      vi.spyOn(proto, "pause").mockImplementation(() => {
        media.paused = true;
      });
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal("cancelAnimationFrame", () => {});
      onTestFinished(() => {
        URL.createObjectURL = original.create;
        URL.revokeObjectURL = original.revoke;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      });
    });

    const runFrame = () => {
      const cb = frames.shift();
      expect(cb).toBeDefined();
      cb?.(performance.now());
    };
    const setSong = (patch: Partial<Song>) => {
      repo.songs = repo.songs.map((s) => ({ ...s, ...patch }));
    };
    const songCard = () => screen.getByRole("heading", { name: "Pink Pulse" }).closest("section")!;
    const videoEl = () => screen.queryByLabelText("Tanzvideo");

    it("eigenes Tanzvideo folgt der Spielzeit mit dem Arbeitswert, Stopp pausiert", async () => {
      saveSettings({ latencyMs: 40 });
      repo.videos = { "video-1": new Blob(["v"], { type: "video/mp4" }) };
      const song = repo.songs[0]!;
      setSong({
        videoBlobId: "video-1",
        syncOffsetMs: 30,
        choreo: { ...song.choreo, offsetMs: 200 },
      });
      await renderAt(`/sync/${SONG_ID}`);
      await advance(0);
      const v = within(songCard()).getByLabelText("Tanzvideo") as HTMLVideoElement;
      expect(v.tagName).toBe("VIDEO");
      expect(v.muted).toBe(true);
      expect(v.getAttribute("src")).toBe("blob:video-0");
      // Stopped: no loop, the video stays paused.
      expect(frames).toHaveLength(0);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      await advance(0);
      runFrame();
      // Audio 1000 → game 1000 − 40 − 30 − 200 = 730 → video 730 + choreo offset 200.
      expect(media.seeks).toEqual([930]);
      expect(media.paused).toBe(false);
      runFrame(); // seek settled at once (no lead for the next seek)

      // +10 ms working value: the next correction lands 10 ms earlier in the video.
      fireEvent.click(screen.getByRole("button", { name: "Offset um 10 ms erhöhen" }));
      await advance(600);
      runFrame();
      // Audio 1600 → video 1600 − 40 − 40 = 1520 (1530 with the saved offset).
      expect(media.seeks).toEqual([930, 1520]);

      fireEvent.click(screen.getByRole("button", { name: "Stopp" }));
      expect(media.paused).toBe(true);
      cleanup();
      expect(revoked).toEqual(["blob:video-0"]);
    });

    it("Musik aus dem Tanzvideo wird gezeigt", async () => {
      repo.blob = new Blob(["v"], { type: "video/mp4" });
      await renderAt(`/sync/${SONG_ID}`);
      await advance(0);
      expect(within(songCard()).getByLabelText("Tanzvideo")).toBeInTheDocument();
    });

    it("Musikdatei ohne Video: kein Video", async () => {
      repo.blob = new Blob(["a"], { type: "audio/mpeg" });
      await renderAt(`/sync/${SONG_ID}`);
      await advance(0);
      expect(videoEl()).toBeNull();
    });

    it("YouTube: kein Tanzvideo, auch mit videoBlobId", async () => {
      repo.videos = { "video-1": new Blob(["v"], { type: "video/mp4" }) };
      setSong({ source: { type: "youtube", videoId: "dQw4w9WgXcQ" }, videoBlobId: "video-1" });
      await renderAt(`/sync/${SONG_ID}`);
      await advance(0);
      expect(videoEl()).toBeNull();
    });

    it("Einstellung Tanzvideo aus: kein Video", async () => {
      saveSettings({ danceVideo: false });
      repo.videos = { "video-1": new Blob(["v"], { type: "video/mp4" }) };
      setSong({ videoBlobId: "video-1" });
      await renderAt(`/sync/${SONG_ID}`);
      await advance(0);
      expect(videoEl()).toBeNull();
    });
  });
});
