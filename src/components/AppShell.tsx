import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { MotionConfig } from "framer-motion";

import { PartyBackground } from "@/components/PartyBackground";
import { Button } from "@/components/ui/button";
import { UpdateBanner } from "@/components/UpdateBanner";
import { SongThemeContext, useSongTheme, type SongTheme } from "@/hooks/useSongTheme";
import { scrimCss } from "@/lib/contrast";
import {
  APP_BACKGROUND,
  CHROME,
  DEFAULT_SONG_THEME,
  GLOW,
  PAPER,
  SCRIM,
  THEME_FADE_MS,
} from "@/theme";
import { useT } from "@/lib/i18n";

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
    "--paper": PAPER,
    "--night": APP_BACKGROUND,
    "--glass-bg": scrimCss(APP_BACKGROUND, SCRIM.glass),
    "--chrome-light": CHROME.light,
    "--chrome-mid": CHROME.mid,
    "--chrome-dark": CHROME.dark,
    "--chrome-tint": `${CHROME.tint * 100}%`,
    "--glow-song": `${GLOW.song * 100}%`,
    "--glow-secondary": `${GLOW.secondary * 100}%`,
  } as CSSProperties;
  return (
    <div className="song-frame bg-party relative flex h-dvh flex-col overflow-hidden" style={style}>
      {!immersive && (
        <>
          <PartyBackground />
          <AppHeader />
          <UpdateBanner />
        </>
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function AppHeader() {
  const t = useT();
  return (
    <header className="safe-pad relative z-20 flex items-center justify-between gap-3 !pb-1">
      {/* Chrome wordmark, slanted like a Y2K logo. */}
      <Link
        to="/"
        className="rounded-lg px-1 focus-visible:ring-4 focus-visible:ring-gold focus-visible:outline-none"
      >
        <span className="font-title chrome-text chrome-glow inline-block -skew-x-8 text-3xl leading-tight">
          DanceBeat
        </span>
      </Link>
      <Button
        asChild
        variant="secondary"
        size="icon"
        className="size-11 rounded-full focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-6"
      >
        <Link to="/settings" aria-label={t("shell.header.settings")}>
          <Settings aria-hidden />
        </Link>
      </Button>
    </header>
  );
}
