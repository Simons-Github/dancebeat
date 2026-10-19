import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";

import { SongLibrary } from "@/components/SongLibrary";
import { buildDevSong, DEV_SONG_IDS, parseDevSong } from "@/data/devSongs";
import { useSongLibrary } from "@/hooks/useSongLibrary";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { songs, loading, save, remove, rename, exportChoreo } = useSongLibrary();
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
            await save(buildDevSong(spec, Date.now()));
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
      onRename={rename}
      onRemove={remove}
      onExport={exportChoreo}
      onAdd={save}
    />
  );
}
