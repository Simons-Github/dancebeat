/** Deterministic random numbers (no `Math.random`), shared by the generator and the simulated player. */

/** Small deterministic PRNG (mulberry32): numbers in [0, 1). */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal random number (Box-Muller) from two draws of `random`. */
export function gaussian(random: () => number) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 32-bit FNV-1a hash of a string (UTF-16 code units), e.g. a song id as generator seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** PRNG seeded from a string: the same text always yields the same sequence. */
export const randomFromString = (text: string) => seededRandom(hashSeed(text));
