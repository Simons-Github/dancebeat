import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/setup/$songId")({
  component: Setup,
});

function Setup() {
  return <PlaceholderPage title="Aufstellhilfe">Aufstellhilfe folgt in Etappe 2</PlaceholderPage>;
}
