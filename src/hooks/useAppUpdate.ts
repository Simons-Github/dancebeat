import { useSyncExternalStore } from "react";

import { applyUpdate, dismissUpdate, hasUpdate, subscribeUpdate } from "@/lib/serviceWorker";

/** Whether a new app build waits (src/lib/serviceWorker.ts), with the two answers to it. */
export function useAppUpdate() {
  const available = useSyncExternalStore(subscribeUpdate, hasUpdate, () => false);
  return { available, apply: applyUpdate, dismiss: dismissUpdate };
}
