import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSessionForTests, setLastResult } from "@/lib/game/session";
import type { GameResult } from "@/lib/types";
import { routeTree } from "@/routeTree.gen";
import { RESULT } from "@/theme";

/** Reduced-motion switch; `animate` only records the count-up instead of running it. */
const motion = vi.hoisted(() => ({
  reduce: false,
  animations: [] as { value: { set(v: number): void }; target: unknown; options: unknown }[],
}));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => motion.reduce,
  animate: (value: { set(v: number): void }, target: unknown, options: unknown) => {
    motion.animations.push({ value, target, options });
    return { stop: () => {} };
  },
}));

const SONG_ID = "song-1";

function result(over: Partial<GameResult> = {}): GameResult {
  return {
    songId: SONG_ID,
    score: 12345,
    stars: 3,
    mega: false,
    counts: { PERFECT: 7, SUPER: 5, GOOD: 3, OK: 2, X: 1 },
    maxCombo: 9,
    newHighscore: false,
    ...over,
  };
}

async function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    await router.load();
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1 });
}

afterEach(() => {
  cleanup();
  resetSessionForTests();
  motion.reduce = false;
  motion.animations = [];
});

const countOf = (label: string) =>
  screen.getByText(label).closest("div")?.querySelector("dd")?.textContent;

describe("Ergebnis-Screen", () => {
  it("zeigt Rang, Punkte, Sterne, Wertungen und Combo", async () => {
    setLastResult(result());
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("TÄNZER");
    expect(screen.getByTestId("result-score")).toHaveTextContent("12.345 Punkte");
    expect(screen.getByRole("img", { name: "3 von 5 Sternen" })).toBeInTheDocument();
    expect(countOf("PERFECT")).toBe("7");
    expect(countOf("Verpasst")).toBe("1");
    expect(screen.getByText("X")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(screen.getByText(/Längste Combo/)).toHaveTextContent("Längste Combo 9");
    expect(screen.getByRole("link", { name: "Nochmal" })).toHaveAttribute(
      "href",
      `/setup/${SONG_ID}`,
    );
    expect(screen.getByRole("link", { name: "Anderer Song" })).toHaveAttribute("href", "/");
  });

  it("Highscore-Abzeichen nur bei neuem Highscore", async () => {
    setLastResult(result({ newHighscore: true }));
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.getByTestId("new-highscore")).toHaveTextContent("Neuer Highscore!");
    cleanup();
    setLastResult(result({ newHighscore: false }));
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.queryByTestId("new-highscore")).toBeNull();
  });

  it("Konfetti nur ab 5 Sternen", async () => {
    setLastResult(result({ stars: 4 }));
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.queryByTestId("confetti")).toBeNull();
    cleanup();
    setLastResult(result({ stars: 5 }));
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.getByTestId("confetti")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("SUPERSTAR");
  });

  it("Megastar: Titel, Sternbeschriftung und Konfetti", async () => {
    setLastResult(result({ stars: 5, mega: true }));
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("MEGASTAR");
    expect(screen.getByRole("img", { name: /Megastar/ })).toBeInTheDocument();
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });

  it("reduzierte Bewegung: Endstand sofort, kein Konfetti", async () => {
    motion.reduce = true;
    setLastResult(result({ stars: 5, newHighscore: true }));
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.getByTestId("result-score-visual")).toHaveTextContent("12.345");
    expect(motion.animations).toHaveLength(0);
    expect(screen.queryByTestId("confetti")).toBeNull();
  });

  it("zählt den Punktestand von 0 hoch", async () => {
    setLastResult(result());
    await renderAt(`/result/${SONG_ID}`);
    const visual = screen.getByTestId("result-score-visual");
    expect(visual).toHaveTextContent(/^0$/);
    expect(motion.animations).toHaveLength(1);
    const run = motion.animations[0]!;
    expect(run.target).toBe(12345);
    expect(run.options).toMatchObject({ duration: RESULT.countUpSeconds });
    // The motion value drives the text directly (next animation frame), without a React render.
    act(() => run.value.set(6000.4));
    await vi.waitFor(() => expect(visual).toHaveTextContent("6.000"));
    act(() => run.value.set(12345));
    await vi.waitFor(() => expect(visual).toHaveTextContent("12.345"));
  });

  it("ohne Ergebnis: freundlicher Hinweis", async () => {
    await renderAt(`/result/${SONG_ID}`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Kein Ergebnis");
    expect(screen.queryByTestId("result-score")).toBeNull();
  });
});
