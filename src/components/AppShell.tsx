import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { MotionConfig } from "framer-motion";

import { PartyBackground } from "@/components/PartyBackground";
import { Button } from "@/components/ui/button";
import { SongThemeContext, useSongTheme, type SongTheme } from "@/hooks/useSongTheme";
import { scrimCss } from "@/lib/contrast";
import { DEFAULT_SONG_THEME, SCRIM, THEME_FADE_MS } from "@/theme";

/** Full-screen frame: song colors as CSS variables, animated background, header, content slot. */
export function AppShell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<SongTheme>(DEFAULT_SONG_THEME);
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return (
    <SongThemeContext.Provider value={value}>
      <MotionConfig reducedMotion="user">
        <Frame>{children}</Frame>
      </MotionConfig>
    </SongThemeContext.Provider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { theme } = useSongTheme();
  // The game screen covers everything: no header, no decorative background behind it.
  const immersive = useRouterState({ select: (s) => s.location.pathname.startsWith("/play/") });
  const style = {
    "--song": theme.accent,
    "--song-2": theme.secondary,
    "--theme-fade": `${THEME_FADE_MS}ms`,
    "--ink": SCRIM.ink,
    "--scrim-header": scrimCss(SCRIM.ink, SCRIM.header),
    "--scrim-tile": scrimCss(SCRIM.ink, SCRIM.tile),
    "--scrim-banner": scrimCss(SCRIM.ink, SCRIM.banner),
    "--scrim-button": scrimCss(SCRIM.ink, SCRIM.button),
    "--scrim-edge": scrimCss(SCRIM.ink, SCRIM.edge),
  } as CSSProperties;
  return (
    <div className="song-frame bg-party relative flex h-dvh flex-col overflow-hidden" style={style}>
      {!immersive && (
        <>
          <PartyBackground />
          <div
            aria-hidden
            className="scrim-edge pointer-events-none absolute inset-x-0 bottom-0 h-1/4"
          />
          <AppHeader />
        </>
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function AppHeader() {
  return (
    <header className="safe-pad relative z-20 flex items-center justify-between gap-3 !pb-1">
      <div
        aria-hidden
        className="scrim-header pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(100%+2.5rem)]"
      />
      <Link
        to="/"
        className="font-title text-stroke rounded-full px-2 text-3xl leading-none focus-visible:ring-4 focus-visible:ring-gold focus-visible:outline-none"
      >
        DanceBeat
      </Link>
      <Button
        asChild
        variant="secondary"
        size="icon"
        className="size-11 rounded-full focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-6"
      >
        <Link to="/settings" aria-label="Einstellungen">
          <Settings aria-hidden />
        </Link>
      </Button>
    </header>
  );
}
