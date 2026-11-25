import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { SyncTestScreen } from "@/components/SyncTestScreen";
import { useSongLibrary } from "@/hooks/useSongLibrary";
import { useT } from "@/lib/i18n";
import { useSongTheme } from "@/hooks/useSongTheme";

export const Route = createFileRoute("/sync/$songId")({
  component: Sync,
});

function Sync() {
  const t = useT();
  const { songId } = Route.useParams();
  const { songs, loading, save } = useSongLibrary();
  const { setTheme } = useSongTheme();
  const song = songs.find((s) => s.id === songId);

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
  return <SyncTestScreen key={song.id} song={song} onSave={(s) => save(s)} />;
}
