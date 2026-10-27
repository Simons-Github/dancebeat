import { useId } from "react";

import { cn } from "@/lib/utils";
import { CHROME, FLAME_GRADIENT, GOLD, GOLD_DEEP, GOLD_LIGHT, ICON_OFF } from "@/theme";

/** useId may contain characters that break `url(#…)` references. */
function useSvgId(prefix: string) {
  return `${prefix}-${useId().replace(/[^\w-]/g, "")}`;
}

const STAR_PATH =
  "M12 1.8l2.95 6.3 6.85.85-5.05 4.7 1.33 6.85L12 17.1l-6.08 3.4 1.33-6.85L2.2 8.95l6.85-.85z";

/**
 * Rating star. `chrome`: polished metal with a dark horizon band and a bright rim; `gold`: the same
 * in gold (megastar); `off`: a faint outline.
 */
export function ChromeStar({
  variant,
  className,
}: {
  variant: "chrome" | "gold" | "off";
  className?: string;
}) {
  const id = useSvgId("star");
  const [light, mid, dark] =
    variant === "gold" ? [GOLD_LIGHT, GOLD, GOLD_DEEP] : [CHROME.light, CHROME.mid, CHROME.dark];
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cn(
        variant !== "off" &&
          "drop-shadow-[0_0_0.25rem_color-mix(in_srgb,var(--song)_70%,transparent)]",
        className,
      )}
    >
      {variant !== "off" && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.1" stopColor={light} />
            <stop offset="0.48" stopColor={mid} />
            <stop offset="0.54" stopColor={dark} />
            <stop offset="0.9" stopColor={light} />
          </linearGradient>
        </defs>
      )}
      <path
        d={STAR_PATH}
        fill={variant === "off" ? "none" : `url(#${id})`}
        stroke={variant === "off" ? ICON_OFF : light}
        strokeWidth={variant === "off" ? 1.6 : 0.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FLAME_PATH =
  "M12 1.5c.6 3.2 2.6 5 4.3 6.9 1.6 1.8 2.9 3.7 2.9 6.3A7.2 7.2 0 0 1 12 22a7.2 7.2 0 0 1-7.2-7.3c0-2.6 1.2-4.6 2.8-6 .1 1.7.8 3 2 3.6C9.2 8.6 10.2 4.4 12 1.5z";
const CORE_PATH =
  "M12 11.5c.3 1.6 1.4 2.5 2.1 3.6.5.7.8 1.4.8 2.3a2.9 2.9 0 0 1-5.8 0c0-1.5.8-2.5 1.6-3.4.1.7.4 1.1.8 1.3-.2-1.4 0-2.7.5-3.8z";

/** Difficulty flame: glowing gradient body with a white-hot core, or a faint outline when off. */
export function HotFlame({ on, className }: { on: boolean; className?: string }) {
  const id = useSvgId("flame");
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cn(
        on && "drop-shadow-[0_0_0.3rem_color-mix(in_srgb,var(--song)_60%,transparent)]",
        className,
      )}
    >
      {on && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={FLAME_GRADIENT.tip} />
            <stop offset="0.5" stopColor={FLAME_GRADIENT.body} />
            <stop offset="1" stopColor={FLAME_GRADIENT.base} />
          </linearGradient>
        </defs>
      )}
      <path
        d={FLAME_PATH}
        fill={on ? `url(#${id})` : "none"}
        stroke={on ? "none" : ICON_OFF}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      {on && (
        <path
          d={CORE_PATH}
          fill={FLAME_GRADIENT.core}
          opacity={0.85}
          transform="translate(12 22) scale(0.7) translate(-12 -22)"
        />
      )}
    </svg>
  );
}
