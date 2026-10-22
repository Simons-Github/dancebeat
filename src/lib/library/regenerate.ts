/** Pure logic for "Choreografie neu erzeugen": replaces a song's choreography with a generated one. */
import { autoChoreo } from "../../data/demo";
import { analyzeAudio, estimateBeatPhaseMs, type AudioAnalysis } from "../beat";
import { SongSchema } from "../schema";
import type { EnergyCurve } from "../generator";
import type { Choreography, MotionPack, Song } from "../types";

export interface RegenerateOptions {
  difficulty: 1 | 2 | 3;
  /** Generator seed; the caller picks a fresh one so each call gives new moves. */
  seed: string;
  /** Onset envelope of the song's audio file (`analyzeAudio`), if it could be analysed. */
  energy?: EnergyCurve;
  /** Time of a beat in the audio (ms), e.g. from `estimateBeatPhaseMs`. */
  beatPhaseMs?: number;
}

/** Length of a choreography: the later of its last frame and last move. Throws if it is 0. */
export function choreoDurationMs(choreo: Choreography): number {
  const lastFrame = choreo.frames.at(-1)?.timeMs ?? 0;
  const lastMove = choreo.moves.at(-1)?.timeMs ?? 0;
  const duration = Math.max(lastFrame, lastMove);
  if (!(duration > 0)) throw new Error("Die Choreografie hat keine Länge.");
  return duration;
}

/**
 * Builds the song with a newly generated choreography; everything else on the song stays.
 * The length comes from the stored choreography, because songs do not store their own length.
 * `offsetMs` is kept: it is the user's alignment of the choreography to the audio. The
 * choreography id and `createdAt` are kept too. Throws if the result is invalid.
 */
export function regenerateSong(
  song: Song,
  pack: MotionPack,
  opts: RegenerateOptions,
  now = Date.now(),
): Song {
  const durationMs = choreoDurationMs(song.choreo);
  const { difficulty, seed, energy, beatPhaseMs } = opts;
  const generated = autoChoreo(
    song.title,
    song.bpm,
    durationMs,
    [song.choreo.accentColor, song.choreo.secondaryColor],
    pack,
    {
      id: song.choreo.id,
      seed,
      difficulty,
      ...(energy && { energy }),
      ...(beatPhaseMs !== undefined && { beatPhaseMs }),
    },
  );
  return SongSchema.parse({
    ...song,
    difficulty,
    choreo: {
      ...generated,
      offsetMs: song.choreo.offsetMs,
      createdAt: song.choreo.createdAt,
      updatedAt: now,
    },
  });
}

/**
 * Beat phase and energy of the song's audio file for `regenerateSong`, like "Song hinzufügen"
 * takes them. Without a file, or when it cannot be decoded, the choreography is generated
 * without them (as for non-file sources). Both are returned in choreography time, i.e. shifted by
 * `choreo.offsetMs` (game time = audio time − offset, see `useAudioClock`), because the offset is
 * kept: video imports store the section start there. The phase is fitted to the stored BPM from
 * where the song starts playing (`startOffsetMs`) or the choreography starts, whichever is later.
 */
export async function audioTiming(
  audio: Blob | undefined,
  song: Song,
  analyze: (file: Blob) => Promise<AudioAnalysis> = analyzeAudio,
): Promise<Pick<RegenerateOptions, "energy" | "beatPhaseMs">> {
  if (!audio) return {};
  let envelope: AudioAnalysis["envelope"];
  try {
    ({ envelope } = await analyze(audio));
  } catch {
    return {};
  }
  const offsetMs = song.choreo.offsetMs;
  const energy = shiftCurve(envelope, offsetMs);
  const phase = estimateBeatPhaseMs(envelope, song.bpm, Math.max(0, offsetMs, song.startOffsetMs));
  return phase === null ? { energy } : { energy, beatPhaseMs: phase - offsetMs };
}

/** The curve as seen from `offsetMs` on: step i is the original step at i + offsetMs / hopMs. */
function shiftCurve(curve: EnergyCurve, offsetMs: number): EnergyCurve {
  const shift = Math.round(offsetMs / curve.hopMs);
  if (shift === 0) return curve;
  const values = Array.from(
    { length: Math.max(0, curve.values.length - shift) },
    (_, i) => curve.values[i + shift] ?? 0,
  );
  return { hopMs: curve.hopMs, values };
}
