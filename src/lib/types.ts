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

export type Angles = Partial<Record<AngleKey, number>>;
export type Landmark = [number, number] | [number, number, number]; // x,y,(visibility)

export interface Frame {
  timeMs: number;
  landmarks: Landmark[];
  angles: Angles;
  lowVisibility?: boolean;
}
export interface Move {
  timeMs: number;
  label: string;
  iconId: string;
  gold: boolean;
}

export interface Choreography {
  title: string;
  bpm: number;
  offsetMs: number;
  accentColor: string;
  secondaryColor: string;
  frames: Frame[];
  moves: Move[];
}

export type SourceSpec =
  | { type: "local"; blobId: string }
  | { type: "url"; url: string }
  | { type: "youtube"; videoId: string }
  | { type: "spotify"; trackUri: string };

export interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  difficulty: 1 | 2 | 3;
  source: SourceSpec;
  syncOffsetMs: number;
  startOffsetMs: number;
  playbackRate?: number;
  choreo: Choreography;
  highscore: number;
  stars: number;
  createdAt: number;
}

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
