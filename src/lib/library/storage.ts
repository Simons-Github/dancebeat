/** Browser storage helpers: persistence request, usage estimate and quota errors. */

export class StorageFullError extends Error {
  constructor() {
    super("Der Speicher ist voll. Lösche Songs oder große Audiodateien und versuche es erneut.");
    this.name = "StorageFullError";
  }
}

/** Size for storage hints, in MB with one German decimal; never shows 0. */
export const formatMb = (bytes: number) =>
  `${Math.max(0.1, bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;

export const isQuotaError = (e: unknown) =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);

/**
 * Asks the browser not to evict our data under storage pressure (Safari otherwise deletes
 * site data after 7 days without use unless the app is installed). Returns the granted state.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export interface StorageUsage {
  usageBytes: number;
  quotaBytes: number;
  persisted: boolean;
}

export async function getStorageUsage(): Promise<StorageUsage | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? Promise.resolve(false),
    ]);
    return { usageBytes: usage, quotaBytes: quota, persisted };
  } catch {
    return null;
  }
}
