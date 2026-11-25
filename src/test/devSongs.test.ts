import { describe, expect, it } from "vitest";

import { buildDevSong, DEV_SONG_IDS, parseDevSong } from "@/data/devSongs";
import packJson from "@/data/motion-pack.json";
import { MotionPackSchema, SongSchema } from "@/lib/schema";

const PACK = MotionPackSchema.parse(packJson);

describe("parseDevSong", () => {
  it("returns null without or with unknown parameter", () => {
    expect(parseDevSong({})).toBeNull();
    expect(parseDevSong({ devsong: "foo:bar" })).toBeNull();
    expect(parseDevSong({ devsong: 5 })).toBeNull();
  });

  it("parses clear", () => {
    expect(parseDevSong({ devsong: "clear" })).toEqual({ kind: "clear" });
  });

  it("parses a YouTube id and a link, with defaults", () => {
    const spec = { kind: "youtube", videoId: "aaaaaaaaaaa", bpm: 120, lenSec: 180 };
    expect(parseDevSong({ devsong: "youtube:aaaaaaaaaaa" })).toEqual(spec);
    expect(parseDevSong({ devsong: "youtube:https://youtu.be/aaaaaaaaaaa" })).toEqual(spec);
  });

  it("rejects an invalid YouTube id", () => {
    expect(parseDevSong({ devsong: "youtube:zu-kurz" })).toBeNull();
  });

  it("accepts http(s) URLs and rejects other schemes", () => {
    expect(parseDevSong({ devsong: "url:https://example.com/a.mp3" })).toMatchObject({
      kind: "url",
      url: "https://example.com/a.mp3",
    });
    expect(parseDevSong({ devsong: "url:javascript:alert(1)" })).toBeNull();
    expect(parseDevSong({ devsong: "url:file:///etc/passwd" })).toBeNull();
    expect(parseDevSong({ devsong: "url:kein link" })).toBeNull();
  });

  it("clamps bpm and len, accepting numbers and strings", () => {
    expect(parseDevSong({ devsong: "youtube:aaaaaaaaaaa", bpm: 5, len: 5000 })).toMatchObject({
      bpm: 30,
      lenSec: 600,
    });
    expect(parseDevSong({ devsong: "youtube:aaaaaaaaaaa", bpm: "999", len: "2" })).toMatchObject({
      bpm: 300,
      lenSec: 10,
    });
    expect(parseDevSong({ devsong: "youtube:aaaaaaaaaaa", bpm: "x" })).toMatchObject({ bpm: 120 });
  });
});

describe("buildDevSong", () => {
  it("builds a schema-valid YouTube song in the fixed slot", () => {
    const song = buildDevSong(
      { kind: "youtube", videoId: "aaaaaaaaaaa", bpm: 100, lenSec: 60 },
      1000,
      PACK,
    );
    expect(SongSchema.safeParse(song).success).toBe(true);
    expect(song.id).toBe(DEV_SONG_IDS.youtube);
    expect(song.title).toBe("Dev: YouTube");
    expect(song.source).toEqual({ type: "youtube", videoId: "aaaaaaaaaaa" });
    expect(song.choreo.moves.length).toBeGreaterThan(0);
  });

  it("builds a URL song in its own slot", () => {
    const song = buildDevSong(
      { kind: "url", url: "https://example.com/a.mp3", bpm: 120, lenSec: 30 },
      1000,
      PACK,
    );
    expect(song.id).toBe(DEV_SONG_IDS.url);
    expect(song.id).not.toBe(DEV_SONG_IDS.youtube);
    expect(song.source).toEqual({ type: "url", url: "https://example.com/a.mp3" });
  });
});
