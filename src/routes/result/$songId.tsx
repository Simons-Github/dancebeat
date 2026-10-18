import { createFileRoute, Link } from "@tanstack/react-router";
import { Home, RotateCcw } from "lucide-react";

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { Button } from "@/components/ui/button";
import { getLastResult } from "@/lib/game/session";
import { rankTitle } from "@/lib/scoring";
import type { Rating } from "@/lib/types";

export const Route = createFileRoute("/result/$songId")({
  component: Result,
});

const RATINGS: Rating[] = ["PERFECT", "SUPER", "GOOD", "OK", "X"];
const BTN =
  "btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";

/** Placeholder until stage 4: shows the final result handed over by the game. */
function Result() {
  const { songId } = Route.useParams();
  const r = getLastResult(songId);
  if (!r) {
    return (
      <PlaceholderPage title="Kein Ergebnis">
        Für diesen Song liegt kein Ergebnis vor.
      </PlaceholderPage>
    );
  }
  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col items-center justify-center">
      <div className="bg-(--scrim-banner) shadow-pop flex max-h-full max-w-full flex-col items-center gap-4 overflow-y-auto rounded-3xl border border-white/15 px-8 py-6 text-center text-white backdrop-blur-md">
        <h1 className="font-title text-stroke text-4xl">{rankTitle(r.stars, r.mega)}</h1>
        <p className="font-title text-5xl tabular-nums" data-testid="result-score">
          {r.score.toLocaleString("de-DE")}
        </p>
        <p className="text-lg">
          {r.mega ? "Megastar" : `${r.stars} von 5 Sternen`} · Längste Combo {r.maxCombo}
        </p>
        <dl className="grid grid-cols-5 gap-3 text-base">
          {RATINGS.map((k) => (
            <div key={k} className="flex flex-col">
              <dt className="text-sm font-bold">{k}</dt>
              <dd className="tabular-nums">{r.counts[k]}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className={BTN}>
            <Link to="/setup/$songId" params={{ songId }}>
              <RotateCcw aria-hidden />
              Nochmal
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className={BTN}>
            <Link to="/">
              <Home aria-hidden />
              Anderer Song
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
