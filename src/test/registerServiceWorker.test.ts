import { afterEach, describe, expect, it, vi } from "vitest";

import { registerServiceWorker } from "@/lib/serviceWorker";

function stubServiceWorker(register: (url: string, opts: RegistrationOptions) => unknown) {
  const fn = vi.fn(register);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: fn },
  });
  return fn;
}

function stubReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, "readyState", { configurable: true, get: () => state });
}

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(document, "readyState");
});

describe("registerServiceWorker", () => {
  it("registriert sw.js mit dem Basis-Pfad als Scope im Produktions-Build", () => {
    vi.stubEnv("PROD", true);
    stubReadyState("complete");
    const register = stubServiceWorker(() => Promise.resolve({}));
    registerServiceWorker();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("wartet auf load, wenn die Seite noch lädt", () => {
    vi.stubEnv("PROD", true);
    stubReadyState("loading");
    const register = stubServiceWorker(() => Promise.resolve({}));
    registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("registriert nichts im Dev-Server", () => {
    vi.stubEnv("PROD", false);
    stubReadyState("complete");
    const register = stubServiceWorker(() => Promise.resolve({}));
    registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });

  it("tut nichts ohne Service-Worker-API", () => {
    vi.stubEnv("PROD", true);
    stubReadyState("complete");
    expect("serviceWorker" in navigator).toBe(false);
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("schluckt Fehler still (abgelehnt oder synchron geworfen)", async () => {
    vi.stubEnv("PROD", true);
    stubReadyState("complete");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    stubServiceWorker(() => Promise.reject(new Error("SecurityError")));
    registerServiceWorker();
    stubServiceWorker(() => {
      throw new Error("blocked");
    });
    expect(() => registerServiceWorker()).not.toThrow();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
