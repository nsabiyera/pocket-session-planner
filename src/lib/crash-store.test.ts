import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureCrash,
  clearAllCrashes,
  clearCrash,
  loadCrashes,
  rememberNamesToRedact,
  saveCrashes,
} from './crash-store';
import { MAX_STORED_CRASHES } from '@/domain/crash';

beforeEach(() => {
  localStorage.clear();
});

const capture = (error: unknown, over: Partial<Parameters<typeof captureCrash>[0]> = {}) =>
  captureCrash({ error, source: 'render', route: '/run', appVersion: '0.1.0', ...over });

describe('capturing a crash', () => {
  it('persists immediately, so a force-quit cannot lose it', () => {
    // A crash on the pitch is usually followed by the coach killing the app.
    capture(new Error('boom'));
    expect(loadCrashes()).toHaveLength(1);
    expect(loadCrashes()[0]?.message).toBe('boom');
  });

  it('records the route and the source', () => {
    capture(new Error('boom'), { route: '/review', source: 'promise' });
    expect(loadCrashes()[0]).toMatchObject({ route: '/review', source: 'promise' });
  });

  it('drops a query string from the route', () => {
    capture(new Error('boom'), { route: '/sessions/detail/?s=abc' });
    expect(loadCrashes()[0]?.route).toBe('/sessions/detail/');
  });

  it('keeps the component stack when React supplied one', () => {
    capture(new Error('boom'), { componentStack: '\n    at RunPage' });
    expect(loadCrashes()[0]?.stack).toContain('Component stack:');
  });
});

describe('redacting names at capture time', () => {
  /**
   * The privacy guarantee, tested where it actually runs. Scrubbing is proved in
   * `crash.test.ts`; what matters here is that `captureCrash` really applies it — a correct
   * scrubber that nothing calls protects nobody.
   */
  it('redacts the remembered names before anything is stored', () => {
    rememberNamesToRedact(['Kai Roberts', 'U12 Reds']);
    capture(new Error('Invalid player Kai Roberts in squad U12 Reds'));

    const stored = loadCrashes()[0]!;
    expect(stored.message).not.toContain('Kai');
    expect(stored.message).not.toContain('Reds');
    expect(stored.message).toContain('[name]');
  });

  it('redacts the stack as well as the message', () => {
    rememberNamesToRedact(['Kai Roberts']);
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at validate (Kai Roberts row)';
    capture(error);
    expect(loadCrashes()[0]?.stack).not.toContain('Kai');
  });

  it('redacts nothing when no squad has been read yet, and does not fail', () => {
    // A crash during the very first open. There is nothing to protect, and the reporter must
    // still work — this is the one moment it is most likely to be needed.
    capture(new Error('database failed to open'));
    expect(loadCrashes()[0]?.message).toBe('database failed to open');
  });
});

describe('values that are not Errors', () => {
  it('handles a thrown string', () => {
    capture('just a string');
    expect(loadCrashes()[0]?.message).toBe('just a string');
  });

  it('handles a thrown object', () => {
    capture({ code: 'E_NOPE' });
    expect(loadCrashes()[0]?.message).toContain('E_NOPE');
  });

  it('handles a thrown undefined', () => {
    // `throw undefined` is legal JavaScript and does happen.
    capture(undefined);
    expect(loadCrashes()).toHaveLength(1);
  });

  it('handles an object that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => capture(circular)).not.toThrow();
    expect(loadCrashes()).toHaveLength(1);
  });

  it('falls back to the error name when the message is empty', () => {
    capture(new TypeError(''));
    expect(loadCrashes()[0]?.message).toBe('TypeError');
  });
});

describe('surviving a broken localStorage', () => {
  /**
   * A reporter that throws while reporting turns one crash into two and loses the first. Every
   * path through this module is wrapped, and these are the tests that hold that.
   */
  it('returns no reports when the stored value is corrupt', () => {
    localStorage.setItem('psp.crashes', 'not json at all');
    expect(loadCrashes()).toEqual([]);
  });

  it('returns no reports when the stored value is not an array', () => {
    localStorage.setItem('psp.crashes', '{"nope":true}');
    expect(loadCrashes()).toEqual([]);
  });

  it('filters out entries that are not crash reports', () => {
    localStorage.setItem('psp.crashes', '[{"nope":true},{"id":"c1","message":"real"}]');
    expect(loadCrashes()).toHaveLength(1);
  });

  it('does not throw when saving fails', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(() => capture(new Error('boom'))).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });

  it('does not throw when reading fails', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(loadCrashes()).toEqual([]);
    } finally {
      getItem.mockRestore();
    }
  });

  it('does not throw when remembering names fails', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(() => rememberNamesToRedact(['Kai'])).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });

  it('redacts nothing when the remembered names are corrupt', () => {
    localStorage.setItem('psp.crash-names', 'not json');
    expect(() => capture(new Error('boom'))).not.toThrow();
    expect(loadCrashes()[0]?.message).toBe('boom');
  });
});

describe('clearing reports', () => {
  it('discards one by id and keeps the rest', () => {
    capture(new Error('first'));
    capture(new Error('second'));
    const [newest] = loadCrashes();

    const remaining = clearCrash(newest!.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message).toBe('first');
  });

  it('discards all of them', () => {
    capture(new Error('first'));
    clearAllCrashes();
    expect(loadCrashes()).toEqual([]);
  });

  it('caps what it stores across many distinct crashes', () => {
    for (let i = 0; i < MAX_STORED_CRASHES + 3; i += 1) capture(new Error(`fault ${i}`));
    expect(loadCrashes()).toHaveLength(MAX_STORED_CRASHES);
  });

  it('round-trips through save and load', () => {
    capture(new Error('boom'));
    const stored = loadCrashes();
    clearAllCrashes();
    saveCrashes(stored);
    expect(loadCrashes()).toEqual(stored);
  });
});
