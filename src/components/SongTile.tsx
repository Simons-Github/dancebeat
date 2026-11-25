import { forwardRef } from "react";
import { motion, type MotionStyle } from "framer-motion";
import { Trophy } from "lucide-react";

import { SongCover } from "@/components/SongCover";
import { ChromeStar, HotFlame } from "@/components/Y2KIcons";
import { formatBpm } from "@/lib/library/newSong";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { GOLD, SPRING, TILE_SCALE } from "@/theme";
import { useT } from "@/lib/i18n";

/**
 * Tile box, also used by the loading placeholders. The carousel is a size container: the tile is
 * as tall as the carousel allows (minus its vertical padding and room for the selected tile's
 * scale), at most 28rem, and never wider than about 70 % of the carousel (3:4, so 95cqw tall).
 */
export const TILE_BOX = "aspect-[3/4] h-[min(100cqh_-_3.5rem,28rem,95cqw)] w-auto shrink-0";

interface SongTileProps {
  song: Song;
  selected: boolean;
  onSelect: () => void;
}

export const SongTile = forwardRef<HTMLButtonElement, SongTileProps>(
  ({ song, selected, onSelect }, ref) => {
    const t = useT();
    return (
      <motion.button
        ref={ref}
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        // Each tile glows in its own song colors, not in the selected song's.
        style={
          {
            "--song": song.choreo.accentColor,
            "--song-2": song.choreo.secondaryColor,
          } as MotionStyle
        }
        animate={{ scale: selected ? TILE_SCALE.selected : TILE_SCALE.idle }}
        whileTap={{ scale: 0.95 }}
        transition={SPRING}
        className={cn(
          TILE_BOX,
          "glass @container flex snap-center flex-col overflow-hidden rounded-[1.75rem] p-2 text-left text-paper outline-none",
          "focus-visible:ring-4 focus-visible:ring-gold",
          // Selected: brighter rim and a stronger glow in the song color.
          selected &&
            "shadow-[inset_0_1px_0_rgb(255_255_255/0.7),inset_0_0_0_2px_rgb(255_255_255/0.55),0_0_1.75rem_-0.5rem_var(--song)]",
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden rounded-[1.25rem] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]">
          <SongCover song={song} />
        </div>
        {/* Narrow tiles (small landscape screens) keep title, tempo and difficulty only. */}
        <div className="flex flex-col gap-0.5 px-2 pt-2.5 pb-1 @max-[12rem]:px-1 @max-[12rem]:pt-1.5">
          <span className="font-title truncate text-2xl leading-tight @max-[12rem]:text-xl">
            {song.title}
          </span>
          <span className="truncate text-sm text-paper/90 @max-[12rem]:hidden">{song.artist}</span>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
            {/* Tempo as a small glass pill. */}
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold whitespace-nowrap shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_0_0_1px_rgb(255_255_255/0.12)]">
              {formatBpm(song.bpm)} BPM
            </span>
            <Flames level={song.difficulty} />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-sm @max-[12rem]:hidden">
            <span
              role="img"
              aria-label={t("shell.tile.highscore", {
                score: song.highscore.toLocaleString(t.locale),
              })}
              className="flex items-center gap-1.5 font-bold tabular-nums"
            >
              <Trophy
                aria-hidden
                className="size-4 drop-shadow-[0_0_0.3rem_color-mix(in_srgb,var(--song)_60%,transparent)]"
                color={GOLD}
              />
              {song.highscore.toLocaleString(t.locale)}
            </span>
            <Stars count={song.stars} />
          </div>
        </div>
      </motion.button>
    );
  },
);
SongTile.displayName = "SongTile";

function Flames({ level }: { level: number }) {
  const t = useT();
  return (
    <span role="img" aria-label={t("shell.tile.difficulty", { level })} className="flex gap-0.5">
      {[1, 2, 3].map((n) => (
        <HotFlame key={n} on={n <= level} className="size-6 @max-[12rem]:size-5" />
      ))}
    </span>
  );
}

function Stars({ count }: { count: number }) {
  const t = useT();
  return (
    <span role="img" aria-label={t("shell.stars.label", { count })} className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <ChromeStar key={n} variant={n <= count ? "chrome" : "off"} className="size-5" />
      ))}
    </span>
  );
}
