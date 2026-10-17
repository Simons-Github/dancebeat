// Synthetisch erzeugte Soundeffekte.
let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

function tone(freq: number, dur: number, type: OscillatorType, delay = 0, gain = 0.15) {
  const c = ac();
  const o = c.createOscillator(),
    g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(gain, t);
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
