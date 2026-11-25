// Zentrale Theme-Datei: Songfarben, Goldton, Fonts, Animationskonstanten.
export const SONG_PALETTES = [
  { accent: "#FF2E93", secondary: "#00E5FF" },
  { accent: "#FF8A00", secondary: "#7CFF4F" },
  { accent: "#2E7BFF", secondary: "#FFE600" },
  { accent: "#13D99A", secondary: "#FF4FD8" },
  { accent: "#B13CFF", secondary: "#FFB800" },
  { accent: "#FF3B3B", secondary: "#3BFFF2" },
] as const;

/**
 * Night: the dark app background behind the song glow (`--night`, `--background` in src/styles.css).
 * Used for the web manifest and the theme-color meta; keep public/manifest.webmanifest and index.html in sync.
 */
export const APP_BACKGROUND = "#14061F";

export const GOLD = "#FFC93C";
export const GOLD_DEEP = "#E89B00";
/** Highlight of gold surfaces (megastar). */
export const GOLD_LIGHT = "#FFF6CF";

export const FONTS = {
  display: "'Bricolage Grotesque Variable', system-ui, sans-serif",
};

/** Slightly pink white for text on night and glass. */
export const PAPER = "#FFF2FA";

/**
 * Chrome: light, a dark "horizon" band in the middle, light again (like polished metal reflecting
 * a horizon). `tint` is mixed in from the song color; `dark` is the darkest stop, checked against
 * the night background in contrast.test.ts.
 */
export const CHROME = {
  light: "#FFFFFF",
  mid: "#E6DCEF",
  dark: "#857799",
  tint: 0.28,
} as const;

/** Song glow on the night background (opacity of the song colors in the two radial glows). */
export const GLOW = { song: 0.45, secondary: 0.22 } as const;

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
export const TILE_SCALE = { selected: 1.04, idle: 0.92 } as const;

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

/**
 * Decorative background. `mosaic`: a large five-pointed star built from small squares in the song
 * color (pixel mosaic). `sparkle`: four-pointed glints. `x` / `y` are viewport percentages, `size` in
 * vmax, `rotate` in degrees. Kept off the song title (bottom in portrait, right column in landscape).
 */
export const BG_SHAPES = [
  { kind: "mosaic", x: -14, y: -8, size: 62, rotate: -14, opacity: 0.55 },
  { kind: "sparkle", x: 78, y: 7, size: 4.5, rotate: 0, opacity: 0.95 },
  { kind: "sparkle", x: 88, y: 18, size: 2, rotate: 20, opacity: 0.8 },
  { kind: "sparkle", x: 6, y: 52, size: 2.6, rotate: 10, opacity: 0.85 },
  { kind: "sparkle", x: 52, y: 44, size: 1.6, rotate: 0, opacity: 0.7 },
  { kind: "sparkle", x: 38, y: 4, size: 1.4, rotate: 30, opacity: 0.7 },
] as const;

/**
 * Dark tint for readable white text. `ink` is the tint color; `glass` is the opacity of the night
 * glass behind panels and tiles (over the glowing background). Checked in src/test/contrast.test.ts.
 */
export const SCRIM = {
  ink: "#1E0B36",
  glass: 0.72,
} as const;

/** Opacity of secondary (artist, hint) text. */
export const TEXT_SECONDARY_ALPHA = 0.9;

/** WCAG minimum contrast: normal text, large text (>= 24px or >= 18.66px bold). */
export const MIN_CONTRAST = { text: 4.5, large: 3 } as const;

export const FLAME = "#FF8A00";

/** Glowing difficulty flame: tip, body and base of its gradient, plus the white-hot core. */
/** Rainbow sheen over the song discs (conic gradient, screen-blended), like light on a real CD. */
export const DISC_SHEEN = ["#FF9AE8", "#9AF3FF", "#FFF59A", "#C9A6FF", "#FF9AE8"] as const;

export const FLAME_GRADIENT = {
  tip: "#FFE66B",
  body: FLAME,
  base: "#FF2E93",
  core: "#FFF8E6",
} as const;
export const ICON_OFF = "rgb(255 255 255 / 45%)";

/** Colors for the setup camera overlay (drawn on canvas, so no CSS variables). */
export const OVERLAY_COLORS = {
  bone: "#FFFFFF",
  joint: "#FFC93C",
  guide: "rgb(255 255 255 / 70%)",
  guideReady: "#7CFF4F",
} as const;

/**
 * Person picker in the video import (canvas still with numbered skeletons): the chosen person in
 * gold, the others dimmed; `ink` is the number on the badge.
 */
export const PERSON_PICK = {
  selected: GOLD,
  other: "rgb(255 255 255 / 55%)",
  ink: SCRIM.ink,
  font: FONTS.display,
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

/**
 * Coach silhouette (in-game, drawn by drawCoach/drawFigure). All lengths are fractions of the
 * shorter canvas side, so the figure scales with the canvas.
 */
export const COACH = {
  /** Limb capsule widths (stroke width, round caps). Upper limbs are thicker than lower ones. */
  width: { upperArm: 0.07, forearm: 0.055, thigh: 0.088, shin: 0.066, neck: 0.04, foot: 0.045 },
  headRadius: 0.068,
  handRadius: 0.036,
  /** Extra width of the light rim around the body (added to every width, radius and the torso). */
  rim: 0.012,
  rimColor: "#FFFFFF",
  /** Glow blur radius, applied once per frame to the whole rim layer. */
  glowBlur: 0.05,
  /** Gradient top: how far the song color is mixed toward white (0..1). Bottom is the song color. */
  gradientLight: 0.45,
  /** CSS size of the coach canvas. Must leave the YouTube box (min 200 px) at the bottom right free. */
  size: { portrait: "min(44vw, 32dvh)", landscape: "min(30vw, 48dvh)" },
} as const;

/**
 * Pictogram figure and movement arrows (drawn by drawPiktos/drawMoveFigure with drawFigure, so the
 * silhouette matches COACH). Lengths are fractions of the figure height (unit-space height 1).
 */
export const PIKTO_FIGURE = {
  /** Body unit in figure heights: multiplies the COACH widths (a little thicker than the coach for small sizes). */
  unit: 1.1,
  /** Width of the dark rim around the silhouette (added to every width, radius and the torso). */
  rim: 0.014,
  /** Gold halo instead of shadowBlur: an extra, wider, translucent gold silhouette beneath. */
  halo: { grow: 0.07, alpha: 0.35 },
  /** Arrow stroke width, dark outline width on each side, and arrow head length / half width. */
  arrow: { width: 0.045, outline: 0.015, headLength: 0.13, headHalfWidth: 0.075 },
} as const;

/** Rating popups: rise distance (vh) and duration (s). */
export const POPUP = { riseVh: 6, seconds: 0.9 } as const;

/** Result screen: score count-up (s, ease), star pop-in delay and stagger (s). */
export const RESULT = {
  countUpSeconds: 1.6,
  countUpEase: "easeOut",
  starDelaySeconds: 0.4,
  starStaggerSeconds: 0.22,
} as const;

/**
 * One-shot confetti for 5 stars / megastar. Pieces fall from `startVh` to `endVh`, drift sideways
 * up to ±`driftVw`/2, spin 1..`maxTurns` turns. Fall time is `fallSeconds` × (1 ± `durationJitter`/2),
 * start delays spread over `delaySpreadSeconds`, height is `sizePx` × (`minAspect` + 0..1).
 */
export const CONFETTI = {
  count: 36,
  fallSeconds: 2.8,
  durationJitter: 0.5,
  delaySpreadSeconds: 0.9,
  sizePx: 10,
  minAspect: 0.5,
  startVh: -5,
  endVh: 105,
  driftVw: 20,
  maxTurns: 3,
  ease: "easeIn",
  colors: [GOLD, GOLD_DEEP, "#FF2E93", "#00E5FF", "#7CFF4F", "#FFFFFF"],
} as const;

/**
 * Beat light in the sync test's fine-tuning card: fade-out after each flash (ms) and the scale at
 * full brightness (not used with reduced motion). The flash rate limit is MAX_PULSE_HZ. Shorter
 * than the gameplay pulse (PULSE_DECAY_MS) so the flash onset is easier to compare with the beat.
 */
export const SYNC_PREVIEW = { decayMs: 180, scale: 1.12 } as const;
