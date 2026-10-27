import { useId, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

/** Four-pointed glint with concave sides: white core fading into the song color, soft glow. */
export function Sparkle({ className, style }: { className?: string; style?: CSSProperties }) {
  // useId may contain characters that break `url(#…)` references.
  const id = `sparkle-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      className={cn(
        "drop-shadow-[0_0_0.4rem_color-mix(in_srgb,var(--song)_80%,transparent)]",
        className,
      )}
      style={style}
    >
      <defs>
        <radialGradient id={id}>
          <stop offset="0.25" stopColor="var(--chrome-light)" />
          <stop offset="1" stopColor="color-mix(in srgb, var(--song) 45%, var(--chrome-mid))" />
        </radialGradient>
      </defs>
      <path
        d="M50 0 C53 37 63 47 100 50 C63 53 53 63 50 100 C47 63 37 53 0 50 C37 47 47 37 50 0 Z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}
