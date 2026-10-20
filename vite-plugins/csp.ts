import type { Plugin } from "vite";

/**
 * Content-Security-Policy for index.html (meta tag, so `frame-ancestors` and reporting are not
 * available). `default-src 'self'` plus an explicit allowance for every remote host the app
 * really uses. Purposes:
 * - Block MediaPipe's built-in telemetry (tasks-vision logger POSTs to
 *   https://odml.pa.googleapis.com/v1/log) via `connect-src`.
 * - Limit what the third-party scripts (YouTube IFrame API, Spotify Web Playback SDK) and any
 *   injected script can load or send: no foreign images, fonts, styles, frames or plugins, so
 *   camera frames or library data cannot leave through those channels. Limit: `media-src` stays
 *   open for https (user-entered audio URLs), top-level navigation cannot be restricted by CSP,
 *   and an allowed vendor script can always talk to its own host.
 *
 * Remote hosts:
 * - Scripts: www.youtube.com (iframe_api and the widget API it loads), sdk.scdn.co (Spotify SDK).
 * - Frames: www.youtube-nocookie.com (player), sdk.scdn.co (SDK's hidden player frame).
 * - Connect: accounts.spotify.com (token exchange, src/lib/audio/spotifyAuth.ts) and
 *   api.spotify.com (play request, SpotifySource in src/lib/audio/sources.ts).
 * - Media: any https address, plus http on loopback (validateAudioUrl in newSong.ts).
 */
export const SPOTIFY_CONNECT_SOURCES = ["https://accounts.spotify.com", "https://api.spotify.com"];
export const SCRIPT_SOURCES = ["https://www.youtube.com", "https://sdk.scdn.co"];
export const FRAME_SOURCES = ["https://www.youtube-nocookie.com", "https://sdk.scdn.co"];
/** Plain-http audio is only accepted on loopback (IPv6 literals cannot be expressed in CSP). */
export const LOOPBACK_MEDIA_SOURCES = ["http://localhost:*", "http://127.0.0.1:*"];

export function connectSrcPolicy(command: "build" | "serve"): string {
  const sources = ["'self'", "blob:", "data:", ...SPOTIFY_CONNECT_SOURCES];
  // Dev only: Vite's HMR socket (also wss: for `dev:https` on phones).
  if (command === "serve") sources.push("ws:", "wss:");
  return `connect-src ${sources.join(" ")}`;
}

export function cspPolicy(command: "build" | "serve"): string {
  // 'wasm-unsafe-eval': MediaPipe compiles its WASM runtime. Dev only 'unsafe-inline': the
  // React Refresh preamble that @vitejs/plugin-react injects into index.html.
  const script = ["'self'", "'wasm-unsafe-eval'", ...SCRIPT_SOURCES];
  if (command === "serve") script.push("'unsafe-inline'");
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    // Inline style attributes (Framer Motion, Radix) and Vite's injected <style> tags in dev.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `media-src 'self' blob: data: https: ${LOOPBACK_MEDIA_SOURCES.join(" ")}`,
    `frame-src ${FRAME_SOURCES.join(" ")}`,
    connectSrcPolicy(command),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
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
          attrs: { "http-equiv": "Content-Security-Policy", content: cspPolicy(command) },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
