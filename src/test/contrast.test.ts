import { describe, expect, it } from "vitest";

import { contrast, hexToRgb, over, type Rgb } from "@/lib/contrast";
import {
  APP_BACKGROUND,
  BG_SHAPES,
  CHROME,
  GAME,
  GLOW,
  MIN_CONTRAST,
  PAPER,
  SCRIM,
  SONG_PALETTES,
  TEXT_SECONDARY_ALPHA,
} from "@/theme";

const WHITE: Rgb = [255, 255, 255];
const INK = hexToRgb(SCRIM.ink);
const NIGHT = hexToRgb(APP_BACKGROUND);
const MOSAIC_OPACITY = BG_SHAPES.find((s) => s.kind === "mosaic")?.opacity ?? 0;

function lum(c: Rgb) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * The lightest point behind glass for a song: the brighter song color glowing on the night, with the
 * mosaic star on top (its squares are the plain song color).
 */
function worstBackdrop(accent: string, secondary: string): Rgb {
  const [a, b] = [hexToRgb(accent), hexToRgb(secondary)];
  const bright = lum(a) > lum(b) ? a : b;
  return over(bright, MOSAIC_OPACITY, over(bright, Math.max(GLOW.song, GLOW.secondary), NIGHT));
}

describe.each(SONG_PALETTES)("text on $accent / $secondary", ({ accent, secondary }) => {
  const glass = over(NIGHT, SCRIM.glass, worstBackdrop(accent, secondary));
  const secondaryText = (surface: Rgb) => over(WHITE, TEXT_SECONDARY_ALPHA, surface);

  it("glass panels and tiles (worst case: over the mosaic star in the glow)", () => {
    expect(contrast(WHITE, glass)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
    expect(contrast(secondaryText(glass), glass)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  });
  it("chrome titles: darkest band on the night with a quarter of the glow (large text)", () => {
    // Titles sit low (portrait) or in the right column (landscape), where the corner glows have
    // mostly faded; the mosaic star stays in the upper left.
    const behind = over(hexToRgb(accent), GLOW.song / 4, NIGHT);
    expect(contrast(hexToRgb(CHROME.dark), behind)).toBeGreaterThanOrEqual(MIN_CONTRAST.large);
  });
});

it("night text on chrome buttons (darkest stop mixed with mid, as in chrome-fill)", () => {
  const band = over(hexToRgb(CHROME.dark), 0.55, hexToRgb(CHROME.mid));
  expect(contrast(NIGHT, band)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
});

it("paper text on the plain night", () => {
  expect(contrast(hexToRgb(PAPER), NIGHT)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
});

describe.each(SONG_PALETTES)("gameplay HUD on $accent", ({ accent }) => {
  // Worst case behind the HUD: a white camera picture under the song tint, no vignette.
  const camera = over(hexToRgb(accent), GAME.tint, WHITE);
  const hud = over(INK, GAME.hudScrim, camera);

  it("score, combo, countdown and hints on the HUD scrim", () => {
    expect(contrast(WHITE, hud)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  });
});
