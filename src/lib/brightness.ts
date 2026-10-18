/** Mean channel value (0..255) below which the picture counts as too dark. */
export const LOW_LIGHT_THRESHOLD = 45;
export const BRIGHTNESS_INTERVAL_MS = 2000;

/**
 * Mean brightness of the video, measured on a 16x12 downscale (local only).
 * Returns null when no canvas backend is available.
 */
export function createBrightnessMeter(): (video: HTMLVideoElement) => number | null {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 12;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return (video) => {
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 16, 12);
    const d = ctx.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i + 2 < d.length; i += 4)
      sum += (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
    return sum / (d.length / 4) / 3;
  };
}

export const isLowLight = (brightness: number) => brightness < LOW_LIGHT_THRESHOLD;
