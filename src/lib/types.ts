import type { z } from "zod";
import type {
  AnglesSchema,
  ChoreoFileSchema,
  ChoreographySchema,
  FrameSchema,
  Landmark3dSchema,
  LandmarkSchema,
  MotionClipSchema,
  MotionKeyframeSchema,
  MotionPackSchema,
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
/** MediaPipe world landmark in metres: x, y, z, (visibility). See Landmark3dSchema. */
export type Landmark3d = z.infer<typeof Landmark3dSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Move = z.infer<typeof MoveSchema>;
export type Choreography = z.infer<typeof ChoreographySchema>;
export type SourceSpec = z.infer<typeof SourceSpecSchema>;
export type Song = z.infer<typeof SongSchema>;
export type ChoreoFile = z.infer<typeof ChoreoFileSchema>;
export type MotionKeyframe = z.infer<typeof MotionKeyframeSchema>;
export type MotionClip = z.infer<typeof MotionClipSchema>;
export type MotionPack = z.infer<typeof MotionPackSchema>;

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
