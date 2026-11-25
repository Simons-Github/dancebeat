import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CameraErrorPanel } from "@/components/setup/CameraErrorPanel";
import { cameraError } from "@/lib/cameraErrors";

describe("CameraErrorPanel", () => {
  it("bietet bei einer Unterbrechung „Erneut starten“ an", () => {
    const onRetry = vi.fn();
    render(<CameraErrorPanel error={cameraError("interrupted")} onRetry={onRetry} />);
    expect(screen.getByText("Die Kamera wurde unterbrochen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erneut starten" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("bietet bei anderen Fehlern „Erneut versuchen“ an", () => {
    render(<CameraErrorPanel error={cameraError("busy")} onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });
});
