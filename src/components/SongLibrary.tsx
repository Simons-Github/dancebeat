import { useEffect, useRef, useState } from "react";

import { getSettings, saveSettings } from "@/lib/settings";

import { SongBanner } from "@/components/SongBanner";
import { SongTile, TILE_BOX } from "@/components/SongTile";
import { useSongTheme } from "@/hooks/useSongTheme";
import type { SongDetailsPatch } from "@/hooks/useSongLibrary";
import type { Song } from "@/lib/types";

interface SongLibraryProps {
  songs: Song[];
  loading: boolean;
  onSaveDetails: (song: Song, patch: SongDetailsPatch) => Promise<void>;
  onRemove: (song: Song) => Promise<void>;
  onRegenerate: (song: Song, difficulty: 1 | 2 | 3) => Promise<Song>;
  onSetVideo: (song: Song, video: Blob | undefined) => Promise<Song>;
  onCheckMusicVideo: (song: Song) => Promise<boolean>;
  onExport: (song: Song) => Promise<string>;
  onAdd: (song: Song, audio?: Blob, video?: Blob) => Promise<void>;
}

/** Song carousel with the selected-song banner. The tile list is the only scrolling area. */
export function SongLibrary({
  songs,
  loading,
  onSaveDetails,
  onRemove,
  onRegenerate,
  onSetVideo,
  onCheckMusicVideo,
  onExport,
  onAdd,
}: SongLibraryProps) {
  const [selectedId, setSelectedId] = useState<string>(() => getSettings().lastSongId);
  const { setTheme } = useSongTheme();
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());

  const selected = songs.find((s) => s.id === selectedId) ?? songs[0];

  useEffect(() => {
    if (selected) {
      setTheme({
        accent: selected.choreo.accentColor,
        secondary: selected.choreo.secondaryColor,
        bpm: selected.bpm,
      });
    }
  }, [selected, setTheme]);

  // After coming back, bring the remembered tile into view (instantly, no animation).
  const restoredFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selected || restoredFor.current === selected.id) return;
    restoredFor.current = selected.id;
    tileRefs.current
      .get(selected.id)
      ?.scrollIntoView?.({ behavior: "instant", inline: "center", block: "nearest" });
  }, [selected]);

  // When the carousel changes size (rotation, window resize), center the selected tile again.
  const listRef = useRef<HTMLUListElement>(null);
  const selectedRef = useRef(selected?.id);
  selectedRef.current = selected?.id;
  const hasList = !loading && songs.length > 0;
  useEffect(() => {
    const list = listRef.current;
    if (!hasList || !list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const id = selectedRef.current;
      if (id === undefined) return;
      tileRefs.current
        .get(id)
        ?.scrollIntoView?.({ behavior: "instant", inline: "center", block: "nearest" });
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasList]);

  const select = (song: Song) => {
    setSelectedId(song.id);
    saveSettings({ lastSongId: song.id });
    tileRefs.current
      .get(song.id)
      ?.scrollIntoView?.({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col gap-4 !pt-1 landscape:flex-row landscape:gap-6">
      <h1 className="sr-only">Song-Bibliothek</h1>
      {/* Size container: the tiles take their size from it (TILE_BOX). */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center [container-type:size]">
        {loading ? (
          <div
            role="status"
            aria-label="Songs werden geladen"
            className="flex h-full items-center gap-5 overflow-hidden px-2 py-6"
          >
            {[0, 1].map((n) => (
              <div key={n} className={`${TILE_BOX} glass animate-pulse rounded-[1.75rem]`} />
            ))}
          </div>
        ) : songs.length === 0 ? (
          <div className="flex h-full flex-col items-start justify-center gap-2 text-paper">
            <p className="font-title chrome-text chrome-glow text-5xl">Noch keine Songs</p>
            <p className="text-xl font-bold">Füge unten deinen ersten Song hinzu.</p>
          </div>
        ) : (
          <ul
            ref={listRef}
            aria-label="Songs"
            className="-mx-4 flex h-full snap-x snap-mandatory items-center gap-5 overflow-x-auto overflow-y-hidden px-6 py-6 [scrollbar-width:none] landscape:mr-0 landscape:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)]"
          >
            {songs.map((song) => (
              <li key={song.id} className="flex h-full items-center">
                <SongTile
                  ref={(el) => {
                    if (el) tileRefs.current.set(song.id, el);
                    else tileRefs.current.delete(song.id);
                  }}
                  song={song}
                  selected={song.id === selected?.id}
                  onSelect={() => select(song)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <SongBanner
        song={selected}
        onSaveDetails={onSaveDetails}
        onRemove={onRemove}
        onRegenerate={onRegenerate}
        onSetVideo={onSetVideo}
        onCheckMusicVideo={onCheckMusicVideo}
        onExport={onExport}
        onAdd={onAdd}
        onAdded={select}
        loading={loading}
      />
    </main>
  );
}
