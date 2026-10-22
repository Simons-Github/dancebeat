// Credits for shipped content (Etappe 14c, docs/plans/etappe-14.md 14-0), shown in Settings under
// "Über und Credits". Links open only on tap; nothing is fetched while the list renders.
import { DEMO_TITLES } from "./demo";

export interface Credit {
  title: string;
  lines: readonly string[];
  links: readonly { label: string; href: string }[];
}

/**
 * Whether the shipped motion pack contains AIST++ clips (source `video:AIST++ …`). A test checks
 * this against src/data/motion-pack.json, so the AIST credits appear exactly when the data ships.
 */
export const SHIPS_AIST = false;

const MUSIC_CREDIT: Credit = {
  title: "Musik der Demo-Songs",
  lines: [
    ...(DEMO_TITLES.length > 0 ? [DEMO_TITLES.map((t) => `„${t}“`).join(", ")] : []),
    "KI-generiert mit Gemini (Google) für DanceBeat.",
  ],
  links: [],
};

// CC BY 4.0 attribution (Google LLC) plus paper citations (ISMIR 2019 required per 14-0.1).
// Wording checked against the AIST pages on 2026-10-22 (docs/roadmap.md, 13h-2): the AIST++ page
// says "licensed by Google LLC under CC BY 4.0"; the AIST Dance DB terms require the database name
// and give the English sentence below for uses outside papers.
export const AIST_CREDITS: readonly Credit[] = [
  {
    title: "AIST++ Dance Motion Dataset",
    lines: [
      "Bewegungsdaten (Annotationen) von Google LLC, lizenziert unter CC BY 4.0. Für DanceBeat in Clips geschnitten, gefiltert und auf die Strichfigur übertragen.",
      "R. Li, S. Yang, D. A. Ross, A. Kanazawa: AI Choreographer: Music Conditioned 3D Dance Generation with AIST++. ICCV 2021.",
    ],
    links: [
      { label: "AIST++", href: "https://google.github.io/aistplusplus_dataset/" },
      { label: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
    ],
  },
  {
    title: "AIST Dance Video Database",
    lines: [
      "Choreografien aus der AIST Dance Video Database; deren Musik wird nicht verwendet.",
      "We have used the AIST Dance Video Database (https://aistdancedb.ongaaccel.jp).",
      "S. Tsuchida, S. Fukayama, M. Hamasaki, M. Goto: AIST Dance Video Database: Multi-genre, Multi-dancer, and Multi-camera Database for Dance Information Processing. ISMIR 2019, Delft, S. 501–510.",
    ],
    links: [{ label: "AIST Dance DB", href: "https://aistdancedb.ongaaccel.jp/" }],
  },
];

export const CREDITS: readonly Credit[] = [MUSIC_CREDIT, ...(SHIPS_AIST ? AIST_CREDITS : [])];
