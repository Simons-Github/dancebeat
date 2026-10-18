// Synthetisch erzeugte Soundeffekte. The AudioContext is shared with the audio unlock
// (src/lib/audio/unlock.ts), so a tap on "Kamera starten" also unlocks the effects on iOS.
import { sharedAudioContext } from "./audio/unlock";

let volume = 1;

/** Effects follow the music volume (0..1). */
export function setSfxVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
}

function tone(freq: number, dur: number, type: OscillatorType, delay = 0, gain = 0.15) {
  const c = sharedAudioContext();
  if (!c || volume === 0) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  const o = c.createOscillator(),
    g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(gain * volume, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  click: () => {
    try {
      tone(880, 0.08, "triangle");
    } catch {
      /* */
    }
  },
  perfect: () => {
    try {
      tone(660, 0.1, "square", 0, 0.08);
      tone(990, 0.15, "square", 0.07, 0.08);
    } catch {
      /* */
    }
  },
  gold: () => {
    try {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, "sawtooth", i * 0.07, 0.07));
    } catch {
      /* */
    }
  },
  beep: (hi = false) => {
    try {
      tone(hi ? 1200 : 600, 0.12, "sine", 0, 0.2);
    } catch {
      /* */
    }
  },
};
