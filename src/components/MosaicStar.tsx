import type { CSSProperties } from "react";

/** Five-pointed star outline (clip-path), points up. */
const STAR =
  "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)";

/**
 * Pixel-mosaic star in the song color: squares separated by night lines, dissolving towards the
 * edges, with a darker star inside (outline effect). Used by the menu background and the covers;
 * `cell` is the grid pitch in px.
 */
export function MosaicStar({
  className,
  style,
  cell = 10,
}: {
  className?: string;
  style?: CSSProperties;
  cell?: number;
}) {
  const line = Math.max(1, Math.round(cell / 5));
  return (
    <div aria-hidden className={className} style={style}>
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "var(--song)",
          backgroundImage: `repeating-linear-gradient(0deg, var(--night) 0 ${line}px, transparent ${line}px ${cell}px), repeating-linear-gradient(90deg, var(--night) 0 ${line}px, transparent ${line}px ${cell}px)`,
          clipPath: STAR,
          maskImage: "radial-gradient(closest-side, black 55%, transparent)",
        }}
      />
      <div className="absolute inset-[30%] bg-night/70" style={{ clipPath: STAR }} />
    </div>
  );
}
