import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioSource } from "@/lib/audio/sources";
import { makeSong } from "./fixtures";

type Sources = typeof import("@/lib/audio/sources");

const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const PlayerError = {
  InvalidParam: 2,
  Html5Error: 5,
  VideoNotFound: 100,
  EmbeddingNotAllowed: 101,
  EmbeddingNotAllowed2: 150,
};

/** Stand-in for YT.Player: keeps the options; the test drives state, time runs while PLAYING. */
class FakePlayer {
  static all: FakePlayer[] = [];
  state = PlayerState.UNSTARTED;
  private time = 0;
  private since = 0;
  playVideo = vi.fn();
  pauseVideo = vi.fn();
  seekTo = vi.fn((sec: number) => {
    this.time = sec;
    this.since = now;
  });
  setVolume = vi.fn();
  destroy = vi.fn();
  constructor(
    public el: HTMLElement,
    public opts: YT.PlayerOptions,
  ) {
    FakePlayer.all.push(this);
  }
  getPlayerState = () => this.state;
  getCurrentTime = () =>
    this.state === PlayerState.PLAYING ? this.time + (now - this.since) / 1000 : this.time;
  private get target() {
    return this as unknown as YT.Player;
  }
  ready() {
    const cb = this.opts.events?.onReady;
    if (typeof cb === "function") cb({ target: this.target });
  }
  emit(state: number) {
    this.time = this.getCurrentTime();
    this.since = now;
    this.state = state;
    const cb = this.opts.events?.onStateChange;
    if (typeof cb === "function") cb({ target: this.target, data: state });
  }
  fail(code: number) {
    const cb = this.opts.events?.onError;
    if (typeof cb === "function") cb({ target: this.target, data: code });
  }
}

function installYT() {
  window.YT = { Player: FakePlayer, PlayerState, PlayerError } as unknown as typeof YT;
}

const ytSong = () => ({
  ...makeSong(),
  source: { type: "youtube" as const, videoId: "aaaaaaaaaaa" },
});

let now = 0;
let mod: Sources;

/** Lets pending promise callbacks run without advancing time. */
const tick = () => vi.advanceTimersByTimeAsync(0);
const advance = async (ms: number) => {
  now += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

/** Settled state of a promise, without awaiting it forever. */
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

async function loaded(): Promise<{ src: AudioSource; player: FakePlayer }> {
  const src = mod.createSource(ytSong());
  const done = src.load();
  await tick();
  const player = FakePlayer.all.at(-1);
  if (!player) throw new Error("no player");
  player.ready();
  await done;
  return { src, player };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  FakePlayer.all = [];
  installYT();
  // Fresh module per test: loadYT caches its promise at module level.
  vi.resetModules();
  mod = await import("@/lib/audio/sources");
});

afterEach(() => {
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("YouTubeSource: Container", () => {
  it("hängt den Host in den Container und startet den Player mit 100 % Größe", async () => {
    const box = document.createElement("div");
    document.body.appendChild(box);
    const src = mod.createSource(ytSong(), { container: box });
    const done = src.load();
    await tick();
    const player = FakePlayer.all.at(-1);
    if (!player) throw new Error("no player");
    expect(box.children).toHaveLength(1);
    expect((box.firstElementChild as HTMLElement).style.position).toBe("absolute");
    expect(player.opts.width).toBe("100%");
    expect(player.opts.height).toBe("100%");
    player.ready();
    await done;
    src.destroy();
    expect(box.children).toHaveLength(0);
    box.remove();
  });

  it("ohne Container bleibt der Player versteckt an body (2×2 px)", async () => {
    const { src, player } = await loaded();
    expect(player.opts.width).toBe(2);
    expect(player.opts.height).toBe(2);
    src.destroy();
  });
});

describe("YouTubeSource: Uhr", () => {
  it("(a) steht nach play() bis PLAYING, dann läuft sie", async () => {
    const { src, player } = await loaded();
    const p = track(src.play());
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(src.getTimeMs()).toBe(0);
    expect(p.state).toBe("pending");

    player.emit(PlayerState.PLAYING);
    await tick();
    expect(p.state).toBe("resolved");
    await advance(300);
    expect(src.getTimeMs()).toBe(300);
    expect(vi.getTimerCount()).toBe(1); // only the resync interval
    src.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(b) BUFFERING mitten im Spiel hält sie an, PLAYING setzt sie fort", async () => {
    const { src, player } = await loaded();
    void src.play();
    player.emit(PlayerState.PLAYING);
    await advance(2000);
    expect(src.getTimeMs()).toBe(2000);

    player.emit(PlayerState.BUFFERING);
    await advance(1500);
    expect(src.getTimeMs()).toBe(2000);

    player.emit(PlayerState.PLAYING);
    await advance(100);
    expect(src.getTimeMs()).toBe(2100);
    src.destroy();
  });
});

describe("YouTubeSource: Start und Autoplay-Sperre", () => {
  it("(c) lehnt nach 4 s bei CUED ab, ruft pauseVideo und hinterlässt keine Timeouts", async () => {
    const { src, player } = await loaded();
    player.emit(PlayerState.CUED);
    const p = track(src.play());
    await advance(mod.YT_PLAY_TIMEOUT_MS - 1);
    expect(p.state).toBe("pending");
    await advance(1);
    expect(p.state).toBe("rejected");
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(src.getTimeMs()).toBe(0);
    src.pause();
    expect(vi.getTimerCount()).toBe(0);
    src.destroy();
  });

  it("(d) BUFFERING nach 4 s gilt als blockiert (iOS), ohne das Puffern anzuhalten", async () => {
    const { src, player } = await loaded();
    const p = track(src.play());
    player.emit(PlayerState.BUFFERING);
    await advance(mod.YT_PLAY_TIMEOUT_MS - 1);
    expect(p.state).toBe("pending");
    await advance(1);
    expect(p.state).toBe("rejected");
    expect((p.error as Error).message).toBe("YouTube hat den Start blockiert. Tippe zum Starten.");
    expect(p.error).toBeInstanceOf(mod.PlayRefusedError);
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(src.getTimeMs()).toBe(0);
    src.destroy();
  });

  it("(d) startet ein langsamer Start nach der Ablehnung doch, meldet er sich als Start von außen", async () => {
    const { src, player } = await loaded();
    const onExternal = vi.fn();
    src.onExternalStart?.(onExternal);
    const p = track(src.play());
    player.emit(PlayerState.BUFFERING);
    await advance(mod.YT_PLAY_TIMEOUT_MS);
    expect(p.state).toBe("rejected");

    player.emit(PlayerState.PLAYING);
    expect(onExternal).toHaveBeenCalledTimes(1);
    await advance(500);
    expect(src.getTimeMs()).toBe(500);
    src.destroy();
  });

  it("(e) zweites play() nach Ablehnung wartet ohne Timeout; Tipp aufs Video löst es auf", async () => {
    const { src, player } = await loaded();
    const first = track(src.play());
    await advance(mod.YT_PLAY_TIMEOUT_MS);
    expect(first.state).toBe("rejected");

    const second = track(src.play());
    expect(player.playVideo).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1); // resync only, no refusal timeouts
    await advance(60_000);
    expect(second.state).toBe("pending");
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);

    // Direct tap on the video: YouTube starts by itself and reports PLAYING.
    player.emit(PlayerState.BUFFERING);
    player.emit(PlayerState.PLAYING);
    await tick();
    expect(second.state).toBe("resolved");
    src.destroy();
  });

  it("nach erfolgreichem Start bekommt ein späteres play() wieder die Timeouts", async () => {
    const { src, player } = await loaded();
    const first = track(src.play());
    await advance(mod.YT_PLAY_TIMEOUT_MS);
    expect(first.state).toBe("rejected");

    const second = track(src.play());
    player.emit(PlayerState.PLAYING);
    await tick();
    expect(second.state).toBe("resolved");

    src.pause();
    player.emit(PlayerState.CUED);
    const third = track(src.play());
    expect(vi.getTimerCount()).toBe(2); // resync + 4 s
    await advance(mod.YT_PLAY_TIMEOUT_MS);
    expect(third.state).toBe("rejected");
    expect(player.pauseVideo).toHaveBeenCalledTimes(3); // refusal, pause, refusal
    src.destroy();
  });

  it("(f) zwei parallele play() → ein playVideo, ein Promise", async () => {
    const { src, player } = await loaded();
    const a = src.play();
    const b = src.play();
    expect(a).toBe(b);
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    player.emit(PlayerState.PLAYING);
    await expect(a).resolves.toBeUndefined();
    src.destroy();
  });

  it("pause() und destroy() lehnen ein ausstehendes play() ab und räumen die Timeouts auf", async () => {
    const { src } = await loaded();
    const a = track(src.play());
    expect(vi.getTimerCount()).toBe(2); // resync + 4 s
    src.pause();
    await tick();
    expect(a.state).toBe("rejected");
    expect(vi.getTimerCount()).toBe(0);

    const b = track(src.play());
    src.destroy();
    await tick();
    expect(b.state).toBe("rejected");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("YouTubeSource: Seek", () => {
  it("(g) seek vor dem Start ruft kein seekTo, play() danach seekTo vor playVideo", async () => {
    const { src, player } = await loaded();
    src.seek(12_000);
    expect(player.seekTo).not.toHaveBeenCalled();
    await advance(1000);
    expect(src.getTimeMs()).toBe(12_000);

    void src.play();
    expect(player.seekTo).toHaveBeenCalledWith(12, true);
    expect(player.seekTo.mock.invocationCallOrder[0]).toBeLessThan(
      player.playVideo.mock.invocationCallOrder[0] ?? 0,
    );
    player.emit(PlayerState.PLAYING);
    await advance(500);
    expect(src.getTimeMs()).toBe(12_500);
    src.destroy();
  });

  it("(h) seek im PAUSED-Zustand lässt die Uhr stehen", async () => {
    const { src, player } = await loaded();
    void src.play();
    player.emit(PlayerState.PLAYING);
    await advance(1000);
    src.pause();
    player.emit(PlayerState.PAUSED);

    src.seek(5000);
    expect(player.seekTo).toHaveBeenCalledWith(5, true);
    await advance(2000);
    expect(src.getTimeMs()).toBe(5000);
    src.destroy();
  });
});

describe("YouTubeSource: Laden", () => {
  it("(i) destroy() während load() erzeugt keinen Player und hinterlässt keinen Timer", async () => {
    delete window.YT;
    const src = mod.createSource(ytSong());
    const done = src.load();
    src.destroy();
    installYT();
    window.onYouTubeIframeAPIReady?.();
    await done;
    expect(FakePlayer.all).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(i) destroy() vor onReady: load() endet, kein Timer, spätes onReady bleibt folgenlos", async () => {
    const src = mod.createSource(ytSong());
    const done = track(src.load());
    await tick();
    const player = FakePlayer.all[0];
    src.destroy();
    await tick();
    expect(done.state).toBe("resolved");
    expect(vi.getTimerCount()).toBe(0);
    expect(player?.destroy).toHaveBeenCalled();

    player?.ready();
    player?.emit(PlayerState.PLAYING);
    expect(vi.getTimerCount()).toBe(0);
    expect(src.getTimeMs()).toBe(0);
  });

  it("(j) loadYT lädt nach Skriptfehler beim nächsten Versuch neu", async () => {
    delete window.YT;
    const first = mod.createSource(ytSong());
    const firstLoad = first.load();
    const s1 = document.head.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    expect(s1).not.toBeNull();
    s1?.onerror?.(new Event("error"));
    await expect(firstLoad).rejects.toThrow("YouTube konnte nicht geladen werden");
    expect(s1?.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    first.destroy();

    const second = mod.createSource(ytSong());
    const secondLoad = second.load();
    const s2 = document.head.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    expect(s2).not.toBeNull();
    expect(s2).not.toBe(s1);
    installYT();
    window.onYouTubeIframeAPIReady?.();
    await tick();
    FakePlayer.all[0]?.ready();
    await expect(secondLoad).resolves.toBeUndefined();
    second.destroy();
  });

  it("(j) loadYT nach Timeout ohne API-Ready lädt beim nächsten Versuch neu", async () => {
    delete window.YT;
    const first = mod.createSource(ytSong());
    const firstLoad = track(first.load());
    await advance(mod.YT_SCRIPT_TIMEOUT_MS);
    expect(firstLoad.state).toBe("rejected");
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    first.destroy();

    const second = mod.createSource(ytSong());
    void second.load().catch(() => {});
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
    second.destroy();
  });

  it("(k) Player läuft über youtube-nocookie.com", async () => {
    const { src, player } = await loaded();
    expect(player.opts.host).toBe("https://www.youtube-nocookie.com");
    expect(player.opts.videoId).toBe("aaaaaaaaaaa");
    src.destroy();
  });

  it("ohne onReady lehnt load() nach YT_LOAD_TIMEOUT_MS ab", async () => {
    const src = mod.createSource(ytSong());
    const done = track(src.load());
    await tick();
    await advance(mod.YT_LOAD_TIMEOUT_MS - 1);
    expect(done.state).toBe("pending");
    await advance(1);
    expect(done.state).toBe("rejected");
    expect((done.error as Error).message).toBe(
      "YouTube-Video lädt nicht. Prüfe Link und Verbindung.",
    );
    expect(vi.getTimerCount()).toBe(0);
    src.destroy();
  });

  it("Fehler vor onReady lehnt load() ab", async () => {
    const src = mod.createSource(ytSong());
    const done = src.load();
    await tick();
    FakePlayer.all[0]?.fail(PlayerError.EmbeddingNotAllowed);
    await expect(done).rejects.toThrow("Dieses Video darf nicht eingebettet werden.");
    expect(vi.getTimerCount()).toBe(0);
    src.destroy();
  });

  it("(l) Fehler nach onReady gehen an den onError-Callback und stoppen die Uhr", async () => {
    const { src, player } = await loaded();
    const onError = vi.fn();
    src.onError(onError);
    const p = track(src.play());
    player.emit(PlayerState.PLAYING);
    await advance(1000);
    expect(p.state).toBe("resolved");

    player.fail(PlayerError.VideoNotFound);
    expect(onError).toHaveBeenCalledWith("YouTube-Video nicht verfügbar.");
    expect(vi.getTimerCount()).toBe(0);
    await advance(1000);
    expect(src.getTimeMs()).toBe(1000);
    src.destroy();
  });
});

describe("YouTubeSource: Start von außen (Tipp aufs Video)", () => {
  it("PLAYING ohne play() ruft onExternalStart genau einmal, die Uhr läuft", async () => {
    const { src, player } = await loaded();
    const onExternal = vi.fn();
    src.onExternalStart?.(onExternal);
    const first = track(src.play());
    await advance(mod.YT_PLAY_TIMEOUT_MS);
    expect(first.state).toBe("rejected");
    player.emit(PlayerState.PAUSED);

    // Direct tap on the video: YouTube starts by itself.
    player.emit(PlayerState.BUFFERING);
    player.emit(PlayerState.PLAYING);
    expect(onExternal).toHaveBeenCalledTimes(1);
    const t0 = src.getTimeMs();
    await advance(1000);
    expect(src.getTimeMs()).toBe(t0 + 1000);
    expect(vi.getTimerCount()).toBe(1); // resync interval

    // Buffering mid-song is no new external start.
    player.emit(PlayerState.BUFFERING);
    player.emit(PlayerState.PLAYING);
    expect(onExternal).toHaveBeenCalledTimes(1);
    src.destroy();
  });

  it("setzt refusedOnce zurück: das nächste play() bei CUED lehnt nach 4 s wieder ab", async () => {
    const { src, player } = await loaded();
    src.onExternalStart?.(() => {});
    const first = track(src.play());
    await advance(mod.YT_PLAY_TIMEOUT_MS);
    expect(first.state).toBe("rejected");
    player.emit(PlayerState.PLAYING);

    src.pause();
    player.emit(PlayerState.CUED);
    const next = track(src.play());
    expect(vi.getTimerCount()).toBe(2); // resync + 4 s
    await advance(mod.YT_PLAY_TIMEOUT_MS);
    expect(next.state).toBe("rejected");
    src.destroy();
  });

  it("PLAYING bei laufendem play() ruft onExternalStart nicht", async () => {
    const { src, player } = await loaded();
    const onExternal = vi.fn();
    src.onExternalStart?.(onExternal);
    const p = track(src.play());
    player.emit(PlayerState.PLAYING);
    await tick();
    expect(p.state).toBe("resolved");
    expect(onExternal).not.toHaveBeenCalled();

    // Pause and resume through play(): still no external start.
    src.pause();
    player.emit(PlayerState.PAUSED);
    const q = track(src.play());
    player.emit(PlayerState.PLAYING);
    await tick();
    expect(q.state).toBe("resolved");
    expect(onExternal).not.toHaveBeenCalled();
    src.destroy();
  });

  it("Start von außen wendet einen gemerkten Seek an (Intro-Sprung im Countdown bleibt)", async () => {
    const { src, player } = await loaded();
    src.onExternalStart?.(() => {});
    player.emit(PlayerState.CUED);
    src.seek(5000); // start(): seek while not started → only remembered
    expect(player.seekTo).not.toHaveBeenCalled();
    // Tap on the video during the countdown.
    player.emit(PlayerState.PLAYING);
    expect(player.seekTo).toHaveBeenCalledWith(5, true);
    expect(src.getTimeMs()).toBe(5000);
    await advance(500);
    expect(src.getTimeMs()).toBe(5500);
    // Re-paused by the game; the countdown's play() continues from there, no second seek.
    src.pause();
    player.emit(PlayerState.PAUSED);
    void src.play();
    player.emit(PlayerState.PLAYING);
    expect(player.seekTo).toHaveBeenCalledTimes(1);
    src.destroy();
  });

  it("play() vor onReady lehnt mit PlayRefusedError ab (ein Tipp kann es nachholen)", async () => {
    const src = mod.createSource(ytSong());
    const e: unknown = await src.play().catch((err: unknown) => err);
    expect(e).toBeInstanceOf(mod.PlayRefusedError);
    expect((e as Error).message).toBe("YouTube-Player ist noch nicht geladen.");
    src.destroy();
  });

  it("nach destroy() bleibt ein spätes PLAYING folgenlos", async () => {
    const { src, player } = await loaded();
    const onExternal = vi.fn();
    src.onExternalStart?.(onExternal);
    src.destroy();
    player.emit(PlayerState.PLAYING);
    expect(onExternal).not.toHaveBeenCalled();
  });
});

describe("YouTubeSource: Pause von außen (Tipp aufs Video)", () => {
  it("PAUSED während der Wiedergabe ruft onExternalPause genau einmal, die Uhr steht", async () => {
    const { src, player } = await loaded();
    const onPause = vi.fn();
    src.onExternalPause?.(onPause);
    void src.play();
    player.emit(PlayerState.PLAYING);
    await advance(1000);
    player.emit(PlayerState.PAUSED);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0); // resync interval cleared
    const held = src.getTimeMs();
    await advance(1000);
    expect(src.getTimeMs()).toBe(held);
    player.emit(PlayerState.PAUSED);
    expect(onPause).toHaveBeenCalledTimes(1);
    src.destroy();
  });

  it("nach eigenem pause() wird kein PAUSED gemeldet; play() danach funktioniert", async () => {
    const { src, player } = await loaded();
    const onPause = vi.fn();
    src.onExternalPause?.(onPause);
    void src.play();
    player.emit(PlayerState.PLAYING);
    src.pause();
    player.emit(PlayerState.PAUSED);
    expect(onPause).not.toHaveBeenCalled();
    const p = track(src.play());
    player.emit(PlayerState.PLAYING);
    await tick();
    expect(p.state).toBe("resolved");
    player.emit(PlayerState.PAUSED);
    expect(onPause).toHaveBeenCalledTimes(1);
    src.destroy();
  });

  it("BUFFERING, ENDED und PAUSED während eines ausstehenden play() melden keine Pause", async () => {
    const { src, player } = await loaded();
    const onPause = vi.fn();
    src.onExternalPause?.(onPause);
    const p = track(src.play());
    player.emit(PlayerState.PAUSED); // pending play: not an external pause
    player.emit(PlayerState.PLAYING);
    await tick();
    expect(p.state).toBe("resolved");
    player.emit(PlayerState.BUFFERING);
    player.emit(PlayerState.PLAYING);
    player.emit(PlayerState.ENDED);
    expect(onPause).not.toHaveBeenCalled();
    src.destroy();
  });

  it("Pause nach einem Start von außen wird ebenfalls gemeldet", async () => {
    const { src, player } = await loaded();
    const onPause = vi.fn();
    src.onExternalStart?.(() => {});
    src.onExternalPause?.(onPause);
    player.emit(PlayerState.PLAYING);
    player.emit(PlayerState.PAUSED);
    expect(onPause).toHaveBeenCalledTimes(1);
    src.destroy();
  });
});
