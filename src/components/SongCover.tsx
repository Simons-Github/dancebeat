import type { Song } from "@/lib/types";

const MOTIFS = ["circles", "triangles", "stripes"] as const;

function motifFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MOTIFS[h % MOTIFS.length] ?? "circles";
}

/** Generated cover: accent/secondary gradient, simple shapes and the title's initial. */
export function SongCover({ song }: { song: Song }) {
  const { accentColor: a, secondaryColor: b } = song.choreo;
  const motif = motifFor(song.id);
  const initial = song.title.trim().charAt(0).toUpperCase();
  return (
    <div
      aria-hidden
      className="relative size-full overflow-hidden"
      style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0">
        {motif === "circles" && (
          <>
            <circle cx="80" cy="22" r="26" fill="white" opacity="0.22" />
            <circle cx="14" cy="88" r="30" fill={b} opacity="0.45" />
            <circle cx="62" cy="78" r="9" fill="white" opacity="0.3" />
          </>
        )}
        {motif === "triangles" && (
          <>
            <polygon points="78,4 100,46 56,46" fill="white" opacity="0.25" />
            <polygon points="0,100 34,40 68,100" fill={b} opacity="0.4" />
            <polygon points="70,96 84,70 98,96" fill="white" opacity="0.22" />
          </>
        )}
        {motif === "stripes" && (
          <>
            <rect
              x="-10"
              y="18"
              width="130"
              height="12"
              fill="white"
              opacity="0.2"
              transform="rotate(-18 50 50)"
            />
            <rect
              x="-10"
              y="46"
              width="130"
              height="12"
              fill={b}
              opacity="0.4"
              transform="rotate(-18 50 50)"
            />
            <rect
              x="-10"
              y="74"
              width="130"
              height="12"
              fill="white"
              opacity="0.2"
              transform="rotate(-18 50 50)"
            />
          </>
        )}
      </svg>
      <span
        className="font-title text-stroke absolute inset-0 flex items-center justify-center text-7xl text-white"
        style={{ textShadow: "0 4px 0 rgb(0 0 0 / 25%)" }}
      >
        {initial}
      </span>
    </div>
  );
}
