/** Types of the choreography generator (Etappe 13f), see docs/choreography-format.md#generator. */

/** Loudness-like curve over the song, e.g. the onset envelope of `analyzeAudio`. */
export interface EnergyCurve {
  /** Step length in ms. */
  hopMs: number;
  values: ArrayLike<number>;
}

export interface GenerationInput {
  bpm: number;
  /** Time of a beat in the audio (ms); every beat lies on `beatPhaseMs + k · 60000 / bpm`. */
  beatPhaseMs: number;
  durationMs: number;
  /** Optional energy curve of the audio; without it the structure alone sets the energy. */
  energy?: EnergyCurve;
  style: string;
  difficulty: 1 | 2 | 3;
  /** Seed of the random choices (the song id): same input and seed, same choreography. */
  seed: string;
}

/** One move position of a phrase. `beat` counts from the beat grid's origin. */
export interface Slot {
  beat: number;
  /** Beats until the next slot (or the end of the phrase / song). */
  lengthBeats: number;
  gold: boolean;
}

/** Kind of a phrase group: verses get fresh content, every chorus repeats the first one. */
export type SectionKind = "verse" | "chorus";

export interface PlannedPhrase {
  /** Phrases with the same key get exactly the same clip sequence. */
  key: string;
  section: SectionKind;
  startBeat: number;
  beats: number;
  slots: Slot[];
  /** Target clip energy 0..1 for this phrase. */
  energy: number;
}

export interface Plan {
  bpm: number;
  /** Beat phase normalised to [0, one beat). */
  beatPhaseMs: number;
  durationMs: number;
  /** Beats before the first move (no moves). */
  introBeats: number;
  phrases: PlannedPhrase[];
  /** The closing pose (last move of the song), or null for a song too short for any move. */
  final: Slot | null;
}

/**
 * A clip placed on the beat grid: what `selectMoves` produces and `realizeFrames` consumes. The
 * clip's anchor (its move) lies on `beat`, so the clip starts `anchorBeat` earlier; moves are
 * therefore exactly as far apart as the slots, whatever the anchors.
 */
export interface ClipRef {
  clipId: string;
  /** Beat of the move (the clip's anchor). */
  beat: number;
  /** Beats until the next move, or until the end of the song for the closing pose. */
  lengthBeats: number;
  gold: boolean;
}
