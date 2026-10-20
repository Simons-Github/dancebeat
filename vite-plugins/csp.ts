import type { Plugin } from "vite";

/**
 * Content-Security-Policy that restricts ONLY `connect-src` (fetch, XHR, WebSocket, EventSource,
 * sendBeacon). Sole purpose: block MediaPipe's built-in telemetry (tasks-vision logger POSTs to
 * https://odml.pa.googleapis.com/v1/log). All other directives stay unrestricted on purpose:
 * YouTube (script + iframe), URL audio (media element) and fonts are not affected.
 *
 * What the app connects to itself: MediaPipe WASM and model (same origin), blob:/data: URLs,
 * and Spotify: token exchange at accounts.spotify.com (src/lib/audio/spotifyAuth.ts) and the
 * play request at api.spotify.com (SpotifySource in src/lib/audio/sources.ts).
 */
export const SPOTIFY_CONNECT_SOURCES = ["https://accounts.spotify.com", "https://api.spotify.com"];

export function connectSrcPolicy(command: "build" | "serve"): string {
  const sources = ["'self'", "blob:", "data:", ...SPOTIFY_CONNECT_SOURCES];
  // Dev only: Vite's HMR socket (also wss: for `dev:https` on phones).
  if (command === "serve") sources.push("ws:", "wss:");
  return `connect-src ${sources.join(" ")}`;
}

export function csp(): Plugin {
  let command: "build" | "serve" = "serve";
  return {
    name: "dancebeat:csp",
    configResolved(config) {
      command = config.command;
    },
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: connectSrcPolicy(command) },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
