import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";

const TOKEN_KEY = "dancebeat.spotify.token";
const CLIENT_ID = "0123456789abcdef0123456789abcdef";

async function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}
const renderSettings = async () => {
  await renderAt("/settings");
  await screen.findByRole("heading", { name: "Einstellungen" });
};
const setClientId = (id: string) =>
  localStorage.setItem("dancebeat.settings", JSON.stringify({ spotifyClientId: id }));
const seedToken = () =>
  sessionStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
      clientId: CLIENT_ID,
    }),
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("Einstellungen: Spotify", () => {
  it("zeigt Überschrift, Redirect-URI und den localhost-Hinweis", async () => {
    await renderSettings();
    expect(screen.getByRole("heading", { name: "Spotify" })).toBeInTheDocument();
    expect(await screen.findByText(`${location.origin}/spotify-callback`)).toBeInTheDocument();
    expect(screen.getByText(/Spotify erlaubt „localhost“ nicht/)).toBeInTheDocument();
    expect(screen.getByText("Status: Nicht verbunden")).toBeInTheDocument();
  });

  it("deaktiviert „Verbinden“ bei leerer Client-ID ohne Fehlertext", async () => {
    await renderSettings();
    expect(await screen.findByRole("button", { name: "Mit Spotify verbinden" })).toBeDisabled();
    expect(screen.queryByText(/besteht aus 32 Zeichen/)).not.toBeInTheDocument();
  });

  it("zeigt bei falscher Client-ID den Fehlertext", async () => {
    setClientId("zu-kurz");
    await renderSettings();
    expect(await screen.findByText(/besteht aus 32 Zeichen/)).toBeInTheDocument();
    expect(screen.getByLabelText("Client-ID")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Mit Spotify verbinden" })).toBeDisabled();
  });

  it("hält „Verbinden“ auf localhost auch mit gültiger ID deaktiviert", async () => {
    setClientId(CLIENT_ID);
    await renderSettings();
    expect(screen.queryByText(/besteht aus 32 Zeichen/)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Mit Spotify verbinden" })).toBeDisabled();
  });

  it("speichert die eingegebene Client-ID getrimmt", async () => {
    await renderSettings();
    fireEvent.change(screen.getByLabelText("Client-ID"), { target: { value: ` ${CLIENT_ID} ` } });
    expect(JSON.parse(localStorage.getItem("dancebeat.settings") ?? "{}").spotifyClientId).toBe(
      CLIENT_ID,
    );
  });

  it("zeigt mit Token „Verbunden“ und trennt per „Trennen“", async () => {
    seedToken();
    await renderSettings();
    expect(await screen.findByText("Status: Verbunden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neu verbinden" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trennen" }));
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.getByText("Status: Nicht verbunden")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trennen" })).not.toBeInTheDocument();
  });
});

describe("Spotify-Callback", () => {
  it("tauscht den Code, speichert das Token und wechselt zu den Einstellungen", async () => {
    setClientId(CLIENT_ID);
    sessionStorage.setItem("dancebeat.spotify.verifier", "v");
    sessionStorage.setItem("dancebeat.spotify.state", "s");
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const router = await renderAt("/spotify-callback?code=x&state=s");
    await screen.findByRole("heading", { name: "Einstellungen" });
    expect(router.state.location.pathname).toBe("/settings");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? "null");
    expect(stored).toMatchObject({ accessToken: "acc", refreshToken: "ref", clientId: CLIENT_ID });
    expect(sessionStorage.getItem("dancebeat.spotify.verifier")).toBeNull();
    expect(await screen.findByText("Status: Verbunden")).toBeInTheDocument();
  });

  it("zeigt bei falschem State die Meldung und den Link zurück", async () => {
    setClientId(CLIENT_ID);
    sessionStorage.setItem("dancebeat.spotify.verifier", "v");
    sessionStorage.setItem("dancebeat.spotify.state", "s");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await renderAt("/spotify-callback?code=x&state=falsch");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/passt nicht zu dieser Sitzung/);
    expect(screen.getByRole("link", { name: "Zu den Einstellungen" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull());
  });

  it("meldet eine abgelehnte Verbindung", async () => {
    await renderAt("/spotify-callback?error=access_denied&state=s");
    expect(await screen.findByRole("alert")).toHaveTextContent(/abgelehnt/);
  });
});
