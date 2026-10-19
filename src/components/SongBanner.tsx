import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { AddSongDialog } from "@/components/AddSongDialog";
import { EditSongDialog } from "@/components/EditSongDialog";
import { Button } from "@/components/ui/button";
import type { SongDetailsPatch } from "@/hooks/useSongLibrary";
import type { Song } from "@/lib/types";

interface SongBannerProps {
  song: Song | undefined;
  onSaveDetails: (song: Song, patch: SongDetailsPatch) => Promise<void>;
  onRemove: (song: Song) => Promise<void>;
  onExport: (song: Song) => Promise<string>;
  onAdd: (song: Song, audio?: Blob) => Promise<void>;
  onAdded: (song: Song) => void;
}

export function SongBanner({
  song,
  onSaveDetails,
  onRemove,
  onExport,
  onAdd,
  onAdded,
}: SongBannerProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [refocus, setRefocus] = useState(0);

  // After a delete the edit button's song is gone: focus "Los geht's" for the next song, or the
  // first enabled button (Song hinzufügen) when the library is empty. Runs after the new song
  // list was rendered, because the delete's refresh is queued before this update.
  useEffect(() => {
    if (refocus === 0) return;
    const root = sectionRef.current;
    const target =
      root?.querySelector<HTMLElement>("a[href]") ??
      root?.querySelector<HTMLElement>("button:not(:disabled)");
    target?.focus();
  }, [refocus]);

  return (
    <section
      ref={sectionRef}
      aria-label="Ausgewählter Song"
      className="bg-(--scrim-banner) shadow-pop flex shrink-0 flex-col gap-2 rounded-3xl border border-white/15 p-4 text-white backdrop-blur-md landscape:w-64 landscape:justify-center"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="font-title text-stroke truncate text-2xl leading-tight">
            {song?.title ?? "Kein Song gewählt"}
          </p>
          <p className="truncate text-base text-white/90">{song?.artist ?? " "}</p>
        </div>
        <EditSongDialog
          song={song}
          onSave={onSaveDetails}
          onRemove={onRemove}
          onExport={onExport}
          onDeleted={() => setRefocus((n) => n + 1)}
        />
      </div>
      {song ? (
        <Button
          asChild
          size="lg"
          className="btn-pill h-14 rounded-full px-10 text-xl focus-visible:ring-4 focus-visible:ring-gold"
        >
          <Link to="/setup/$songId" params={{ songId: song.id }}>
            Los geht's
          </Link>
        </Button>
      ) : (
        <Button size="lg" disabled className="btn-pill h-14 rounded-full px-10 text-xl">
          Los geht's
        </Button>
      )}
      <AddSongDialog onAdd={onAdd} onAdded={onAdded} />
    </section>
  );
}
