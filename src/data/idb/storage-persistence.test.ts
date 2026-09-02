import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPORT_NAG_DAYS,
  formatBytes,
  getStorageStatus,
  requestPersistentStorage,
  shouldNagToExport,
} from './storage-persistence';

const original = navigator.storage;

function withStorage(stub: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, 'storage', { value: stub, configurable: true });
}

afterEach(() => {
  Object.defineProperty(navigator, 'storage', { value: original, configurable: true });
  vi.restoreAllMocks();
});

describe('requestPersistentStorage', () => {
  it('returns true without asking again when already persisted', async () => {
    const persist = vi.fn();
    withStorage({ persisted: async () => true, persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks once when not yet persisted', async () => {
    const persist = vi.fn(async () => true);
    withStorage({ persisted: async () => false, persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('treats a refusal as a normal outcome, not an error', async () => {
    withStorage({ persisted: async () => false, persist: async () => false });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('treats a throw (private mode) the same as being told no', async () => {
    withStorage({
      persisted: async () => {
        throw new Error('SecurityError');
      },
      persist: async () => true,
    });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns false where the API does not exist at all', async () => {
    withStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
    withStorage({});
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe('getStorageStatus', () => {
  it('reports usage and quota for Settings', async () => {
    withStorage({
      persisted: async () => true,
      estimate: async () => ({ usage: 13_000_000, quota: 2_000_000_000 }),
    });
    expect(await getStorageStatus()).toEqual({
      persisted: true,
      supported: true,
      usageBytes: 13_000_000,
      quotaBytes: 2_000_000_000,
    });
  });

  it('reports unsupported rather than throwing when the API is missing', async () => {
    withStorage(undefined);
    expect(await getStorageStatus()).toEqual({
      persisted: false,
      supported: false,
      usageBytes: null,
      quotaBytes: null,
    });
  });

  it('copes with an estimate that omits the numbers', async () => {
    withStorage({ persisted: async () => false, estimate: async () => ({}) });
    expect(await getStorageStatus()).toMatchObject({ usageBytes: null, quotaBytes: null });
  });

  it('degrades quietly when estimate throws', async () => {
    withStorage({
      persisted: async () => true,
      estimate: async () => {
        throw new Error('nope');
      },
    });
    expect((await getStorageStatus()).supported).toBe(false);
  });
});

describe('formatBytes', () => {
  it.each([
    [null, 'unknown'],
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.0 kB'],
    [13_000_000, '12 MB'], // one decimal below 10, whole numbers above
    [2_000_000_000, '1.9 GB'],
  ])('formats %s as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('shouldNagToExport', () => {
  const now = Date.parse('2026-08-31T18:00:00.000Z');
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  it('nags when the coach has never exported', () => {
    expect(shouldNagToExport(null, now)).toBe(true);
  });

  it('stays quiet inside the window and speaks up outside it', () => {
    expect(shouldNagToExport(daysAgo(EXPORT_NAG_DAYS - 1), now)).toBe(false);
    expect(shouldNagToExport(daysAgo(EXPORT_NAG_DAYS + 1), now)).toBe(true);
  });
});
