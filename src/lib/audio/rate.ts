import type { Song } from "../types";

/**
 * Whether an audio source applies `playbackRate`. File and URL sources (HTML media element) and
 * YouTube (`setPlaybackRate`) do; Spotify always plays at normal speed.
 */
export const appliesPlaybackRate = (source: Song["source"]) =>
  source.type === "local" || source.type === "url" || source.type === "youtube";

/**
 * The rate the song actually plays at: `song.playbackRate ?? 1` for sources that apply it, else 1.
 * Everything that depends on the real speed (latency scaling, frame age, beat pulse limit, sync
 * test) uses this instead of the stored value.
 */
export const effectivePlaybackRate = (song: Song): number =>
  appliesPlaybackRate(song.source) ? (song.playbackRate ?? 1) : 1;
