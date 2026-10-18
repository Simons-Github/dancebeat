import { afterEach, describe, expect, it, vi } from "vitest";

import { checkCameraSupport, isStaleCameraError, mapCameraError } from "@/lib/cameraErrors";

const err = (name: string) => new DOMException("x", name);

describe("Kamerafehler", () => {
  it.each([
    ["NotAllowedError", "denied", /verweigert/],
    ["NotFoundError", "nocamera", /Keine Kamera/],
    ["NotReadableError", "busy", /bereits verwendet/],
    ["OverconstrainedError", "overconstrained", /nicht verfügbar/],
    ["SecurityError", "insecure", /sichere/],
    ["SomethingElse", "unknown", /nicht gestartet/],
  ])("%s -> %s", (name, kind, title) => {
    const e = mapCameraError(err(name));
    expect(e.kind).toBe(kind);
    expect(e.title).toMatch(title);
    expect(e.hint).toMatch(/Erneut versuchen|HTTPS|Kamera/);
  });

  it("verträgt Nicht-Fehler", () => {
    expect(mapCameraError(undefined).kind).toBe("unknown");
    expect(mapCameraError("boom").kind).toBe("unknown");
  });

  it("erkennt eine veraltete Kamera-ID nur über die deviceId-Vorgabe", () => {
    const over = (constraint?: string) =>
      Object.assign(err("OverconstrainedError"), constraint ? { constraint } : {});
    expect(isStaleCameraError(over("deviceId"))).toBe(true);
    expect(isStaleCameraError(over("width"))).toBe(false);
    expect(isStaleCameraError(over())).toBe(false);
    expect(isStaleCameraError(err("NotAllowedError"))).toBe(false);
  });
});

describe("checkCameraSupport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("meldet unsicheren Kontext", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(checkCameraSupport()?.kind).toBe("insecure");
  });
  it("meldet fehlende API im sicheren Kontext als fehlende Kamera", () => {
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    expect(checkCameraSupport()?.kind).toBe("nocamera");
  });
  it("lässt eine nutzbare API durch", () => {
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    expect(checkCameraSupport()).toBeNull();
  });
});
