/**
 * iOS (and Chrome's autoplay policy) only let a media element or AudioContext start sound after a
 * user gesture. The game starts the music after a countdown, which is not a gesture. So the setup
 * screen calls `unlockAudio()` synchronously in its "Kamera starten" tap: one shared audio element
 * plays a tiny silent clip and the shared AudioContext is resumed. WebKit lifts the playback
 * restriction per element, so the play route reuses exactly this element for the song (see
 * `createSource(song, { element })`). It is never destroyed, only emptied.
 *
 * If `play()` is still refused later (page reloaded on /play, other browser rules), the game
 * shows "Zum Starten tippen" and calls `play()` inside that tap.
 */

let element: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let unlocked = false;

/** A 50 ms silent 8-bit mono WAV as data URI. */
function silentWav(): string {
  const samples = 400;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (o: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence is the midpoint
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** The one audio element the songs play through. Created on first use. */
export function sharedAudioElement(): HTMLAudioElement {
  element ??= new Audio();
  return element;
}

/** Shared AudioContext (sound effects). Created on first use; null where unsupported. */
export function sharedAudioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = typeof AudioContext === "undefined" ? undefined : AudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/**
 * Must run synchronously inside a user gesture (click/tap handler). Safe to call repeatedly;
 * never throws.
 */
export function unlockAudio(): void {
  const el = sharedAudioElement();
  // Only touch the element while it is not playing a song.
  if (!el.src || el.dataset["silent"] === "1" || el.paused) {
    try {
      el.dataset["silent"] = "1";
      el.src = silentWav();
      const p = el.play();
      void Promise.resolve(p)
        .then(() => {
          unlocked = true;
          if (el.dataset["silent"] === "1") el.pause();
        })
        .catch(() => {
          /* still locked; the game falls back to "Zum Starten tippen" */
        });
    } catch {
      /* play() not implemented (tests) or refused synchronously */
    }
  }
  const ctx = sharedAudioContext();
  if (ctx) {
    try {
      void ctx.resume().catch(() => {});
      // A silent buffer played in the gesture unlocks Web Audio on older iOS versions.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }
}

/** True once the silent clip actually played (only a hint; play() may still be refused). */
export const isAudioUnlocked = () => unlocked;

/** Hands the shared element over to a song: no silent clip, no leftovers from earlier songs. */
export function claimSharedElement(): HTMLAudioElement {
  const el = sharedAudioElement();
  delete el.dataset["silent"];
  el.onended = null;
  el.onerror = null;
  el.oncanplay = null;
  el.onloadedmetadata = null;
  return el;
}

/** Test helper: forget everything. */
export function resetAudioUnlockForTests() {
  element = null;
  context = null;
  unlocked = false;
}
