import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SpotifyAuthError, spotifyExchange } from "@/lib/audio/spotifyAuth";
import { t as tr, useT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

/**
 * Landing page of the Spotify login (`/spotify-callback?code=…&state=…`): trades the code for a
 * token once, then replaces itself with the settings, so the code never stays in the history.
 */
export function SpotifyCallbackScreen() {
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const navigate = useNavigate();
  const t = useT();
  const [error, setError] = useState("");
  // The code is single-use and the verifier is deleted on the first try (StrictMode runs twice).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    spotifyExchange(getSettings().spotifyClientId, new URLSearchParams(searchStr))
      .then(() => navigate({ to: "/settings", replace: true }))
      .catch((e: unknown) =>
        setError(e instanceof SpotifyAuthError ? e.message : tr("shell.spotify.failed")),
      );
  }, [searchStr, navigate]);

  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="glass flex max-w-full flex-col items-center gap-4 rounded-3xl px-8 py-6 text-white">
        <h1 className="font-title text-4xl">Spotify</h1>
        <p role={error ? "alert" : "status"} className="text-lg text-white/90">
          {error || t("shell.spotify.connecting")}
        </p>
        {error && (
          <Button
            asChild
            size="lg"
            className="btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5"
          >
            <Link to="/settings" replace>
              <ArrowLeft aria-hidden />
              {t("shell.spotify.toSettings")}
            </Link>
          </Button>
        )}
      </div>
    </main>
  );
}
