import { t as translate } from "../i18n";
import { deSongs } from "../i18n/de/songs";

/**
 * Spotify login via Authorization Code with PKCE (no client secret, no backend).
 *
 * Everything lives in `sessionStorage` only: the PKCE verifier and `state` until the code
 * exchange (deleted right after it, success or not) and the token set afterwards. The client ID
 * is entered by the user in the settings; it is stored with the token so a refresh needs no
 * settings access. All functions touch browser APIs and must run in effects or handlers.
 */

const TOKEN_KEY = "dancebeat.spotify.token";
const VERIFIER_KEY = "dancebeat.spotify.verifier";
const STATE_KEY = "dancebeat.spotify.state";

export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_SCOPES =
  "streaming user-read-email user-read-private user-modify-playback-state";
/** Path of the callback route, relative to the app base. */
export const SPOTIFY_CALLBACK_PATH = "spotify-callback";
/** A token this close to its expiry is refreshed before use. */
export const SPOTIFY_REFRESH_MARGIN_MS = 60_000;

/** Spotify client IDs are 32 hex characters. */
export const isSpotifyClientId = (id: string) => /^[0-9a-f]{32}$/i.test(id.trim());

/** Login or token failure with a message for the UI. */
export class SpotifyAuthError extends Error {
  override name = "SpotifyAuthError";
}

export interface SpotifyTokenSet {
  accessToken: string;
  /** Absent when Spotify did not send one; the user then has to reconnect after expiry. */
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  clientId: string;
}

type Loc = Pick<Location, "protocol" | "hostname" | "origin">;

/**
 * Spotify only accepts HTTPS redirect URIs, or plain HTTP on an explicit loopback address
 * (127.0.0.1 / [::1]); `localhost` is rejected.
 */
export type RedirectCheck = { ok: true } | { ok: false; reason: "localhost" | "insecure" };

export function checkRedirectOrigin(loc: Loc): RedirectCheck {
  if (loc.hostname === "localhost") return { ok: false, reason: "localhost" };
  if (loc.protocol === "https:") return { ok: true };
  if (loc.protocol === "http:" && (loc.hostname === "127.0.0.1" || loc.hostname === "[::1]"))
    return { ok: true };
  return { ok: false, reason: "insecure" };
}

/** Redirect URI to register in the Spotify dashboard (must match exactly). */
export const spotifyRedirectUri = (loc: Loc, base = import.meta.env.BASE_URL) =>
  loc.origin + base + SPOTIFY_CALLBACK_PATH;

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomString = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function codeChallenge(verifier: string) {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export function buildAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}) {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    code_challenge_method: "S256",
    code_challenge: p.challenge,
    state: p.state,
    scope: SPOTIFY_SCOPES,
  });
  return `${SPOTIFY_AUTHORIZE_URL}?${q}`;
}

/** Starts the login: stores verifier and state, then leaves the app for accounts.spotify.com. */
export async function spotifyLogin(clientId: string) {
  const check = checkRedirectOrigin(location);
  if (!check.ok)
    throw new SpotifyAuthError(
      check.reason === "localhost"
        ? translate("songs.spotify.noLocalhost")
        : translate("songs.spotify.needsHttps"),
    );
  if (!isSpotifyClientId(clientId))
    throw new SpotifyAuthError(translate("songs.spotify.badClientId"));
  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  location.assign(
    buildAuthorizeUrl({
      clientId: clientId.trim(),
      redirectUri: spotifyRedirectUri(location),
      challenge: await codeChallenge(verifier),
      state,
    }),
  );
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function isTokenResponse(j: unknown): j is TokenResponse {
  if (typeof j !== "object" || j === null) return false;
  const o = j as Record<string, unknown>;
  return (
    typeof o["access_token"] === "string" &&
    typeof o["expires_in"] === "number" &&
    (o["refresh_token"] === undefined || typeof o["refresh_token"] === "string")
  );
}

async function requestToken(body: Record<string, string>, fetchFn: typeof fetch) {
  const r = await fetchFn(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!r.ok) throw new SpotifyAuthError(translate("songs.spotify.loginFailed"));
  const j: unknown = await r.json();
  if (!isTokenResponse(j)) throw new SpotifyAuthError(translate("songs.spotify.loginFailed"));
  return j;
}

function storeToken(set: SpotifyTokenSet) {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(set));
}

function toTokenSet(j: TokenResponse, clientId: string, now: number, oldRefresh?: string) {
  const refreshToken = j.refresh_token ?? oldRefresh;
  return {
    accessToken: j.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: now + j.expires_in * 1000,
    clientId,
  } satisfies SpotifyTokenSet;
}

/**
 * Finishes the login on the callback route: checks `state`, trades the code for a token and
 * stores it. Verifier and state are deleted in any case, so a code can never be replayed.
 */
export async function spotifyExchange(
  clientId: string,
  params: URLSearchParams,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
) {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const state = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (params.get("error") === "access_denied")
    throw new SpotifyAuthError(translate("songs.spotify.denied"));
  const code = params.get("code");
  if (params.get("error") || !code) throw new SpotifyAuthError(translate("songs.spotify.noLogin"));
  if (!verifier || !state || params.get("state") !== state)
    throw new SpotifyAuthError(translate("songs.spotify.stateMismatch"));
  const j = await requestToken(
    {
      client_id: clientId.trim(),
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(location),
      code_verifier: verifier,
    },
    fetchFn,
  );
  storeToken(toTokenSet(j, clientId.trim(), now));
}

function readToken(): SpotifyTokenSet | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const { accessToken, refreshToken, expiresAt, clientId } = o;
    if (
      typeof accessToken !== "string" ||
      typeof expiresAt !== "number" ||
      typeof clientId !== "string"
    )
      return null;
    return {
      accessToken,
      ...(typeof refreshToken === "string" ? { refreshToken } : {}),
      expiresAt,
      clientId,
    };
  } catch {
    return null;
  }
}

export type SpotifyStatus = "disconnected" | "connected" | "expired";

/** `expired`: the token ran out and cannot be refreshed; the user has to reconnect. */
export function spotifyStatus(now = Date.now()): SpotifyStatus {
  const t = readToken();
  if (!t) return "disconnected";
  return t.refreshToken || t.expiresAt > now ? "connected" : "expired";
}

export function spotifyLogout() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

/**
 * German reference text of the message for an expired session that could not be refreshed (the
 * thrown error uses `t("songs.spotify.expired")` in the current UI language).
 */
export const SPOTIFY_EXPIRED_MESSAGE = deSongs["songs.spotify.expired"];

let refreshing: Promise<string> | null = null;

/**
 * A valid access token: refreshed shortly before expiry (concurrent callers share one request).
 * Throws `SpotifyAuthError` when not connected or when the session cannot be renewed; a failed
 * refresh drops the stored token.
 */
export async function getSpotifyToken(fetchFn: typeof fetch = fetch, now = Date.now()) {
  const t = readToken();
  if (!t) throw new SpotifyAuthError(translate("songs.spotify.connectFirst"));
  if (t.expiresAt - SPOTIFY_REFRESH_MARGIN_MS > now) return t.accessToken;
  if (!t.refreshToken) throw new SpotifyAuthError(translate("songs.spotify.expired"));
  const refreshToken = t.refreshToken;
  refreshing ??= requestToken(
    { client_id: t.clientId, grant_type: "refresh_token", refresh_token: refreshToken },
    fetchFn,
  )
    .then((j) => {
      const set = toTokenSet(j, t.clientId, now, refreshToken);
      storeToken(set);
      return set.accessToken;
    })
    .catch(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      throw new SpotifyAuthError(translate("songs.spotify.expired"));
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
