import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpdateBanner } from "@/components/UpdateBanner";

const update = vi.hoisted(() => ({ available: true, apply: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/hooks/useAppUpdate", () => ({ useAppUpdate: () => update }));

async function renderAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <UpdateBanner />
        <Outlet />
      </>
    ),
  });
  const page = (p: string) => createRoute({ getParentRoute: () => root, path: p });
  const router = createRouter({
    routeTree: root.addChildren(["/", "/settings", "/edit/$songId", "/setup/$songId"].map(page)),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  update.available = true;
  vi.clearAllMocks();
});

describe("UpdateBanner", () => {
  it.each(["/", "/settings"])("zeigt auf %s das Update an", async (path) => {
    await renderAt(path);
    expect(await screen.findByRole("status")).toHaveTextContent("Neue Version verfügbar");
    fireEvent.click(screen.getByRole("button", { name: "Neu laden" }));
    expect(update.apply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(update.dismiss).toHaveBeenCalledTimes(1);
  });

  it.each(["/edit/s1", "/setup/s1"])(
    "zeigt auf %s nichts (ungespeicherte Arbeit)",
    async (path) => {
      await renderAt(path);
      expect(screen.queryByRole("status")).toBeNull();
    },
  );

  it("zeigt nichts ohne wartenden Build", async () => {
    update.available = false;
    await renderAt("/");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
