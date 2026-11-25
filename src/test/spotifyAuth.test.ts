import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SPOTIFY_EXPIRED_MESSAGE,
  SpotifyAuthError,
  buildAuthorizeUrl,
  checkRedirectOrigin,
  codeChallenge,
  getSpotifyToken,
  isSpotifyClientId,
  spotifyExchange,
  spotifyLogout,
  spotifyRedirectUri,
  spotifyStatus,
} from "@/lib/audio/spotifyAuth";

const TOKEN_KEY = "dancebeat.spotify.token";
const VERIFIER_KEY = "dancebeat.spotify.verifier";
const STATE_KEY = "dancebeat.spotify.state";
const CLIENT_ID = "0123456789abcdef0123456789abcdef";
const NOW = 1_000_000;

const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const failResponse = () => ({ ok: false, json: async () => ({}) }) as Response;
const mockFetch = (res: () => Response) => vi.fn<typeof fetch>(async () => res());
const storedToken = () => JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? "null");
const seedToken = (t: Record<string, unknown>) =>
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ clientId: CLIENT_ID, ...t }));
const seedLogin = () => {
  sessionStorage.setItem(VERIFIER_KEY, "verifier-1");
  sessionStorage.setItem(STATE_KEY, "state-1");
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Spotify: Redirect-Regeln", () => {
  it("erlaubt HTTPS", () => {
    expect(
      checkRedirectOrigin({ protocol: "https:", hostname: "example.com", origin: "" }),
    ).toEqual({ ok: true });
  });

  it("erlaubt HTTP nur auf 127.0.0.1", () => {
    expect(checkRedirectOrigin({ protocol: "http:", hostname: "127.0.0.1", origin: "" })).toEqual({
      ok: true,
    });
  });

  it("lehnt localhost ab, auch über HTTPS", () => {
    for (const protocol of ["http:", "https:"]) {
      expect(checkRedirectOrigin({ protocol, hostname: "localhost", origin: "" })).toEqual({
        ok: false,
        reason: "localhost",
      });
    }
  });

  it("lehnt HTTP auf einer LAN-IP ab", () => {
    expect(checkRedirectOrigin({ protocol: "http:", hostname: "192.168.1.5", origin: "" })).toEqual(
      {
        ok: false,
        reason: "insecure",
      },
    );
  });

  it("bildet die Redirect-URI aus Origin, Base und Callback-Pfad", () => {
    const loc = { protocol: "https:", hostname: "x.de", origin: "https://x.de" };
    expect(spotifyRedirectUri(loc, "/app/")).toBe("https://x.de/app/spotify-callback");
    expect(spotifyRedirectUri(loc)).toBe(`https://x.de${import.meta.env.BASE_URL}spotify-callback`);
  });
});

describe("Spotify: Client-ID und Authorize-URL", () => {
  it("prüft die Client-ID auf 32 Hex-Zeichen", () => {
    expect(isSpotifyClientId(CLIENT_ID)).toBe(true);
    expect(isSpotifyClientId(` ${CLIENT_ID.toUpperCase()} `)).toBe(true);
    expect(isSpotifyClientId("")).toBe(false);
    expect(isSpotifyClientId(CLIENT_ID.slice(1))).toBe(false);
    expect(isSpotifyClientId(`${CLIENT_ID.slice(1)}g`)).toBe(false);
  });

  it("setzt alle Parameter der Authorize-URL", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: "https://x.de/spotify-callback",
        challenge: "chal",
        state: "st",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe(CLIENT_ID);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe("https://x.de/spotify-callback");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toBe("chal");
    expect(q.get("state")).toBe("st");
    expect(q.get("scope")).toContain("streaming");
  });

  it("berechnet die Code-Challenge nach dem RFC-7636-Testvektor", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("Spotify: Code-Tausch", () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);

  it("sendet den Formular-Body mit code_verifier und speichert das Token", async () => {
    seedLogin();
    const fetchFn = mockFetch(() =>
      okResponse({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }),
    );
    await spotifyExchange(` ${CLIENT_ID} `, params({ code: "c1", state: "state-1" }), fetchFn, NOW);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code: "c1",
      redirect_uri: spotifyRedirectUri(location),
      code_verifier: "verifier-1",
    });
    expect(storedToken()).toEqual({
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: NOW + 3_600_000,
      clientId: CLIENT_ID,
    });
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
  });

  const failures: [string, () => URLSearchParams, () => Response][] = [
    ["falscher State", () => params({ code: "c", state: "other" }), () => okResponse({})],
    [
      "error=access_denied",
      () => params({ error: "access_denied", state: "state-1" }),
      () => okResponse({}),
    ],
    ["fehlender Code", () => params({ state: "state-1" }), () => okResponse({})],
    ["Fehlerantwort des Servers", () => params({ code: "c", state: "state-1" }), failResponse],
    [
      "ungültige Token-Antwort",
      () => params({ code: "c", state: "state-1" }),
      () => okResponse({ access_token: 1 }),
    ],
  ];

  it.each(failures)("wirft bei %s und löscht Verifier und State", async (_n, p, res) => {
    seedLogin();
    const fetchFn = mockFetch(res);
    await expect(spotifyExchange(CLIENT_ID, p(), fetchFn, NOW)).rejects.toBeInstanceOf(
      SpotifyAuthError,
    );
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("ruft bei falschem State oder fehlendem Code nicht fetch auf", async () => {
    seedLogin();
    const fetchFn = mockFetch(() => okResponse({}));
    await expect(
      spotifyExchange(CLIENT_ID, params({ code: "c", state: "x" }), fetchFn, NOW),
    ).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("wirft ohne gespeicherten Verifier", async () => {
    const fetchFn = mockFetch(() => okResponse({}));
    await expect(
      spotifyExchange(CLIENT_ID, params({ code: "c", state: "state-1" }), fetchFn, NOW),
    ).rejects.toBeInstanceOf(SpotifyAuthError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("Spotify: getSpotifyToken", () => {
  it("wirft ohne Token", async () => {
    await expect(getSpotifyToken(mockFetch(failResponse), NOW)).rejects.toBeInstanceOf(
      SpotifyAuthError,
    );
  });

  it("liefert ein gültiges Token ohne fetch", async () => {
    seedToken({ accessToken: "a", refreshToken: "r", expiresAt: NOW + 120_000 });
    const fetchFn = mockFetch(failResponse);
    expect(await getSpotifyToken(fetchFn, NOW)).toBe("a");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("erneuert innerhalb der 60-s-Marge und behält den alten Refresh-Token", async () => {
    seedToken({ accessToken: "old", refreshToken: "r1", expiresAt: NOW + 59_000 });
    const fetchFn = mockFetch(() => okResponse({ access_token: "new", expires_in: 3600 }));
    expect(await getSpotifyToken(fetchFn, NOW)).toBe("new");
    const body = new URLSearchParams(String(fetchFn.mock.calls[0]![1]?.body));
    expect(Object.fromEntries(body)).toEqual({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: "r1",
    });
    expect(storedToken()).toEqual({
      accessToken: "new",
      refreshToken: "r1",
      expiresAt: NOW + 3_600_000,
      clientId: CLIENT_ID,
    });
  });

  it("übernimmt einen neuen Refresh-Token aus der Antwort", async () => {
    seedToken({ accessToken: "old", refreshToken: "r1", expiresAt: NOW });
    const fetchFn = mockFetch(() =>
      okResponse({ access_token: "new", refresh_token: "r2", expires_in: 10 }),
    );
    await getSpotifyToken(fetchFn, NOW);
    expect(storedToken().refreshToken).toBe("r2");
  });

  it("teilt sich bei gleichzeitigen Aufrufen eine Anfrage", async () => {
    seedToken({ accessToken: "old", refreshToken: "r1", expiresAt: NOW });
    const fetchFn = mockFetch(() => okResponse({ access_token: "new", expires_in: 3600 }));
    const results = await Promise.all([
      getSpotifyToken(fetchFn, NOW),
      getSpotifyToken(fetchFn, NOW),
      getSpotifyToken(fetchFn, NOW),
    ]);
    expect(results).toEqual(["new", "new", "new"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("entfernt das Token und wirft, wenn die Erneuerung scheitert", async () => {
    seedToken({ accessToken: "old", refreshToken: "r1", expiresAt: NOW });
    await expect(getSpotifyToken(mockFetch(failResponse), NOW)).rejects.toMatchObject({
      name: "SpotifyAuthError",
      message: SPOTIFY_EXPIRED_MESSAGE,
    });
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    // A later call starts a fresh state (the shared promise was reset).
    await expect(getSpotifyToken(mockFetch(failResponse), NOW)).rejects.toBeInstanceOf(
      SpotifyAuthError,
    );
  });

  it("wirft abgelaufen ohne Refresh-Token und ruft nicht fetch auf", async () => {
    seedToken({ accessToken: "old", expiresAt: NOW - 1 });
    const fetchFn = mockFetch(failResponse);
    await expect(getSpotifyToken(fetchFn, NOW)).rejects.toThrow(SPOTIFY_EXPIRED_MESSAGE);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("Spotify: Status und Abmeldung", () => {
  it("meldet getrennt, verbunden und abgelaufen", () => {
    expect(spotifyStatus(NOW)).toBe("disconnected");
    seedToken({ accessToken: "a", expiresAt: NOW + 1000 });
    expect(spotifyStatus(NOW)).toBe("connected");
    seedToken({ accessToken: "a", expiresAt: NOW - 1000 });
    expect(spotifyStatus(NOW)).toBe("expired");
    seedToken({ accessToken: "a", refreshToken: "r", expiresAt: NOW - 1000 });
    expect(spotifyStatus(NOW)).toBe("connected");
  });

  it("behandelt kaputtes Token-JSON als getrennt", () => {
    sessionStorage.setItem(TOKEN_KEY, "{kaputt");
    expect(spotifyStatus(NOW)).toBe("disconnected");
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 1 }));
    expect(spotifyStatus(NOW)).toBe("disconnected");
  });

  it("löscht beim Abmelden Token, Verifier und State", () => {
    seedToken({ accessToken: "a", expiresAt: NOW + 1000 });
    seedLogin();
    spotifyLogout();
    expect(sessionStorage.length).toBe(0);
    expect(spotifyStatus(NOW)).toBe("disconnected");
  });
});
