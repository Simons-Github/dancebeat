import { useCallback, useEffect, useState } from "react";

import { songRepository } from "@/lib/library/repository";
import type { Song } from "@/lib/types";

/**
 * Object URL of the song's dance video, or null (Etappe 8h-2a, shared with the editor preview
 * since 8h-2b-2b-1). A dance video kept on its own (8h-2b-1, `videoBlobId`) takes precedence;
 * otherwise a local source whose blob is a video (8h-1, "Musik aus dem Tanzvideo"). Both share
 * the music's timeline. YouTube, URL and Spotify sources have none. The URL is revoked when the
 * blob changes or on unmount; `onError` (the element's error event) drops it for good, so a
 * broken video falls back once. State changes only on load and error.
 */
export function useDanceVideo(song: Song): { url: string | null; onError: () => void } {
  const keptVideoId = song.videoBlobId ?? null;
  const videoBlobId = keptVideoId ?? (song.source.type === "local" ? song.source.blobId : null);
  const [video, setVideo] = useState<{ blobId: string; url: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!videoBlobId) return;
    let cancelled = false;
    let url: string | null = null;
    void (keptVideoId ? songRepository.getVideo(keptVideoId) : songRepository.getAudio(videoBlobId))
      .then((blob) => {
        // A kept video is a video by construction, even when the picker left its type empty
        // (some Android pickers do for .mov); a music blob must say so.
        if (cancelled || !blob || (!keptVideoId && !blob.type.startsWith("video/"))) return;
        url = URL.createObjectURL(blob);
        setVideo({ blobId: videoBlobId, url });
      })
      .catch(() => {
        // No picture then; the coach stays. The music reports its own load errors.
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [videoBlobId, keptVideoId]);
  const url = video && video.blobId === videoBlobId && video.url !== failedUrl ? video.url : null;
  const onError = useCallback(() => setFailedUrl(url), [url]);
  return { url, onError };
}
