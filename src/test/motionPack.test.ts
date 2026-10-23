import { describe, expect, it } from "vitest";
import { DEMO_POSES, DEMO_SEQUENCES } from "@/data/demo";
import committed from "@/data/motion-pack.json";
import {
  assignMirrors,
  boneDistance,
  buildMotionPack,
  checkFloorWork,
  checkMeasurable,
  checkSpeed,
  checkYaw,
  clipsFromPoses,
  countTransitions,
  demoMotionSource,
  difficulty,
  energy,
  groupClips,
  isAistClip,
  loadMotionPack,
  MAX_BONE_SPEED_DEG_PER_S,
  playability,
  selectShippedClips,
  SHIP_CLIPS_PER_BUCKET,
  type RawClip,
  withoutAistClips,
} from "@/lib/motionPack";
import { figure3d, type FigureParams } from "@/lib/pose";
import { MOTION_PACK_VERSION, MotionPackSchema } from "@/lib/schema";
import type { Skeleton3D } from "@/lib/skeleton";
import type { MotionClip, MotionPack } from "@/lib/types";

const NEUTRAL = figure3d({ la: 10, ra: 10 });

const pose = (p: FigureParams, change?: (sk: Skeleton3D) => void): Skeleton3D => {
  const sk = figure3d(p);
  change?.(sk);
  return sk;
};

const rawClip = (id: string, sk: Skeleton3D, extra: Partial<RawClip> = {}): RawClip => ({
  id,
  label: id,
  styles: ["party"],
  beats: 1,
  anchorBeat: 0,
  keyframes: [
    { beat: 0, pose3d: sk },
    { beat: 1, pose3d: sk },
  ],
  source: "test",
  ...extra,
});

const clip = (id: string, extra: Partial<MotionClip> = {}): MotionClip => ({
  ...rawClip(id, figure3d({ la: 10, ra: 10 })),
  difficulty: 1,
  energy: 0.5,
  playability: 1,
  ...extra,
});

const pack = (clips: MotionClip[], transitions: MotionPack["transitions"] = {}): MotionPack => ({
  version: MOTION_PACK_VERSION,
  clips,
  transitions,
});

describe("MotionPackSchema", () => {
  it("accepts a valid pack with a mirror pair and transitions", () => {
    const p = pack([clip("a", { mirrorOf: "b" }), clip("b", { mirrorOf: "a" }), clip("c")], {
      party: { a: { b: 2, c: 1 } },
    });
    expect(MotionPackSchema.safeParse(p).success).toBe(true);
  });

  it("rejects transitions to unknown clips", () => {
    const p = pack([clip("a")], { party: { a: { x: 1 } } });
    expect(MotionPackSchema.safeParse(p).success).toBe(false);
  });

  it("rejects transitions of a style the clips do not have", () => {
    const p = pack([clip("a"), clip("b", { styles: ["hiphop"] })], { party: { a: { b: 1 } } });
    expect(MotionPackSchema.safeParse(p).success).toBe(false);
    const q = pack([clip("a"), clip("b", { styles: ["hiphop"] })], { party: { b: { a: 1 } } });
    expect(MotionPackSchema.safeParse(q).success).toBe(false);
  });

  it("rejects non-positive transition weights", () => {
    const p = pack([clip("a"), clip("b")], { party: { a: { b: 0 } } });
    expect(MotionPackSchema.safeParse(p).success).toBe(false);
  });

  it("rejects mirrorOf to a missing, own or non-reciprocal clip", () => {
    expect(MotionPackSchema.safeParse(pack([clip("a", { mirrorOf: "x" })])).success).toBe(false);
    expect(MotionPackSchema.safeParse(pack([clip("a", { mirrorOf: "a" })])).success).toBe(false);
    const oneSided = pack([clip("a", { mirrorOf: "b" }), clip("b")]);
    expect(MotionPackSchema.safeParse(oneSided).success).toBe(false);
  });

  it("rejects duplicate ids", () => {
    expect(MotionPackSchema.safeParse(pack([clip("a"), clip("a")])).success).toBe(false);
  });

  it("rejects keyframe beats out of range or not ascending, and a late anchor", () => {
    const kf = (beat: number) => ({ beat, pose3d: NEUTRAL });
    const bad = [
      { keyframes: [kf(0), kf(2)] },
      { keyframes: [kf(1), kf(0)] },
      { keyframes: [kf(0), kf(0)] },
      { keyframes: [] },
      { anchorBeat: 2 },
    ];
    for (const extra of bad)
      expect(MotionPackSchema.safeParse(pack([clip("a", extra)])).success).toBe(false);
  });
});

describe("metrics", () => {
  it("boneDistance is the largest bone angle and Infinity with missing bones", () => {
    const a = figure3d({ la: 10, ra: 10 });
    const b = figure3d({ la: 50, ra: 20 });
    expect(boneDistance(a, b)).toBeCloseTo(40, 6);
    const partial = pose({ la: 10, ra: 10 }, (sk) => delete sk.bones.leftShin);
    expect(boneDistance(a, partial)).toBe(Infinity);
    // The facing counts too: the same pose turned by 40° is 40° away.
    const turned = pose({ la: 10, ra: 10 }, (sk) => (sk.root.yawDeg = 40));
    expect(boneDistance(a, turned)).toBeCloseTo(40, 6);
  });

  it("playability: flat poses are fully measurable, a bone at the camera costs two angles", () => {
    for (const { p } of Object.values(DEMO_POSES)) expect(playability(figure3d(p))).toBe(1);
    // Left upper arm toward the camera: left shoulder and left elbow (its reference) drop out.
    const forward = pose({ la: 10, ra: 10 }, (sk) => (sk.bones.leftUpperArm = [0, 0, 1]));
    expect(playability(forward)).toBe(0.75);
  });

  it("energy and difficulty relative to neutral", () => {
    expect(energy(NEUTRAL, NEUTRAL)).toBeCloseTo(0, 6);
    expect(energy(figure3d({ la: 170, ra: 170 }), NEUTRAL)).toBeGreaterThan(0.5);
    expect(difficulty(figure3d({ la: 90, ra: 90 }), NEUTRAL)).toBe(1);
    expect(difficulty(figure3d({ la: 10, ra: 10, ll: 50 }), NEUTRAL)).toBe(2);
  });
});

describe("filters", () => {
  const ok = rawClip("ok", figure3d({ la: 90, ra: 90 }));

  it("pass a regular demo clip", () => {
    for (const f of [checkMeasurable, checkYaw, checkFloorWork, checkSpeed])
      expect(f(ok)).toBeNull();
  });

  it("measurable: rejects a pose with arms and thighs pointing at the camera", () => {
    const sk = pose({ la: 10, ra: 10 }, (s) => {
      s.bones.leftUpperArm = [0, 0, 1];
      s.bones.rightUpperArm = [0, 0, 1];
      s.bones.leftThigh = [0, 0, 1];
      s.bones.rightThigh = [0, 0, 1];
    });
    expect(checkMeasurable(rawClip("x", sk))).toMatch(/0 sicher messbare/);
  });

  it("yaw: rejects 60° at any keyframe, accepts 45°", () => {
    const turned = (yawDeg: number) => pose({ la: 90, ra: 90 }, (s) => (s.root.yawDeg = yawDeg));
    const bad = rawClip("x", NEUTRAL, {
      keyframes: [
        { beat: 0, pose3d: NEUTRAL },
        { beat: 1, pose3d: turned(-60) },
      ],
    });
    expect(checkYaw(bad)).toMatch(/60°/);
    expect(checkYaw(rawClip("y", turned(45)))).toBeNull();
    expect(checkYaw(rawClip("z", turned(400)))).toBeNull(); // 400° = 40°
  });

  it("floor work: rejects lying, sitting, kneeling and raised knees, accepts the demo squat", () => {
    const base = { la: 90, ra: 90 };
    const lyingOnSide = pose(base, (s) => (s.bones.torso = [1, 0, 0]));
    const sitting = pose(base, (s) => {
      s.bones.leftThigh = [0, 0, 1];
      s.bones.rightThigh = [0, 0, 1];
    });
    // Thighs straight down, shins flat backward: pelvis at half the leg length.
    const kneeling = pose(base, (s) => {
      s.bones.leftThigh = [0, -1, 0];
      s.bones.rightThigh = [0, -1, 0];
      s.bones.leftShin = [0, 0, -1];
      s.bones.rightShin = [0, 0, -1];
    });
    const kneesAbovePelvis = pose(base, (s) => {
      s.bones.leftThigh = [0.3, 0.3, 0.906];
      s.bones.rightThigh = [-0.3, 0.3, 0.906];
    });
    expect(checkFloorWork(rawClip("side", lyingOnSide))).toMatch(/Rumpf/);
    expect(checkFloorWork(rawClip("sit", sitting))).toMatch(/Knie nicht unter/);
    expect(checkFloorWork(rawClip("kneel", kneeling))).toMatch(/Hüfte zu tief/);
    expect(checkFloorWork(rawClip("knees", kneesAbovePelvis))).toMatch(/Knie nicht unter/);
    // A single raised knee (thigh horizontal) is a standing move, not floor work.
    const kneeLift = pose(base, (s) => (s.bones.leftThigh = [0, 0, 1]));
    expect(checkFloorWork(rawClip("lift", kneeLift))).toBeNull();
    for (const id of ["squat", "kick-l", "star"])
      expect(checkFloorWork(rawClip(id, figure3d(DEMO_POSES[id]!.p)))).toBeNull();
  });

  it("speed: rejects a fast swing, uses sourceBpm or the fallback tempo", () => {
    const up = figure3d({ la: 170, ra: 10 });
    // Left arm 160° in a quarter beat: 0.1 s at 150 BPM = 1600°/s.
    const fast = rawClip("x", NEUTRAL, {
      keyframes: [
        { beat: 0, pose3d: NEUTRAL },
        { beat: 0.25, pose3d: up },
      ],
    });
    expect(checkSpeed(fast)).toMatch(new RegExp(`höchstens ${MAX_BONE_SPEED_DEG_PER_S}`));
    // Same swing over a full beat at 60 BPM: 160°/s.
    const slow = { ...fast, keyframes: [fast.keyframes[0]!, { beat: 1, pose3d: up }] };
    expect(checkSpeed({ ...slow, sourceBpm: 60 })).toBeNull();
    // At 300 BPM one beat is 0.2 s: 800°/s.
    expect(checkSpeed({ ...slow, sourceBpm: 300 })).not.toBeNull();
  });

  it("speed: counts a fast turn of the whole body", () => {
    const tPose = figure3d({ la: 90, ra: 90 });
    const turned = pose({ la: 90, ra: 90 }, (s) => (s.root.yawDeg = 40));
    // 40° in a tenth of a beat at 150 BPM (0.04 s) = 1000°/s, bones unchanged in the body.
    const fast = rawClip("x", tPose, {
      keyframes: [
        { beat: 0, pose3d: tPose },
        { beat: 0.1, pose3d: turned },
      ],
    });
    expect(checkSpeed(fast)).toMatch(/1000°\/s/);
    expect(
      checkSpeed({ ...fast, keyframes: [fast.keyframes[0]!, { beat: 1, pose3d: turned }] }),
    ).toBeNull();
  });
});

describe("grouping and mirrors", () => {
  it("merges near-duplicates and keeps the medoid", () => {
    const clips = [
      rawClip("a", figure3d({ la: 90, ra: 90 })),
      rawClip("b", figure3d({ la: 98, ra: 90 })),
      rawClip("c", figure3d({ la: 106, ra: 90 })),
      rawClip("d", figure3d({ la: 170, ra: 170 })),
    ];
    const { kept, idMap } = groupClips(clips, 20);
    expect(kept.map((c) => c.id)).toEqual(["b", "d"]);
    expect(Object.fromEntries(idMap)).toEqual({ a: "b", b: "b", c: "b", d: "d" });
  });

  it("groups only clips with the same length and styles", () => {
    const sk = figure3d({ la: 90, ra: 90 });
    const clips = [
      rawClip("a", sk),
      rawClip("b", sk, { beats: 4, keyframes: [{ beat: 0, pose3d: sk }] }),
      rawClip("c", sk, { styles: ["hiphop"] }),
      rawClip("d", sk, { styles: ["party", "party"] }),
    ];
    const { kept, idMap } = groupClips(clips);
    expect(kept.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(idMap.get("d")).toBe("a");
  });

  it("keeps every demo pose", () => {
    const clips = clipsFromPoses(DEMO_POSES);
    expect(groupClips(clips).kept).toHaveLength(Object.keys(DEMO_POSES).length);
  });

  it("pairs exactly the left/right demo poses", () => {
    const mirrored = assignMirrors(clipsFromPoses(DEMO_POSES));
    const pairs = Object.fromEntries(
      mirrored.filter((c) => c.mirrorOf).map((c) => [c.id, c.mirrorOf]),
    );
    expect(pairs).toEqual({
      "demo:left-up": "demo:right-up",
      "demo:right-up": "demo:left-up",
      "demo:disco-l": "demo:disco-r",
      "demo:disco-r": "demo:disco-l",
      "demo:kick-l": "demo:kick-r",
      "demo:kick-r": "demo:kick-l",
    });
  });

  it("keeps only reciprocal mirror matches", () => {
    // mirror(A) is closest to B (3°), but mirror(B) matches C exactly: only B and C pair up.
    const clips = [
      rawClip("A", figure3d({ la: 160, ra: 20 })),
      rawClip("B", figure3d({ la: 20, ra: 163 })),
      rawClip("C", figure3d({ la: 163, ra: 20 })),
    ];
    const byId = Object.fromEntries(assignMirrors(clips).map((c) => [c.id, c.mirrorOf]));
    expect(byId).toEqual({ A: undefined, B: "C", C: "B" });
  });

  it("requires the same length for a mirror pair", () => {
    const left = figure3d({ la: 160, ra: 20 });
    const right = figure3d({ la: 20, ra: 160 });
    const twoBeats = assignMirrors([rawClip("l", left), rawClip("r", right, { beats: 2 })]);
    expect(twoBeats.every((c) => c.mirrorOf === undefined)).toBe(true);
  });
});

describe("countTransitions", () => {
  it("counts mapped pairs and skips dropped ids", () => {
    const idMap = new Map([
      ["a", "a"],
      ["a2", "a"],
      ["b", "b"],
    ]);
    const counts = countTransitions(
      [
        ["a", "b", "a2", "b"],
        ["b", "x", "a"],
      ],
      "party",
      idMap,
    );
    expect(counts).toEqual({ party: { a: { b: 2 }, b: { a: 1 } } });
  });
});

describe("buildMotionPack", () => {
  const neutral = figure3d(DEMO_POSES["neutral"]!.p);
  const demo = () =>
    buildMotionPack({ sources: [demoMotionSource(DEMO_POSES, DEMO_SEQUENCES)], neutral });

  it("builds a valid pack from the demo poses without rejections", () => {
    const { pack, rejected } = demo();
    expect(rejected).toEqual([]);
    expect(pack.clips.map((c) => c.id)).toEqual(
      Object.keys(DEMO_POSES)
        .map((id) => `demo:${id}`)
        .sort(),
    );
    expect(MotionPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.transitions["party"]?.["demo:left-up"]?.["demo:right-up"]).toBe(3);
  });

  it("reports rejected clips with their reason", () => {
    const turned = pose({ la: 90, ra: 90 }, (s) => (s.root.yawDeg = 90));
    const { pack, rejected } = buildMotionPack({
      sources: [
        {
          clips: [rawClip("ok", NEUTRAL), rawClip("turned", turned)],
          sequences: [["ok", "turned", "ok"]],
          style: "s",
        },
      ],
      neutral,
    });
    expect(pack.clips.map((c) => c.id)).toEqual(["ok"]);
    expect(rejected.map((r) => r.id)).toEqual(["turned"]);
    expect(pack.transitions).toEqual({ s: {} });
  });

  it("committed src/data/motion-pack.json has up-to-date demo clips and a valid AIST subset", () => {
    const shipped = MotionPackSchema.parse(committed);
    const reproduce =
      "src/data/motion-pack.json ist veraltet: " +
      "`bun run build-motion-pack -- --ship eval-results/aist/*.posetrack.json` ausführen";
    expect(withoutAistClips(shipped), reproduce).toEqual(demo().pack);
    const buckets = new Map<string, number>();
    for (const c of shipped.clips.filter(isAistClip)) {
      const key = `${c.sourceBpm}/${c.difficulty}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    expect(buckets.size).toBeGreaterThan(0);
    for (const n of buckets.values()) expect(n).toBeLessThanOrEqual(SHIP_CLIPS_PER_BUCKET);
  });

  it("loadMotionPack parses the shipped pack", async () => {
    const loaded = await loadMotionPack();
    expect(loaded.version).toBe(MOTION_PACK_VERSION);
    expect(loaded.clips.filter((c) => !isAistClip(c))).toHaveLength(Object.keys(DEMO_POSES).length);
    expect(loaded.clips.length).toBe(MotionPackSchema.parse(committed).clips.length);
    expect(await loadMotionPack()).toBe(loaded);
  });
});

describe("selectShippedClips", () => {
  const AIST = "video:AIST++ test";
  /** AIST clip with the given arm angles, tempo and difficulty. */
  const aist = (id: string, p: FigureParams, extra: Partial<MotionClip> = {}): MotionClip => ({
    ...clip(id, { source: AIST, sourceBpm: 120, ...extra }),
    keyframes: [
      { beat: 0, pose3d: figure3d(p) },
      { beat: 1, pose3d: figure3d(p) },
    ],
  });
  const ids = (p: MotionPack) => p.clips.map((c) => c.id);

  it("keeps every non-AIST clip and drops AIST rest poses", () => {
    const p = pack([
      clip("demo:a", { source: "demo" }),
      clip("video:other", { source: "video:Fremdvideo", energy: 0.05 }),
      aist("x:rest", { la: 10, ra: 10 }, { energy: 0.05 }),
      aist("x:move", { la: 90, ra: 90 }),
    ]);
    expect(ids(selectShippedClips(p))).toEqual(["demo:a", "video:other", "x:move"]);
  });

  it("caps every (sourceBpm, difficulty) bucket separately, keeping the pack order", () => {
    const clips = [10, 40, 70, 100, 130, 160].flatMap((la) => [
      aist(`a:${la}`, { la, ra: 10 }),
      aist(`b:${la}`, { la, ra: 10 }, { sourceBpm: 90 }),
      aist(`c:${la}`, { la, ra: 10 }, { difficulty: 2 }),
    ]);
    const shipped = selectShippedClips(pack(clips), 2);
    expect(shipped.clips).toHaveLength(6);
    for (const prefix of ["a:", "b:", "c:"])
      expect(shipped.clips.filter((c) => c.id.startsWith(prefix))).toHaveLength(2);
    const order = clips.map((c) => c.id).filter((id) => ids(shipped).includes(id));
    expect(ids(shipped)).toEqual(order);
  });

  it("starts with the most playable clip, then picks the farthest pose", () => {
    const p = pack([
      aist("a", { la: 90, ra: 90 }, { playability: 0.75 }),
      aist("b", { la: 100, ra: 90 }),
      aist("c", { la: 110, ra: 90 }),
      aist("d", { la: 170, ra: 170 }),
    ]);
    // b is the most playable of the energy ties (smallest id), d is farthest from b.
    expect(ids(selectShippedClips(p, 2))).toEqual(["b", "d"]);
    // Third pick: a and c are both 10° from b, their nearest pick; the tie goes to the smaller id.
    expect(ids(selectShippedClips(p, 3))).toEqual(["a", "b", "d"]);
  });

  it("is deterministic and independent of the input order for the picks", () => {
    const clips = [20, 50, 80, 110, 140, 170].map((la, i) =>
      aist(`x:${i}`, { la, ra: 180 - la }, { energy: 0.2 + i * 0.05 }),
    );
    const a = selectShippedClips(pack(clips), 3);
    const b = selectShippedClips(pack([...clips].reverse()), 3);
    expect(selectShippedClips(pack(clips), 3)).toEqual(a);
    expect([...ids(b)].sort()).toEqual([...ids(a)].sort());
  });

  it("drops mirrors and transitions of dropped clips and stays schema-valid", () => {
    const p = pack(
      [
        clip("demo:a", { source: "demo" }),
        aist("x:1", { la: 90, ra: 10 }, { mirrorOf: "x:2" }),
        aist("x:2", { la: 10, ra: 90 }, { mirrorOf: "x:1" }),
        aist("x:3", { la: 170, ra: 170 }),
      ],
      { party: { "demo:a": { "x:1": 2 }, "x:3": { "x:2": 1, "demo:a": 1 }, "x:1": { "x:2": 1 } } },
    );
    expect(MotionPackSchema.safeParse(p).success).toBe(true);
    // All tie on playability and energy: x:1 first, then x:3 (160° away, x:2 only 80°).
    const shipped = selectShippedClips(p, 2);
    expect(ids(shipped)).toEqual(["demo:a", "x:1", "x:3"]);
    expect(shipped.clips.find((c) => c.id === "x:1")?.mirrorOf).toBeUndefined();
    expect(shipped.transitions).toEqual({
      party: { "demo:a": { "x:1": 2 }, "x:3": { "demo:a": 1 } },
    });
    expect(MotionPackSchema.safeParse(shipped).success).toBe(true);
    expect(withoutAistClips(p)).toEqual(pack([clip("demo:a", { source: "demo" })], {}));
  });
});
