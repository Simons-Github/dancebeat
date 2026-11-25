import { useId, type CSSProperties } from "react";

import type { Song } from "@/lib/types";
import { DISC_SHEEN } from "@/theme";

const ARTWORKS = ["swoosh", "burst", "stars"] as const;

function artworkFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ARTWORKS[h % ARTWORKS.length] ?? "swoosh";
}

/** Five-pointed star as an SVG points string (center, outer radius). */
function star(cx: number, cy: number, r: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/** Sunburst rays from the disc center: every other 15° wedge. */
const RAYS = Array.from({ length: 12 }, (_, i) => {
  const a0 = (i * 30 * Math.PI) / 180;
  const a1 = ((i * 30 + 15) * Math.PI) / 180;
  const p = (a: number) =>
    `${(50 + 80 * Math.cos(a)).toFixed(2)},${(50 + 80 * Math.sin(a)).toFixed(2)}`;
  return `50,50 ${p(a0)} ${p(a1)}`;
});

/**
 * Generated cover: a glossy song disc floating slightly tilted on the dark tile, glowing in the
 * song color. The upper part carries bright artwork in the song colors (swooshes, sunburst or
 * stars, fixed per song id) with the title as a sticker logo; the lower part is a dark label band
 * that ties the disc to the night background. Center hub with a chrome ring, rainbow sheen on top.
 */
export function SongCover({ song }: { song: Song }) {
  const { accentColor: a, secondaryColor: b } = song.choreo;
  const artwork = artworkFor(song.id);
  const id = useId().replace(/[^\w-]/g, "");
  const ref = (name: string) => `url(#${name}-${id})`;
  const light = `color-mix(in srgb, ${a} 72%, var(--chrome-light))`;
  return (
    <div
      aria-hidden
      className="relative size-full overflow-hidden bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--song)_35%,transparent),transparent)]"
      style={{ "--song": a, "--song-2": b } as CSSProperties}
    >
      {/* Square box centered in the cover; the disc inside is tilted in 3D. */}
      <div className="absolute top-1/2 left-1/2 aspect-square h-[98%] max-w-[98%] -translate-x-1/2 -translate-y-1/2">
        <div className="relative size-full drop-shadow-[0_0_1.1rem_color-mix(in_srgb,var(--song)_65%,transparent)] [transform:perspective(40rem)_rotateX(20deg)_rotateZ(-12deg)]">
          <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
            <defs>
              <clipPath id={`disc-${id}`}>
                <circle cx="50" cy="50" r="49" />
              </clipPath>
              <linearGradient id={`art-${id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={light} />
                <stop offset="0.45" stopColor={a} />
                <stop offset="1" stopColor={b} />
              </linearGradient>
              <linearGradient id={`label-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--night)" />
                <stop offset="1" stopColor={`color-mix(in srgb, ${a} 30%, var(--night))`} />
              </linearGradient>
              <linearGradient id={`hub-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0.1" stopColor="var(--chrome-light)" />
                <stop offset="0.48" stopColor="var(--chrome-mid)" />
                <stop offset="0.55" stopColor="var(--chrome-dark)" />
                <stop offset="0.9" stopColor="var(--chrome-light)" />
              </linearGradient>
            </defs>
            <g clipPath={ref("disc")}>
              <rect width="100" height="100" fill={ref("art")} />
              {artwork === "swoosh" && (
                <>
                  <path
                    d="M-5 22 C 25 4, 62 40, 105 14 L105 27 C 62 52, 25 18, -5 36 Z"
                    fill="var(--chrome-light)"
                    opacity="0.6"
                  />
                  <path
                    d="M-5 44 C 30 26, 64 58, 105 36 L105 44 C 64 66, 30 34, -5 52 Z"
                    fill={b}
                  />
                </>
              )}
              {artwork === "burst" &&
                RAYS.map((points) => (
                  <polygon key={points} points={points} fill="var(--chrome-light)" opacity="0.22" />
                ))}
              {artwork === "stars" && (
                <>
                  <polygon points={star(76, 22, 17)} fill="var(--chrome-light)" opacity="0.5" />
                  <polygon points={star(22, 36, 10)} fill={b} />
                  <polygon points={star(56, 8, 6)} fill="var(--chrome-light)" opacity="0.7" />
                </>
              )}
              {/* Dark label band with a curved edge and a thin line in the song color. */}
              <path d="M0 64 C 30 57, 70 71, 100 61 L100 100 L0 100 Z" fill={ref("label")} />
              <path d="M0 64 C 30 57, 70 71, 100 61" fill="none" stroke={b} strokeWidth="1.2" />
            </g>
            {/* Rim highlights and the center hub: clear ring, chrome ring, hole. */}
            <circle
              cx="50"
              cy="50"
              r="48.6"
              fill="none"
              stroke="var(--chrome-light)"
              strokeWidth="0.8"
              opacity="0.6"
            />
            <circle cx="50" cy="50" r="15" fill="var(--night)" opacity="0.35" />
            <circle
              cx="50"
              cy="50"
              r="15"
              fill="none"
              stroke="var(--chrome-light)"
              strokeWidth="0.5"
              opacity="0.5"
            />
            <circle cx="50" cy="50" r="10" fill={ref("hub")} />
            <circle cx="50" cy="50" r="6.2" fill="var(--night)" />
            <circle
              cx="50"
              cy="50"
              r="6.2"
              fill="none"
              stroke="var(--chrome-light)"
              strokeWidth="0.4"
              opacity="0.5"
            />
          </svg>
          {/* Rainbow sheen, like light on a CD. */}
          <div
            className="absolute inset-[1%] rounded-full opacity-15 mix-blend-screen"
            style={{ backgroundImage: `conic-gradient(from 200deg, ${DISC_SHEEN.join(", ")})` }}
          />
          {/* Title as a sticker logo on the bright upper part. Drawn from data-title via CSS so it is
              not a second copy of the title in the DOM (the tile already names the song). */}
          <p
            data-title={song.title}
            className="font-title text-stroke absolute inset-x-[14%] top-[13%] line-clamp-2 -rotate-6 text-center text-[11cqw] leading-[0.95] text-paper before:content-[attr(data-title)]"
          />
        </div>
      </div>
    </div>
  );
}
