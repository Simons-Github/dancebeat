import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  AIST_STANDING_GENRES,
  AIST_STEP_MS,
  AistClipListSchema,
  AistClipSchema,
  aistGenre,
  AistKeypointsSchema,
  aistMusicBpm,
  aistMusicPiece,
  AistMusicTableSchema,
  aistPoseTrack,
  clipYawDeg,
  COCO_TO_MEDIAPIPE,
  cocoToWorld,
} from "@/lib/aist";
import { videoMotionSource } from "@/lib/motionPackVideo";
import { angleDiff, computeAngles } from "@/lib/pose";
import { PoseTrackFileSchema } from "@/lib/poseTrackFile";
import { fromLandmarks3d, project, rotateYaw, type Landmark3d, type Vec3 } from "@/lib/skeleton";
import type { Angles } from "@/lib/types";

type Keypoints = Parameters<typeof aistPoseTrack>[0];
type Clip = Parameters<typeof aistPoseTrack>[1];
type Joints = (Vec3 | null)[];

const CLIP: Clip = { name: "gHO_sBM_cAll_d19_mHO0_ch01", bpm: 120 };
const NOW = 1234;

/**
 * AIST world (cm, y up, right-handed) equals the skeleton world system up to units: x toward the
 * dancer's left when facing +z (the camera), y up, z toward the viewer. So a dancer facing the
 * camera has the left joints at +x and the nose at +z.
 */
interface BodyParams {
  /** Arm abduction in degrees: 0 = hanging, 90 = sideways, 180 = straight up. */
  la?: number;
  ra?: number;
}
function body({ la = 10, ra = 10 }: BodyParams = {}): Joints {
  const rad = Math.PI / 180;
  const arm = (side: 1 | -1, a: number, f: number): Vec3 => [
    side * (18 + Math.sin(a * rad) * 28 * f),
    145 - Math.cos(a * rad) * 28 * f,
    0,
  ];
  return [
    [0, 165, 8], // 0 nose (forward)
    [3, 168, 6], // 1 left eye
    [-3, 168, 6], // 2 right eye
    [7, 166, 0], // 3 left ear
    [-7, 166, 0], // 4 right ear
    [18, 145, 0], // 5 left shoulder
    [-18, 145, 0], // 6 right shoulder
    arm(1, la, 1), // 7 left elbow
    arm(-1, ra, 1), // 8 right elbow
    arm(1, la, 2), // 9 left wrist
    arm(-1, ra, 2), // 10 right wrist
    [10, 90, 0], // 11 left hip
    [-10, 90, 0], // 12 right hip
    [10, 48, 2], // 13 left knee
    [-10, 48, 2], // 14 right knee
    [10, 8, 0], // 15 left ankle
    [-10, 8, 0], // 16 right ankle
  ];
}

/** Turns the whole figure about the vertical through the origin (the hip midpoint's axis). */
const turn = (joints: Joints, deg: number): Joints =>
  joints.map((p) => (p ? rotateYaw(p, deg) : null));

const flipZ = (joints: Joints): Joints => joints.map((p) => (p ? [p[0], p[1], -p[2]] : null));

const empty = (): Joints => Array.from({ length: 17 }, () => null);

const yawOf = (world: readonly Landmark3d[]) => fromLandmarks3d(world).root.yawDeg;

const circ = (a: number, b: number) => Math.abs(angleDiff(a, b));

function keypoints(fps: number, frames: Joints[]): Keypoints {
  return { fps, joints: frames };
}

function expectAnglesClose(actual: Angles, expected: Angles, tolDeg = 1) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [k, v] of Object.entries(expected) as [keyof Angles, number][]) {
    const a = actual[k];
    expect(a).toBeDefined();
    expect(Math.abs(angleDiff(a!, v))).toBeLessThan(tolDeg);
  }
}

describe("COCO_TO_MEDIAPIPE", () => {
  it("maps all 17 COCO joints, odd COCO indices are the left side", () => {
    expect(COCO_TO_MEDIAPIPE).toEqual([
      [0, 0],
      [1, 2],
      [2, 5],
      [3, 7],
      [4, 8],
      [5, 11],
      [6, 12],
      [7, 13],
      [8, 14],
      [9, 15],
      [10, 16],
      [11, 23],
      [12, 24],
      [13, 25],
      [14, 26],
      [15, 27],
      [16, 28],
    ]);
  });
});

describe("AIST_STANDING_GENRES and aistGenre", () => {
  it("lists the six standing genres", () => {
    expect([...AIST_STANDING_GENRES].sort()).toEqual(["gHO", "gJB", "gLH", "gLO", "gMH", "gWA"]);
  });

  it("reads the genre from the first token of a clip name", () => {
    expect(aistGenre("gHO_sBM_cAll_d19_mHO0_ch01")).toBe("gHO");
    expect(aistGenre("gBR_sFM_cAll_d04_mBR0_ch01")).toBe("gBR");
    expect(aistGenre("clip.json")).toBeNull();
    expect(aistGenre("")).toBeNull();
  });
});

describe("AIST music pieces", () => {
  it("reads the music piece from a clip name", () => {
    expect(aistMusicPiece("gHO_sBM_cAll_d19_mHO0_ch01")).toBe("mHO0");
    expect(aistMusicPiece("gWA_sFM_cAll_d25_mWA5_ch03")).toBe("mWA5");
    expect(aistMusicPiece("gHO_sBM_cAll_d19_mHO6_ch01")).toBeNull();
    expect(aistMusicPiece("mHO0")).toBeNull();
  });

  it("gives the AIST table tempo: House 110-135 by 5, others 80-130 by 10", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => aistMusicBpm(`mHO${i}`))).toEqual([
      110, 115, 120, 125, 130, 135,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((i) => aistMusicBpm(`mLO${i}`))).toEqual([
      80, 90, 100, 110, 120, 130,
    ]);
    expect(aistMusicBpm("mJB6")).toBeNull();
    expect(aistMusicBpm("HO0")).toBeNull();
    expect(aistMusicBpm("mXX0")).toBeNull();
    expect(aistMusicBpm("mKR5")).toBe(130);
  });

  it("table schema accepts a phase below one beat only", () => {
    const entry = { bpm: 120, measuredBpm: 119.97, beatPhaseMs: 60, durationMs: 34000 };
    expect(AistMusicTableSchema.safeParse({ mHO2: entry }).success).toBe(true);
    const bad = (v: unknown) => expect(AistMusicTableSchema.safeParse(v).success).toBe(false);
    bad({ mHO2: { ...entry, beatPhaseMs: 500 } });
    bad({ mHO2: { ...entry, beatPhaseMs: -1 } });
    bad({ HO2: entry });
    bad({ mHO2: { ...entry, durationMs: 0.5 } });
  });

  it("the committed measurement covers every standing piece at the table tempo", () => {
    const table = AistMusicTableSchema.parse(
      JSON.parse(readFileSync(path.resolve(__dirname, "../../scripts/aist/music.json"), "utf8")),
    );
    const expected = AIST_STANDING_GENRES.flatMap((g) =>
      [0, 1, 2, 3, 4, 5].map((i) => `m${g.slice(1)}${i}`),
    );
    expect(Object.keys(table).sort()).toEqual(expected.sort());
    for (const [piece, e] of Object.entries(table)) {
      expect(e.bpm).toBe(aistMusicBpm(piece));
      expect(Math.abs(e.measuredBpm - e.bpm)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("AistKeypointsSchema", () => {
  const frame = body();

  it("accepts 17 joints per frame with null for missing joints", () => {
    const withGap = [...frame];
    withGap[3] = null;
    expect(AistKeypointsSchema.safeParse({ fps: 60, joints: [frame, withGap] }).success).toBe(true);
    expect(AistKeypointsSchema.safeParse({ fps: 240, joints: [empty()] }).success).toBe(true);
  });

  it("rejects wrong joint counts, non-finite values, bad tuples and bad fps", () => {
    const bad = (v: unknown) => expect(AistKeypointsSchema.safeParse(v).success).toBe(false);
    bad({ fps: 60, joints: [frame.slice(0, 16)] });
    bad({ fps: 60, joints: [[...frame, [0, 0, 0]]] });
    bad({ fps: 60, joints: [] });
    bad({ fps: 0, joints: [frame] });
    bad({ fps: -30, joints: [frame] });
    bad({ fps: 241, joints: [frame] });
    const withNaN = [...frame];
    withNaN[0] = [Number.NaN, 0, 0];
    bad({ fps: 60, joints: [withNaN] });
    const withInf = [...frame];
    withInf[5] = [0, Number.POSITIVE_INFINITY, 0];
    bad({ fps: 60, joints: [withInf] });
    const short = [...frame] as unknown[];
    short[2] = [1, 2];
    bad({ fps: 60, joints: [short] });
  });
});

describe("AistClipSchema", () => {
  it("accepts standing genres with bpm 30..300 and optional finite beat phase", () => {
    for (const g of AIST_STANDING_GENRES) {
      expect(
        AistClipSchema.safeParse({ name: `${g}_sBM_cAll_d01_m0_ch01`, bpm: 100 }).success,
      ).toBe(true);
    }
    expect(AistClipSchema.safeParse({ ...CLIP, beatPhaseMs: -120.5 }).success).toBe(true);
    expect(AistClipSchema.safeParse({ ...CLIP, bpm: 30 }).success).toBe(true);
    expect(AistClipSchema.safeParse({ ...CLIP, bpm: 300 }).success).toBe(true);
  });

  it("rejects break and krump clips, foreign names, bpm out of range and NaN phase", () => {
    const bad = (v: unknown) => expect(AistClipSchema.safeParse(v).success).toBe(false);
    bad({ name: "gBR_sBM_cAll_d04_mBR0_ch01", bpm: 120 });
    bad({ name: "gKR_sBM_cAll_d28_mKR0_ch01", bpm: 120 });
    bad({ name: "my dance", bpm: 120 });
    bad({ ...CLIP, bpm: 29 });
    bad({ ...CLIP, bpm: 301 });
    bad({ ...CLIP, beatPhaseMs: Number.NaN });
    bad({ bpm: 120 });
  });

  it("list rejects duplicate names", () => {
    const other = { name: "gLH_sBM_cAll_d16_mLH0_ch01", bpm: 110 };
    expect(AistClipListSchema.safeParse([CLIP, other]).success).toBe(true);
    expect(AistClipListSchema.safeParse([CLIP, other, { ...CLIP, bpm: 90 }]).success).toBe(false);
  });
});

describe("cocoToWorld", () => {
  it("maps each COCO joint to its MediaPipe index in metres, MediaPipe axes, hip origin", () => {
    // Distinct coordinates per joint: c → [c, 10c, 100c] cm. Hip midpoint (11, 12) = 11.5.
    const joints: Joints = Array.from({ length: 17 }, (_, c): Vec3 => [c, 10 * c, 100 * c]);
    const out = cocoToWorld(joints);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(33);
    const mapped = new Map<number, number>(COCO_TO_MEDIAPIPE.map(([c, m]) => [m, c]));
    out!.forEach((p, i) => {
      const c = mapped.get(i);
      if (c === undefined) {
        expect(p).toEqual([0, 0, 0, 0]);
        return;
      }
      expect(p).toHaveLength(4);
      expect(p[0]).toBeCloseTo((c - 11.5) / 100, 9);
      expect(p[1]).toBeCloseTo(-(10 * c - 115) / 100, 9);
      expect(p[2]).toBeCloseTo(-(100 * c - 1150) / 100, 9);
      expect(p[3]).toBe(1);
    });
  });

  it("left/right: a dancer facing the camera has the left side at MediaPipe +x (image right)", () => {
    const out = cocoToWorld(body())!;
    expect(out[11]![0]).toBeGreaterThan(0); // left shoulder
    expect(out[12]![0]).toBeLessThan(0);
    expect(out[23]![0]).toBeCloseTo(0.1, 9); // left hip
    expect(out[24]![0]).toBeCloseTo(-0.1, 9);
    // Nose 75 cm above the hips and 8 cm toward the camera: MediaPipe y down, z away.
    expect(out[0]![1]).toBeCloseTo(-0.75, 9);
    expect(out[0]![2]).toBeCloseTo(-0.08, 9);
    // Ankles below the hips: positive y.
    expect(out[27]![1]).toBeCloseTo(0.82, 9);
  });

  it("missing joints get visibility 0 and are skipped by fromLandmarks3d", () => {
    const joints = body();
    joints[9] = null; // left wrist
    const out = cocoToWorld(joints)!;
    expect(out[15]).toEqual([0, 0, 0, 0]);
    const sk = fromLandmarks3d(out);
    expect(sk.bones.leftForearm).toBeUndefined();
    expect(sk.bones.leftUpperArm).toBeDefined();
  });

  it("falls back to the shoulder midpoint without a hip, null without any axis", () => {
    const noHip = body();
    noHip[12] = null;
    const out = cocoToWorld(noHip)!;
    expect(out).not.toBeNull();
    // Shoulder midpoint at height 145 cm is the origin.
    expect(out[11]![0]).toBeCloseTo(0.18, 9);
    expect(out[11]![1]).toBeCloseTo(0, 9);
    expect(out[12]![1]).toBeCloseTo(0, 9);
    expect(out[23]![1]).toBeCloseTo(0.55, 9); // remaining left hip 55 cm below
    expect(out[24]).toEqual([0, 0, 0, 0]);

    const none = body();
    none[11] = null;
    none[6] = null;
    expect(cocoToWorld(none)).toBeNull();
    expect(cocoToWorld(empty())).toBeNull();
  });

  it("figure facing +z gives yaw 0, left arm toward body +x, nose forward", () => {
    const sk = fromLandmarks3d(cocoToWorld(body({ la: 90, ra: 10 }))!);
    expect(circ(sk.root.yawDeg, 0)).toBeLessThan(1e-6);
    const lua = sk.bones.leftUpperArm!;
    expect(lua[0]).toBeCloseTo(1, 6);
    expect(sk.bones.rightUpperArm![0]).toBeLessThan(0);
    expect(sk.bones.torso![1]).toBeGreaterThan(0.99);
    expect(sk.bones.neck![2]).toBeGreaterThan(0);
  });

  it("turned figure gives that yaw", () => {
    expect(circ(yawOf(cocoToWorld(turn(body(), 70))!), 70)).toBeLessThan(1e-6);
    expect(circ(yawOf(cocoToWorld(turn(body(), -120))!), -120)).toBeLessThan(1e-6);
  });
});

describe("clipYawDeg", () => {
  it("circular mean over frames with a body axis, null frames skipped", () => {
    const frames = [
      cocoToWorld(turn(body(), 350)),
      null,
      cocoToWorld(turn(body(), 10)),
      cocoToWorld(empty()),
    ];
    const y = clipYawDeg(frames);
    expect(y).not.toBeNull();
    expect(circ(y!, 0)).toBeLessThan(1e-6);

    const y2 = clipYawDeg([170, 190, 180].map((d) => cocoToWorld(turn(body(), d))));
    expect(circ(y2!, 180)).toBeLessThan(1e-6);
  });

  it("frames without a body axis do not count", () => {
    const noAxis: Landmark3d[] = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
    expect(clipYawDeg([noAxis, cocoToWorld(turn(body(), 40))])).toBeCloseTo(40, 6);
  });

  it("null if no frame has a body axis", () => {
    const noAxis: Landmark3d[] = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
    expect(clipYawDeg([])).toBeNull();
    expect(clipYawDeg([null, noAxis])).toBeNull();
  });
});

describe("aistPoseTrack", () => {
  it("file fields and schema", () => {
    const data = keypoints(
      60,
      Array.from({ length: 30 }, () => body()),
    );
    const { file, warnings } = aistPoseTrack(data, { ...CLIP, beatPhaseMs: 125 }, { now: NOW });
    expect(PoseTrackFileSchema.safeParse(file).success).toBe(true);
    expect(warnings).toEqual([]);
    expect(file.format).toBe("dancebeat-pose-track");
    expect(file.version).toBe(2);
    expect(file.exportedAt).toBe(NOW);
    expect(file.video).toBe(`AIST++ ${CLIP.name}`);
    expect(file.bpm).toBe(120);
    expect(file.beatPhaseMs).toBe(125);
    expect(file.mirror).toBe(true);
    expect(file.movePlacement).toBe("holds");
    expect(file.track.aspect).toBe(1);
    expect(aistPoseTrack(data, CLIP, { now: NOW }).file.beatPhaseMs).toBe(0);
  });

  it("resamples 60 fps to 50 ms steps while the source index stays in range", () => {
    expect(AIST_STEP_MS).toBe(50);
    const { file } = aistPoseTrack(
      keypoints(
        60,
        Array.from({ length: 30 }, () => body()),
      ),
      CLIP,
      { now: NOW },
    );
    // round(t · 60 / 1000) < 30 → t ≤ 450.
    expect(file.track.samples.map((s) => s.timeMs)).toEqual(
      Array.from({ length: 10 }, (_, k) => k * 50),
    );
    expect(file.range).toEqual({ startMs: 0, endMs: 450 });
  });

  it("takes the nearest source frame and honours stepMs", () => {
    // Frame i lifts the left wrist to 100 + i cm (hip height 90): world y = -(10 + i) / 100.
    const frames = Array.from({ length: 25 }, (_, i) => {
      const j = body();
      j[9] = [40, 100 + i, 0];
      return j;
    });
    const { file } = aistPoseTrack(keypoints(24, frames), CLIP, { now: NOW });
    // 24 fps: index round(1.2 k) < 25 → k ≤ 20.
    expect(file.track.samples).toHaveLength(21);
    expect(file.range.endMs).toBe(1000);
    file.track.samples.forEach((s, k) => {
      const idx = Math.round((k * 50 * 24) / 1000);
      expect(s.world).toBeTruthy();
      expect(s.world![15]![1]).toBeCloseTo(-(10 + idx) / 100, 3);
    });

    const coarse = aistPoseTrack(keypoints(24, frames), CLIP, { now: NOW, stepMs: 100 }).file;
    expect(coarse.track.samples.map((s) => s.timeMs)).toEqual(
      Array.from({ length: 11 }, (_, k) => k * 100),
    );
    expect(coarse.range.endMs).toBe(1000);
  });

  it("removes a fixed clip yaw: output faces the camera and equals the unturned figure", () => {
    const fig = body({ la: 150, ra: 30 });
    const { file } = aistPoseTrack(
      keypoints(
        20,
        Array.from({ length: 10 }, () => turn(fig, 70)),
      ),
      CLIP,
      { now: NOW },
    );
    const ref = cocoToWorld(fig)!;
    for (const s of file.track.samples) {
      expect(s.world).toBeTruthy();
      expect(circ(yawOf(s.world!), 0)).toBeLessThan(0.1);
      s.world!.forEach((p, i) => {
        const r = ref[i]!;
        for (let a = 0; a < 3; a++) expect(p[a]).toBeCloseTo(r[a]!, 3);
        expect(p[3] ?? 1).toBe(r[3] ?? 1);
      });
    }
  });

  it("keeps per-frame turns relative to the mean yaw, in order", () => {
    // 20 fps and 50 ms steps: one sample per frame; yaw 60 → 80, mean 70.
    const n = 21;
    const frames = Array.from({ length: n }, (_, i) => turn(body(), 60 + (20 * i) / (n - 1)));
    const { file } = aistPoseTrack(keypoints(20, frames), CLIP, { now: NOW });
    expect(file.track.samples).toHaveLength(n);
    file.track.samples.forEach((s, i) => {
      expect(circ(yawOf(s.world!), -10 + (20 * i) / (n - 1))).toBeLessThan(0.1);
    });
  });

  it("2D landmarks in unmirrored camera space: raised left wrist on the image right", () => {
    const fig = body({ la: 170, ra: 20 });
    const { file } = aistPoseTrack(
      keypoints(
        20,
        Array.from({ length: 5 }, () => turn(fig, 25)),
      ),
      CLIP,
      { now: NOW },
    );
    const s = file.track.samples[0]!;
    const lm = s.landmarks!;
    expect(lm).toHaveLength(33);
    expect(lm[15]![0]).toBeGreaterThan(0.5); // left wrist, image right
    expect(lm[15]![1]).toBeLessThan(lm[11]![1]); // above the left shoulder (y down)
    expect(lm[16]![0]).toBeLessThan(0.5);
    expect(lm[11]![0]).toBeGreaterThan(lm[12]![0]);

    // Exactly the mirrored projection of the world points, visibility as project() gives it.
    const proj = project(fromLandmarks3d(s.world!));
    lm.forEach((p, i) => {
      const q = proj[i]!;
      expect(p[0]).toBeCloseTo(1 - q[0], 3);
      expect(p[1]).toBeCloseTo(q[1], 3);
      expect(p[2] ?? 1).toBe(q[2] ?? 1);
    });
    expect(lm[2]![2]).toBe(0); // eyes are not placed by project()

    // A camera image and its mirror image give the same angles (choreography-format#winkel).
    const angles = computeAngles(lm, { aspect: 1 });
    expectAnglesClose(angles, computeAngles(proj, { aspect: 1 }));
    expect(Math.abs(angles.leftShoulder!)).toBeGreaterThan(160);
    expect(Math.abs(angles.rightShoulder!)).toBeLessThan(40);
  });

  it("frames without an axis yield landmarks and world null", () => {
    const frames = [body(), empty(), body(), body()];
    const { file, warnings } = aistPoseTrack(keypoints(20, frames), CLIP, { now: NOW });
    expect(warnings).toEqual([]);
    expect(file.track.samples[1]).toMatchObject({ timeMs: 50, landmarks: null, world: null });
    expect(file.track.samples[0]!.landmarks).not.toBeNull();
    expect(PoseTrackFileSchema.safeParse(file).success).toBe(true);
  });

  it("warns when more than half the samples have no pose", () => {
    const frames = [body(), empty(), empty(), body(), empty(), empty(), body(), empty()];
    const { file, warnings } = aistPoseTrack(keypoints(20, frames), CLIP, { now: NOW });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.length).toBeGreaterThan(0);
    expect(PoseTrackFileSchema.safeParse(file).success).toBe(true);
  });

  it("warns when the face points backwards (z axis flipped), not for a plain turn", () => {
    const frames = Array.from({ length: 10 }, () => flipZ(body()));
    const back = aistPoseTrack(keypoints(20, frames), CLIP, { now: NOW });
    expect(back.warnings).toHaveLength(1);
    const empties = aistPoseTrack(keypoints(20, [body(), empty(), empty(), empty()]), CLIP, {
      now: NOW,
    });
    expect(empties.warnings).toHaveLength(1);
    expect(back.warnings[0]).not.toBe(empties.warnings[0]);

    // A real 180° turn keeps the face in front of the body: yaw normalisation, no warning.
    const turned = Array.from({ length: 10 }, () => turn(body(), 180));
    expect(aistPoseTrack(keypoints(20, turned), CLIP, { now: NOW }).warnings).toEqual([]);
  });

  it("throws when no sample has a pose", () => {
    expect(() =>
      aistPoseTrack(
        keypoints(
          20,
          Array.from({ length: 5 }, () => empty()),
        ),
        CLIP,
        { now: NOW },
      ),
    ).toThrow();
  });
});

describe("end to end: AIST clip to video motion source", () => {
  const BPM = 120;
  const BEAT_MS = 60000 / BPM;
  const A: BodyParams = { la: 160, ra: 20 };
  const B: BodyParams = { la: 90, ra: 90 };
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  /** Holds of A and B alternate around the odd beats, one-beat moves between. */
  function dancer(t: number): BodyParams {
    const tau = Math.max(0, t - BEAT_MS);
    const w = Math.floor(tau / (2 * BEAT_MS));
    const s = smooth((tau - w * 2 * BEAT_MS - BEAT_MS / 2) / BEAT_MS);
    const [p, q] = w % 2 === 0 ? [A, B] : [B, A];
    return {
      la: p.la! + (q.la! - p.la!) * s,
      ra: p.ra! + (q.ra! - p.ra!) * s,
    };
  }

  it("8 s at 60 fps parses as a pose track and feeds videoMotionSource", () => {
    const fps = 60;
    const frames = Array.from({ length: 8 * fps }, (_, i) =>
      turn(body(dancer((i * 1000) / fps)), 30),
    );
    expect(AistKeypointsSchema.safeParse({ fps, joints: frames }).success).toBe(true);
    const { file, warnings } = aistPoseTrack(keypoints(fps, frames), CLIP, { now: NOW });
    expect(warnings).toEqual([]);
    expect(PoseTrackFileSchema.parse(file)).toBeTruthy();
    expect(file.range.endMs).toBeGreaterThan(7900);

    const res = videoMotionSource(file);
    const ids = [...res.source.clips.map((c) => c.id), ...res.rejected.map((r) => r.id)];
    expect(res.source.clips.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith("video:aist-")).toBe(true);
    expect(res.source.sequences.flat().sort()).toEqual([...ids].sort());
  });
});
