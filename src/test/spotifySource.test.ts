import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioSource } from "@/lib/audio/sources";
import { makeSong } from "./fixtures";

type Sources = typeof import("@/lib/audio/sources");
type Auth = typeof import("@/lib/audio/spotifyAuth");

const auth = vi.hoisted(() => ({ getSpotifyToken: vi.fn<() => Promise<string>>() }));
// Stays active across vi.resetModules(); SpotifyAuthError remains the real class.
vi.mock("@/lib/audio/spotifyAuth", async (importActual) => ({
  ...(await importActual<Auth>()),
  getSpotifyToken: auth.getSpotifyToken,
}));

type Listener = (arg: unknown) => void;

/** Stand-in for Spotify.Player: keeps options and listeners; the test emits the events. */
class FakeSpotifyPlayer {
  static all: FakeSpotifyPlayer[] = [];
  static connectResult = true;
  listeners = new Map<string, Listener[]>();
  connect = vi.fn(() => Promise.resolve(FakeSpotifyPlayer.connectResult));
  disconnect = vi.fn();
  activateElement = vi.fn(() => Promise.resolve());
  pause = vi.fn(() => Promise.resolve());
  resume = vi.fn(() => Promise.resolve());
  seek = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  setVolume = vi.fn<(v: number) => Promise<void>>(() => Promise.resolve());
  getCurrentState = vi.fn(() => Promise.resolve<Spotify.PlaybackState | null>(null));
  constructor(public opts: Spotify.PlayerInit) {
    FakeSpotifyPlayer.all.push(this);
  }
  addListener(event: string, cb: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return true;
  }
  emit(event: string, arg?: unknown) {
    this.listeners.get(event)?.forEach((cb) => cb(arg));
  }
}

function installSpotify() {
  window.Spotify = { Player: FakeSpotifyPlayer } as unknown as typeof Spotify;
}

const URI = "spotify:track:aaaaaaaaaaaaaaaaaaaaaa";
const spSong = () => ({ ...makeSong(), source: { type: "spotify" as const, trackUri: URI } });

/** Playback state as the SDK reports it; `ended` puts the track into previous_tracks. */
function state(paused: boolean, position: number, ended = false) {
  return {
    paused,
    position,
    timestamp: now,
    track_window: { previous_tracks: ended ? [{}] : [], current_track: {}, next_tracks: [] },
  } as unknown as Spotify.PlaybackState;
}

let now = 0;
let mod: Sources;
type FetchFn = (url: string, init?: RequestInit) => Promise<{ ok: boolean }>;
let fetchMock: ReturnType<typeof vi.fn<FetchFn>>;

const tick = () => vi.advanceTimersByTimeAsync(0);
const advance = async (ms: number) => {
  now += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

function track(p: Promise<void>) {
  const r: { state: "pending" | "resolved" | "rejected"; error?: unknown } = { state: "pending" };
  p.then(
    () => (r.state = "resolved"),
    (e: unknown) => {
      r.state = "rejected";
      r.error = e;
    },
  );
  return r;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "");

/** Creates the source and starts `load()`; the player exists but is not ready yet. */
async function created() {
  const src = mod.createSource(spSong());
  const done = track(src.load());
  await tick();
  return { src, done, player: FakeSpotifyPlayer.all.at(-1) };
}

async function loaded(): Promise<{ src: AudioSource; player: FakeSpotifyPlayer }> {
  const { src, done, player } = await created();
  if (!player) throw new Error("no player");
  player.emit("ready", { device_id: "dev 1" });
  await tick();
  expect(done.state).toBe("resolved");
  return { src, player };
}

/** Loaded and started (PUT sent, start confirmed by a playing state). */
async function started(seekMs = 0) {
  const { src, player } = await loaded();
  if (seekMs) src.seek(seekMs);
  const p = track(src.play());
  await tick();
  player.emit("player_state_changed", state(false, seekMs));
  await tick();
  expect(p.state).toBe("resolved");
  return { src, player };
}

const putBody = (call = 0) => {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(init?.body as string) as unknown;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  auth.getSpotifyToken.mockReset().mockResolvedValue("tok");
  fetchMock = vi.fn<FetchFn>(() => Promise.resolve({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  FakeSpotifyPlayer.all = [];
  FakeSpotifyPlayer.connectResult = true;
  installSpotify();
  // Fresh module per test: loadSpotifySdk caches its promise at module level.
  vi.resetModules();
  mod = await import("@/lib/audio/sources");
});

afterEach(() => {
  delete (window as Partial<Window>).Spotify;
  delete (window as Partial<Window>).onSpotifyWebPlaybackSDKReady;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SpotifySource: SDK laden", () => {
  const sdkScripts = () =>
    [...document.head.querySelectorAll("script")].filter((s) => s.src === mod.SPOTIFY_SDK_URL);

  it("hängt das Skript an und erzeugt den Player nach onSpotifyWebPlaybackSDKReady", async () => {
    delete (window as Partial<Window>).Spotify;
    const { player } = await created();
    expect(player).toBeUndefined();
    expect(sdkScripts()).toHaveLength(1);
    installSpotify();
    window.onSpotifyWebPlaybackSDKReady();
    await tick();
    expect(FakeSpotifyPlayer.all).toHaveLength(1);
    expect(FakeSpotifyPlayer.all[0]?.opts.name).toBe("DanceBeat");
  });

  it("Skriptfehler lehnt ab, entfernt das Skript, der nächste Versuch lädt neu", async () => {
    delete (window as Partial<Window>).Spotify;
    const { done } = await created();
    sdkScripts()[0]?.dispatchEvent(new Event("error"));
    await tick();
    expect(done.state).toBe("rejected");
    expect(message(done.error)).toBe("Spotify konnte nicht geladen werden. Bist du online?");
    expect(sdkScripts()).toHaveLength(0);
    await created();
    expect(sdkScripts()).toHaveLength(1);
  });

  it("Timeout beim Skript lehnt ab, der nächste Versuch lädt neu", async () => {
    delete (window as Partial<Window>).Spotify;
    const { done } = await created();
    await advance(mod.SPOTIFY_SCRIPT_TIMEOUT_MS);
    expect(done.state).toBe("rejected");
    expect(message(done.error)).toBe("Spotify konnte nicht geladen werden. Bist du online?");
    expect(sdkScripts()).toHaveLength(0);
    await created();
    expect(sdkScripts()).toHaveLength(1);
  });
});

describe("SpotifySource: load", () => {
  it("löst erst bei ready auf", async () => {
    const { done, player } = await created();
    await advance(1000);
    expect(done.state).toBe("pending");
    player?.emit("ready", { device_id: "d" });
    await tick();
    expect(done.state).toBe("resolved");
  });

  it("ohne ready lehnt es nach SPOTIFY_READY_TIMEOUT_MS ab", async () => {
    const { done } = await created();
    await advance(mod.SPOTIFY_READY_TIMEOUT_MS);
    expect(done.state).toBe("rejected");
    expect(message(done.error)).toBe("Spotify-Player lädt nicht. Prüfe deine Verbindung.");
  });

  it("account_error vor ready lehnt mit der Premium-Meldung ab", async () => {
    const { done, player } = await created();
    player?.emit("account_error", { message: "x" });
    await tick();
    expect(message(done.error)).toBe("Spotify Premium wird benötigt, um im Browser abzuspielen.");
  });

  it("connect() mit false lehnt ab", async () => {
    FakeSpotifyPlayer.connectResult = false;
    const { done } = await created();
    expect(done.state).toBe("rejected");
    expect(message(done.error)).toBe("Spotify-Player konnte sich nicht verbinden.");
  });

  it("destroy() während des Wartens beendet load still", async () => {
    const { src, done, player } = await created();
    src.destroy();
    await tick();
    expect(done.state).toBe("resolved");
    expect(player?.disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wirft getSpotifyToken, lehnt load ab", async () => {
    auth.getSpotifyToken.mockRejectedValue(new Error("Nicht verbunden"));
    const { done } = await created();
    expect(message(done.error)).toBe("Nicht verbunden");
    expect(FakeSpotifyPlayer.all).toHaveLength(0);
  });

  it("setVolume vor load erzeugt den Player mit dieser Lautstärke", async () => {
    const src = mod.createSource(spSong());
    src.setVolume(0.3);
    void src.load();
    await tick();
    expect(FakeSpotifyPlayer.all[0]?.opts.volume).toBe(0.3);
  });
});

describe("SpotifySource: erster Start", () => {
  it("sendet PUT mit position_ms, wartet auf den Status, dann läuft die Uhr", async () => {
    const { src, player } = await loaded();
    src.seek(12345);
    const p = track(src.play());
    expect(player.activateElement).toHaveBeenCalledTimes(1);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.spotify.com/v1/me/player/play?device_id=dev%201");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(putBody()).toEqual({ uris: [URI], position_ms: 12345 });

    // Not running before the player confirms.
    await advance(1000);
    expect(p.state).toBe("pending");
    expect(src.getTimeMs()).toBe(12345);

    player.emit("player_state_changed", state(false, 12345));
    await tick();
    expect(p.state).toBe("resolved");
    await advance(300);
    expect(src.getTimeMs()).toBe(12645);
  });

  it("seek während des Starts wird nach der Bestätigung nachgeholt", async () => {
    const { src, player } = await loaded();
    src.seek(1000);
    void src.play();
    await tick();
    src.seek(4000);
    player.emit("player_state_changed", state(false, 1000));
    await tick();
    expect(player.seek).toHaveBeenCalledWith(4000);
    expect(src.getTimeMs()).toBe(4000);
  });

  it("fetch mit ok:false lehnt mit eigener Meldung ab (kein PlayRefusedError)", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { src } = await loaded();
    const p = track(src.play());
    await tick();
    expect(message(p.error)).toBe("Spotify konnte den Song nicht starten.");
    expect(p.error).not.toBeInstanceOf(mod.PlayRefusedError);
  });

  it("fetch wirft: Spotify nicht erreichbar", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { src } = await loaded();
    const p = track(src.play());
    await tick();
    expect(message(p.error)).toBe("Spotify ist nicht erreichbar. Bist du online?");
  });

  it("autoplay_failed lehnt mit PlayRefusedError ab, die Wiederholung behält position_ms", async () => {
    const { src, player } = await loaded();
    src.seek(12345);
    const p = track(src.play());
    await tick();
    player.emit("autoplay_failed");
    await tick();
    expect(p.error).toBeInstanceOf(mod.PlayRefusedError);
    void src.play();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(putBody(1)).toEqual({ uris: [URI], position_ms: 12345 });
  });

  it("ohne Bestätigung nach SPOTIFY_PLAY_TIMEOUT_MS: PlayRefusedError und pause()", async () => {
    const { src, player } = await loaded();
    const p = track(src.play());
    await advance(mod.SPOTIFY_PLAY_TIMEOUT_MS);
    expect(p.error).toBeInstanceOf(mod.PlayRefusedError);
    expect(player.pause).toHaveBeenCalled();
  });

  it("play() vor ready: PlayRefusedError", async () => {
    const { src } = await created();
    await expect(src.play()).rejects.toBeInstanceOf(mod.PlayRefusedError);
  });

  it("pause() während des Starts lehnt play ab; kommt der PUT danach, wird pausiert", async () => {
    let answer: (r: { ok: boolean }) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((res) => (answer = res)));
    const { src, player } = await loaded();
    const p = track(src.play());
    await tick();
    src.pause();
    await tick();
    expect(p.state).toBe("rejected");
    expect(player.pause).not.toHaveBeenCalled();
    answer({ ok: true });
    await tick();
    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  // Regression: the late answer of an abandoned PUT must not pause the start that replaced it.
  it("eine verspätete Antwort eines alten PUT pausiert den neueren Start nicht", async () => {
    const answers: ((r: { ok: boolean }) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise((res) => answers.push(res)));
    const { src, player } = await loaded();
    void src.play().catch(() => {});
    await tick();
    src.pause();
    const p = track(src.play());
    await tick();
    expect(answers).toHaveLength(2);
    answers[1]?.({ ok: true });
    await tick();
    player.emit("player_state_changed", state(false, 0));
    await tick();
    expect(p.state).toBe("resolved");
    answers[0]?.({ ok: true });
    await tick();
    expect(player.pause).not.toHaveBeenCalled();
  });
});

describe("SpotifySource: Pause und Fortsetzen", () => {
  it("pause hält die Uhr an, play setzt per resume() fort, seek geht direkt an den Player", async () => {
    const { src, player } = await started();
    await advance(1000);
    src.pause();
    expect(player.pause).toHaveBeenCalledTimes(1);
    await advance(500);
    expect(src.getTimeMs()).toBe(1000);

    src.seek(5000);
    expect(player.seek).toHaveBeenCalledWith(5000);
    expect(src.getTimeMs()).toBe(5000);

    const p = track(src.play());
    await tick();
    expect(player.resume).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    player.emit("player_state_changed", state(false, 5000));
    await tick();
    expect(p.state).toBe("resolved");
  });
});

describe("SpotifySource: Laufzeitfehler", () => {
  it.each([
    ["account_error", "Spotify Premium wird benötigt, um im Browser abzuspielen."],
    ["playback_error", "Spotify konnte den Song nicht abspielen."],
    ["not_ready", "Die Verbindung zu Spotify ist abgebrochen."],
  ])("%s nach ready: onError, Uhr steht", async (event, text) => {
    const { src, player } = await started();
    const onError = vi.fn();
    src.onError(onError);
    await advance(1000);
    player.emit(event, { message: "x" });
    expect(onError).toHaveBeenCalledWith(text);
    await advance(1000);
    expect(src.getTimeMs()).toBe(1000);
  });

  it("Fehler während offenem play lehnt play ab", async () => {
    const { src, player } = await loaded();
    src.onError(() => {});
    const p = track(src.play());
    await tick();
    player.emit("playback_error", { message: "x" });
    await tick();
    expect(message(p.error)).toBe("Spotify konnte den Song nicht abspielen.");
  });
});

describe("SpotifySource: Ende und Pause von außen", () => {
  it("Ende meldet onEnded genau einmal, danach startet play wieder per PUT", async () => {
    const { src, player } = await started();
    const onEnded = vi.fn();
    const onPause = vi.fn();
    src.onEnded(onEnded);
    src.onExternalPause?.(onPause);
    player.emit("player_state_changed", state(true, 0, true));
    player.emit("player_state_changed", state(true, 0, true));
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    void src.play();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Pause von außen meldet onExternalPause, Start von außen onExternalStart", async () => {
    const { src, player } = await started();
    const onPause = vi.fn();
    const onStart = vi.fn();
    src.onExternalPause?.(onPause);
    src.onExternalStart?.(onStart);
    player.emit("player_state_changed", state(true, 3000));
    expect(onPause).toHaveBeenCalledTimes(1);
    player.emit("player_state_changed", state(false, 3000));
    expect(onStart).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(src.getTimeMs()).toBe(3200);
  });

  it("Status null während der Wiedergabe gilt als Pause von außen", async () => {
    const { src, player } = await started();
    const onPause = vi.fn();
    src.onExternalPause?.(onPause);
    await advance(700);
    player.emit("player_state_changed", null);
    expect(onPause).toHaveBeenCalledTimes(1);
    await advance(500);
    expect(src.getTimeMs()).toBe(700);
  });
});

describe("SpotifySource: Rennen und Wiederverbindung", () => {
  it("pause() nach angenommenem PUT, vor dem Status: pausiert, späteres Spielen bleibt aus", async () => {
    const { src, player } = await loaded();
    const ext = vi.fn();
    src.onExternalStart?.(ext);
    src.seek(2000);
    const p = track(src.play());
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    src.pause();
    await tick();
    expect(p.state).toBe("rejected");
    expect(player.pause).toHaveBeenCalledTimes(1);
    player.emit("player_state_changed", state(false, 2000));
    await advance(1000);
    expect(src.getTimeMs()).toBe(2000);
    expect(player.pause).toHaveBeenCalledTimes(2);
    expect(ext).not.toHaveBeenCalled();
  });

  it("nach Status null startet play() wieder per PUT ab der aktuellen Position", async () => {
    const { src, player } = await started(2000);
    await advance(1000);
    player.emit("player_state_changed", null);
    await tick();
    void src.play().catch(() => {});
    await tick();
    expect(player.resume).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(putBody(1)).toEqual({ uris: [URI], position_ms: 3000 });
  });

  it("nach autoplay_failed zählt ein spielender Status nicht als Start von außen", async () => {
    const { src, player } = await started(1000);
    const ext = vi.fn();
    src.onExternalStart?.(ext);
    player.emit("autoplay_failed");
    const t = src.getTimeMs();
    player.emit("player_state_changed", state(false, 1000));
    await advance(1000);
    expect(ext).not.toHaveBeenCalled();
    expect(src.getTimeMs()).toBe(t);
    expect(player.pause).toHaveBeenCalled();
  });

  it("not_ready: play() ist ein echter Fehler; nach erneutem ready Start an das neue Gerät", async () => {
    const { src, player } = await started(1000);
    player.emit("not_ready", { device_id: "dev 1" });
    const p = track(src.play());
    await tick();
    expect(p.state).toBe("rejected");
    expect(p.error).not.toBeInstanceOf(mod.PlayRefusedError);
    player.emit("ready", { device_id: "dev 2" });
    void src.play().catch(() => {});
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("device_id=dev%202");
    expect(putBody(1)).toEqual({ uris: [URI], position_ms: 1000 });
  });

  it("play() ohne load(): echter Fehler statt PlayRefusedError", async () => {
    const src = mod.createSource(spSong());
    const p = track(src.play());
    await tick();
    expect(p.state).toBe("rejected");
    expect(p.error).not.toBeInstanceOf(mod.PlayRefusedError);
    expect(message(p.error)).toBe("Spotify-Player ist nicht bereit.");
  });
});

describe("SpotifySource: Poll und destroy", () => {
  it("fragt alle SPOTIFY_POLL_MS den Status ab, solange aktiv", async () => {
    const { src, player } = await started();
    await advance(mod.SPOTIFY_POLL_MS);
    expect(player.getCurrentState).toHaveBeenCalledTimes(1);
    await advance(mod.SPOTIFY_POLL_MS);
    expect(player.getCurrentState).toHaveBeenCalledTimes(2);
    src.pause();
    await advance(mod.SPOTIFY_POLL_MS * 3);
    expect(player.getCurrentState).toHaveBeenCalledTimes(2);
  });

  it("destroy trennt den Player, lehnt offenes play ab und stoppt den Poll", async () => {
    const { src, player } = await started();
    src.pause();
    const p = track(src.play());
    await tick();
    src.destroy();
    await tick();
    expect(player.disconnect).toHaveBeenCalledTimes(1);
    expect(p.state).toBe("rejected");
    await advance(mod.SPOTIFY_POLL_MS * 3);
    expect(player.getCurrentState).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
