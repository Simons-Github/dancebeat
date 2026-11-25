import { GOLD, RATING_COLORS } from "@/theme";

import type { Rating } from "../types";

/** Text and color of a rating popup; gold moves say "YEAH!" or "X". */
export function popupContent(j: { rating: Rating; gold: boolean }) {
  if (j.gold) {
    return j.rating === "X"
      ? { text: "X", color: RATING_COLORS["X"] ?? "#FF3B3B" }
      : { text: "YEAH!", color: GOLD };
  }
  return { text: j.rating, color: RATING_COLORS[j.rating] ?? "#FFFFFF" };
}
