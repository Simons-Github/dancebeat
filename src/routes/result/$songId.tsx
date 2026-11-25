import { createFileRoute } from "@tanstack/react-router";

import { useT } from "@/lib/i18n";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { ResultScreen } from "@/components/result/ResultScreen";
import { getLastResult } from "@/lib/game/session";

export const Route = createFileRoute("/result/$songId")({
  component: Result,
});

/** Shows the result the game handed over (in memory only, so a reload shows the fallback). */
function Result() {
  const t = useT();
  const { songId } = Route.useParams();
  const r = getLastResult(songId);
  if (!r) {
    return (
      <PlaceholderPage title={t("shell.route.noResult.title")}>
        {t("shell.route.noResult.body")}
      </PlaceholderPage>
    );
  }
  return <ResultScreen result={r} />;
}
