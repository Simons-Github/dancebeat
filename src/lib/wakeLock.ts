/**
 * Keeps the screen awake via the Screen Wake Lock API. Framework-free; every failure is swallowed
 * (no API, insecure context, battery saver, request rejected): the lock is a comfort, not a need.
 * Browsers drop the lock when the page is hidden, so it is requested again on return.
 */
export interface WakeLockHandle {
  release(): void;
}

export function acquireWakeLock(): WakeLockHandle {
  let wanted = true;
  let sentinel: WakeLockSentinel | null = null;
  let pending = false;
  /** Asked again while a request was in flight (e.g. visible again): retry once it settles. */
  let again = false;

  const settle = () => {
    pending = false;
    if (again) {
      again = false;
      request();
    }
  };

  const request = () => {
    if (pending) {
      again = true;
      return;
    }
    if (!wanted || sentinel) return;
    if (typeof navigator === "undefined" || !navigator.wakeLock) return;
    pending = true;
    navigator.wakeLock.request("screen").then(
      (s) => {
        // Released while the request was in flight: give the lock straight back.
        if (!wanted) {
          s.release().catch(() => {});
        } else if (!s.released) {
          sentinel = s;
          // The browser may release on its own (tab hidden); forget it so we can ask again.
          s.addEventListener("release", () => {
            if (sentinel === s) sentinel = null;
          });
        }
        settle();
      },
      // Rejected (hidden page, battery saver): stay silent; a later return to the page retries.
      settle,
    );
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") request();
  };
  document.addEventListener("visibilitychange", onVisible);
  request();

  return {
    release() {
      if (!wanted) return;
      wanted = false;
      document.removeEventListener("visibilitychange", onVisible);
      const s = sentinel;
      sentinel = null;
      s?.release().catch(() => {});
    },
  };
}
