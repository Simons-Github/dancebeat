import { songRepository } from "../library/repository";
import type { Song } from "../types";

export type SourceType = Song["source"]["type"];

export interface AudioSource {
  type: SourceType;
  lowPrecision: boolean;
  load(): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(ms: number): void;
  getTimeMs(): number;
  setVolume(v: number): void;
  onEnded(cb: () => void): void;
  /** Called when playback breaks after a successful `load()` (connection lost, decode error). */
  onError(cb: (message: string) => void): void;
  destroy(): void;
}

export interface SourceOptions {
  /**
   * Audio element to play through instead of a new one: the shared element unlocked in a user
   * gesture (src/lib/audio/unlock.ts). It is emptied on destroy, never thrown away.
   */
  element?: HTMLAudioElement;
  /**
   * YouTube only: element the player is shown in (fills it). Without it the player stays hidden
   * off screen.
   */
  container?: HTMLElement;
}

/** Interpolierte Uhr: zwischen API-Abfragen per performance.now() fortschreiben, weich angleichen. */
class SmoothClock {
  private base = 0;
  private at = 0;
  private playing = false;
  private rate = 1;
  sync(apiMs: number, playing: boolean, hard = false) {
    const now = performance.now();
    const est = this.get();
    const diff = apiMs - est;
    if (hard || !this.playing || Math.abs(diff) > 400) this.base = apiMs;
    else this.base = est + diff * 0.3; // Sprünge glätten
    this.at = now;
    this.playing = playing;
  }
  setRate(r: number) {
    this.rate = r;
  }
  get() {
    return this.playing ? this.base + (performance.now() - this.at) * this.rate : this.base;
  }
}

/**
 * iOS loads media only after a gesture, so `canplay` may never come before `play()`. Loading
 * therefore counts as done on `loadedmetadata` or `canplay`, or after this timeout (then `play()`
 * does the actual loading). A real error still rejects.
 */
export const LOAD_TIMEOUT_MS = 5000;

class ElementSource implements AudioSource {
  lowPrecision = false;
  el: HTMLAudioElement;
  private shared: boolean;
  private clock = new SmoothClock();
  private timer = 0;
  private destroyed = false;
  /** True while the element stalls for data (`waiting`); the clock holds until `playing`. */
  private waiting = false;
  private errorCb: (message: string) => void = () => {};
  constructor(
    public type: "local" | "url",
    private getUrl: () => Promise<string>,
    private rate = 1,
    element?: HTMLAudioElement,
  ) {
    this.shared = !!element;
    this.el = element ?? new Audio();
    this.el.preload = "auto";
    this.el.defaultPlaybackRate = rate;
    this.el.playbackRate = rate;
    this.clock.setRate(rate);
  }
  private errorMessage() {
    return this.type === "url"
      ? "Die Audio-URL konnte nicht geladen werden. Prüfe den Link und ob die Datei öffentlich erreichbar ist."
      : "Die Audiodatei konnte nicht dekodiert werden. Bitte MP3, M4A, WAV oder OGG verwenden.";
  }
  async load() {
    const url = await this.getUrl();
    // Destroyed while the URL was resolved (song switch, route left): do not touch the element.
    if (this.destroyed) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      return;
    }
    const el = this.el;
    await new Promise<void>((res, rej) => {
      let timeout = 0;
      const done = () => {
        clearTimeout(timeout);
        el.oncanplay = null;
        el.onloadedmetadata = null;
        res();
      };
      el.oncanplay = done;
      el.onloadedmetadata = done;
      el.onerror = () => {
        clearTimeout(timeout);
        rej(new Error(this.errorMessage()));
      };
      timeout = window.setTimeout(done, LOAD_TIMEOUT_MS);
      el.src = url;
      try {
        el.load();
      } catch {
        /* jsdom */
      }
    });
    el.defaultPlaybackRate = this.rate;
    el.playbackRate = this.rate;
    // After loading, errors are runtime errors (connection lost, decode failure mid-song).
    el.onerror = () => {
      if (this.destroyed) return;
      clearInterval(this.timer);
      this.clock.sync(el.currentTime * 1000, false, true);
      this.errorCb(
        this.type === "url" ? "Die Verbindung zur Musik ist abgebrochen." : this.errorMessage(),
      );
    };
    // Buffering: `paused` stays false, so the clock must be held explicitly.
    el.onwaiting = () => {
      this.waiting = true;
      this.clock.sync(el.currentTime * 1000, false, true);
    };
    el.onplaying = () => {
      this.waiting = false;
      this.clock.sync(el.currentTime * 1000, !el.paused, true);
    };
  }
  async play() {
    await this.el.play();
    if (this.destroyed) return;
    this.clock.sync(this.el.currentTime * 1000, true, true);
    clearInterval(this.timer);
    this.timer = window.setInterval(
      () => this.clock.sync(this.el.currentTime * 1000, !this.el.paused && !this.waiting),
      250,
    );
  }
  pause() {
    clearInterval(this.timer);
    this.waiting = false;
    this.el.pause();
    this.clock.sync(this.el.currentTime * 1000, false, true);
  }
  seek(ms: number) {
    this.el.currentTime = ms / 1000;
    this.clock.sync(ms, !this.el.paused && !this.waiting, true);
  }
  getTimeMs() {
    return this.clock.get();
  }
  setVolume(v: number) {
    this.el.volume = v;
  }
  onEnded(cb: () => void) {
    this.el.onended = cb;
  }
  onError(cb: (message: string) => void) {
    this.errorCb = cb;
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    const el = this.el;
    el.pause();
    el.onended = null;
    el.onerror = null;
    el.onwaiting = null;
    el.onplaying = null;
    el.oncanplay = null;
    el.onloadedmetadata = null;
    if (el.src.startsWith("blob:")) URL.revokeObjectURL(el.src);
    if (this.shared) {
      // Keep the (unlocked) element, just drop the song.
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        /* jsdom */
      }
    } else el.src = "";
  }
}

// ---------- YouTube ----------
// SDK types come from @types/youtube and @types/spotify-web-playback-sdk (which also declares
// window.Spotify). The YouTube global is only present after the IFrame API script loaded.
declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let ytReady: Promise<void> | null = null;
/** Script load or `onYouTubeIframeAPIReady` not within this time: give up, the next try reloads. */
export const YT_SCRIPT_TIMEOUT_MS = 15000;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  ytReady ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    let timeout = 0;
    const fail = () => {
      clearTimeout(timeout);
      // Do not cache the failure: the next attempt starts with a fresh script tag.
      ytReady = null;
      s.remove();
      rej(new Error("YouTube konnte nicht geladen werden. Bist du online?"));
    };
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      res();
    };
    timeout = window.setTimeout(fail, YT_SCRIPT_TIMEOUT_MS);
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return ytReady;
}

export function parseYouTubeId(input: string) {
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(input.trim()) ? input.trim() : null;
}

/**
 * `play()` waits for PLAYING. Still UNSTARTED or CUED after this time: autoplay was refused
 * (no gesture reached the iframe). Assumed value, to be tuned on devices.
 */
export const YT_PLAY_TIMEOUT_MS = 4000;
/** BUFFERING at the refusal check: wait up to this time (from `play()`) before giving up. */
export const YT_BUFFER_TIMEOUT_MS = 15000;

const YT_STATE_UNSTARTED = -1;

interface PendingPlay {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
  timers: number[];
}

class YouTubeSource implements AudioSource {
  type = "youtube" as const;
  lowPrecision = true;
  private player: YT.Player | null = null;
  private api: typeof YT | null = null;
  private clock = new SmoothClock();
  private resync = 0;
  private destroyed = false;
  /** Set on `onReady`; errors after that are runtime errors (`onError` callback). */
  private ready = false;
  /** Last state from `onStateChange`; drives the clock. */
  private ytState: number = YT_STATE_UNSTARTED;
  /** Seek before the first start: `seekTo` on an unstarted video would start it (assumption). */
  private pendingSeekMs: number | null = null;
  /** Shared by concurrent `play()` calls; rejected by `pause()`/`destroy()`. */
  private pending: PendingPlay | null = null;
  /** A play() was refused once: later calls wait without timeouts (tap on the video may start it). */
  private refusedOnce = false;
  private loadTimer = 0;
  private settleLoad: (() => void) | null = null;
  private endedCb = () => {};
  private errorCb: (message: string) => void = () => {};
  private host: HTMLDivElement;
  private visible: boolean;
  constructor(
    private videoId: string,
    container?: HTMLElement,
  ) {
    this.visible = !!container;
    this.host = document.createElement("div");
    this.host.style.cssText = container
      ? "position:absolute;inset:0"
      : "position:fixed;width:2px;height:2px;left:-10px;bottom:0;opacity:0.01;pointer-events:none";
    const inner = document.createElement("div");
    this.host.appendChild(inner);
    (container ?? document.body).appendChild(this.host);
  }
  private errorText(api: typeof YT, code: YT.PlayerError) {
    return code === api.PlayerError.EmbeddingNotAllowed ||
      code === api.PlayerError.EmbeddingNotAllowed2
      ? "Dieses Video darf nicht eingebettet werden."
      : "YouTube-Video nicht verfügbar.";
  }
  async load() {
    await loadYT();
    // Destroyed while the API script loaded (song switch, route left): no player.
    if (this.destroyed) return;
    const api = window.YT;
    const el = this.host.firstChild;
    if (!api || !(el instanceof HTMLElement))
      throw new Error("YouTube konnte nicht geladen werden.");
    this.api = api;
    await new Promise<void>((res, rej) => {
      const settle = () => {
        clearTimeout(this.loadTimer);
        this.settleLoad = null;
      };
      // destroy() during the wait ends load() quietly, like ElementSource.
      this.settleLoad = () => {
        settle();
        res();
      };
      this.loadTimer = window.setTimeout(() => {
        settle();
        rej(new Error("YouTube-Video lädt nicht. Prüfe Link und Verbindung."));
      }, 15000);
      this.player = new api.Player(el, {
        videoId: this.videoId,
        width: this.visible ? "100%" : 2,
        height: this.visible ? "100%" : 2,
        host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: {
          onReady: () => {
            if (this.destroyed) return;
            settle();
            this.ready = true;
            res();
          },
          onError: (e: YT.OnErrorEvent) => {
            if (this.destroyed) return;
            const message = this.errorText(api, e.data);
            if (!this.ready) {
              settle();
              rej(new Error(message));
            } else this.fail(message);
          },
          onStateChange: (e: YT.OnStateChangeEvent) => this.stateChanged(api, e.data),
        },
      });
    });
  }
  private currentMs() {
    return this.pendingSeekMs ?? (this.player?.getCurrentTime() ?? 0) * 1000;
  }
  private stateChanged(api: typeof YT, state: YT.PlayerState) {
    if (this.destroyed) return;
    this.ytState = state;
    // Started some other way (direct tap on the video): the remembered seek no longer applies.
    if (state === api.PlayerState.PLAYING) this.pendingSeekMs = null;
    // Game time runs only while YouTube reports PLAYING; buffering and pausing hold it.
    const playing = state === api.PlayerState.PLAYING;
    this.clock.sync(this.currentMs(), playing, true);
    if (playing) this.settlePlay();
    if (state === api.PlayerState.ENDED) this.endedCb();
  }
  private takePending() {
    const p = this.pending;
    if (!p) return null;
    p.timers.forEach((t) => clearTimeout(t));
    this.pending = null;
    return p;
  }
  private settlePlay(error?: Error) {
    const p = this.takePending();
    if (!p) return;
    if (error) p.reject(error);
    else {
      // Started: later play() calls (resume, restart) get the refusal timeouts again.
      this.refusedOnce = false;
      p.resolve();
    }
  }
  /** Runtime error after `onReady`: stop the clock and report it. */
  private fail(message: string) {
    clearInterval(this.resync);
    this.clock.sync(this.currentMs(), false, true);
    this.settlePlay(new Error(message));
    this.errorCb(message);
  }
  private startResync(api: typeof YT) {
    clearInterval(this.resync);
    // Advanced locally per frame (SmoothClock), aligned with the API time every 500 ms.
    this.resync = window.setInterval(() => {
      this.clock.sync(this.currentMs(), this.ytState === api.PlayerState.PLAYING);
    }, 500);
  }
  play(): Promise<void> {
    const player = this.player;
    const api = this.api;
    if (this.destroyed || !player || !api || !this.ready)
      return Promise.reject(new Error("YouTube-Player ist noch nicht geladen."));
    if (this.pending) return this.pending.promise;
    if (this.ytState === api.PlayerState.PLAYING) {
      this.startResync(api);
      return Promise.resolve();
    }
    let resolve = () => {};
    let reject: (e: Error) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const pending: PendingPlay = { promise, resolve, reject, timers: [] };
    this.pending = pending;
    if (this.pendingSeekMs !== null) {
      player.seekTo(this.pendingSeekMs / 1000, true);
      this.pendingSeekMs = null;
    }
    player.playVideo();
    this.startResync(api);
    if (!this.refusedOnce) {
      const refuse = (message: string) => {
        this.refusedOnce = true;
        player.pauseVideo();
        this.settlePlay(new Error(message));
      };
      pending.timers.push(
        window.setTimeout(() => {
          const s = this.ytState;
          if (s === YT_STATE_UNSTARTED || s === api.PlayerState.CUED)
            refuse("YouTube hat den Start blockiert. Tippe zum Starten.");
        }, YT_PLAY_TIMEOUT_MS),
        window.setTimeout(
          () => refuse("YouTube-Video lädt nicht. Prüfe Link und Verbindung."),
          YT_BUFFER_TIMEOUT_MS,
        ),
      );
    }
    return promise;
  }
  pause() {
    clearInterval(this.resync);
    this.settlePlay(new Error("Wiedergabe angehalten."));
    if (!this.player) return;
    this.player.pauseVideo();
    this.clock.sync(this.currentMs(), false, true);
  }
  seek(ms: number) {
    const player = this.player;
    const api = this.api;
    if (!player || !api) {
      this.pendingSeekMs = ms;
      this.clock.sync(ms, false, true);
      return;
    }
    const s = this.ytState;
    const started =
      s === api.PlayerState.PLAYING ||
      s === api.PlayerState.PAUSED ||
      s === api.PlayerState.BUFFERING;
    if (!started && !this.pending) {
      // Not started (UNSTARTED, CUED, ENDED): seekTo would start playback; play() applies it.
      this.pendingSeekMs = ms;
      this.clock.sync(ms, false, true);
      return;
    }
    this.pendingSeekMs = null;
    player.seekTo(ms / 1000, true);
    this.clock.sync(ms, s === api.PlayerState.PLAYING, true);
  }
  getTimeMs() {
    return this.clock.get();
  }
  setVolume(v: number) {
    this.player?.setVolume(Math.round(v * 100));
  }
  onEnded(cb: () => void) {
    this.endedCb = cb;
  }
  onError(cb: (message: string) => void) {
    this.errorCb = cb;
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.resync);
    this.settlePlay(new Error("Wiedergabe beendet."));
    this.settleLoad?.();
    try {
      this.player?.destroy();
    } catch {
      /* */
    }
    this.player = null;
    this.host.remove();
  }
}

// ---------- Spotify (PKCE, Token nur in sessionStorage) ----------
const SP_TOKEN = "dancebeat.spotify.token";
const SP_VERIFIER = "dancebeat.spotify.verifier";
const b64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function spotifyLogin(clientId: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)).buffer);
  sessionStorage.setItem(SP_VERIFIER, verifier);
  const challenge = b64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: location.origin + "/spotify-callback",
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: "streaming user-read-email user-read-private user-modify-playback-state",
  });
  location.href = "https://accounts.spotify.com/authorize?" + p;
}
export async function spotifyExchange(clientId: string, code: string) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: location.origin + "/spotify-callback",
      code_verifier: sessionStorage.getItem(SP_VERIFIER) || "",
    }),
  });
  if (!r.ok) throw new Error("Spotify-Anmeldung fehlgeschlagen.");
  const j = await r.json();
  sessionStorage.setItem(SP_TOKEN, j.access_token);
}
export const spotifyToken = () =>
  typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SP_TOKEN) : null;
export function parseSpotifyUri(input: string) {
  const m = input.match(/track[/:]([A-Za-z0-9]{22})/);
  return m ? `spotify:track:${m[1]}` : null;
}

class SpotifySource implements AudioSource {
  type = "spotify" as const;
  lowPrecision = true;
  private player: Spotify.Player | null = null;
  private deviceId = "";
  private clock = new SmoothClock();
  private poll = 0;
  private endedCb = () => {};
  private errorCb: (message: string) => void = () => {};
  constructor(private uri: string) {}
  async load() {
    const token = spotifyToken();
    if (!token) throw new Error("Bitte zuerst in den Einstellungen mit Spotify verbinden.");
    if (!window.Spotify) {
      await new Promise<void>((res) => {
        window.onSpotifyWebPlaybackSDKReady = () => res();
        const s = document.createElement("script");
        s.src = "https://sdk.scdn.co/spotify-player.js";
        document.head.appendChild(s);
      });
    }
    const player = new window.Spotify.Player({
      name: "DanceBeat",
      getOAuthToken: (cb) => cb(token),
      volume: 0.8,
    });
    this.player = player;
    await new Promise<void>((res, rej) => {
      player.addListener("ready", ({ device_id }: Spotify.WebPlaybackInstance) => {
        this.deviceId = device_id;
        res();
      });
      player.addListener("account_error", () =>
        rej(new Error("Spotify Premium wird benötigt, um im Browser abzuspielen.")),
      );
      player.addListener("authentication_error", () =>
        rej(new Error("Spotify-Anmeldung abgelaufen. Bitte neu verbinden.")),
      );
      player.addListener("initialization_error", () =>
        rej(new Error("Dein Browser unterstützt Spotify-Wiedergabe nicht.")),
      );
      player.addListener("autoplay_failed", () =>
        rej(new Error("Wiedergabe blockiert. Tippe erneut auf Start.")),
      );
      player.addListener("player_state_changed", (s: Spotify.PlaybackState | null) => {
        if (!s) return;
        const pos = s.position + (s.paused ? 0 : Date.now() - s.timestamp);
        this.clock.sync(pos, !s.paused);
        if (s.paused && s.position === 0 && s.track_window?.previous_tracks?.length) this.endedCb();
      });
      void player.connect();
    });
    void player.activateElement();
  }
  async play() {
    const r = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${spotifyToken()}` },
      body: JSON.stringify({ uris: [this.uri] }),
    });
    if (!r.ok) throw new Error("Spotify konnte den Song nicht starten.");
    this.clock.sync(0, true, true);
    this.poll = window.setInterval(async () => {
      const s = await this.player?.getCurrentState();
      if (s) this.clock.sync(s.position, !s.paused);
    }, 500);
  }
  pause() {
    this.player?.pause();
    this.clock.sync(this.clock.get(), false, true);
  }
  seek(ms: number) {
    this.player?.seek(ms);
    this.clock.sync(ms, true, true);
  }
  getTimeMs() {
    return this.clock.get();
  }
  setVolume(v: number) {
    this.player?.setVolume(v);
  }
  onEnded(cb: () => void) {
    this.endedCb = cb;
  }
  onError(cb: (message: string) => void) {
    this.errorCb = cb;
  }
  destroy() {
    clearInterval(this.poll);
    this.player?.disconnect();
  }
}

export function createSource(song: Song, opts: SourceOptions = {}): AudioSource {
  const s = song.source;
  switch (s.type) {
    case "local":
      return new ElementSource(
        "local",
        async () => {
          const b = await songRepository.getAudio(s.blobId);
          if (!b) throw new Error("Audiodatei nicht gefunden.");
          return URL.createObjectURL(b);
        },
        song.playbackRate ?? 1,
        opts.element,
      );
    case "url":
      return new ElementSource("url", async () => s.url, song.playbackRate ?? 1, opts.element);
    case "youtube":
      return new YouTubeSource(s.videoId, opts.container);
    case "spotify":
      return new SpotifySource(s.trackUri);
  }
}

export const isLowPrecision = (song: Song) =>
  song.source.type === "youtube" || song.source.type === "spotify";
