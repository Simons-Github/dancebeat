import type { Song } from "./types";

const DB_NAME = "dancebeat";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("songs", { keyPath: "id" });
        r.result.createObjectStore("blobs");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const req = fn(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }),
  );
}

export const songsDb = {
  all: () => tx<Song[]>("songs", "readonly", (s) => s.getAll() as IDBRequest<Song[]>),
  get: (id: string) => tx<Song | undefined>("songs", "readonly", (s) => s.get(id)),
  put: (song: Song) => tx("songs", "readwrite", (s) => s.put(song)),
  remove: (id: string) => tx("songs", "readwrite", (s) => s.delete(id)),
};

export const blobsDb = {
  get: (id: string) => tx<Blob | undefined>("blobs", "readonly", (s) => s.get(id)),
  put: (id: string, b: Blob) => tx("blobs", "readwrite", (s) => s.put(b, id)),
  remove: (id: string) => tx("blobs", "readwrite", (s) => s.delete(id)),
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
