import { useCallback, useEffect, useRef, useState } from "react";
import { createSource, type AudioSource } from "@/lib/audio/sources";
import { gameTimeMs, type ClockOffsets } from "@/lib/audio/clock";
import type { Song } from "@/lib/types";

export type AudioClockState = "idle" | "loading" | "ready" | "error";

export interface AudioClockOptions {
  latencyMs: number;
  volume: number;
  /**
   * Returns the shared, gesture-unlocked element for file and URL sources (see
   * src/lib/audio/unlock.ts). Called inside the effect, never during render.
   */
  element?: () => HTMLAudioElement;
  /** Called when the audio reached its end (read from a ref, may change freely). */
  onEnded?: () => void;
  /** Test seam: replaces `createSource`. */
  create?: (song: Song) => AudioSource;
}

/**
 * Owns the song's AudioSource and is the only game clock:
 * `timeMs() = getTimeMs() − latency − song.syncOffsetMs − choreo.offsetMs` (see `gameTimeMs`).
 * `timeMs` keeps its identity; offsets are read from refs, so loops never need to restart.
 */
export function useAudioClock(song: Song | null, opts: AudioClockOptions) {
  const src = useRef<AudioSource | null>(null);
  const [state, setState] = useState<AudioClockState>("idle");
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);
  const latest = useRef(opts);
  latest.current = opts;
  const offsets = useRef<ClockOffsets>({ latencyMs: 0, syncOffsetMs: 0, choreoOffsetMs: 0 });
  offsets.current = {
    latencyMs: opts.latencyMs,
    syncOffsetMs: song?.syncOffsetMs ?? 0,
    choreoOffsetMs: song?.choreo.offsetMs ?? 0,
  };

  useEffect(() => {
    src.current?.setVolume(opts.volume);
  }, [opts.volume]);

  const songId = song?.id;
  useEffect(() => {
    if (!song) return;
    // A late load of a previous song must not touch this one's state.
    let cancelled = false;
    const { create, element } = latest.current;
    const s = create ? create(song) : createSource(song, element ? { element: element() } : {});
    src.current = s;
    setEnded(false);
    setError("");
    setState("loading");
    s.onEnded(() => {
      if (cancelled) return;
      setEnded(true);
      latest.current.onEnded?.();
    });
    // Spotify must load inside a click handler (stage 10); everything else may load now.
    if (song.source.type !== "spotify") {
      s.load()
        .then(() => {
          if (cancelled) return;
          s.setVolume(latest.current.volume);
          setState("ready");
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          setState("error");
        });
    } else setState("ready");
    return () => {
      cancelled = true;
      s.destroy();
      if (src.current === s) src.current = null;
    };
    // The source depends on the song identity only; a re-render with a new object is the same song.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  const timeMs = useCallback(
    () => (src.current ? gameTimeMs(src.current.getTimeMs(), offsets.current) : 0),
    [],
  );

  return { source: src, state, error, ended, timeMs };
}
