// Decodes an audio file to mono float samples with ffmpeg (optional system tool, not a project
// dependency). Shared by measure-audio.ts and aist/measure-music.ts.
import { spawnSync } from "node:child_process";

export const SAMPLE_RATE = 44_100;

/** Mono samples at SAMPLE_RATE; `filter` is an ffmpeg audio filter chain (e.g. a lowpass). */
export function decode(file: string, filter?: string): Float32Array {
  const args = ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE)];
  if (filter) args.push("-af", filter);
  args.push("-f", "f32le", "-");
  const res = spawnSync("ffmpeg", args, { maxBuffer: 1 << 30 });
  if (res.error) {
    const missing = (res.error as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing
        ? "ffmpeg nicht gefunden: bitte installieren (z. B. `brew install ffmpeg`). " +
            "ffmpeg not found on the PATH."
        : `ffmpeg konnte nicht starten: ${res.error.message}`,
    );
  }
  if (res.status !== 0)
    throw new Error(`ffmpeg-Fehler bei ${file}: ${res.stderr.toString().trim() || res.status}`);
  const buf = res.stdout;
  // Copy into an aligned buffer: the Buffer may sit at an unaligned offset of a shared pool.
  const bytes = new Uint8Array(buf.byteLength - (buf.byteLength % 4));
  bytes.set(buf.subarray(0, bytes.length));
  return new Float32Array(bytes.buffer);
}

/** Kick band (lowpass 120 Hz): the full band locks onto hi-hat offbeats in some songs. */
export const KICK_FILTER = "lowpass=f=120,lowpass=f=120";
