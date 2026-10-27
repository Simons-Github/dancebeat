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
 * Since Etappe 13i the pack ships a subset of the AIST++ clips (`selectShippedClips`).
 */
export const SHIPS_AIST = true;

// The app's own license (LICENSE.md); the Required Notice line must reach every recipient.
const APP_CREDIT: Credit = {
  title: "DanceBeat",
  lines: [
    "Required Notice: Copyright 2026 Simon Berger",
    "Lizenziert unter der PolyForm Noncommercial License 1.0.0: Nutzung, Änderung und Weitergabe nur für nicht-kommerzielle Zwecke. Fremde Bestandteile behalten ihre eigenen Lizenzen (unten und unter „Lizenztexte“).",
  ],
  links: [
    {
      label: "PolyForm Noncommercial 1.0.0",
      href: "https://polyformproject.org/licenses/noncommercial/1.0.0/",
    },
  ],
};

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
      "Verwendung mit Erlaubnis des AIST, nur für nicht-kommerzielle Zwecke.",
      "S. Tsuchida, S. Fukayama, M. Hamasaki, M. Goto: AIST Dance Video Database: Multi-genre, Multi-dancer, and Multi-camera Database for Dance Information Processing. ISMIR 2019, Delft, S. 501–510.",
    ],
    links: [{ label: "AIST Dance DB", href: "https://aistdancedb.ongaaccel.jp/" }],
  },
];

// Shipped unchanged from our own origin: the JS and WASM runtime of @mediapipe/tasks-vision
// (package.json: Apache-2.0) and the pose models (model card: Apache License 2.0).
const MEDIAPIPE_CREDIT: Credit = {
  title: "MediaPipe Pose Landmarker",
  lines: [
    "Pose-Erkennung mit MediaPipe Tasks Vision (Laufzeit und WASM) und den Pose-Landmarker-Modellen „lite“ und „full“ (BlazePose GHUM 3D) von Google LLC, lizenziert unter der Apache License 2.0. Unverändert mitgeliefert.",
  ],
  links: [
    { label: "MediaPipe", href: "https://github.com/google-ai-edge/mediapipe" },
    {
      label: "Model Card",
      href: "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf",
    },
    { label: "Apache 2.0", href: "https://www.apache.org/licenses/LICENSE-2.0" },
  ],
};

// Copyright line as in node_modules/@fontsource-variable/bricolage-grotesque/LICENSE.
const FONT_CREDIT: Credit = {
  title: "Schrift Bricolage Grotesque",
  lines: [
    "Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage). Lizenziert unter der SIL Open Font License 1.1, eingebunden über @fontsource-variable/bricolage-grotesque.",
  ],
  links: [
    { label: "Bricolage Grotesque", href: "https://github.com/ateliertriay/bricolage" },
    { label: "OFL 1.1", href: "https://openfontlicense.org/" },
  ],
};

const PACKAGES_CREDIT: Credit = {
  title: "Open-Source-Pakete",
  lines: [
    "React, TanStack Router und Query, Radix UI, Framer Motion, zod, Tailwind CSS, Lucide und weitere npm-Pakete. Namen, Versionen und Lizenztexte aller mitgelieferten Pakete stehen unter „Lizenztexte“.",
  ],
  links: [],
};

export const CREDITS: readonly Credit[] = [
  APP_CREDIT,
  MUSIC_CREDIT,
  ...(SHIPS_AIST ? AIST_CREDITS : []),
  MEDIAPIPE_CREDIT,
  FONT_CREDIT,
  PACKAGES_CREDIT,
];
