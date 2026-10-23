import { SKIP_WAITING_MESSAGE } from "@/sw/strategy";

/** Minimum time between two update checks triggered by the app becoming visible again. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the offline service worker (built by vite-plugins/serviceWorker.ts). Production
 * builds only: the dev server never has a service worker, so HMR and fresh files are not
 * affected. Registered after `load` so it does not compete with the first page load.
 * Failures (unsupported, private mode, insecure context) are ignored on purpose: the app works
 * the same without it, only offline start is missing.
 * `vite build --mode development` still emits sw.js but does not register it (PROD is false):
 * intended, that build is for debugging without caching.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const register = () => {
    try {
      navigator.serviceWorker
        .register(`${base}sw.js`, { scope: base })
        .then(watchRegistration)
        .catch(() => undefined);
    } catch {
      // Some browsers throw synchronously (e.g. blocked storage); nothing to do.
    }
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

// ---- Update offer (Etappe 7b-3) ----
// A new build installs next to the running one and waits (src/sw/sw.ts). The page offers it
// via `hasUpdate` (UpdateBanner); `applyUpdate` lets it take over and reloads.

let waiting: ServiceWorker | null = null;
let dismissed = false;
let reloading = false;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

function setWaiting(worker: ServiceWorker | null): void {
  if (worker === waiting) return;
  waiting = worker;
  dismissed = false;
  // A newer build replaced the one "Neu laden" was sent to (no controllerchange will come):
  // the next tap must work again.
  reloading = false;
  notify();
}

/** Whether a new build is installed and waiting for `applyUpdate`, and not dismissed. */
export const hasUpdate = (): boolean => waiting !== null && !dismissed;

/** "Später": hides the offer until the next new build (the waiting one still takes over on the
 * next start once every tab is closed). */
export function dismissUpdate(): void {
  if (dismissed) return;
  dismissed = true;
  notify();
}

/** Calls `listener` whenever `hasUpdate` changes; returns the unsubscribe function. */
export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Activates the waiting build and reloads once it controls the page: the old page must not
 * stay, its lazy route chunks are gone from the new precache. Only on a user tap.
 */
export function applyUpdate(): void {
  const worker = waiting;
  if (!worker || reloading) return;
  reloading = true;
  // Another tab already activated it: this page is controlled by it, only the reload is left.
  if (worker.state === "activating" || worker.state === "activated") {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
    once: true,
  });
  worker.postMessage(SKIP_WAITING_MESSAGE);
}

/**
 * Offers installed updates and checks for new ones when the app comes back to the foreground
 * (an installed PWA on iOS often resumes without a navigation, so the browser's own check on
 * navigations rarely runs). At most once per UPDATE_CHECK_INTERVAL_MS; the check only fetches
 * our own sw.js.
 */
function watchRegistration(reg: ServiceWorkerRegistration): void {
  // Without a controller this is the first install: nothing to replace, nothing to offer.
  const offer = (worker: ServiceWorker | null) => {
    if (!worker || !navigator.serviceWorker.controller) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "redundant" && waiting === worker) setWaiting(null);
    });
    setWaiting(worker);
  };
  const whenInstalled = (worker: ServiceWorker | null) => {
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  };
  offer(reg.waiting);
  // The browser's own check on navigation may have started installing before `load`, i.e.
  // before this runs; its `updatefound` is already gone.
  whenInstalled(reg.installing);
  reg.addEventListener("updatefound", () => whenInstalled(reg.installing));

  let lastCheck = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    lastCheck = Date.now();
    reg.update().catch(() => undefined);
  });
}
