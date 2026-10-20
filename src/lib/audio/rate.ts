import type { Song } from "../types";

/**
 * Whether an audio source applies `playbackRate`. Only file and URL sources (HTML media element)
 * do; YouTube and Spotify always play at normal speed.
 */
export const appliesPlaybackRate = (source: Song["source"]) =>
  source.type === "local" || source.type === "url";

/**
 * The rate the song actually plays at: `song.playbackRate ?? 1` for sources that apply it, else 1.
 * Everything that depends on the real speed (latency scaling, frame age, beat pulse limit, sync
 * test) uses this instead of the stored value.
 */
export const effectivePlaybackRate = (song: Song): number =>
  appliesPlaybackRate(song.source) ? (song.playbackRate ?? 1) : 1;
