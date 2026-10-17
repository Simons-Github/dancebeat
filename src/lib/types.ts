import type { z } from "zod";
import type {
  AnglesSchema,
  ChoreoFileSchema,
  ChoreographySchema,
  FrameSchema,
  LandmarkSchema,
  MoveSchema,
  SongSchema,
  SourceSpecSchema,
} from "./schema";

export type AngleKey =
  | "leftElbow"
  | "rightElbow"
  | "leftShoulder"
  | "rightShoulder"
  | "leftHip"
  | "rightHip"
  | "leftKnee"
  | "rightKnee"
  | "torsoLean";

export type Angles = z.infer<typeof AnglesSchema>;
export type Landmark = z.infer<typeof LandmarkSchema>; // x, y, (visibility)
export type Frame = z.infer<typeof FrameSchema>;
export type Move = z.infer<typeof MoveSchema>;
export type Choreography = z.infer<typeof ChoreographySchema>;
export type SourceSpec = z.infer<typeof SourceSpecSchema>;
export type Song = z.infer<typeof SongSchema>;
export type ChoreoFile = z.infer<typeof ChoreoFileSchema>;

export type Rating = "PERFECT" | "SUPER" | "GOOD" | "OK" | "X";

export interface GameResult {
  songId: string;
  score: number;
  stars: number;
  mega: boolean;
  counts: Record<Rating, number>;
  maxCombo: number;
  newHighscore: boolean;
}
