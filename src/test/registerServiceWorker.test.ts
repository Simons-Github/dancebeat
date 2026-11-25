import { afterEach, describe, expect, it, vi } from "vitest";

import { registerServiceWorker } from "@/lib/serviceWorker";
import { SKIP_WAITING_MESSAGE } from "@/sw/strategy";

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

// ---- Update offer (Etappe 7b-3) ----

type Lib = typeof import("@/lib/serviceWorker");

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
  postMessage = vi.fn();
  set(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
}

/** Fresh module state, a fake container (`controller` set = an old build runs the page). */
async function setup(opts: { controlled: boolean; waiting?: FakeWorker }) {
  vi.resetModules();
  vi.stubEnv("PROD", true);
  stubReadyState("complete");
  const reg = new FakeRegistration();
  reg.waiting = opts.waiting ?? null;
  const container = Object.assign(new EventTarget(), {
    controller: opts.controlled ? new FakeWorker() : null,
    register: vi.fn(() => Promise.resolve(reg)),
  });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  const lib: Lib = await import("@/lib/serviceWorker");
  lib.registerServiceWorker();
  await Promise.resolve();
  await Promise.resolve();
  return { lib, reg, container };
}

function stubReload() {
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  return reload;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("Update-Angebot", () => {
  it("bietet einen schon wartenden neuen Build an", async () => {
    const { lib } = await setup({ controlled: true, waiting: new FakeWorker() });
    expect(lib.hasUpdate()).toBe(true);
  });

  it("bietet nichts bei der Erstinstallation an (keine Seite unter altem Build)", async () => {
    const { lib, reg } = await setup({ controlled: false, waiting: new FakeWorker() });
    const w = new FakeWorker();
    reg.installing = w;
    reg.dispatchEvent(new Event("updatefound"));
    w.set("installed");
    expect(lib.hasUpdate()).toBe(false);
  });

  it("meldet einen neu installierten Build erst, wenn er fertig installiert ist", async () => {
    const { lib, reg } = await setup({ controlled: true });
    const changed = vi.fn();
    lib.subscribeUpdate(changed);
    const w = new FakeWorker();
    reg.installing = w;
    reg.dispatchEvent(new Event("updatefound"));
    expect(lib.hasUpdate()).toBe(false);
    w.set("installed");
    expect(lib.hasUpdate()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("bietet einen Build an, der beim Registrieren schon installiert wurde", async () => {
    vi.resetModules();
    vi.stubEnv("PROD", true);
    stubReadyState("complete");
    const reg = new FakeRegistration();
    const w = new FakeWorker();
    reg.installing = w;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        controller: new FakeWorker(),
        register: vi.fn(() => Promise.resolve(reg)),
      }),
    });
    const lib: Lib = await import("@/lib/serviceWorker");
    lib.registerServiceWorker();
    await Promise.resolve();
    await Promise.resolve();
    expect(lib.hasUpdate()).toBe(false);
    w.set("installed");
    expect(lib.hasUpdate()).toBe(true);
  });

  it("Neu laden wirkt wieder, wenn ein neuerer Build den angestoßenen ersetzt", async () => {
    const first = new FakeWorker();
    first.state = "installed";
    const { lib, reg } = await setup({ controlled: true, waiting: first });
    lib.applyUpdate();
    const newer = new FakeWorker();
    reg.installing = newer;
    reg.dispatchEvent(new Event("updatefound"));
    newer.set("installed");
    lib.applyUpdate();
    expect(newer.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
  });

  it("zieht das Angebot zurück, wenn der wartende Build verworfen wird", async () => {
    const w = new FakeWorker();
    w.state = "installed";
    const { lib } = await setup({ controlled: true, waiting: w });
    w.set("redundant");
    expect(lib.hasUpdate()).toBe(false);
  });

  it("Später blendet aus, bis ein neuerer Build kommt", async () => {
    const { lib, reg } = await setup({ controlled: true, waiting: new FakeWorker() });
    lib.dismissUpdate();
    expect(lib.hasUpdate()).toBe(false);
    const w = new FakeWorker();
    reg.installing = w;
    reg.dispatchEvent(new Event("updatefound"));
    w.set("installed");
    expect(lib.hasUpdate()).toBe(true);
  });

  it("Neu laden: schickt skip-waiting und lädt genau einmal nach dem Wechsel neu", async () => {
    const w = new FakeWorker();
    w.state = "installed";
    const { lib, container } = await setup({ controlled: true, waiting: w });
    const reload = stubReload();
    lib.applyUpdate();
    lib.applyUpdate();
    expect(w.postMessage).toHaveBeenCalledTimes(1);
    expect(w.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("Neu laden ohne Nachricht, wenn ein anderer Tab den Build schon aktiviert hat", async () => {
    const w = new FakeWorker();
    w.state = "activated";
    const { lib } = await setup({ controlled: true, waiting: w });
    const reload = stubReload();
    lib.applyUpdate();
    expect(w.postMessage).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("sucht beim Zurückkehren in die App höchstens einmal pro Intervall nach Updates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { lib, reg } = await setup({ controlled: true });
    let state: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    const show = () => document.dispatchEvent(new Event("visibilitychange"));
    show();
    expect(reg.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(lib.UPDATE_CHECK_INTERVAL_MS);
    state = "hidden";
    show();
    expect(reg.update).not.toHaveBeenCalled();
    state = "visible";
    show();
    show();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });
});
