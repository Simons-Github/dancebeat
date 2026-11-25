import { useEffect } from "react";

import { acquireWakeLock } from "@/lib/wakeLock";

/**
 * Holds the screen awake while `active`. Matters most in movement mode: without a camera the
 * phone gets no touch input during the song and could lock mid-song.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const lock = acquireWakeLock();
    return () => lock.release();
  }, [active]);
}
