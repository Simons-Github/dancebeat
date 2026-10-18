// Zentrale Theme-Datei: Songfarben, Goldton, Fonts, Animationskonstanten.
export const SONG_PALETTES = [
  { accent: "#FF2E93", secondary: "#00E5FF" },
  { accent: "#FF8A00", secondary: "#7CFF4F" },
  { accent: "#2E7BFF", secondary: "#FFE600" },
  { accent: "#13D99A", secondary: "#FF4FD8" },
  { accent: "#B13CFF", secondary: "#FFB800" },
  { accent: "#FF3B3B", secondary: "#3BFFF2" },
] as const;

export const GOLD = "#FFC93C";
export const GOLD_DEEP = "#E89B00";

export const FONTS = {
  display: "'Fredoka', 'Baloo 2', system-ui, sans-serif",
};

export const SPRING = { type: "spring", stiffness: 420, damping: 22 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 180, damping: 20 } as const;

export const RATING_COLORS: Record<string, string> = {
  PERFECT: "#FFE600",
  SUPER: "#7CFF4F",
  GOOD: "#00E5FF",
  OK: "#FFFFFF",
  X: "#FF3B3B",
};

/** Colors and tempo used before a song is selected (and on screens without a song). */
export const DEFAULT_SONG_THEME = {
  accent: SONG_PALETTES[0].accent,
  secondary: SONG_PALETTES[0].secondary,
  bpm: 110,
} as const;

/** Scale of the selected / unselected song tile in the library. */
export const TILE_SCALE = { selected: 1.07, idle: 0.93 } as const;

/** Duration (ms) of the smooth background color change when another song is selected. */
export const THEME_FADE_MS = 900;

/**
 * Menu motion. Default is "calm" (stage 5 adds the full / calm / off setting). The menu has no beat
 * pulse and no running color gradient; the only continuous animation is one slow drift of all
 * decorative shapes together (one cycle = `driftSeconds`, never changes opacity).
 */
export type MotionLevel = "full" | "calm" | "off";
export const DEFAULT_MOTION_LEVEL: MotionLevel = "calm";
export const MOTION_PRESETS: Record<MotionLevel, { drift: boolean; seconds: number; vh: number }> =
  {
    full: { drift: true, seconds: 60, vh: 6 },
    calm: { drift: true, seconds: 90, vh: 3 },
    off: { drift: false, seconds: 0, vh: 0 },
  };

/** Decorative background shapes. `x` / `y` / `size` are relative to the viewport (vw / % / vmax). */
export const BG_SHAPES = [
  { kind: "triangle", x: 6, y: 62, size: 14, tint: "white", opacity: 0.14 },
  { kind: "circle", x: 22, y: 8, size: 9, tint: "secondary", opacity: 0.18 },
  { kind: "triangle", x: 40, y: 38, size: 18, tint: "secondary", opacity: 0.16 },
  { kind: "circle", x: 58, y: 74, size: 12, tint: "white", opacity: 0.12 },
  { kind: "triangle", x: 74, y: 18, size: 10, tint: "white", opacity: 0.14 },
  { kind: "circle", x: 88, y: 52, size: 16, tint: "secondary", opacity: 0.16 },
] as const;

/**
 * Dark tint laid over the song colors so white text stays readable on every song color. `ink` is
 * the tint color, the numbers are its opacity per surface. Checked in src/test/contrast.test.ts.
 */
export const SCRIM = {
  ink: "#1E0B36",
  header: 0.7,
  tile: 0.88,
  banner: 0.74,
  button: 0.55,
  edge: 0.35,
} as const;

/** Opacity of secondary (artist, hint) text. */
export const TEXT_SECONDARY_ALPHA = 0.9;

/** WCAG minimum contrast: normal text, large text (>= 24px or >= 18.66px bold). */
export const MIN_CONTRAST = { text: 4.5, large: 3 } as const;

export const FLAME = "#FF8A00";
export const ICON_OFF = "rgb(255 255 255 / 45%)";

/** Colors for the setup camera overlay (drawn on canvas, so no CSS variables). */
export const OVERLAY_COLORS = {
  bone: "#FFFFFF",
  joint: "#FFC93C",
  guide: "rgb(255 255 255 / 70%)",
  guideReady: "#7CFF4F",
} as const;

/** Gameplay screen (canvas colors are plain strings, no CSS variables). */
export const GAME = {
  /** Song-color filter over the camera picture (opacity). */
  tint: 0.2,
  /** Darkness of the vignette at the edges (opacity of SCRIM.ink). */
  vignette: 0.6,
  /** Ink behind HUD texts (opacity of SCRIM.ink); checked in contrast.test.ts. */
  hudScrim: 0.72,
  /** Pictogram bar fill. */
  piktoBar: "rgb(255 255 255 / 22%)",
  /** Dark outline around pictograms and coach so they read on any picture. */
  outline: SCRIM.ink,
  flash: "#FFFFFF",
  skeleton: "rgb(255 255 255 / 60%)",
  skeletonJoint: "rgb(255 201 60 / 80%)",
  /** Beat pulse at the screen edge: highest opacity. */
  pulse: 0.35,
} as const;

/** Rating popups: rise distance (vh) and duration (s). */
export const POPUP = { riseVh: 6, seconds: 0.9 } as const;
