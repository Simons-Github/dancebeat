import { Link } from "@tanstack/react-router";

import { AddSongDialog } from "@/components/AddSongDialog";
import { Button } from "@/components/ui/button";
import type { Song } from "@/lib/types";

export function SongBanner({ song }: { song: Song | undefined }) {
  return (
    <section
      aria-label="Ausgewählter Song"
      className="bg-(--scrim-banner) shadow-pop flex shrink-0 flex-col gap-2 rounded-3xl border border-white/15 p-4 text-white backdrop-blur-md landscape:w-64 landscape:justify-center"
    >
      <div className="min-w-0" aria-live="polite">
        <p className="font-title text-stroke truncate text-2xl leading-tight">
          {song?.title ?? "Kein Song gewählt"}
        </p>
        <p className="truncate text-base text-white/90">{song?.artist ?? " "}</p>
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
      <AddSongDialog />
    </section>
  );
}
