/** Pure logic for adding a song: link parsing, field validation and building the Song record. */
import { autoChoreo } from "../../data/demo";
import { SongSchema } from "../schema";
import type { ChoreoFile, Choreography, Song, SourceSpec } from "../types";
import { songFromChoreoFile } from "./choreoFile";

export const BPM_MIN = 30;
export const BPM_MAX = 300;
export const DURATION_MIN_S = 10;
export const DURATION_MAX_S = 600;
export const TITLE_MAX = 120;
export const ARTIST_MAX = 120;

const VIDEO_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Extracts the 11-character video id from a YouTube link or a bare id; null if it is neither. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return text;
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let candidate: string | null | undefined;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") candidate = url.searchParams.get("v");
    else if (parts[0] === "shorts" || parts[0] === "embed") candidate = parts[1];
  } else {
    return null;
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "play.spotify.com"]);

/**
 * Turns a Spotify song link (open.spotify.com/track/…, also with /intl-xx/ and query) or a
 * `spotify:track:` URI into the track URI; null for anything else (albums, playlists, bare IDs).
 */
export function parseSpotifyTrackUri(input: string): string | null {
  const text = input.trim();
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return `spotify:track:${uri[1]}`;
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!SPOTIFY_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("intl-")) parts.shift();
  const id = parts[0] === "track" ? parts[1] : undefined;
  return id && SPOTIFY_TRACK_ID.test(id) ? `spotify:track:${id}` : null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Accepts https addresses (http only for localhost, for development). Returns the normalized URL or a German error. */
export function validateAudioUrl(
  input: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const text = input.trim();
  try {
    const url = new URL(text);
    if (url.protocol === "https:" && url.hostname) return { ok: true, url: url.href };
    if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) {
      return { ok: true, url: url.href };
    }
  } catch {
    // falls through to the error below
  }
  return { ok: false, error: "Bitte eine https-Adresse verwenden." };
}

export type NewSongSource =
  | { kind: "file" }
  | { kind: "url"; url: string }
  | { kind: "youtube"; videoId: string }
  | { kind: "spotify"; trackUri: string };

export type NewSongChoreo =
  | { type: "auto" }
  | { type: "import"; file: ChoreoFile }
  /** From the video import (videoImport.ts); `startOffsetMs` = start of the video section. */
  | { type: "video"; choreo: Choreography; startOffsetMs: number };

export interface NewSongInput {
  source: NewSongSource;
  title: string;
  artist: string;
  bpm: number;
  difficulty: 1 | 2 | 3;
  durationMs: number;
  /** Accent and secondary color of the new song (used for auto choreographies). */
  colors: [string, string];
  choreo: NewSongChoreo;
}

function sourceSpec(source: NewSongSource): SourceSpec {
  switch (source.kind) {
    case "file":
      return { type: "local", blobId: crypto.randomUUID() };
    case "url":
      return { type: "url", url: source.url };
    case "youtube":
      return { type: "youtube", videoId: source.videoId };
    case "spotify":
      return { type: "spotify", trackUri: source.trackUri };
  }
}

/**
 * Builds a validated Song. Auto: generated moves from bpm and duration. Import: the file's moves
 * and timing (its bpm, sync and start offsets) are kept, title/artist/difficulty come from the
 * form. Video: the choreography's bpm and offset are kept, the song starts its audio at
 * `startOffsetMs`; colors come from the form like for auto choreographies. IDs are always fresh.
 * Local sources get a new blobId. Throws if the result is invalid.
 */
export function buildNewSong(input: NewSongInput, now = Date.now()): Song {
  const title = input.title.trim();
  const artist = input.artist.trim();
  const source = sourceSpec(input.source);

  let song: Song;
  if (input.choreo.type === "import") {
    const imported = songFromChoreoFile(input.choreo.file, source, now);
    song = {
      ...imported,
      title,
      artist,
      difficulty: input.difficulty,
      choreo: { ...imported.choreo, title },
    };
  } else if (input.choreo.type === "video") {
    const { choreo, startOffsetMs } = input.choreo;
    const [accentColor, secondaryColor] = input.colors;
    song = {
      id: crypto.randomUUID(),
      title,
      artist,
      bpm: choreo.bpm,
      difficulty: input.difficulty,
      source,
      syncOffsetMs: 0,
      startOffsetMs,
      choreo: {
        ...choreo,
        id: crypto.randomUUID(),
        title,
        accentColor,
        secondaryColor,
        createdAt: now,
        updatedAt: now,
      },
      highscore: 0,
      stars: 0,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const choreo = autoChoreo(title, input.bpm, input.durationMs, input.colors);
    song = {
      id: crypto.randomUUID(),
      title,
      artist,
      bpm: input.bpm,
      difficulty: input.difficulty,
      source,
      syncOffsetMs: 0,
      startOffsetMs: 0,
      choreo: { ...choreo, createdAt: now, updatedAt: now },
      highscore: 0,
      stars: 0,
      createdAt: now,
      updatedAt: now,
    };
  }
  return SongSchema.parse(song);
}

export interface NewSongFields {
  kind: "file" | "url" | "youtube" | "spotify";
  title: string;
  /** Raw text of the link / address field (url, youtube and spotify only). */
  link: string;
  bpm: number;
  durationS: number;
  /** Imported choreographies carry their own timing, so no length is needed. */
  imported: boolean;
  /** Video choreographies take their length from the video section (bpm is still needed). */
  video?: boolean;
}

export type FieldErrors = Partial<Record<"title" | "link" | "bpm" | "duration", string>>;

/** Field-level German messages; an empty object means the form is valid. */
export function validateNewSongFields(f: NewSongFields): FieldErrors {
  const errors: FieldErrors = {};
  const title = f.title.trim();
  if (!title) errors.title = "Bitte einen Titel eingeben.";
  else if (title.length > TITLE_MAX)
    errors.title = `Der Titel darf höchstens ${TITLE_MAX} Zeichen haben.`;
  if (f.kind === "youtube" && parseYouTubeId(f.link) === null) {
    errors.link =
      "Das ist kein gültiger YouTube-Link. Bitte Link oder 11-stellige Video-ID eingeben.";
  }
  if (f.kind === "spotify" && parseSpotifyTrackUri(f.link) === null) {
    errors.link =
      "Das ist kein gültiger Spotify-Song. Bitte einen Song-Link (open.spotify.com/track/…) oder eine Spotify-URI eingeben.";
  }
  if (f.kind === "url") {
    const r = validateAudioUrl(f.link);
    if (!r.ok) errors.link = r.error;
  }
  if (!f.imported) {
    if (!Number.isFinite(f.bpm) || f.bpm < BPM_MIN || f.bpm > BPM_MAX) {
      errors.bpm = `BPM muss zwischen ${BPM_MIN} und ${BPM_MAX} liegen.`;
    }
    if (
      !f.video &&
      (!Number.isFinite(f.durationS) ||
        f.durationS < DURATION_MIN_S ||
        f.durationS > DURATION_MAX_S)
    ) {
      errors.duration = `Die Länge muss zwischen ${DURATION_MIN_S} und ${DURATION_MAX_S} Sekunden liegen.`;
    }
  }
  return errors;
}
