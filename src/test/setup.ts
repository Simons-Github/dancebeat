import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import { resetSettingsCacheForTests } from "@/lib/settings";

afterEach(resetSettingsCacheForTests);

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom has no canvas backend; tests that need a context mock it themselves.
HTMLCanvasElement.prototype.getContext = () => null;

// jsdom does not implement media playback; tests that care spy on these themselves.
HTMLMediaElement.prototype.play = function () {
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = () => {};
HTMLMediaElement.prototype.load = () => {};

// jsdom has no ResizeObserver (Radix slider and switch measure with it).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom's Blob lacks text() / arrayBuffer(); fall back to FileReader.
const readBlob = (blob: Blob, mode: "text" | "buffer") =>
  new Promise<never>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as never);
    reader.onerror = () => reject(reader.error);
    if (mode === "text") reader.readAsText(blob);
    else reader.readAsArrayBuffer(blob);
  });
if (!Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob) {
    return readBlob(this, "text");
  };
}
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return readBlob(this, "buffer");
  };
}
