import { useRouterState } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAppUpdate } from "@/hooks/useAppUpdate";

/**
 * Screens where reloading loses nothing: the library (its dialogs are modal, the banner cannot
 * be tapped while one is open) and the settings (saved on change). Game, editor, sync test and
 * setup never show the offer.
 */
const UPDATE_PATHS = new Set(["/", "/settings"]);

const BTN =
  "btn-pill h-10 rounded-full px-4 text-sm focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-4";

/** "Neue Version verfügbar" with "Neu laden" and "Später" (Etappe 7b-3). */
export function UpdateBanner() {
  const { available, apply, dismiss } = useAppUpdate();
  const onUpdatePath = useRouterState({ select: (s) => UPDATE_PATHS.has(s.location.pathname) });
  if (!available || !onUpdatePath) return null;
  return (
    <div className="relative z-20 px-4 pb-2">
      <div
        role="status"
        className="bg-(--scrim-banner) shadow-pop mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-white/15 px-4 py-2 text-white backdrop-blur-md"
      >
        <p className="text-sm font-semibold">Neue Version verfügbar</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={dismiss} className={BTN}>
            Später
          </Button>
          <Button type="button" onClick={apply} className={BTN}>
            <RefreshCw aria-hidden />
            Neu laden
          </Button>
        </div>
      </div>
    </div>
  );
}
