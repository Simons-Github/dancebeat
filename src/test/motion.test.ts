import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MOTION,
  MotionMeter,
  judgeIntensity,
  motionScoring,
  probeMotionSensor,
  requestMotionPermission,
  type MotionSample,
} from "@/lib/motion";

const lin = (x: number, y = 0, z = 0): MotionSample => ({
  linear: { x, y, z },
  withGravity: { x, y: y + 9.81, z },
});

afterEach(() => vi.unstubAllGlobals());

describe("MotionMeter", () => {
  it("Mittelwert des Betrags im Fenster, Grenzen eingeschlossen", () => {
    const m = new MotionMeter();
    m.push(0, lin(3, 4)); // 5
    m.push(100, lin(0, 0, 3)); // 3
    m.push(200, lin(1)); // 1
    m.push(201, lin(100)); // outside
    expect(m.intensity(0, 200)).toBeCloseTo(3);
  });

  it("weniger als MIN_SAMPLES Messungen im Fenster → kein Wert", () => {
    const m = new MotionMeter();
    for (let i = 0; i < MOTION.minSamples - 1; i++) m.push(i * 10, lin(5));
    expect(m.intensity(0, 1000)).toBeNull();
    m.push(500, lin(5));
    expect(m.intensity(0, 1000)).toBe(5);
    expect(m.intensity(2000, 3000)).toBeNull();
  });

  it("Messungen mit fehlenden Achsen werden verworfen", () => {
    const m = new MotionMeter();
    const broken: MotionSample = {
      linear: { x: 1, y: null, z: 0 },
      withGravity: { x: null, y: 9.81, z: 0 },
    };
    for (let i = 0; i < 5; i++) m.push(i * 10, broken);
    expect(m.intensity(0, 100)).toBeNull();
    expect(m.lastSampleMs).toBe(-Infinity);
    m.push(Number.NaN, lin(5));
    expect(m.lastSampleMs).toBe(-Infinity);
  });

  it("Hochpass-Ersatz ohne lineare Beschleunigung: Schwerkraft allein ergibt ~0, Bewegung zählt", () => {
    const m = new MotionMeter();
    const g = (x: number): MotionSample => ({ linear: null, withGravity: { x, y: 9.81, z: 0 } });
    for (let i = 0; i < 50; i++) m.push(i * 16, g(0));
    expect(m.intensity(0, 800)).toBeCloseTo(0);
    for (let i = 50; i < 70; i++) m.push(i * 16, g(i % 2 ? 8 : -8));
    expect(m.intensity(50 * 16, 70 * 16)).toBeGreaterThan(MOTION.thresholds.OK);
  });

  it("Puffer ist begrenzt, lastSampleMs und reset", () => {
    const m = new MotionMeter();
    for (let i = 0; i < MOTION.bufferSize + 10; i++) m.push(i, lin(2));
    expect(m.intensity(0, 9)).toBeNull();
    expect(m.lastSampleMs).toBe(MOTION.bufferSize + 9);
    m.reset();
    expect(m.lastSampleMs).toBe(-Infinity);
    expect(m.intensity(-Infinity, Infinity)).toBeNull();
  });
});

describe("judgeIntensity", () => {
  it("Schwellen bei normal", () => {
    expect(judgeIntensity(6)).toBe("PERFECT");
    expect(judgeIntensity(5.9)).toBe("SUPER");
    expect(judgeIntensity(4)).toBe("SUPER");
    expect(judgeIntensity(2.5)).toBe("GOOD");
    expect(judgeIntensity(1.2)).toBe("OK");
    expect(judgeIntensity(1.1)).toBe("X");
    expect(judgeIntensity(null)).toBe("X");
  });

  it("Schwierigkeit und Gold verschieben die Schwellen", () => {
    expect(judgeIntensity(4.2, "leicht")).toBe("PERFECT"); // 6 × 0.7
    expect(judgeIntensity(6, "schwer")).toBe("SUPER"); // PERFECT needs 8.4
    expect(judgeIntensity(8.4, "schwer")).toBe("PERFECT");
    expect(judgeIntensity(6, "normal", true)).toBe("SUPER"); // PERFECT needs 7.5
    expect(judgeIntensity(7.5, "normal", true)).toBe("PERFECT");
    expect(judgeIntensity(null, "leicht", true)).toBe("X");
  });

  it("motionScoring verbindet Messer und Urteil", () => {
    const m = new MotionMeter();
    for (let i = 0; i < 5; i++) m.push(1000 + i * 50, lin(7));
    let difficulty: "normal" | "schwer" = "normal";
    const dep = motionScoring(m, () => difficulty);
    const move = { timeMs: 1100, label: "M", iconId: "x", gold: false };
    expect(dep.rating(move, 850, 1350)).toBe("PERFECT");
    expect(dep.rating({ ...move, gold: true }, 850, 1350)).toBe("SUPER");
    expect(dep.rating(move, 5000, 5500)).toBe("X");
    expect(dep.lastSampleMs()).toBe(1200);
    // The difficulty is read on every rating: 7 < 6 × 1.4.
    difficulty = "schwer";
    expect(dep.rating(move, 850, 1350)).toBe("SUPER");
  });
});

describe("requestMotionPermission", () => {
  it("ohne DeviceMotionEvent: unsupported", async () => {
    vi.stubGlobal("DeviceMotionEvent", undefined);
    await expect(requestMotionPermission()).resolves.toBe("unsupported");
  });

  it("ohne requestPermission (Android, Desktop): granted", async () => {
    vi.stubGlobal("DeviceMotionEvent", class {});
    await expect(requestMotionPermission()).resolves.toBe("granted");
  });

  it("iOS: fragt synchron an und übernimmt die Antwort", async () => {
    const request = vi.fn(async () => "granted" as PermissionState);
    vi.stubGlobal("DeviceMotionEvent", { requestPermission: request });
    const p = requestMotionPermission();
    expect(request).toHaveBeenCalledTimes(1); // still inside the gesture
    await expect(p).resolves.toBe("granted");
  });

  it("iOS: abgelehnt oder Fehler → denied", async () => {
    vi.stubGlobal("DeviceMotionEvent", { requestPermission: async () => "denied" });
    await expect(requestMotionPermission()).resolves.toBe("denied");
    vi.stubGlobal("DeviceMotionEvent", {
      requestPermission: () => Promise.reject(new Error("no gesture")),
    });
    await expect(requestMotionPermission()).resolves.toBe("denied");
  });
});

describe("probeMotionSensor", () => {
  const motion = (acceleration: unknown, accelerationIncludingGravity: unknown) =>
    Object.assign(new Event("devicemotion"), { acceleration, accelerationIncludingGravity });

  it("true beim ersten Event mit Messwerten, räumt auf", async () => {
    vi.useFakeTimers();
    try {
      const remove = vi.spyOn(window, "removeEventListener");
      const result = probeMotionSensor(1000);
      // Events without data (desktop Chrome sends nulls) do not count.
      window.dispatchEvent(motion({ x: null, y: null, z: null }, null));
      await vi.advanceTimersByTimeAsync(500);
      window.dispatchEvent(motion(null, { x: 0, y: 9.8, z: 0 }));
      await expect(result).resolves.toBe(true);
      expect(remove).toHaveBeenCalledWith("devicemotion", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("false nach dem Timeout ohne Messwerte", async () => {
    vi.useFakeTimers();
    try {
      const result = probeMotionSensor(1000);
      window.dispatchEvent(motion(null, null));
      await vi.advanceTimersByTimeAsync(999);
      let settled = false;
      void result.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
