import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/play/$songId")({
  component: Play,
});

function Play() {
  return <PlaceholderPage title="Spiel">Spiel folgt in Etappe 3</PlaceholderPage>;
}
