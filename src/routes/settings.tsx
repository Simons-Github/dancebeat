import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  return <PlaceholderPage title="Einstellungen">Einstellungen folgen</PlaceholderPage>;
}
