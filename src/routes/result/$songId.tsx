import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { ResultScreen } from "@/components/result/ResultScreen";
import { getLastResult } from "@/lib/game/session";

export const Route = createFileRoute("/result/$songId")({
  component: Result,
});

/** Shows the result the game handed over (in memory only, so a reload shows the fallback). */
function Result() {
  const { songId } = Route.useParams();
  const r = getLastResult(songId);
  if (!r) {
    return (
      <PlaceholderPage title="Kein Ergebnis">
        Für diesen Song liegt kein Ergebnis vor. Tanz ihn einmal, dann siehst du hier deine Wertung.
      </PlaceholderPage>
    );
  }
  return <ResultScreen result={r} />;
}
