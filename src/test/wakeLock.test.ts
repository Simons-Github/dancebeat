import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireWakeLock } from "@/lib/wakeLock";

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}

let request: ReturnType<typeof vi.fn>;
let sentinels: FakeSentinel[];

const flush = () => new Promise((r) => setTimeout(r, 0));
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: v });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  sentinels = [];
  request = vi.fn(async () => {
    const s = new FakeSentinel();
    sentinels.push(s);
    return s;
  });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "wakeLock");
  setVisibility("visible");
});

describe("wakeLock", () => {
  it("requests a screen lock and releases it", async () => {
    const lock = acquireWakeLock();
    await flush();
    expect(request).toHaveBeenCalledWith("screen");
    lock.release();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it("requests again when the page becomes visible after the browser dropped the lock", async () => {
    const lock = acquireWakeLock();
    await flush();
    setVisibility("hidden");
    await sentinels[0]?.release();
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    lock.release();
    expect(sentinels[1]?.release).toHaveBeenCalledTimes(1);
  });

  it("does not request twice while a lock is held or pending", async () => {
    const lock = acquireWakeLock();
    setVisibility("visible");
    await flush();
    setVisibility("visible");
    expect(request).toHaveBeenCalledTimes(1);
    lock.release();
  });

  it("retries once when the page became visible while a request was rejected", async () => {
    let reject: (e: Error) => void = () => {};
    request.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    const lock = acquireWakeLock();
    setVisibility("visible");
    reject(new Error("NotAllowedError"));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    lock.release();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rejected request on its own", async () => {
    request.mockImplementationOnce(async () => {
      throw new Error("NotAllowedError");
    });
    const lock = acquireWakeLock();
    await flush();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    lock.release();
  });

  it("stops listening after release", async () => {
    const lock = acquireWakeLock();
    await flush();
    lock.release();
    await sentinels[0]?.release();
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without the API", () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    const lock = acquireWakeLock();
    expect(() => lock.release()).not.toThrow();
  });

  it("swallows a rejected request", async () => {
    request.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const lock = acquireWakeLock();
    await flush();
    expect(() => lock.release()).not.toThrow();
  });

  it("releases a sentinel that arrives after release()", async () => {
    const lock = acquireWakeLock();
    lock.release();
    await flush();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });
});
