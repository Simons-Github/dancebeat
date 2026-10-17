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

/** Erzeugt einen synthetischen Beat-Track als WAV. */
async function synthTrack(bpm: number, seconds: number, root: number): Promise<Blob> {
  const sr = 22050;
  const ctx = new OfflineAudioContext(1, sr * seconds, sr);
  const beat = 60 / bpm;
  const notes = [0, 3, 7, 5];
  for (let i = 0; i * beat < seconds; i++) {
    const t = i * beat;
    // Kick
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.3);
    // Hihat offbeat
    const h = ctx.createOscillator(),
      hg = ctx.createGain();
    h.type = "square";
    h.frequency.value = 8000;
    hg.gain.setValueAtTime(0.04, t + beat / 2);
    hg.gain.exponentialRampToValueAtTime(0.001, t + beat / 2 + 0.05);
    h.connect(hg).connect(ctx.destination);
    h.start(t + beat / 2);
    h.stop(t + beat / 2 + 0.06);
    // Bass
    const b = ctx.createOscillator(),
      bg = ctx.createGain();
    b.type = "sawtooth";
    b.frequency.value = root * Math.pow(2, (notes[Math.floor(i / 4) % 4] ?? 0) / 12); // index is always in range; 0 = root note
    bg.gain.setValueAtTime(0.12, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9);
    b.connect(bg).connect(ctx.destination);
    b.start(t);
    b.stop(t + beat);
  }
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  const ab = new ArrayBuffer(44 + d.length * 2);
  const v = new DataView(ab);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + d.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++)
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] ?? 0)) * 0x7fff, true);
  return new Blob([ab], { type: "audio/wav" });
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

export async function seedDemos(repo: SongRepository) {
  if (localStorage.getItem("dancebeat.seeded")) return;
  for (const d of DEMOS) {
    const choreo = build(d.choreoId, d.title, d.bpm, d.seq, d.gold, d.colors);
    const lastMove = choreo.moves.at(-1);
    if (!lastMove) continue; // no moves: nothing to seed
    const blob = await synthTrack(d.bpm, Math.ceil(lastMove.timeMs / 1000) + 4, d.root);
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
  localStorage.setItem("dancebeat.seeded", "1");
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
