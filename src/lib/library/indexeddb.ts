import { SongSchema } from "../schema";
import type { Song, SourceSpec } from "../types";
import { buildChoreoFile, parseChoreoFile, songFromChoreoFile } from "./choreoFile";
import { migrateSong } from "./migrations";
import type { SongRepository } from "./repository";
import { StorageFullError, isQuotaError } from "./storage";

const DB_NAME = "dancebeat";
/**
 * Schema history:
 * 1 – stores "songs" (keyPath id) and "blobs" (audio and dance videos, out-of-line keys)
 * 2 – song records migrated to choreography format v1 (UUIDs, timestamps, signed angles)
 * 3 – song records migrated to choreography format v2 (optional `pose3d` per frame); the same
 *     cursor pass as for 2, `migrateSong` runs all format steps from the record's version on
 */
const DB_VERSION = 3;
const SONGS = "songs";
const BLOBS = "blobs";

function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore(SONGS, { keyPath: "id" });
    db.createObjectStore(BLOBS);
  }
  if (oldVersion >= 1 && oldVersion < 3) {
    // Song ids may change (legacy ids become UUIDs), so records are re-keyed.
    const store = tx.objectStore(SONGS);
    store.openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      try {
        const song = migrateSong(cursor.value);
        if (song.id !== cursor.key) {
          cursor.delete();
          store.put(song);
        } else cursor.update(song);
      } catch (err) {
        // Left untouched; list() skips it. Never delete user data during an upgrade.
        console.warn("Song migration failed, record kept as is:", cursor.key, err);
      }
      cursor.continue();
    };
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      if (req.transaction) upgrade(req.result, req.transaction, e.oldVersion);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is upgrading: close so it can proceed; the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("Die Datenbank ist in einem anderen Tab geöffnet. Bitte diesen schließen."));
  }).catch((e: unknown) => {
    dbPromise = null; // allow a retry instead of caching the failure
    throw e;
  });
  return dbPromise;
}

/** Runs `fn` in one transaction and resolves with its result once the transaction commits. */
async function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    const fail = (e: Event) => {
      // A failing request (also one made inside a callback, without `req`) reports here before
      // the transaction aborts, while `tx.error` is still null: take the request's error.
      const source = e.type === "error" ? (e.target as IDBRequest | null)?.error : undefined;
      const err = tx.error ?? source ?? req?.error;
      reject(isQuotaError(err) ? new StorageFullError() : err);
    };
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = fail;
    tx.onabort = fail;
  });
}

function validate(raw: unknown): Song | undefined {
  const r = SongSchema.safeParse(raw);
  if (r.success) return r.data;
  console.warn("Invalid song record skipped:", r.error.issues.slice(0, 3));
  return undefined;
}

export class IndexedDbSongRepository implements SongRepository {
  async list() {
    const raw = await run<unknown[]>([SONGS], "readonly", (tx) => tx.objectStore(SONGS).getAll());
    return (raw ?? [])
      .map(validate)
      .filter((s): s is Song => !!s)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(id: string) {
    const raw = await run<unknown>([SONGS], "readonly", (tx) => tx.objectStore(SONGS).get(id));
    return raw === undefined ? undefined : validate(raw);
  }

  async save(song: Song, audio?: Blob, video?: Blob) {
    const next = SongSchema.parse({ ...song, updatedAt: Date.now() });
    if (audio && next.source.type !== "local")
      throw new Error("Audiodaten gehören nur zu lokalen Songs.");
    if (video && !next.videoBlobId) throw new Error("Das Tanzvideo braucht eine videoBlobId.");
    const blobId = next.source.type === "local" ? next.source.blobId : null;
    await run([SONGS, BLOBS], "readwrite", (tx) => {
      if (audio && blobId) tx.objectStore(BLOBS).put(audio, blobId);
      if (video && next.videoBlobId) tx.objectStore(BLOBS).put(video, next.videoBlobId);
      tx.objectStore(SONGS).put(next);
    });
    return next;
  }

  async setVideo(id: string, video: Blob | undefined) {
    let found = false as boolean; // set inside the callback; keeps TS from narrowing
    let saved: Song | undefined;
    // Read, delete the old blob, store the new one and the song in one transaction.
    await run([SONGS, BLOBS], "readwrite", (tx) => {
      const songs = tx.objectStore(SONGS);
      const req = songs.get(id);
      req.onsuccess = () => {
        if (req.result === undefined) return;
        found = true;
        const current = validate(req.result);
        if (!current) return; // invalid records are never rewritten
        const { videoBlobId: old, ...rest } = current;
        const blobs = tx.objectStore(BLOBS);
        if (old) blobs.delete(old);
        const next: Song = {
          ...rest,
          ...(video ? { videoBlobId: crypto.randomUUID() } : {}),
          updatedAt: Date.now(),
        };
        if (video && next.videoBlobId) blobs.put(video, next.videoBlobId);
        songs.put(next);
        saved = next;
      };
    });
    if (!found) throw new Error("Song nicht gefunden.");
    if (!saved) throw new Error("Der Song ist beschädigt und kann nicht geändert werden.");
    return saved;
  }

  async delete(id: string) {
    // Read and delete in one transaction; works on the raw record, so invalid ones go too.
    await run([SONGS, BLOBS], "readwrite", (tx) => {
      const songs = tx.objectStore(SONGS);
      const req = songs.get(id);
      req.onsuccess = () => {
        const raw = req.result as { source?: unknown; videoBlobId?: unknown } | undefined;
        const blobId = (raw?.source as { blobId?: unknown } | undefined)?.blobId;
        if (typeof blobId === "string") tx.objectStore(BLOBS).delete(blobId);
        if (typeof raw?.videoBlobId === "string") tx.objectStore(BLOBS).delete(raw.videoBlobId);
        songs.delete(id);
      };
    });
  }

  async getAudio(blobId: string) {
    return run<Blob | undefined>([BLOBS], "readonly", (tx) => tx.objectStore(BLOBS).get(blobId));
  }

  async getVideo(blobId: string) {
    // Same store as the audio; the separate name keeps call sites readable.
    return this.getAudio(blobId);
  }

  async export(id: string) {
    const song = await this.get(id);
    if (!song) throw new Error("Song nicht gefunden.");
    return JSON.stringify(buildChoreoFile(song), null, 2);
  }

  async import(json: string, source: SourceSpec, audio?: Blob) {
    return this.save(songFromChoreoFile(parseChoreoFile(json), source), audio);
  }
}
