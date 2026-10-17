import { useCallback, useEffect, useState } from "react";
import { songRepository } from "@/lib/library/repository";
import { seedDemos } from "@/data/demo";
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

  const save = useCallback(
    async (s: Song, audio?: Blob) => {
      await songRepository.save(s, audio);
      await refresh();
    },
    [refresh],
  );
  const remove = useCallback(
    async (s: Song) => {
      await songRepository.delete(s.id);
      await refresh();
    },
    [refresh],
  );
  const rename = useCallback(
    async (s: Song, title: string) => save({ ...s, title, choreo: { ...s.choreo, title } }),
    [save],
  );
  return { songs, loading, save, remove, rename, refresh };
}
