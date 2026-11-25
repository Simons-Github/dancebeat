import { createFileRoute } from "@tanstack/react-router";

import { SpotifyCallbackScreen } from "@/components/SpotifyCallbackScreen";

export const Route = createFileRoute("/spotify-callback")({
  component: SpotifyCallbackScreen,
});
