import { useEffect } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { GameScreen } from "@/components/play/GameScreen";
import { useSongLibrary } from "@/hooks/useSongLibrary";
import { useT } from "@/lib/i18n";
import { useSongTheme } from "@/hooks/useSongTheme";
import { parseSimParams } from "@/lib/game/simulatedPlayer";
import { parsePlayMode } from "@/lib/motion";

export const Route = createFileRoute("/play/$songId")({
  component: Play,
});

function Play() {
  const t = useT();
  const { songId } = Route.useParams();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { songs, loading } = useSongLibrary();
  const { setTheme } = useSongTheme();
  const song = songs.find((s) => s.id === songId);
  // Dev builds only: `?sim=1&noise=10&miss=0.1` plays without camera (see simulatedPlayer.ts).
  const sim = import.meta.env.DEV ? parseSimParams(search) : null;
  // `?mode=motion`: movement mode without camera (all builds).
  const mode = parsePlayMode(search);

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
      <PlaceholderPage title={t("shell.route.noSong.title")}>
        {t("shell.route.noSong.body")}
      </PlaceholderPage>
    );
  }
  if (song.choreo.moves.length === 0) {
    return (
      <PlaceholderPage title={t("shell.route.noMoves.title")}>
        {t("shell.route.noMoves.body")}
      </PlaceholderPage>
    );
  }
  // Keyed on the mode too: switching camera ↔ motion needs a fresh controller.
  return <GameScreen key={`${song.id}:${mode}`} song={song} sim={sim} mode={mode} />;
}
