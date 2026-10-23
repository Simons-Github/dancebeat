import type { Song, SourceSpec } from "../types";
import { IndexedDbSongRepository } from "./indexeddb";

/**
 * All access to the song library goes through this interface. Screens and hooks never touch
 * the storage backend directly, so a server-backed implementation can be swapped in later.
 */
export interface SongRepository {
  /** All valid songs, oldest first. Records that fail validation are skipped. */
  list(): Promise<Song[]>;
  get(id: string): Promise<Song | undefined>;
  /**
   * Validates and stores a song (insert or update) and sets `updatedAt`. Audio, if given, is
   * stored under the song's local blobId, the dance video under its `videoBlobId`, all in the
   * same transaction. Throws StorageFullError (nothing is stored then).
   */
  save(song: Song, audio?: Blob, video?: Blob): Promise<Song>;
  /** Deletes the song, its audio and its dance video in one transaction. */
  delete(id: string): Promise<void>;
  getAudio(blobId: string): Promise<Blob | undefined>;
  /** The dance video stored under a song's `videoBlobId`. */
  getVideo(blobId: string): Promise<Blob | undefined>;
  /** JSON export of the song's choreography (no audio). */
  export(id: string): Promise<string>;
  /** Validates an export file and stores it as a new song with the given audio source. */
  import(json: string, source: SourceSpec, audio?: Blob): Promise<Song>;
}

export const songRepository: SongRepository = new IndexedDbSongRepository();
