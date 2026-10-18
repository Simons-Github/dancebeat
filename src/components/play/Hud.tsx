import { Star } from "lucide-react";

import { comboMultiplier, MEGA_THRESHOLD, STAR_THRESHOLDS } from "@/lib/scoring";
import { cn } from "@/lib/utils";
import { GOLD, ICON_OFF } from "@/theme";

export const HUD_PILL =
  "bg-(--hud-scrim) rounded-full border border-white/15 px-4 py-1.5 text-white shadow-pop backdrop-blur-sm";

/** Score, combo and star bar (5 stars plus the golden mega step). Renders once per judged move. */
export function Hud({
  score,
  combo,
  stars,
  mega,
  ratio,
}: {
  score: number;
  combo: number;
  stars: number;
  mega: boolean;
  ratio: number;
}) {
  const mult = comboMultiplier(combo);
  const progress = Math.min(1, ratio / MEGA_THRESHOLD);
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className={cn(HUD_PILL, "flex items-baseline gap-2")}>
        <span className="sr-only">Punkte</span>
        <span className="font-title text-2xl tabular-nums" data-testid="score">
          {score.toLocaleString("de-DE")}
        </span>
      </div>
      <div className={cn(HUD_PILL, "flex items-baseline gap-1.5")} aria-label={`Combo ${combo}`}>
        <span className="text-lg font-bold tabular-nums" data-testid="combo">
          {combo}
        </span>
        <span className="text-sm font-medium">Combo</span>
        {mult > 1 && (
          <span className="text-sm font-bold" style={{ color: GOLD }}>
            ×{mult}
          </span>
        )}
      </div>
      <div
        className={cn(HUD_PILL, "flex flex-col gap-1 py-1.5")}
        role="img"
        aria-label={mega ? "Megastar" : `${stars} von 5 Sternen`}
      >
        <div className="flex items-center gap-0.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star
              key={i}
              aria-hidden
              className="size-4"
              fill={i < stars ? "white" : "transparent"}
              color={i < stars ? "white" : ICON_OFF}
            />
          ))}
          <Star
            aria-hidden
            className="ml-1 size-5"
            fill={mega ? GOLD : "transparent"}
            color={mega ? GOLD : ICON_OFF}
          />
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/25">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${progress * 100}%`, background: mega ? GOLD : "white" }}
          />
          {STAR_THRESHOLDS.map((t) => (
            <span
              key={t}
              aria-hidden
              className="absolute inset-y-0 w-px bg-black/40"
              style={{ left: `${(t / MEGA_THRESHOLD) * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
