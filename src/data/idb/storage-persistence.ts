/**
 * Durability. **This is the only safety net there is.**
 *
 * IndexedDB is *evictable by default*: under storage pressure a browser may clear it without
 * asking, and for an app whose entire value is on-device that is an existential risk rather
 * than an inconvenience. `navigator.storage.persist()` asks for the bucket to be exempt.
 *
 * The heuristics browsers use to grant it reward engagement — an installed PWA, a bookmark,
 * repeat visits — so we ask at the first moment the coach has actually invested something
 * (creating their first squad), not on a cold first paint where it would simply be refused.
 */

export interface StorageStatus {
  /** `true` once the browser has agreed not to evict us. */
  persisted: boolean;
  /** Whether the API exists at all — it does not on older iOS Safari. */
  supported: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

function storageManager(): StorageManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.storage;
}

/**
 * Asks for persistent storage, returning whether we have it.
 *
 * Safe to call more than once: if the bucket is already persisted this is a cheap read, and
 * a refusal is not an error — it just means we keep nagging about exports instead.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = storageManager();
  if (!storage?.persist || !storage.persisted) return false;

  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    // Some browsers throw in private mode rather than returning false. Not being able to
    // ask is the same outcome as being told no.
    return false;
  }
}

/** Drives the storage row in Settings. Never throws — a missing API is just `supported: false`. */
export async function getStorageStatus(): Promise<StorageStatus> {
  const storage = storageManager();
  if (!storage?.estimate) {
    return { persisted: false, supported: false, usageBytes: null, quotaBytes: null };
  }

  try {
    const [persisted, estimate] = await Promise.all([
      storage.persisted ? storage.persisted() : Promise.resolve(false),
      storage.estimate(),
    ]);
    return {
      persisted,
      supported: true,
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
    };
  } catch {
    return { persisted: false, supported: false, usageBytes: null, quotaBytes: null };
  }
}

/** `12.4 MB of 2.1 GB` — Settings only, so a fixed locale is fine and keeps it testable. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/** Nag to export after this long. Long enough not to be noise; short enough to matter. */
export const EXPORT_NAG_DAYS = 30;

export function shouldNagToExport(lastExportAt: string | null, nowMs: number): boolean {
  if (lastExportAt === null) return true;
  return nowMs - Date.parse(lastExportAt) > EXPORT_NAG_DAYS * 24 * 60 * 60 * 1000;
}
