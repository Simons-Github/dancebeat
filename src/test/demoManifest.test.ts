import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import packJson from "@/data/motion-pack.json";
import {
  DemoManifestSchema,
  SECTION_KINDS,
  unknownClipIds,
  type DemoManifest,
} from "@/lib/demoManifest";
import { MotionPackSchema } from "@/lib/schema";
import { SONG_PALETTES } from "@/theme";

const pack = MotionPackSchema.parse(packJson);
const knownClip = pack.clips[0]?.id ?? "";

/** 120 BPM: one beat = 500 ms; 4 sections of 16 beats end at 100 + 64 * 500 = 32 100 ms. */
const valid = (): DemoManifest => ({
  version: 1,
  id: "demo-test-song",
  title: "Test Song",
  artist: "DanceBeat Original",
  audio: "Test_Song.mp3",
  palette: 0,
  difficulty: 2,
  bpm: 120,
  beatPhaseMs: 100,
  durationMs: 33_000,
  sections: [
    { kind: "intro", beats: 16 },
    { kind: "verse", beats: 16 },
    { kind: "chorus", beats: 16 },
    { kind: "outro", beats: 16 },
  ],
  phrases: { intro: "auto", verse: [knownClip], chorus: "auto", outro: "auto" },
  gold: [{ section: 2, beat: 12 }],
});

const messages = (input: unknown) => {
  const res = DemoManifestSchema.safeParse(input);
  return res.success ? [] : res.error.issues.map((i) => i.message);
};

describe("DemoManifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(messages(valid())).toEqual([]);
    expect(SECTION_KINDS).toContain("prechorus");
  });

  it("rejects a section kind without phrase", () => {
    const m = valid();
    delete m.phrases.verse;
    expect(messages(m)).toEqual(["section kind verse has no phrase"]);
  });

  it("rejects an empty clip list and unknown phrase keys", () => {
    expect(messages({ ...valid(), phrases: { ...valid().phrases, verse: [] } })).not.toEqual([]);
    expect(messages({ ...valid(), phrases: { ...valid().phrases, hook: "auto" } })).not.toEqual([]);
  });

  it("rejects beats that are not a multiple of 4", () => {
    const m = valid();
    m.sections[1] = { kind: "verse", beats: 14 };
    expect(messages(m)).toContain("beats must be a multiple of 4");
  });

  it("rejects gold moves outside the sections", () => {
    expect(messages({ ...valid(), gold: [{ section: 4, beat: 0 }] })).toEqual([
      "gold section 4 does not exist (4 sections)",
    ]);
    expect(messages({ ...valid(), gold: [{ section: 2, beat: 16 }] })).toEqual([
      "gold beat 16 is outside section 2 (16 beats)",
    ]);
    expect(messages({ ...valid(), gold: [{ section: 2, beat: 15 }] })).toEqual([]);
  });

  it("rejects gold moves in intro or outro and duplicates", () => {
    expect(messages({ ...valid(), gold: [{ section: 0, beat: 4 }] })).toEqual([
      "gold section 0 is an intro (no moves there)",
    ]);
    expect(messages({ ...valid(), gold: [{ section: 3, beat: 4 }] })).toEqual([
      "gold section 3 is an outro (no moves there)",
    ]);
    const twice = { section: 2, beat: 12 };
    expect(messages({ ...valid(), gold: [twice, { ...twice }] })).toEqual(["duplicate gold 2:12"]);
  });

  it("allows the intro only first and the outro only last", () => {
    const [intro, verse, chorus, outro] = valid().sections;
    expect(messages({ ...valid(), sections: [verse, intro, chorus, outro] })).toEqual([
      "intro must be the first section",
    ]);
    expect(messages({ ...valid(), sections: [intro, outro, verse, chorus], gold: [] })).toEqual([
      "outro must be the last section",
    ]);
  });

  it("rejects misspelled keys", () => {
    expect(messages({ ...valid(), golds: [] })).not.toEqual([]);
    expect(messages({ ...valid(), sections: [{ kind: "verse", beats: 16, bars: 4 }] })).not.toEqual(
      [],
    );
    expect(messages({ ...valid(), gold: [{ section: 2, beat: 12, label: "x" }] })).not.toEqual([]);
  });

  it("rejects sections longer than the song", () => {
    expect(messages({ ...valid(), durationMs: 32_100 })).toEqual([]);
    expect(messages({ ...valid(), durationMs: 32_099 })).toEqual([
      "sections end at 32100 ms, after the song (32099 ms)",
    ]);
  });

  it("rejects a beat phase of one beat or more", () => {
    expect(messages({ ...valid(), beatPhaseMs: 500, durationMs: 40_000 })).toEqual([
      "beatPhaseMs must be below one beat (500.0 ms)",
    ]);
  });

  it("rejects a palette index outside SONG_PALETTES", () => {
    expect(messages({ ...valid(), palette: SONG_PALETTES.length - 1 })).toEqual([]);
    expect(messages({ ...valid(), palette: SONG_PALETTES.length })).not.toEqual([]);
    expect(messages({ ...valid(), palette: -1 })).not.toEqual([]);
  });

  it("rejects bad ids and audio file names", () => {
    expect(messages({ ...valid(), id: "test-song" })).not.toEqual([]);
    expect(messages({ ...valid(), audio: "../secret.mp3" })).not.toEqual([]);
    expect(messages({ ...valid(), audio: "song.wav" })).not.toEqual([]);
  });
});

describe("unknownClipIds", () => {
  it("accepts clip ids from the pack", () => {
    expect(knownClip).not.toBe("");
    expect(unknownClipIds({ ...valid(), moveNames: { [knownClip]: "Kick" } }, pack)).toEqual([]);
  });

  it("finds unknown ids in phrases and moveNames", () => {
    const m: DemoManifest = {
      ...valid(),
      phrases: { ...valid().phrases, chorus: ["zz:missing", knownClip, "aa:missing"] },
      moveNames: { "mm:missing": "Name", [knownClip]: "Kick" },
    };
    expect(unknownClipIds(m, pack)).toEqual(["aa:missing", "mm:missing", "zz:missing"]);
  });
});

describe("shipped demo manifests", () => {
  const root = path.resolve(__dirname, "../..");
  const dir = path.join(root, "src/data/demos");
  const files = readdirSync(dir).filter((f) => f.endsWith(".manifest.json"));
  const manifests = files.map((f) => ({
    file: f,
    manifest: DemoManifestSchema.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))),
  }));

  it("are four valid manifests with unique ids named after their slug", () => {
    expect(files).toHaveLength(4);
    const ids = manifests.map((m) => m.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { file, manifest } of manifests)
      expect(`${manifest.id}.manifest.json`).toBe(`demo-${file}`);
  });

  it("use only clip ids from the shipped motion pack", () => {
    for (const { manifest } of manifests) expect(unknownClipIds(manifest, pack)).toEqual([]);
  });

  it("reference distinct audio files", () => {
    const audio = manifests.map((m) => m.manifest.audio);
    expect(new Set(audio).size).toBe(audio.length);
  });

  // The MP3s are not committed yet (they arrive with 14a-2); in a checkout without any MP3 only the
  // file-name pattern (schema) is checked. Drop the condition once they are in the repo.
  const audioDir = path.join(root, "public/demo-audio");
  const haveAudio = existsSync(audioDir) && readdirSync(audioDir).some((f) => f.endsWith(".mp3"));
  it.runIf(haveAudio)("reference existing files in public/demo-audio", () => {
    for (const { manifest } of manifests)
      expect(existsSync(path.join(audioDir, manifest.audio)), manifest.audio).toBe(true);
  });
});
