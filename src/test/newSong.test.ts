import { describe, expect, it } from "vitest";

import { autoChoreo } from "@/data/demo";
import { analyzeAudio, DECODE_ERROR_MESSAGE } from "@/lib/beat";
import { buildChoreoFile, parseChoreoFile } from "@/lib/library/choreoFile";
import {
  buildNewSong,
  formatBpm,
  parseSpotifyTrackUri,
  parseYouTubeId,
  validateAudioUrl,
  validateNewSongFields,
  type NewSongInput,
} from "@/lib/library/newSong";
import { SongSchema } from "@/lib/schema";
import { makeSong } from "./fixtures";

const ID = "dQw4w9WgXcQ";

describe("formatBpm", () => {
  it("shows at most one fraction digit, German style", () => {
    expect(formatBpm(128)).toBe("128");
    expect(formatBpm(123.4)).toBe("123,4");
    expect(formatBpm(97.25)).toBe("97,3");
    expect(formatBpm(120.04)).toBe("120");
  });
});

describe("parseYouTubeId", () => {
  it.each([
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`,
    `youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}?start=3`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  ${ID}  `,
  ])("accepts %s", (input) => {
    expect(parseYouTubeId(input)).toBe(ID);
  });

  it.each([
    "",
    "kurz",
    "dQw4w9WgXcQ1",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/playlist?list=PL1234567890A",
    "https://evil.com/youtu.be/dQw4w9WgXcQ",
    "ftp://youtu.be/dQw4w9WgXcQ",
    "javascript:alert(1)",
  ])("rejects %j", (input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });
});

const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const TRACK_URI = `spotify:track:${TRACK}`;

describe("parseSpotifyTrackUri", () => {
  it.each([
    TRACK_URI,
    `  ${TRACK_URI}  `,
    `https://open.spotify.com/track/${TRACK}`,
    `https://open.spotify.com/track/${TRACK}?si=abc123&utm_source=copy-link`,
    `https://open.spotify.com/track/${TRACK}/`,
    `https://open.spotify.com/intl-de/track/${TRACK}`,
    `https://open.spotify.com/intl-pt-BR/track/${TRACK}?si=x`,
    `https://play.spotify.com/track/${TRACK}`,
    `open.spotify.com/track/${TRACK}`,
    `https://OPEN.SPOTIFY.COM/track/${TRACK}`,
  ])("akzeptiert %s", (input) => {
    expect(parseSpotifyTrackUri(input)).toBe(TRACK_URI);
  });

  it.each([
    "",
    "   ",
    TRACK,
    `spotify:album:${TRACK}`,
    `spotify:playlist:${TRACK}`,
    `spotify:track:${TRACK}1`,
    `spotify:track:${TRACK.slice(1)}`,
    `spotify:track:${TRACK.slice(1)}_`,
    `https://open.spotify.com/album/${TRACK}`,
    `https://open.spotify.com/playlist/${TRACK}`,
    `https://open.spotify.com/artist/${TRACK}`,
    `https://open.spotify.com/track/${TRACK}1`,
    `https://open.spotify.com/track/${TRACK.slice(2)}`,
    "https://open.spotify.com/track/",
    `https://open.spotify.com/embed/track/${TRACK}`,
    `https://example.com/track/${TRACK}`,
    `https://open.spotify.com.evil.com/track/${TRACK}`,
    `https://evil.com/open.spotify.com/track/${TRACK}`,
    `ftp://open.spotify.com/track/${TRACK}`,
    `spotify://track/${TRACK}`,
    "javascript:alert(1)",
  ])("lehnt %j ab", (input) => {
    expect(parseSpotifyTrackUri(input)).toBeNull();
  });
});

describe("validateAudioUrl", () => {
  it("accepts https, and http only for local hosts", () => {
    expect(validateAudioUrl(" https://example.com/a.mp3 ")).toEqual({
      ok: true,
      url: "https://example.com/a.mp3",
    });
    expect(validateAudioUrl("http://localhost:3000/a.wav").ok).toBe(true);
    expect(validateAudioUrl("http://127.0.0.1:5173/a.wav").ok).toBe(true);
    expect(validateAudioUrl("http://[::1]:5173/a.wav").ok).toBe(true);
    expect(validateAudioUrl("http://example.com/a.mp3")).toEqual({
      ok: false,
      error: "Bitte eine https-Adresse verwenden.",
    });
  });
  it.each(["", "example.com/a.mp3", "ftp://example.com/a.mp3", "javascript:alert(1)", "file:///a"])(
    "rejects %j with a German message",
    (input) => {
      const r = validateAudioUrl(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("Bitte eine https-Adresse verwenden.");
    },
  );
});

const base: Omit<NewSongInput, "source" | "choreo"> = {
  title: "  Mein Song ",
  artist: "Ich",
  bpm: 120,
  difficulty: 2,
  durationMs: 60_000,
  colors: ["#FF2E93", "#00E5FF"],
};

describe("buildNewSong", () => {
  it("builds a local song with a fresh blobId and an auto choreography", () => {
    const song = buildNewSong({ ...base, source: { kind: "file" }, choreo: { type: "auto" } });
    expect(SongSchema.safeParse(song).success).toBe(true);
    expect(song.title).toBe("Mein Song");
    expect(song.source.type).toBe("local");
    if (song.source.type === "local") expect(song.source.blobId.length).toBeGreaterThan(0);
    expect(song.choreo.moves.length).toBeGreaterThan(4);
    expect(song.choreo.accentColor).toBe("#FF2E93");
    expect(song.syncOffsetMs).toBe(0);
    expect(song.startOffsetMs).toBe(0);
    expect(song.highscore).toBe(0);
  });

  it("builds url and youtube songs", () => {
    const url = buildNewSong({
      ...base,
      source: { kind: "url", url: "https://example.com/a.mp3" },
      choreo: { type: "auto" },
    });
    expect(url.source).toEqual({ type: "url", url: "https://example.com/a.mp3" });
    const yt = buildNewSong({
      ...base,
      source: { kind: "youtube", videoId: ID },
      choreo: { type: "auto" },
    });
    expect(yt.source).toEqual({ type: "youtube", videoId: ID });
  });

  it("baut einen schema-gültigen Spotify-Song mit der Track-URI", () => {
    const song = buildNewSong({
      ...base,
      source: { kind: "spotify", trackUri: TRACK_URI },
      choreo: { type: "auto" },
    });
    expect(SongSchema.safeParse(song).success).toBe(true);
    expect(song.source).toEqual({ type: "spotify", trackUri: TRACK_URI });
    expect(song.choreo.moves.length).toBeGreaterThan(4);
  });

  it("lehnt eine ungültige Spotify-URI über das Schema ab", () => {
    expect(() =>
      buildNewSong({
        ...base,
        source: { kind: "spotify", trackUri: "spotify:track:kurz" },
        choreo: { type: "auto" },
      }),
    ).toThrow();
  });

  it("rejects invalid data via the schema", () => {
    expect(() =>
      buildNewSong({ ...base, title: " ", source: { kind: "file" }, choreo: { type: "auto" } }),
    ).toThrow();
    expect(() =>
      buildNewSong({
        ...base,
        source: { kind: "youtube", videoId: "bad" },
        choreo: { type: "auto" },
      }),
    ).toThrow();
  });

  it("import keeps moves and bpm, uses form title/artist/difficulty, and gets fresh ids", () => {
    const original = makeSong(autoChoreo("Orig", 100, 40_000, ["#FF8A00", "#7CFF4F"]));
    const file = {
      ...buildChoreoFile(original),
      song: { ...buildChoreoFile(original).song, syncOffsetMs: 40, startOffsetMs: 500, bpm: 100 },
    };
    const song = buildNewSong({
      ...base,
      bpm: 999,
      difficulty: 3,
      source: { kind: "youtube", videoId: ID },
      choreo: { type: "import", file },
    });
    expect(song.bpm).toBe(100);
    expect(song.title).toBe("Mein Song");
    expect(song.choreo.title).toBe("Mein Song");
    expect(song.difficulty).toBe(3);
    expect(song.syncOffsetMs).toBe(40);
    expect(song.startOffsetMs).toBe(500);
    expect(song.choreo.moves).toEqual(original.choreo.moves);
    expect(song.id).not.toBe(original.id);
    expect(song.choreo.id).not.toBe(original.choreo.id);
  });

  it("round-trips export -> parse -> import", () => {
    const original = makeSong(autoChoreo("Orig", 128, 50_000, ["#B13CFF", "#FFB800"]));
    const file = parseChoreoFile(JSON.stringify(buildChoreoFile(original)));
    const song = buildNewSong({
      ...base,
      source: { kind: "file" },
      choreo: { type: "import", file },
    });
    expect(song.choreo.frames).toEqual(original.choreo.frames);
    expect(song.choreo.moves).toEqual(original.choreo.moves);
    expect(song.choreo.accentColor).toBe("#B13CFF");
  });
});

describe("validateNewSongFields", () => {
  const ok = {
    kind: "youtube" as const,
    title: "Song",
    link: ID,
    bpm: 120,
    durationS: 180,
    imported: false,
  };
  it("accepts valid input", () => {
    expect(validateNewSongFields(ok)).toEqual({});
  });
  it("reports German messages", () => {
    const e = validateNewSongFields({ ...ok, title: " ", link: "x", bpm: 20, durationS: 5 });
    expect(e.title).toMatch(/Titel/);
    expect(e.link).toMatch(/YouTube/);
    expect(e.bpm).toMatch(/30 und 300/);
    expect(e.duration).toMatch(/10 und 600/);
    expect(validateNewSongFields({ ...ok, bpm: 301 }).bpm).toBeDefined();
    expect(validateNewSongFields({ ...ok, bpm: NaN }).bpm).toBeDefined();
    expect(validateNewSongFields({ ...ok, durationS: 601 }).duration).toBeDefined();
  });
  it("checks the url field and skips timing for imports", () => {
    expect(validateNewSongFields({ ...ok, kind: "url", link: "nope" }).link).toMatch(/https/);
    expect(validateNewSongFields({ ...ok, bpm: NaN, durationS: NaN, imported: true })).toEqual({});
    expect(validateNewSongFields({ ...ok, kind: "file", link: "" })).toEqual({});
  });
  it("prüft das Spotify-Feld mit deutscher Meldung", () => {
    const spotify = { ...ok, kind: "spotify" as const };
    expect(validateNewSongFields({ ...spotify, link: TRACK_URI })).toEqual({});
    expect(
      validateNewSongFields({ ...spotify, link: `https://open.spotify.com/track/${TRACK}?si=1` }),
    ).toEqual({});
    for (const link of ["", ID, `https://open.spotify.com/album/${TRACK}`]) {
      expect(validateNewSongFields({ ...spotify, link }).link).toBe(
        "Das ist kein gültiger Spotify-Song. Bitte einen Song-Link (open.spotify.com/track/…) oder eine Spotify-URI eingeben.",
      );
    }
    // A Spotify link is not a valid YouTube link and vice versa.
    expect(validateNewSongFields({ ...ok, link: TRACK_URI }).link).toMatch(/YouTube/);
  });
});

describe("analyzeAudio", () => {
  const SR = 22050;
  it("returns refined (0.1), clamped bpm and the duration", async () => {
    const data = new Float32Array(SR * 20);
    const beat = (60 / 120) * SR;
    for (let t = 0; t < data.length; t += beat) {
      for (let k = 0; k < 400; k++) data[Math.round(t) + k] = Math.sin(k * 0.6) * Math.exp(-k / 80);
    }
    const r = await analyzeAudio(new Blob(["x"]), async () => ({
      sampleRate: SR,
      duration: 20.0004,
      getChannelData: () => data,
    }));
    // 0.1 resolution; a true integer tempo comes back exact.
    expect(Math.round(r.bpm * 10) / 10).toBe(r.bpm);
    expect(r.bpm).toBe(120);
    expect(r.durationMs).toBe(20_000);
    expect(r.envelope.values.length).toBeGreaterThan(1900);
    expect(r.envelope.hopMs).toBeCloseTo(9.977, 3);
  });
  it("throws the German message when decoding fails", async () => {
    await expect(
      analyzeAudio(new Blob(["x"]), () => Promise.reject(new Error("bad"))),
    ).rejects.toThrow(DECODE_ERROR_MESSAGE);
  });
});
