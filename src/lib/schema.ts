import { z } from "zod";
import { BONE_IDS, type BoneId, type Skeleton3D } from "./skeleton/types";

/**
 * Persisted and exchanged data formats. These zod schemas are the single source of truth for the
 * data types (see types.ts); every read from storage and every import is validated against them.
 */

export const CHOREO_VERSION = 2;
export const EXPORT_FORMAT = "dancebeat-choreo";

const time = z.number().finite().nonnegative();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Farbe als #RRGGBB");
const timestamp = z.number().int().nonnegative();

export const LandmarkSchema = z.union([
  z.tuple([z.number().finite(), z.number().finite()]),
  z.tuple([z.number().finite(), z.number().finite(), z.number().min(0).max(1)]),
]);

/**
 * MediaPipe world landmark: metres, origin at the hip midpoint, x toward the right of the camera
 * image, y down, z away from the camera; optional visibility (default 1).
 */
export const Landmark3dSchema = z.union([
  z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().min(0).max(1),
  ]),
]);

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const unitComponent = z.number().min(-1).max(1);
const boneVec = z.tuple([unitComponent, unitComponent, unitComponent]);
const boneShape = Object.fromEntries(BONE_IDS.map((id) => [id, boneVec.optional()])) as Record<
  BoneId,
  z.ZodOptional<typeof boneVec>
>;

/**
 * A body pose as bone directions (`Skeleton3D`, see `src/lib/skeleton/types.ts` for the
 * convention). Bone entries are unit vectors; a missing bone is absent, never a zero vector.
 */
export const Skeleton3DSchema = z.object({
  root: z.object({ pos: vec3, yawDeg: z.number().finite() }),
  bones: z.object(boneShape).strict(),
});

// Compile-time check: the parsed type and the skeleton API type are mutually assignable.
type Skeleton3DParsed = z.infer<typeof Skeleton3DSchema>;
const skeletonTypesMatch: [Skeleton3DParsed, Skeleton3D] extends [Skeleton3D, Skeleton3DParsed]
  ? true
  : never = true;
void skeletonTypesMatch;

const angle = z.number().finite().min(-180).max(180);
export const AnglesSchema = z
  .object({
    leftElbow: angle,
    rightElbow: angle,
    leftShoulder: angle,
    rightShoulder: angle,
    leftHip: angle,
    rightHip: angle,
    leftKnee: angle,
    rightKnee: angle,
    torsoLean: angle,
  })
  .partial()
  .strict();

export const FrameSchema = z.object({
  timeMs: time,
  landmarks: z.array(LandmarkSchema).max(33),
  angles: AnglesSchema,
  lowVisibility: z.boolean().optional(),
  /** Format v2: optional 3D pose of the reference dancer (video import with world landmarks). */
  pose3d: Skeleton3DSchema.optional(),
});

export const MoveSchema = z.object({
  timeMs: time,
  label: z.string().max(60),
  iconId: z.string().max(60),
  gold: z.boolean(),
});

const sortedByTime = (items: { timeMs: number }[]) =>
  items.every((it, i) => i === 0 || items[i - 1]!.timeMs <= it.timeMs);

export const ChoreographySchema = z.object({
  version: z.literal(CHOREO_VERSION),
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  bpm: z.number().min(30).max(300),
  offsetMs: z.number().finite(),
  accentColor: hexColor,
  secondaryColor: hexColor,
  frames: z.array(FrameSchema).refine(sortedByTime, "Frames müssen nach timeMs sortiert sein"),
  moves: z.array(MoveSchema).refine(sortedByTime, "Moves müssen nach timeMs sortiert sein"),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const SourceSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local"), blobId: z.string().min(1) }),
  z.object({ type: z.literal("url"), url: z.string().url() }),
  z.object({ type: z.literal("youtube"), videoId: z.string().regex(/^[\w-]{11}$/) }),
  z.object({ type: z.literal("spotify"), trackUri: z.string().regex(/^spotify:track:\w{22}$/) }),
]);

export const SongSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  artist: z.string().max(120),
  bpm: z.number().min(30).max(300),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  source: SourceSpecSchema,
  syncOffsetMs: z.number().finite(),
  startOffsetMs: time,
  playbackRate: z.number().min(0.5).max(2).optional(),
  choreo: ChoreographySchema,
  highscore: z.number().nonnegative(),
  stars: z.number().int().min(0).max(5),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Song metadata carried in an export file (no audio, no source, no personal scores). */
export const ExportedSongSchema = SongSchema.pick({
  title: true,
  artist: true,
  bpm: true,
  difficulty: true,
  syncOffsetMs: true,
  startOffsetMs: true,
});

/** Export files of format v1 stay readable; their choreography is migrated on import. */
export const ChoreoFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.union([z.literal(1), z.literal(CHOREO_VERSION)]),
  exportedAt: timestamp,
  song: ExportedSongSchema,
  choreo: ChoreographySchema,
});
