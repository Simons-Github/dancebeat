import { z } from "zod";

import { computeAngles, figure, type FigureParams } from "@/lib/pose";
import type { Choreography, Frame, Move, Song } from "@/lib/types";
import { CHOREO_VERSION } from "@/lib/schema";
import type { SongRepository } from "@/lib/library/repository";

const POSES: Record<string, { label: string; p: FigureParams }> = {
  neutral: { label: "Locker", p: { la: 10, ra: 10 } },
  "arms-up": { label: "Arme hoch", p: { la: 170, ra: 170 } },
  "t-pose": { label: "Flieger", p: { la: 90, ra: 90 } },
  "left-up": { label: "Links hoch", p: { la: 160, ra: 20, le: 0, re: 60 } },
  "right-up": { label: "Rechts hoch", p: { la: 20, ra: 160, le: 60 } },
  squat: { label: "Tief!", p: { la: 80, ra: 80, ll: 25, rl: 25, lk: 70, rk: 70, dy: 0.06 } },
  "disco-l": { label: "Disco", p: { la: 150, ra: 30, re: 90, lean: -10 } },
  "disco-r": { label: "Disco", p: { la: 30, ra: 150, le: 90, lean: 10 } },
  flex: { label: "Muskeln", p: { la: 90, ra: 90, le: 100, re: 100 } },
  "kick-l": { label: "Kick", p: { la: 60, ra: 60, ll: 50, lean: 8 } },
  "kick-r": { label: "Kick", p: { la: 60, ra: 60, rl: 50, lean: -8 } },
  star: { label: "Stern", p: { la: 135, ra: 135, ll: 25, rl: 25 } },
};

function build(
  id: string,
  title: string,
  bpm: number,
  seq: string[],
  gold: number[],
  colors: [string, string],
): Choreography {
  const beat = 60000 / bpm;
  const frames: Frame[] = [];
  const moves: Move[] = [];
  const intro = beat * 4;
  const neutral = POSES["neutral"];
  if (!neutral) throw new Error("Missing 'neutral' pose");
  seq.forEach((id, i) => {
    const pose = POSES[id];
    if (!pose) {
      console.warn(`Unknown pose id "${id}", skipped`);
      return;
    }
    const t = intro + i * beat * 2;
    const lm = figure(pose.p);
    const between = figure(neutral.p);
    frames.push({ timeMs: t - beat * 0.9, landmarks: between, angles: computeAngles(between) });
    frames.push({ timeMs: t, landmarks: lm, angles: computeAngles(lm) });
    frames.push({ timeMs: t + beat * 0.5, landmarks: lm, angles: computeAngles(lm) });
    moves.push({ timeMs: t, label: pose.label, iconId: id, gold: gold.includes(i) });
  });
  const now = Date.now();
  return {
    version: CHOREO_VERSION,
    id,
    title,
    bpm,
    offsetMs: 0,
    accentColor: colors[0],
    secondaryColor: colors[1],
    frames,
    moves,
    createdAt: now,
    updatedAt: now,
  };
}

/** Peak level of the demo audio (−6 dBFS): leaves headroom for music plus sound effects. */
export const DEMO_PEAK = 0.5;

/**
 * Encodes mono samples as 16-bit PCM WAV. The signal is first peak-normalized to DEMO_PEAK, so
 * it can never clip whatever the mix; silence stays silence.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0 ? DEMO_PEAK / peak : 0;
  const ab = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(ab);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, (samples[i] ?? 0) * scale));
    v.setInt16(44 + i * 2, Math.round(s * 0x7fff), true);
  }
  return ab;
}

/** Shapes a gain envelope: short linear attack (no click), then exponential decay. */
function envelope(g: GainNode, t: number, level: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
}

/**
 * Synthesizes a beat track as WAV. Mixed for phone speakers: the kick sweeps down only to 55 Hz,
 * the bass plays an octave up through a lowpass, the hihat is highpassed noise (a square wave
 * at this sample rate aliases).
 */
async function synthTrack(bpm: number, seconds: number, root: number): Promise<Blob> {
  const sr = 22050; // low rate keeps the stored blob small
  const ctx = new OfflineAudioContext(1, sr * seconds, sr);
  const beat = 60 / bpm;
  const notes = [0, 3, 7, 5];
  const noise = ctx.createBuffer(1, Math.ceil(sr * 0.05), sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  for (let i = 0; i * beat < seconds; i++) {
    const t = i * beat;
    // Kick
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    envelope(g, t, 0.6, 0.004, 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.3);
    // Hihat offbeat
    const ht = t + beat / 2;
    const h = ctx.createBufferSource(),
      hf = ctx.createBiquadFilter(),
      hg = ctx.createGain();
    h.buffer = noise;
    hf.type = "highpass";
    hf.frequency.value = 6500;
    envelope(hg, ht, 0.15, 0.002, 0.045);
    h.connect(hf).connect(hg).connect(ctx.destination);
    h.start(ht);
    h.stop(ht + 0.05);
    // Bass, one octave above the root so phone speakers can play it
    const b = ctx.createOscillator(),
      bf = ctx.createBiquadFilter(),
      bg = ctx.createGain();
    b.type = "sawtooth";
    b.frequency.value = root * 2 * Math.pow(2, (notes[Math.floor(i / 4) % 4] ?? 0) / 12); // index is always in range; 0 = root note
    bf.type = "lowpass";
    bf.frequency.value = 1200;
    envelope(bg, t, 0.3, 0.005, beat * 0.9);
    b.connect(bf).connect(bg).connect(ctx.destination);
    b.start(t);
    b.stop(t + beat);
  }
  const buf = await ctx.startRendering();
  return new Blob([encodeWav(buf.getChannelData(0), sr)], { type: "audio/wav" });
}

const DEMOS = [
  {
    // Fixed UUIDs keep the demos stable across re-seeding.
    id: "d4e0c1a2-0001-4000-8000-000000000001",
    choreoId: "d4e0c1a2-0001-4000-8000-000000000101",
    title: "Pink Pulse",
    artist: "DanceBeat Demo",
    bpm: 112,
    diff: 1 as const,
    root: 55,
    colors: ["#FF2E93", "#00E5FF"] as [string, string],
    seq: [
      "arms-up",
      "t-pose",
      "left-up",
      "right-up",
      "flex",
      "star",
      "disco-l",
      "disco-r",
      "arms-up",
      "squat",
      "t-pose",
      "star",
      "left-up",
      "right-up",
      "flex",
      "arms-up",
    ],
    gold: [5, 15],
  },
  {
    id: "d4e0c1a2-0002-4000-8000-000000000002",
    choreoId: "d4e0c1a2-0002-4000-8000-000000000102",
    title: "Sunset Kick",
    artist: "DanceBeat Demo",
    bpm: 124,
    diff: 2 as const,
    root: 49,
    colors: ["#FF8A00", "#7CFF4F"] as [string, string],
    seq: [
      "kick-l",
      "kick-r",
      "disco-l",
      "disco-r",
      "squat",
      "arms-up",
      "star",
      "flex",
      "kick-l",
      "kick-r",
      "t-pose",
      "squat",
      "disco-l",
      "disco-r",
      "star",
      "arms-up",
      "left-up",
      "right-up",
    ],
    gold: [6, 14, 17],
  },
];

export const DEMO_IDS: readonly string[] = DEMOS.map((d) => d.id);

export const isDemoId = (id: string) => DEMO_IDS.includes(id);

const DELETED_KEY = "dancebeat.deletedDemos";
/** Marker of the old "seed once" rule; no longer read, removed on the next seed. */
const LEGACY_SEEDED_KEY = "dancebeat.seeded";

const DeletedDemosSchema = z.array(z.string());

/** Ids of demos the player deleted on purpose. Unreadable or invalid storage counts as empty. */
export function getDeletedDemos(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    if (raw === null) return [];
    const parsed = DeletedDemosSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Remembers that a demo was deleted so it is not seeded again. No-op for other songs. */
export function markDemoDeleted(id: string) {
  if (!isDemoId(id)) return;
  const deleted = getDeletedDemos();
  if (deleted.includes(id)) return;
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...deleted, id]));
  } catch (e) {
    console.warn("Gelöschte Demos konnten nicht gespeichert werden:", e);
  }
}

/**
 * Version of the synthesized demo audio. Raise it when `synthTrack` changes audibly: the next seed
 * replaces the audio of demos already in the library once (song data stays untouched).
 * 1 – original mix (clipped) · 2 – phone-friendly mix, normalized to DEMO_PEAK
 */
export const DEMO_AUDIO_VERSION = 2;
const AUDIO_VERSION_KEY = "dancebeat.demoAudioVersion";
const AudioVersionSchema = z.number().int().positive();

/** Audio version of the stored demos. Missing, unreadable or invalid storage counts as 1. */
function getDemoAudioVersion(): number {
  try {
    const raw = localStorage.getItem(AUDIO_VERSION_KEY);
    if (raw === null) return 1;
    const parsed = AudioVersionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : 1;
  } catch {
    return 1;
  }
}

function setDemoAudioVersion(version: number) {
  try {
    localStorage.setItem(AUDIO_VERSION_KEY, JSON.stringify(version));
  } catch (e) {
    console.warn("Version der Demo-Audiodaten konnte nicht gespeichert werden:", e);
  }
}

type Demo = (typeof DEMOS)[number];

const buildDemoChoreo = (d: Demo) => build(d.choreoId, d.title, d.bpm, d.seq, d.gold, d.colors);

/** Track length for a demo: last move plus a short tail. */
const demoSeconds = (lastMove: Move) => Math.ceil(lastMove.timeMs / 1000) + 4;

/** True if the stored song still plays the synthesized demo audio (not a source the player set). */
const usesDemoAudio = (song: Song) =>
  song.source.type === "local" && song.source.blobId === song.id;

/**
 * Replaces the audio of a demo already in the library with a fresh synthesis. The stored song
 * (highscore, sync offset, edits) is saved back unchanged. Returns false if the upgrade failed;
 * the failure is logged, not thrown, so seeding the other demos goes on.
 */
async function upgradeDemoAudio(repo: SongRepository, synth: typeof synthTrack, d: Demo) {
  const lastMove = buildDemoChoreo(d).moves.at(-1);
  if (!lastMove) return true; // no moves: nothing to play
  try {
    const blob = await synth(d.bpm, demoSeconds(lastMove), d.root);
    // Synthesis is slow: re-read so changes made meanwhile (highscore, deletion) are kept.
    if (getDeletedDemos().includes(d.id)) return true;
    const current = await repo.get(d.id);
    if (!current || !usesDemoAudio(current)) return true;
    await repo.save(current, blob);
    return true;
  } catch (e) {
    console.warn(`Audio der Demo „${d.title}“ konnte nicht erneuert werden:`, e);
    return false;
  }
}

async function seedMissingDemos(repo: SongRepository, synth: typeof synthTrack) {
  try {
    localStorage.removeItem(LEGACY_SEEDED_KEY);
  } catch {
    // storage unavailable: nothing to clean up
  }
  const deleted = getDeletedDemos();
  const outdated = getDemoAudioVersion() < DEMO_AUDIO_VERSION;
  let upgradeFailed = false;
  for (const d of DEMOS) {
    if (deleted.includes(d.id)) continue;
    // Never overwrite an existing demo: it carries the player's highscore and stars. Only its
    // audio is replaced, once, when the synthesis changed.
    const existing = await repo.get(d.id);
    if (existing) {
      if (outdated && usesDemoAudio(existing) && !(await upgradeDemoAudio(repo, synth, d)))
        upgradeFailed = true;
      continue;
    }
    const choreo = buildDemoChoreo(d);
    const lastMove = choreo.moves.at(-1);
    if (!lastMove) continue; // no moves: nothing to seed
    const blob = await synth(d.bpm, demoSeconds(lastMove), d.root);
    // Synthesis is slow: the demo may have been deleted or saved meanwhile (e.g. other tab).
    if (getDeletedDemos().includes(d.id) || (await repo.get(d.id))) continue;
    const now = Date.now();
    const song: Song = {
      id: d.id,
      title: d.title,
      artist: d.artist,
      bpm: d.bpm,
      difficulty: d.diff,
      source: { type: "local", blobId: d.id },
      syncOffsetMs: 0,
      startOffsetMs: 0,
      choreo,
      highscore: 0,
      stars: 0,
      createdAt: now,
      updatedAt: now,
    };
    await repo.save(song, blob);
  }
  // Only after every upgrade succeeded; otherwise the next seed tries again.
  if (outdated && !upgradeFailed) setDemoAudioVersion(DEMO_AUDIO_VERSION);
}

// One run for all callers; there is only one repository in the app, so no per-repo keying.
let seeding: Promise<void> | null = null;

/**
 * Adds every demo that is neither in the library nor deleted by the player and, once per
 * DEMO_AUDIO_VERSION, replaces the audio of demos already there. Concurrent calls
 * (StrictMode runs effects twice) share one run, so no demo is synthesized twice.
 * `synth` is replaceable for tests (jsdom has no OfflineAudioContext).
 */
export function seedDemos(repo: SongRepository, synth: typeof synthTrack = synthTrack) {
  seeding ??= seedMissingDemos(repo, synth).finally(() => {
    seeding = null;
  });
  return seeding;
}

/** Standard-Choreo für neu hinzugefügte Songs ohne eigene Choreografie. */
export function autoChoreo(
  title: string,
  bpm: number,
  durationMs: number,
  colors: [string, string],
): Choreography {
  const ids = Object.keys(POSES).filter((k) => k !== "neutral");
  const beat = 60000 / bpm;
  const n = Math.max(4, Math.floor((durationMs - beat * 4) / (beat * 2)));
  const seq = Array.from({ length: n }, (_, i) => ids[(i * 7 + 3) % ids.length]).filter(
    (id): id is string => id !== undefined,
  );
  const gold = [Math.floor(n * 0.3), Math.floor(n * 0.65), n - 1];
  return build(crypto.randomUUID(), title, bpm, seq, gold, colors);
}
