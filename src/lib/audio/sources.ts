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
  destroy(): void;
}

export interface SourceOptions {
  /**
   * Audio element to play through instead of a new one: the shared element unlocked in a user
   * gesture (src/lib/audio/unlock.ts). It is emptied on destroy, never thrown away.
   */
  element?: HTMLAudioElement;
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
  constructor(
    public type: "local" | "url",
    private getUrl: () => Promise<string>,
    private rate = 1,
    element?: HTMLAudioElement,
  ) {
    this.shared = !!element;
    this.el = element ?? new Audio();
    this.el.preload = "auto";
    this.el.playbackRate = rate;
    this.clock.setRate(rate);
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
        rej(
          new Error(
            this.type === "url"
              ? "Die Audio-URL konnte nicht geladen werden. Prüfe den Link und ob die Datei öffentlich erreichbar ist."
              : "Die Audiodatei konnte nicht dekodiert werden. Bitte MP3, M4A, WAV oder OGG verwenden.",
          ),
        );
      };
      timeout = window.setTimeout(done, LOAD_TIMEOUT_MS);
      el.src = url;
      try {
        el.load();
      } catch {
        /* jsdom */
      }
    });
    el.playbackRate = this.rate;
  }
  async play() {
    await this.el.play();
    if (this.destroyed) return;
    this.clock.sync(this.el.currentTime * 1000, true, true);
    clearInterval(this.timer);
    this.timer = window.setInterval(
      () => this.clock.sync(this.el.currentTime * 1000, !this.el.paused),
      250,
    );
  }
  pause() {
    clearInterval(this.timer);
    this.el.pause();
    this.clock.sync(this.el.currentTime * 1000, false, true);
  }
  seek(ms: number) {
    this.el.currentTime = ms / 1000;
    this.clock.sync(ms, !this.el.paused, true);
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
  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    const el = this.el;
    el.pause();
    el.onended = null;
    el.onerror = null;
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
function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  ytReady ??= new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = () => res();
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => rej(new Error("YouTube konnte nicht geladen werden. Bist du online?"));
    document.head.appendChild(s);
  });
  return ytReady;
}

export function parseYouTubeId(input: string) {
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(input.trim()) ? input.trim() : null;
}

class YouTubeSource implements AudioSource {
  type = "youtube" as const;
  lowPrecision = true;
  private player: YT.Player | null = null;
  private clock = new SmoothClock();
  private poll = 0;
  private resync = 0;
  private endedCb = () => {};
  private host: HTMLDivElement;
  constructor(private videoId: string) {
    this.host = document.createElement("div");
    this.host.style.cssText =
      "position:fixed;width:2px;height:2px;left:-10px;bottom:0;opacity:0.01;pointer-events:none";
    const inner = document.createElement("div");
    this.host.appendChild(inner);
    document.body.appendChild(this.host);
  }
  async load() {
    await loadYT();
    const api = window.YT;
    const el = this.host.firstChild;
    if (!api || !(el instanceof HTMLElement))
      throw new Error("YouTube konnte nicht geladen werden.");
    await new Promise<void>((res, rej) => {
      const t = setTimeout(
        () => rej(new Error("YouTube-Video lädt nicht. Prüfe Link und Verbindung.")),
        15000,
      );
      this.player = new api.Player(el, {
        videoId: this.videoId,
        width: 2,
        height: 2,
        playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: {
          onReady: () => {
            clearTimeout(t);
            res();
          },
          onError: (e: YT.OnErrorEvent) => {
            clearTimeout(t);
            rej(
              new Error(
                e.data === api.PlayerError.EmbeddingNotAllowed ||
                  e.data === api.PlayerError.EmbeddingNotAllowed2
                  ? "Dieses Video darf nicht eingebettet werden."
                  : "YouTube-Video nicht verfügbar.",
              ),
            );
          },
          onStateChange: (e: YT.OnStateChangeEvent) => {
            if (e.data === api.PlayerState.ENDED) this.endedCb();
          },
        },
      });
    });
  }
  async play() {
    const player = this.player;
    if (!player) throw new Error("YouTube-Player ist noch nicht geladen.");
    player.playVideo();
    this.clock.sync(player.getCurrentTime() * 1000, true, true);
    clearInterval(this.poll);
    clearInterval(this.resync);
    // Alle ~16 ms lokal fortgeschrieben (SmoothClock), alle 500 ms an API-Zeit angleichen
    this.resync = window.setInterval(() => {
      const playing = player.getPlayerState() === YT.PlayerState.PLAYING;
      this.clock.sync(player.getCurrentTime() * 1000, playing);
    }, 500);
  }
  pause() {
    if (!this.player) return;
    this.player.pauseVideo();
    this.clock.sync(this.player.getCurrentTime() * 1000, false, true);
  }
  seek(ms: number) {
    this.player?.seekTo(ms / 1000, true);
    this.clock.sync(ms, true, true);
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
  destroy() {
    clearInterval(this.poll);
    clearInterval(this.resync);
    try {
      this.player?.destroy();
    } catch {
      /* */
    }
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
      return new YouTubeSource(s.videoId);
    case "spotify":
      return new SpotifySource(s.trackUri);
  }
}

export const isLowPrecision = (song: Song) =>
  song.source.type === "youtube" || song.source.type === "spotify";
