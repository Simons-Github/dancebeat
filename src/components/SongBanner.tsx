import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

import { AddSongDialog } from "@/components/AddSongDialog";
import { EditSongDialog } from "@/components/EditSongDialog";
import { Button } from "@/components/ui/button";
import type { SongDetailsPatch } from "@/hooks/useSongLibrary";
import { Sparkle } from "@/components/Sparkle";
import type { Song } from "@/lib/types";
import { SPRING } from "@/theme";

interface SongBannerProps {
  song: Song | undefined;
  onSaveDetails: (song: Song, patch: SongDetailsPatch) => Promise<void>;
  onRemove: (song: Song) => Promise<void>;
  onRegenerate: (song: Song, difficulty: 1 | 2 | 3) => Promise<Song>;
  onSetVideo: (song: Song, video: Blob | undefined) => Promise<Song>;
  onCheckMusicVideo: (song: Song) => Promise<boolean>;
  onExport: (song: Song) => Promise<string>;
  onAdd: (song: Song, audio?: Blob, video?: Blob) => Promise<void>;
  onAdded: (song: Song) => void;
  /** While the library loads, the title stays empty instead of "Kein Song gewählt". */
  loading?: boolean;
}

export function SongBanner({
  song,
  onSaveDetails,
  onRemove,
  onRegenerate,
  onSetVideo,
  onCheckMusicVideo,
  onExport,
  onAdd,
  onAdded,
  loading = false,
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
      className="flex shrink-0 flex-col gap-3 text-paper landscape:w-[clamp(15rem,34vw,30rem)] landscape:justify-end"
    >
      <div aria-live="polite" className="min-w-0 pb-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={song?.id ?? "none"}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={SPRING}
            className="relative"
          >
            {/* Chrome title; bottom and right padding keep descenders inside the clamp's clip box. */}
            <p className="font-title chrome-text chrome-glow line-clamp-2 pr-[0.1em] pb-[0.14em] text-[clamp(2.5rem,12vw,5.5rem)] leading-[1.02] break-words landscape:text-[clamp(2rem,5.5vw,5.5rem)]">
              {loading ? "\u00a0" : (song?.title ?? "Kein Song gewählt")}
            </p>
            {/* The one ambient motion: a glint on the title's top left corner. */}
            {!loading && song && (
              <Sparkle className="animate-twinkle absolute -top-3 -left-3 size-10" />
            )}
            <p className="mt-2 truncate text-xl font-bold">{song?.artist ?? " "}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      {song ? (
        <Button
          asChild
          size="lg"
          className="btn-pill h-16 rounded-full px-10 text-2xl focus-visible:ring-4 focus-visible:ring-gold"
        >
          <Link to="/setup/$songId" params={{ songId: song.id }}>
            Los geht's
          </Link>
        </Button>
      ) : (
        <Button size="lg" disabled className="btn-pill h-16 rounded-full px-10 text-2xl">
          Los geht's
        </Button>
      )}
      <div className="flex items-center gap-3">
        <AddSongDialog onAdd={onAdd} onAdded={onAdded} />
        <EditSongDialog
          song={song}
          onSave={onSaveDetails}
          onRemove={onRemove}
          onRegenerate={onRegenerate}
          onSetVideo={onSetVideo}
          onCheckMusicVideo={onCheckMusicVideo}
          onExport={onExport}
          onDeleted={() => setRefocus((n) => n + 1)}
        />
      </div>
    </section>
  );
}
