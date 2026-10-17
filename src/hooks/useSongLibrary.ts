import { useCallback, useEffect, useState } from "react";
import { blobsDb, songsDb } from "@/lib/db";
import { seedDemos } from "@/data/demo";
import type { Song } from "@/lib/types";

export function useSongLibrary() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const all = await songsDb.all();
    setSongs(all.sort((a, b) => a.createdAt - b.createdAt));
    setLoading(false);
  }, []);
  useEffect(() => {
    seedDemos()
      .catch(() => {})
      .finally(refresh);
  }, [refresh]);

  const save = useCallback(
    async (s: Song) => {
      await songsDb.put(s);
      await refresh();
    },
    [refresh],
  );
  const remove = useCallback(
    async (s: Song) => {
      await songsDb.remove(s.id);
      if (s.source.type === "local") await blobsDb.remove(s.source.blobId);
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

export async function getSong(id: string) {
  return songsDb.get(id);
}
