import { useCallback } from "react";
import {
  notifyManager,
  useQuery,
  useQueryClient,
  type QueryFunctionContext,
} from "@tanstack/react-query";
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

/** Query key of the song list; one shared cache entry for every screen. */
export const SONGS_QUERY_KEY = ["songs"] as const;

/** Stable reference while nothing is loaded, so effects depending on `songs` do not re-run. */
const NO_SONGS: Song[] = [];

/**
 * Seeds the demos, then lists the library. The only place that reads the library: a server
 * backend would replace this function, not the screens.
 */
async function loadSongs({ client, queryKey }: QueryFunctionContext<typeof SONGS_QUERY_KEY>) {
  await seedDemos(songRepository).catch((e: unknown) => console.warn("Seeding demos failed:", e));
  try {
    return await songRepository.list();
  } catch (e) {
    // Reloads after a write report their own failure (see refreshAfterWrite).
    if (client.getQueryData(queryKey) === undefined) console.warn("Loading the library failed:", e);
    throw e;
  }
}

export function useSongLibrary() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: SONGS_QUERY_KEY,
    queryFn: loadSongs,
    // Loaded once per page load. Writes go through this hook and refetch explicitly; a background
    // refetch mid-game would hand screens new Song objects and re-trigger their effects. Changes
    // from another tab show after a reload.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  /**
   * Refetches the list; rejects when it fails. Resolves only after the observers were notified,
   * so a caller continuing after `await save()` already renders with the new list (React Query
   * delivers updates in a later task, see notifyManager).
   */
  const refresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: SONGS_QUERY_KEY }, { throwOnError: true });
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  }, [queryClient]);

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
  return {
    songs: data ?? NO_SONGS,
    loading: data === undefined,
    save,
    remove,
    updateDetails,
    exportChoreo,
    refresh,
  };
}
