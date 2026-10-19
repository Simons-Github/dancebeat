import { useCallback, useEffect, useState } from "react";
import { songRepository } from "@/lib/library/repository";
import { markDemoDeleted, seedDemos } from "@/data/demo";
import type { Song } from "@/lib/types";

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
  const rename = useCallback(
    async (s: Song, title: string, artist: string = s.artist) => {
      // The repository validates lengths (title 1-120, artist 0-120) and rejects otherwise.
      const t = title.trim();
      await save({ ...s, title: t, artist: artist.trim(), choreo: { ...s.choreo, title: t } });
    },
    [save],
  );
  return { songs, loading, save, remove, rename, refresh };
}
