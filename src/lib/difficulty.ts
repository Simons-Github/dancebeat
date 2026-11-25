/** Stored difficulty values (persisted in settings; labels are translated at render time). */
export const DIFFICULTIES = ["leicht", "normal", "schwer"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
