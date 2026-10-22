import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CreditList } from "@/components/SettingsScreen";
import { AIST_CREDITS, CREDITS } from "@/data/credits";
import { resetAudioUnlockForTests } from "@/lib/audio/unlock";
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
    for (const name of ["Spiel", "Ton", "Anzeige", "Kamera", "Speicher", "Über und Credits"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(await screen.findByText("Nicht verfügbar")).toBeInTheDocument();
  });

  it("zeigt die Credits mit Musikquelle und Link-Hosts", async () => {
    await renderSettings();
    for (const c of CREDITS) {
      expect(screen.getByRole("heading", { name: c.title })).toBeInTheDocument();
      for (const l of c.links) {
        const link = screen.getByRole("link", {
          name: `${l.label} (${new URL(l.href).hostname})`,
        });
        expect(link).toHaveAttribute("href", l.href);
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
    }
    expect(screen.getByText(/KI-generiert mit Gemini/)).toBeInTheDocument();
  });

  it("zeigt Credit-Links mit Host, öffnet sie nur in einem neuen Tab", () => {
    render(<CreditList credits={AIST_CREDITS} />);
    const link = screen.getByRole("link", { name: "CC BY 4.0 (creativecommons.org)" });
    expect(link).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByText(/erst beim Tippen/)).toBeInTheDocument();
  });

  it("speichert Schalter und Schwierigkeit", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("switch", { name: "Skelett anzeigen" }));
    expect(stored().skeleton).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Automatisch starten" }));
    expect(stored().autoStart).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Vibration" }));
    expect(stored().haptics).toBe(false);
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

  it("Hinweis zum Regler nur, wenn das Gerät media.volume ignoriert", async () => {
    const hint = /regelt der Regler nur eigene Audiodateien/;
    await renderSettings();
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    cleanup();
    resetAudioUnlockForTests();
    const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      configurable: true,
      get: () => 1,
      set: () => {},
    });
    try {
      await renderSettings();
      expect(await screen.findByText(hint)).toBeInTheDocument();
    } finally {
      if (volume) Object.defineProperty(HTMLMediaElement.prototype, "volume", volume);
      resetAudioUnlockForTests();
    }
  });
});
