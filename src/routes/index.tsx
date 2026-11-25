import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";

import { SongLibrary } from "@/components/SongLibrary";
import { buildDevSong, DEV_SONG_IDS, parseDevSong } from "@/data/devSongs";
import { useSongLibrary } from "@/hooks/useSongLibrary";
import { loadMotionPack } from "@/lib/motionPack";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const {
    songs,
    loading,
    save,
    remove,
    updateDetails,
    regenerateChoreo,
    setVideo,
    musicIsVideo,
    exportChoreo,
  } = useSongLibrary();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const handled = useRef(false);

  // Dev builds only: `?devsong=youtube:<id>` / `url:<address>` / `clear` (see devSongs.ts).
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (handled.current || loading || search["devsong"] === undefined) return;
      handled.current = true;
      const spec = parseDevSong(search);
      void (async () => {
        try {
          if (spec?.kind === "clear") {
            const slots: string[] = Object.values(DEV_SONG_IDS);
            for (const s of songs.filter((x) => slots.includes(x.id))) await remove(s);
          } else if (spec) {
            await save(buildDevSong(spec, Date.now(), await loadMotionPack()));
          } else {
            console.warn("Ungültiger devsong-Parameter");
          }
        } catch (e) {
          console.warn("devsong failed:", e);
        }
        await navigate({ to: "/", replace: true });
      })();
    }
  }, [search, loading, songs, save, remove, navigate]);

  return (
    <SongLibrary
      songs={songs}
      loading={loading}
      onSaveDetails={updateDetails}
      onRemove={remove}
      onRegenerate={regenerateChoreo}
      onSetVideo={setVideo}
      onCheckMusicVideo={musicIsVideo}
      onExport={exportChoreo}
      onAdd={save}
    />
  );
}
