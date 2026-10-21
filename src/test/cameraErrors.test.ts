import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cameraError,
  checkCameraSupport,
  isPermissionError,
  mapCameraError,
} from "@/lib/cameraErrors";

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

  it("kennt den Fall „Kamera unterbrochen“ als eigenen Typ", () => {
    const e = cameraError("interrupted");
    expect(e.title).toBe("Die Kamera wurde unterbrochen");
    expect(e.hint).toMatch(/Erneut starten/);
    // It is never produced by getUserMedia errors, only by the hook.
    expect(mapCameraError(err("AbortError")).kind).toBe("busy");
  });

  it("nennt den iPhone-Weg bei verweigerter Kamera", () => {
    expect(cameraError("denied").hint).toMatch(/aA.*Website-Einstellungen.*Kamera/);
  });

  it("legt nicht nahe, dass die Erkennung nach dem ersten Laden offline läuft", () => {
    const hint = cameraError("model").hint;
    expect(hint).not.toMatch(/ersten Start/);
    expect(hint).toMatch(/Beim Start der Kamera/);
    expect(hint).not.toMatch(/Internet/);
  });

  it("verträgt Nicht-Fehler", () => {
    expect(mapCameraError(undefined).kind).toBe("unknown");
    expect(mapCameraError("boom").kind).toBe("unknown");
  });

  it("erkennt nur Berechtigungsfehler als Grund, keine andere Kamera zu versuchen", () => {
    expect(isPermissionError(err("NotAllowedError"))).toBe(true);
    expect(isPermissionError(err("PermissionDeniedError"))).toBe(true);
    expect(isPermissionError(err("SecurityError"))).toBe(true);
    expect(isPermissionError(err("NotReadableError"))).toBe(false);
    expect(isPermissionError(err("NotFoundError"))).toBe(false);
    expect(isPermissionError(err("OverconstrainedError"))).toBe(false);
    expect(isPermissionError(undefined)).toBe(false);
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
