export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
}

/** `color` at `alpha` over an opaque `base` (plain sRGB blend, as the browser does it). */
export function over(color: Rgb, alpha: number, base: Rgb): Rgb {
  return [0, 1, 2].map((i) => color[i]! * alpha + base[i]! * (1 - alpha)) as unknown as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two opaque colors (1 to 21). */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** CSS color for a tint, e.g. `rgb(30 11 54 / 0.74)`. */
export function scrimCss(hex: string, alpha: number): string {
  return `rgb(${hexToRgb(hex).join(" ")} / ${alpha})`;
}
