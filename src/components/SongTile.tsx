import { forwardRef } from "react";
import { motion } from "framer-motion";
import { Flame, Star, Trophy } from "lucide-react";

import { SongCover } from "@/components/SongCover";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { FLAME, GOLD, ICON_OFF, SPRING, TILE_SCALE } from "@/theme";

interface SongTileProps {
  song: Song;
  selected: boolean;
  onSelect: () => void;
}

export const SongTile = forwardRef<HTMLButtonElement, SongTileProps>(
  ({ song, selected, onSelect }, ref) => (
    <motion.button
      ref={ref}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      animate={{ scale: selected ? TILE_SCALE.selected : TILE_SCALE.idle }}
      whileTap={{ scale: 0.95 }}
      transition={SPRING}
      className={cn(
        "bg-(--scrim-tile) shadow-pop flex aspect-[3/4] h-full max-h-[28rem] shrink-0 portrait:h-auto portrait:w-[min(72vw,22rem)] snap-center flex-col overflow-hidden rounded-3xl text-left text-white outline-none backdrop-blur-sm",
        "focus-visible:ring-4 focus-visible:ring-gold",
        selected && "ring-4 ring-white",
      )}
    >
      <div className="min-h-0 flex-1">
        <SongCover song={song} />
      </div>
      <div className="flex flex-col gap-0.5 px-4 py-3">
        <span className="font-title truncate text-xl leading-tight">{song.title}</span>
        <span className="truncate text-sm text-white/85">{song.artist}</span>
        <div className="mt-1 flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">{song.bpm} BPM</span>
          <Flames level={song.difficulty} />
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span
            role="img"
            aria-label={`Highscore: ${song.highscore.toLocaleString("de-DE")} Punkte`}
            className="flex items-center gap-1 font-semibold"
          >
            <Trophy aria-hidden className="size-4" color={GOLD} />
            {song.highscore.toLocaleString("de-DE")}
          </span>
          <Stars count={song.stars} />
        </div>
      </div>
    </motion.button>
  ),
);
SongTile.displayName = "SongTile";

function Flames({ level }: { level: number }) {
  return (
    <span role="img" aria-label={`Schwierigkeit ${level} von 3`} className="flex gap-0.5">
      {[1, 2, 3].map((n) => (
        <Flame
          key={n}
          aria-hidden
          className="size-5"
          fill={n <= level ? FLAME : "none"}
          color={n <= level ? FLAME : ICON_OFF}
        />
      ))}
    </span>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <span role="img" aria-label={`${count} von 5 Sternen`} className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className="size-4"
          fill={n <= count ? GOLD : "none"}
          color={n <= count ? GOLD : ICON_OFF}
        />
      ))}
    </span>
  );
}
