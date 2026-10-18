import { createContext, useContext } from "react";
import { DEFAULT_SONG_THEME } from "@/theme";

export interface SongTheme {
  accent: string;
  secondary: string;
  bpm: number;
}

export interface SongThemeContextValue {
  theme: SongTheme;
  setTheme: (theme: SongTheme) => void;
}

export const SongThemeContext = createContext<SongThemeContextValue>({
  theme: DEFAULT_SONG_THEME,
  setTheme: () => {},
});

/** Colors and tempo of the currently selected song; drives the animated page background. */
export function useSongTheme() {
  return useContext(SongThemeContext);
}
