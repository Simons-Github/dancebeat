import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

async function renderSettings() {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Einstellungen" });
}
const stored = () => JSON.parse(localStorage.getItem("dancebeat.settings") ?? "{}");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Einstellungen", () => {
  it("zeigt alle Abschnitte", async () => {
    await renderSettings();
    for (const name of ["Spiel", "Ton", "Anzeige", "Kamera", "Speicher"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(await screen.findByText("Nicht verfügbar")).toBeInTheDocument();
  });

  it("speichert Schalter und Schwierigkeit", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("switch", { name: "Skelett anzeigen" }));
    expect(stored().skeleton).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Automatisch starten" }));
    expect(stored().autoStart).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Schwer" }));
    expect(stored().difficulty).toBe("schwer");
    expect(screen.getByRole("button", { name: "Schwer" })).toHaveAttribute("aria-pressed", "true");
  });

  it("setzt den Latenz-Ausgleich zurück", async () => {
    localStorage.setItem("dancebeat.settings", JSON.stringify({ latencyMs: 80 }));
    await renderSettings();
    expect(await screen.findByText("+80 ms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zurücksetzen" }));
    expect(stored().latencyMs).toBe(0);
  });

  it("zeigt „Gespeicherte Kamera vergessen“ nur mit gespeicherter Kamera", async () => {
    await renderSettings();
    expect(
      screen.queryByRole("button", { name: "Gespeicherte Kamera vergessen" }),
    ).not.toBeInTheDocument();
    cleanup();

    localStorage.setItem("dancebeat.settings", JSON.stringify({ cameraId: "cam-1" }));
    await renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Gespeicherte Kamera vergessen" }));
    expect(stored().cameraId).toBe("");
    expect(
      screen.queryByRole("button", { name: "Gespeicherte Kamera vergessen" }),
    ).not.toBeInTheDocument();
  });
});
