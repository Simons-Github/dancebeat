import { z } from "zod";

import { computeAngles, figure, type FigureParams } from "@/lib/pose";
import { DEFAULT_STYLE, generateChoreo, type EnergyCurve } from "@/lib/generator";
import type { Choreography, Frame, MotionPack, Move, Song } from "@/lib/types";
import { CHOREO_VERSION, ChoreographySchema } from "@/lib/schema";
import type { SongRepository } from "@/lib/library/repository";
import { demoSongId } from "@/lib/demoBuild";
import { DemoManifestSchema, type DemoManifest } from "@/lib/demoManifest";

import goldInMyPocket from "./demos/gold-in-my-pocket.manifest.json";
import goldOnTheGlass from "./demos/gold-on-the-glass.manifest.json";
import lemonadeSkies from "./demos/lemonade-skies.manifest.json";
import riseUntilTheMorning from "./demos/rise-until-the-morning.manifest.json";

/** Built-in poses (id → label and figure); also the first source of the motion pack (13e). */
export const DEMO_POSES: Readonly<Record<string, { label: string; p: FigureParams }>> = {
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
  const neutral = DEMO_POSES["neutral"];
  if (!neutral) throw new Error("Missing 'neutral' pose");
  seq.forEach((id, i) => {
    const pose = DEMO_POSES[id];
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

/**
 * Pose id sequences of the former synthesized demos Pink Pulse and Sunset Kick (until Etappe
 * 14a-2). No longer seeded; kept unchanged as the source of the motion pack's transition counts
 * (13e), so `bun run build-motion-pack` stays reproducible.
 */
export const DEMO_SEQUENCES: readonly (readonly string[])[] = [
  [
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
  [
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
];

/**
 * The former synthesized demos with their original metadata. The seed removes them while they
 * are untouched (see `removeLegacyDemos`).
 */
const LEGACY_DEMOS: readonly { id: string; title: string }[] = [
  { id: "d4e0c1a2-0001-4000-8000-000000000001", title: "Pink Pulse" },
  { id: "d4e0c1a2-0002-4000-8000-000000000002", title: "Sunset Kick" },
];
const LEGACY_DEMO_ARTIST = "DanceBeat Demo";

interface DemoEntry {
  /** Library song id (`demoSongId` of the manifest id). */
  id: string;
  manifest: DemoManifest;
  /** Loads the prebuilt choreography (`bun run build-demo`); a separate chunk per demo. */
  loadChoreo: () => Promise<unknown>;
}

function demoEntry(manifest: unknown, load: () => Promise<{ default: unknown }>): DemoEntry {
  const m = DemoManifestSchema.parse(manifest);
  return { id: demoSongId(m.id), manifest: m, loadChoreo: async () => (await load()).default };
}

/** The shipped demo songs (Etappe 14): manifest plus lazily loaded choreography each. */
const DEMOS: readonly DemoEntry[] = [
  demoEntry(goldInMyPocket, () => import("./demos/gold-in-my-pocket.choreo.json")),
  demoEntry(goldOnTheGlass, () => import("./demos/gold-on-the-glass.choreo.json")),
  demoEntry(lemonadeSkies, () => import("./demos/lemonade-skies.choreo.json")),
  demoEntry(riseUntilTheMorning, () => import("./demos/rise-until-the-morning.choreo.json")),
];

export const DEMO_IDS: readonly string[] = DEMOS.map((d) => d.id);
/** Titles of the shipped demos, for the credits. */
export const DEMO_TITLES: readonly string[] = DEMOS.map((d) => d.manifest.title);

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
 * Version of the demo audio. Raise it when the demo audio changes audibly: the next seed
 * replaces the audio of demos already in the library once (song data stays untouched).
 * 1 – original mix (clipped) · 2 – phone-friendly mix, normalized · 3 – less bass
 * (highpass, higher kick and bass; device test: bass still too strong on an iPhone 11) ·
 * 4 – rendered at 48 kHz (iPhone 11: 22.05 kHz sounded dull and noisy) ·
 * 5 – MP3 demos (Etappe 14a-2) replace the synthesis
 */
export const DEMO_AUDIO_VERSION = 5;
const AUDIO_VERSION_KEY = "dancebeat.demoAudioVersion";

/**
 * Version of the demo choreographies. Raise it whenever a prebuilt `*.choreo.json` changes
 * (a test compares their fingerprint): the next seed replaces every demo already in the library
 * once, completely (highscore, stars and the player's edits are lost; decided 2026-10-23 while
 * only the developer uses the app, to be revisited before a public release).
 * 1 – no marker yet (seeded before Etappe 14g) · 2 – AIST pack with smooth entries (14f) ·
 * 3 – AIST sequences in the pack, observed transitions weighted (13j)
 */
export const DEMO_CHOREO_VERSION = 3;
/**
 * Choreography version per demo id. Per demo, not global like the audio marker: the seed runs
 * again after every library write, and a retry must not wipe demos that were already replaced.
 */
const CHOREO_VERSIONS_KEY = "dancebeat.demoChoreoVersions";

const VersionSchema = z.number().int().positive();
const ChoreoVersionsSchema = z.record(z.string(), VersionSchema);

/** Stored choreography version of a demo. Missing, unreadable or invalid storage counts as 1. */
function getChoreoVersions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CHOREO_VERSIONS_KEY);
    if (raw === null) return {};
    const parsed = ChoreoVersionsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

const choreoOutdated = (id: string) => (getChoreoVersions()[id] ?? 1) < DEMO_CHOREO_VERSION;

/** Records that a demo carries the current choreography (synchronous read-modify-write). */
function markChoreoCurrent(id: string) {
  try {
    localStorage.setItem(
      CHOREO_VERSIONS_KEY,
      JSON.stringify({ ...getChoreoVersions(), [id]: DEMO_CHOREO_VERSION }),
    );
  } catch (e) {
    console.warn("Version der Demo-Choreografien konnte nicht gespeichert werden:", e);
  }
}

/** A stored version marker. Missing, unreadable or invalid storage counts as 1. */
function getVersion(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return 1;
    const parsed = VersionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : 1;
  } catch {
    return 1;
  }
}

function setVersion(key: string, version: number) {
  try {
    localStorage.setItem(key, JSON.stringify(version));
  } catch (e) {
    console.warn(`Versionsmarker ${key} konnte nicht gespeichert werden:`, e);
  }
}

/** Loads the audio file of a demo (file name from the manifest). */
export type LoadDemoAudio = (file: string) => Promise<Blob>;

/**
 * Upper limit for one demo download. Generous for about 4 MB on a slow mobile connection; without
 * it a stalled request would hang the library, which waits for the seed.
 */
export const DEMO_AUDIO_TIMEOUT_MS = 60_000;

/**
 * Fetches a demo MP3 from the app's own origin (public/demo-audio/). A missing file comes back as
 * 200 with index.html (SPA fallback on Vercel and in the dev server), so anything that is not
 * audio counts as an error, as does a download that takes longer than `timeoutMs`.
 */
export async function fetchDemoAudio(
  file: string,
  timeoutMs = DEMO_AUDIO_TIMEOUT_MS,
): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}demo-audio/${file}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Demo audio ${file}: HTTP ${response.status}`);
    const type = response.headers.get("Content-Type") ?? "";
    if (!type.startsWith("audio/"))
      throw new Error(`Demo audio ${file}: expected audio, got "${type || "no content type"}"`);
    return await response.blob();
  } finally {
    clearTimeout(timer);
  }
}

/** True if the stored song still plays the shipped demo audio (not a source the player set). */
const usesDemoAudio = (song: Song) =>
  song.source.type === "local" && song.source.blobId === song.id;

/**
 * True while a former demo is exactly as the old seed stored it: original title and artist, demo
 * audio, no sync or start offset, no playback rate and the choreography never edited (the editor
 * sets `updatedAt`; renaming and calibration do not, hence the metadata checks).
 */
const isUntouchedLegacyDemo = (song: Song, title: string) =>
  song.title === title &&
  song.artist === LEGACY_DEMO_ARTIST &&
  usesDemoAudio(song) &&
  song.syncOffsetMs === 0 &&
  song.startOffsetMs === 0 &&
  song.playbackRate === undefined &&
  song.choreo.updatedAt === song.choreo.createdAt;

/**
 * Removes the former synthesized demos while the player left them untouched; otherwise they stay
 * as normal songs. Not recorded as deleted: their ids are never seeded again anyway.
 */
async function removeLegacyDemos(repo: SongRepository) {
  for (const { id, title } of LEGACY_DEMOS) {
    try {
      const song = await repo.get(id);
      if (song && isUntouchedLegacyDemo(song, title)) await repo.delete(id);
    } catch (e) {
      console.warn("Alte Demo konnte nicht entfernt werden:", e);
    }
  }
}

/**
 * Replaces the audio of a demo already in the library with a fresh download. The stored song
 * (highscore, sync offset, edits) is saved back unchanged. Returns false if the upgrade failed;
 * the failure is logged, not thrown, so seeding the other demos goes on.
 */
async function upgradeDemoAudio(repo: SongRepository, loadAudio: LoadDemoAudio, d: DemoEntry) {
  try {
    const blob = await loadAudio(d.manifest.audio);
    // The download is slow: re-read so changes made meanwhile (highscore, deletion) are kept.
    if (getDeletedDemos().includes(d.id)) return true;
    const current = await repo.get(d.id);
    if (!current || !usesDemoAudio(current)) return true;
    await repo.save(current, blob);
    return true;
  } catch (e) {
    console.warn(`Audio der Demo „${d.manifest.title}“ konnte nicht erneuert werden:`, e);
    return false;
  }
}

/** The demo as a fresh library entry: shipped metadata and choreography, no score. */
function freshDemoSong(d: DemoEntry, rawChoreo: unknown): Song {
  const choreo = ChoreographySchema.parse(rawChoreo);
  const now = Date.now();
  const m = d.manifest;
  return {
    id: d.id,
    title: m.title,
    artist: m.artist,
    bpm: m.bpm,
    difficulty: m.difficulty,
    source: { type: "local", blobId: d.id },
    syncOffsetMs: 0,
    startOffsetMs: 0,
    // The prebuilt file carries 0 as times; equal times also mark the choreo as unedited.
    choreo: { ...choreo, createdAt: now, updatedAt: now },
    highscore: 0,
    stars: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Adds one missing demo. Failures are logged, not thrown; the next seed tries again. */
async function addDemo(repo: SongRepository, loadAudio: LoadDemoAudio, d: DemoEntry) {
  try {
    const [rawChoreo, blob] = await Promise.all([d.loadChoreo(), loadAudio(d.manifest.audio)]);
    const song = freshDemoSong(d, rawChoreo);
    // The download is slow: the demo may have been deleted or saved meanwhile (e.g. other tab).
    if (getDeletedDemos().includes(d.id) || (await repo.get(d.id))) return;
    await repo.save(song, blob);
    markChoreoCurrent(d.id);
  } catch (e) {
    console.warn(`Demo „${d.manifest.title}“ konnte nicht angelegt werden:`, e);
  }
}

/**
 * Replaces a demo already in the library with the shipped one (new DEMO_CHOREO_VERSION). The
 * stored audio stays while it is the current demo audio; otherwise (older audio, or the player
 * chose another source) the MP3 is downloaded. An attached dance video is removed first, then
 * `save` overwrites the song (and the audio, if downloaded) in one transaction, so the demo is
 * never missing in between. The song keeps its `createdAt`: the library sorts by it, and a new
 * one would move every replaced demo behind the player's own songs. Returns false if the
 * replacement failed (logged).
 */
async function replaceDemo(
  repo: SongRepository,
  loadAudio: LoadDemoAudio,
  d: DemoEntry,
  existing: Song,
  audioOutdated: boolean,
) {
  try {
    const keepAudio =
      !audioOutdated && usesDemoAudio(existing) && (await repo.getAudio(d.id)) !== undefined;
    const [rawChoreo, blob] = await Promise.all([
      d.loadChoreo(),
      keepAudio ? undefined : loadAudio(d.manifest.audio),
    ]);
    const song = freshDemoSong(d, rawChoreo);
    // The download may be slow: re-read, a demo deleted meanwhile stays deleted.
    const current = await repo.get(d.id);
    if (!current || getDeletedDemos().includes(d.id)) return true;
    if (current.videoBlobId) await repo.setVideo(d.id, undefined);
    if (getDeletedDemos().includes(d.id)) return true;
    await repo.save({ ...song, createdAt: current.createdAt }, blob);
    markChoreoCurrent(d.id);
    return true;
  } catch (e) {
    console.warn(`Demo „${d.manifest.title}“ konnte nicht ersetzt werden:`, e);
    return false;
  }
}

/**
 * Seeds, replaces or upgrades one demo. Returns false only if an existing demo could not be
 * read, or its audio could not be renewed while the audio was outdated (the audio marker then
 * stays for a retry; a failed replacement stays outdated through its own marker).
 */
async function seedDemo(
  repo: SongRepository,
  loadAudio: LoadDemoAudio,
  d: DemoEntry,
  audioOutdated: boolean,
): Promise<boolean> {
  if (getDeletedDemos().includes(d.id)) return true;
  let existing: Song | undefined;
  try {
    existing = await repo.get(d.id);
  } catch (e) {
    console.warn(`Demo „${d.manifest.title}“ konnte nicht gelesen werden:`, e);
    return !audioOutdated;
  }
  if (!existing) {
    await addDemo(repo, loadAudio, d);
    return true;
  }
  // New choreographies replace the whole demo, once per DEMO_CHOREO_VERSION.
  if (choreoOutdated(d.id)) {
    const ok = await replaceDemo(repo, loadAudio, d, existing, audioOutdated);
    return ok || !audioOutdated;
  }
  // Otherwise an existing demo is never overwritten (highscore, stars); only its audio is
  // replaced, once, when the demo audio changed.
  if (audioOutdated && usesDemoAudio(existing)) return upgradeDemoAudio(repo, loadAudio, d);
  return true;
}

async function seedMissingDemos(repo: SongRepository, loadAudio: LoadDemoAudio) {
  try {
    localStorage.removeItem(LEGACY_SEEDED_KEY);
  } catch {
    // storage unavailable: nothing to clean up
  }
  await removeLegacyDemos(repo);
  const audioOutdated = getVersion(AUDIO_VERSION_KEY) < DEMO_AUDIO_VERSION;
  // In parallel: the first start downloads every demo (about 15 MB).
  const results = await Promise.all(DEMOS.map((d) => seedDemo(repo, loadAudio, d, audioOutdated)));
  // Only after every upgrade succeeded; otherwise the next seed tries again.
  if (audioOutdated && results.every(Boolean)) setVersion(AUDIO_VERSION_KEY, DEMO_AUDIO_VERSION);
}

// One run for all callers; there is only one repository in the app, so no per-repo keying.
let seeding: Promise<void> | null = null;

/**
 * Adds every demo that is neither in the library nor deleted by the player, removes untouched
 * former demos, once per DEMO_CHOREO_VERSION replaces demos already there completely and, once
 * per DEMO_AUDIO_VERSION, replaces only their audio.
 * A demo that fails to load is skipped and retried on the next call. Concurrent calls
 * (StrictMode runs effects twice) share one run, so no demo is downloaded twice.
 * `loadAudio` is replaceable for tests (default: fetch from public/demo-audio/).
 */
export function seedDemos(repo: SongRepository, loadAudio: LoadDemoAudio = fetchDemoAudio) {
  seeding ??= seedMissingDemos(repo, loadAudio).finally(() => {
    seeding = null;
  });
  return seeding;
}

/**
 * The former standard choreography for added songs (until Etappe 13f): every 2 beats one of the
 * 11 demo poses in a fixed order, "Locker" in between. Kept only as the baseline of the
 * evaluation bench (`bun run eval-choreo`); the app uses `autoChoreo` (generator).
 */
export function legacyAutoChoreo(
  title: string,
  bpm: number,
  durationMs: number,
  colors: [string, string],
): Choreography {
  const ids = Object.keys(DEMO_POSES).filter((k) => k !== "neutral");
  const beat = 60000 / bpm;
  const n = Math.max(4, Math.floor((durationMs - beat * 4) / (beat * 2)));
  const seq = Array.from({ length: n }, (_, i) => ids[(i * 7 + 3) % ids.length]).filter(
    (id): id is string => id !== undefined,
  );
  const gold = [Math.floor(n * 0.3), Math.floor(n * 0.65), n - 1];
  return build(crypto.randomUUID(), title, bpm, seq, gold, colors);
}

export interface AutoChoreoOptions {
  /** Generator seed; the song id, so the same song always gets the same choreography. */
  seed?: string;
  /** Choreography id; a fresh UUID when omitted. */
  id?: string;
  difficulty?: 1 | 2 | 3;
  /** Time of a beat in the audio (ms), e.g. from `estimateBeatPhaseMs`; 0 when unknown. */
  beatPhaseMs?: number;
  /** Onset envelope of the audio (`analyzeAudio`), steers density, clip energy and gold moves. */
  energy?: EnergyCurve;
  style?: string;
}

/**
 * Standard choreography for added songs without their own: built by the generator
 * (src/lib/generator) from the motion pack (`loadMotionPack`), deterministic per seed.
 */
export function autoChoreo(
  title: string,
  bpm: number,
  durationMs: number,
  colors: [string, string],
  pack: MotionPack,
  opts: AutoChoreoOptions = {},
): Choreography {
  const id = opts.id ?? crypto.randomUUID();
  const { frames, moves } = generateChoreo(
    {
      bpm,
      beatPhaseMs: opts.beatPhaseMs ?? 0,
      durationMs,
      ...(opts.energy ? { energy: opts.energy } : {}),
      style: opts.style ?? DEFAULT_STYLE,
      difficulty: opts.difficulty ?? 2,
      seed: opts.seed ?? id,
    },
    pack,
  );
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
