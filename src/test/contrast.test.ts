import { describe, expect, it } from "vitest";

import { contrast, hexToRgb, over, type Rgb } from "@/lib/contrast";
import { GAME, MIN_CONTRAST, SCRIM, SONG_PALETTES, TEXT_SECONDARY_ALPHA } from "@/theme";

const WHITE: Rgb = [255, 255, 255];
const INK = hexToRgb(SCRIM.ink);
/** Decorative white shapes may lighten the song color by this much behind a surface. */
const SHAPE_LIFT = 0.2;

function lum(c: Rgb) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** The lightest point behind a surface for a song: its brighter color, lifted by a white shape. */
function worstBackdrop(accent: string, secondary: string): Rgb {
  const [a, b] = [hexToRgb(accent), hexToRgb(secondary)];
  return over(WHITE, SHAPE_LIFT, lum(a) > lum(b) ? a : b);
}

describe.each(SONG_PALETTES)("white text on $accent / $secondary", ({ accent, secondary }) => {
  const backdrop = worstBackdrop(accent, secondary);
  const header = over(INK, SCRIM.header, backdrop);
  const banner = over(INK, SCRIM.banner, backdrop);
  const tile = over(INK, SCRIM.tile, backdrop);
  const button = over(INK, SCRIM.button, banner);
  const secondaryText = (surface: Rgb) => over(WHITE, TEXT_SECONDARY_ALPHA, surface);

  it("header (logo)", () => {
    expect(contrast(WHITE, header)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  });
  it("banner title and placeholder pages", () => {
    expect(contrast(WHITE, banner)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
    expect(contrast(secondaryText(banner), banner)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  });
  it("tile info area", () => {
    expect(contrast(WHITE, tile)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
    expect(contrast(secondaryText(tile), tile)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  });
  it("'Song hinzufügen' button inside the banner", () => {
    expect(contrast(WHITE, button)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  });
});

describe.each(SONG_PALETTES)("gameplay HUD on $accent", ({ accent }) => {
  // Worst case behind the HUD: a white camera picture under the song tint, no vignette.
  const camera = over(hexToRgb(accent), GAME.tint, WHITE);
  const hud = over(INK, GAME.hudScrim, camera);

  it("score, combo, countdown and hints on the HUD scrim", () => {
    expect(contrast(WHITE, hud)).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  });
});
