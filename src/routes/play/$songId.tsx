import { useEffect } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { GameScreen } from "@/components/play/GameScreen";
import { useSongLibrary } from "@/hooks/useSongLibrary";
import { useSongTheme } from "@/hooks/useSongTheme";
import { parseSimParams } from "@/lib/game/simulatedPlayer";

export const Route = createFileRoute("/play/$songId")({
  component: Play,
});

function Play() {
  const { songId } = Route.useParams();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { songs, loading } = useSongLibrary();
  const { setTheme } = useSongTheme();
  const song = songs.find((s) => s.id === songId);
  // Dev builds only: `?sim=1&noise=10&miss=0.1` plays without camera (see simulatedPlayer.ts).
  const sim = import.meta.env.DEV ? parseSimParams(search) : null;

  useEffect(() => {
    if (song) {
      setTheme({
        accent: song.choreo.accentColor,
        secondary: song.choreo.secondaryColor,
        bpm: song.bpm,
      });
    }
  }, [song, setTheme]);

  if (!song) {
    return loading ? null : (
      <PlaceholderPage title="Song nicht gefunden">
        Dieser Song ist nicht in deiner Bibliothek.
      </PlaceholderPage>
    );
  }
  if (song.choreo.moves.length === 0) {
    return (
      <PlaceholderPage title="Keine Choreografie">
        Für diesen Song gibt es noch keine Moves.
      </PlaceholderPage>
    );
  }
  return <GameScreen key={song.id} song={song} sim={sim} />;
}
