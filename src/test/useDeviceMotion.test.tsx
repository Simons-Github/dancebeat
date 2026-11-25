import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDeviceMotion } from "@/hooks/useDeviceMotion";
import { parsePlayMode } from "@/lib/motion";

const motionEvent = (acceleration: unknown, accelerationIncludingGravity: unknown) =>
  Object.assign(new Event("devicemotion"), { acceleration, accelerationIncludingGravity });

describe("useDeviceMotion", () => {
  it("reicht Messungen nur weiter, solange aktiv, und räumt beim Ausschalten auf", () => {
    const onSample = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useDeviceMotion(on, onSample), {
      initialProps: { on: false },
    });
    act(() => void window.dispatchEvent(motionEvent({ x: 1, y: 2, z: 3 }, null)));
    expect(onSample).not.toHaveBeenCalled();

    rerender({ on: true });
    act(() => void window.dispatchEvent(motionEvent({ x: 1, y: 2, z: 3 }, null)));
    act(() => void window.dispatchEvent(motionEvent(null, { x: 0, y: 9.8, z: 0 })));
    expect(onSample.mock.calls).toEqual([
      [{ linear: { x: 1, y: 2, z: 3 }, withGravity: null }],
      [{ linear: null, withGravity: { x: 0, y: 9.8, z: 0 } }],
    ]);

    rerender({ on: false });
    act(() => void window.dispatchEvent(motionEvent({ x: 1, y: 2, z: 3 }, null)));
    expect(onSample).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("nimmt immer den neuesten Callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useDeviceMotion(true, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    act(() => void window.dispatchEvent(motionEvent({ x: 1, y: 0, z: 0 }, null)));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("parsePlayMode", () => {
  it("erkennt nur mode=motion", () => {
    expect(parsePlayMode({ mode: "motion" })).toBe("motion");
    expect(parsePlayMode({})).toBe("camera");
    expect(parsePlayMode({ mode: "kamera" })).toBe("camera");
    expect(parsePlayMode({ mode: 1 })).toBe("camera");
  });
});
