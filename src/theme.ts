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
