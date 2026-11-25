import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ChoreoEditorScreen } from "@/components/editor/ChoreoEditorScreen";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { useSongLibrary } from "@/hooks/useSongLibrary";
import { useT } from "@/lib/i18n";
import { useSongTheme } from "@/hooks/useSongTheme";

export const Route = createFileRoute("/edit/$songId")({
  component: Edit,
});

function Edit() {
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
  return <ChoreoEditorScreen key={song.id} song={song} onSave={(s) => save(s)} />;
}
