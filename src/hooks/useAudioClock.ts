import { useCallback, useEffect, useRef, useState } from "react";
import { createSource, type AudioSource } from "@/lib/audio/sources";
import type { Song } from "@/lib/types";

/** Einzige Zeitquelle des Spiels: Song-Zeit minus globaler Latenz und Song-Offset. */
export function useAudioClock(song: Song | null, latencyMs: number, volume: number) {
  const src = useRef<AudioSource | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (!song) return;
    const s = createSource(song);
    src.current = s;
    setState("loading");
    // YouTube/Spotify müssen im Klick-Handler starten; laden darf vorab passieren (außer Spotify).
    if (song.source.type !== "spotify") {
      s.load()
        .then(() => {
          s.setVolume(volume);
          setState("ready");
        })
        .catch((e) => {
          setError(e.message);
          setState("error");
        });
    } else setState("ready");
    s.onEnded(() => setEnded(true));
    return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  const start = useCallback(async () => {
    const s = src.current!;
    if (song?.source.type === "spotify") await s.load();
    s.setVolume(volume);
    if (song?.startOffsetMs) s.seek(song.startOffsetMs);
    await s.play();
  }, [song, volume]);

  const timeMs = useCallback(
    () =>
      src.current
        ? src.current.getTimeMs() -
          latencyMs -
          (song?.syncOffsetMs ?? 0) -
          (song?.choreo.offsetMs ?? 0)
        : 0,
    [latencyMs, song],
  );

  return { source: src, state, error, ended, start, timeMs, setError, setState };
}
