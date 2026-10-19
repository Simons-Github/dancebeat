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
      navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined);
    } catch {
      // Some browsers throw synchronously (e.g. blocked storage); nothing to do.
    }
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
