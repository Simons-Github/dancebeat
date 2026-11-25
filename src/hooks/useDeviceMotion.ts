import { useEffect, useRef } from "react";

import type { MotionSample } from "@/lib/motion";

/**
 * Listens to `devicemotion` while `enabled` and hands every measurement to `onSample` (read from a
 * ref, may change freely). No state: React does not render per event. The caller stamps the
 * measurement with the game clock; the event's own time stamp is ignored on purpose.
 */
export function useDeviceMotion(enabled: boolean, onSample: (sample: MotionSample) => void) {
  const callback = useRef(onSample);
  callback.current = onSample;

  useEffect(() => {
    if (!enabled) return;
    const onMotion = (e: DeviceMotionEvent) =>
      callback.current({
        linear: e.acceleration ?? null,
        withGravity: e.accelerationIncludingGravity ?? null,
      });
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [enabled]);
}
