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
 *
 * iOS Safari ignores `HTMLMediaElement.volume` (the setter is a no-op, it reads back 1). On such
 * devices file songs play through a second shared element that is routed through Web Audio
 * (MediaElementSource → GainNode → destination), so the volume slider works via the gain.
 */

let element: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let unlocked = false;
let volumeIgnored: boolean | null = null;
/** Element routed through `routedGain`; null until created (or when routing failed). */
let routed: HTMLAudioElement | null = null;
let routedGain: GainNode | null = null;
let routingFailed = false;

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
 * iPhone, iPod or iPad (iPadOS reports a Mac user agent, but with touch points). Every browser
 * there is WebKit and leaves the media volume to the hardware keys.
 */
function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * True where the browser ignores `HTMLMediaElement.volume` (iOS/iPadOS). Measured once on first
 * call (never at module level) and cached. Reading the value back is not enough: an iPhone 11
 * (device test 2026-10-20) reported the set 0.5 but still played at full volume.
 */
export function mediaVolumeIgnored(): boolean {
  if (volumeIgnored !== null) return volumeIgnored;
  try {
    const probe = new Audio();
    probe.volume = 0.5;
    volumeIgnored = isAppleMobile() || probe.volume !== 0.5;
  } catch {
    volumeIgnored = isAppleMobile();
  }
  return volumeIgnored;
}

/**
 * The element file songs play through on volume-ignoring devices, connected once to
 * MediaElementSource → GainNode → destination. Null where routing is not needed or failed.
 */
function routedAudioElement(): HTMLAudioElement | null {
  if (routed) return routed;
  if (routingFailed || !mediaVolumeIgnored()) return null;
  const ctx = sharedAudioContext();
  if (!ctx) return null;
  const el = new Audio();
  try {
    // Allowed only once per element; the connection is permanent.
    const node = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    node.connect(gain);
    gain.connect(ctx.destination);
    routed = el;
    routedGain = gain;
  } catch {
    routingFailed = true;
    return null;
  }
  return routed;
}

/** Gain node the element's sound passes through (routed element only), else null. */
export function musicGainFor(el: HTMLAudioElement): GainNode | null {
  return el === routed ? routedGain : null;
}

/** Plays the silent clip on `el` (inside a gesture this lifts WebKit's per-element lock). */
function unlockElement(el: HTMLAudioElement) {
  // Only touch the element while it is not playing a song.
  if (el.src && el.dataset["silent"] !== "1" && !el.paused) return;
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

/**
 * Must run synchronously inside a user gesture (click/tap handler). Safe to call repeatedly;
 * never throws.
 */
export function unlockAudio(): void {
  unlockElement(sharedAudioElement());
  // Volume-ignoring devices: the routed element needs its own unlock in the same gesture.
  const r = routedAudioElement();
  if (r) unlockElement(r);
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

/**
 * Hands a shared element over to a song: no silent clip, no leftovers from earlier songs. File
 * songs get the routed element on volume-ignoring devices. URL songs always get the plain one: a
 * cross-origin URL without CORS headers would output silence through MediaElementSource (the URL
 * source deliberately does not require CORS), and routing an element cannot be undone.
 */
export function claimSharedElement(type: "local" | "url" = "url"): HTMLAudioElement {
  const el = (type === "local" ? routedAudioElement() : null) ?? sharedAudioElement();
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
  volumeIgnored = null;
  routed = null;
  routedGain = null;
  routingFailed = false;
}
