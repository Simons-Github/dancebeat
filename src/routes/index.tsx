import { createFileRoute } from "@tanstack/react-router";

import { SongLibrary } from "@/components/SongLibrary";
import { useSongLibrary } from "@/hooks/useSongLibrary";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { songs, loading } = useSongLibrary();
  return <SongLibrary songs={songs} loading={loading} />;
}
