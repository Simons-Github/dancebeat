import type { Frame, MotionPack, Move } from "../types";
import { planStructure } from "./plan";
import { realizeFrames } from "./realize";
import { selectMoves } from "./select";
import type { GenerationInput } from "./types";
import { randomFromString } from "../random";

/** Style of the generated choreographies until style selection exists (13f-2). */
export const DEFAULT_STYLE = "party";

/**
 * Generates frames and moves for a song: `planStructure` → `selectMoves` → `realizeFrames`.
 * Pure and deterministic: the same input (including `seed`) and pack give the same result.
 */
export function generateChoreo(
  input: GenerationInput,
  pack: MotionPack,
): { frames: Frame[]; moves: Move[] } {
  const plan = planStructure(input);
  const clips = selectMoves(plan, pack, input, randomFromString(input.seed));
  return realizeFrames(plan, clips, pack);
}
