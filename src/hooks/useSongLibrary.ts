import { useCallback, useEffect, useState } from "react";
import { songRepository } from "@/lib/library/repository";
import { markDemoDeleted, seedDemos } from "@/data/demo";
import type { Song } from "@/lib/types";

/** Fields the "Song bearbeiten" dialog changes; saved together in one write. */
export interface SongDetailsPatch {
  title: string;
  /** Kept when left out. */
  artist?: string;
  /** Kept when left out. */
  startOffsetMs?: number;
}

export function useSongLibrary() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setSongs(await songRepository.list());
    setLoading(false);
  }, []);
  useEffect(() => {
    seedDemos(songRepository)
      .catch((e: unknown) => console.warn("Seeding demos failed:", e))
      .finally(refresh);
  }, [refresh]);

  /** Reload after a successful write; a failing reload must not look like a failed write. */
  const refreshAfterWrite = useCallback(async () => {
    try {
      await refresh();
    } catch (e) {
      console.warn("Reloading the library failed:", e);
    }
  }, [refresh]);

  const save = useCallback(
    async (s: Song, audio?: Blob) => {
      await songRepository.save(s, audio);
      await refreshAfterWrite();
    },
    [refreshAfterWrite],
  );
  const remove = useCallback(
    async (s: Song) => {
      // Mark first so a seed running in another tab cannot bring the demo back in between.
      // A mark left behind by a failed delete is harmless: seeding only adds missing demos.
      markDemoDeleted(s.id);
      await songRepository.delete(s.id);
      await refreshAfterWrite();
    },
    [refreshAfterWrite],
  );
  /** Title, artist and start offset in one write; `choreo.title` follows the title. */
  const updateDetails = useCallback(
    async (s: Song, patch: SongDetailsPatch) => {
      // The repository validates (title 1-120, artist 0-120, start offset >= 0) and rejects otherwise.
      const t = patch.title.trim();
      await save({
        ...s,
        title: t,
        artist: (patch.artist ?? s.artist).trim(),
        startOffsetMs: patch.startOffsetMs ?? s.startOffsetMs,
        choreo: { ...s.choreo, title: t },
      });
    },
    [save],
  );
  /** JSON text of the song's choreography export (no audio). */
  const exportChoreo = useCallback((s: Song) => songRepository.export(s.id), []);
  return { songs, loading, save, remove, updateDetails, exportChoreo, refresh };
}
