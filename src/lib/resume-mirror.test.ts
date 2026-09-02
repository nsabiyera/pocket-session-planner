import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearResumeMirror,
  mirrorRemainingMs,
  readResumeMirror,
  writeResumeMirror,
  type ResumeMirror,
} from './resume-mirror';

const KEY = 'psp.resume';

const mirror = (over: Partial<ResumeMirror> = {}): ResumeMirror => ({
  activeSessionId: '00000000-0000-4000-8000-000000000001',
  squadId: '00000000-0000-4000-8000-000000000002',
  sessionTitle: 'Playing out from the back · 31 Aug',
  phaseTitle: 'Main practice',
  status: 'in_progress',
  phaseRunningSince: '2026-08-31T18:00:00.000Z',
  phaseAccumulatedMs: 0,
  phasePlannedMs: 20 * 60_000,
  updatedAt: '2026-08-31T18:00:00.000Z',
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the resume mirror', () => {
  it('round-trips', () => {
    writeResumeMirror(mirror());
    expect(readResumeMirror()).toEqual(mirror());
  });

  it('is absent until written, and clearable', () => {
    expect(readResumeMirror()).toBeNull();
    writeResumeMirror(mirror());
    clearResumeMirror();
    expect(readResumeMirror()).toBeNull();
  });

  it('ignores a corrupt or outdated payload rather than crashing the home screen', () => {
    localStorage.setItem(KEY, 'not json at all');
    expect(readResumeMirror()).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ activeSessionId: 42 }));
    expect(readResumeMirror()).toBeNull();
  });

  it('survives a localStorage that throws — the mirror is a cache, never a requirement', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeResumeMirror(mirror())).not.toThrow();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readResumeMirror()).toBeNull();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearResumeMirror()).not.toThrow();
  });
});

describe('mirrorRemainingMs', () => {
  const at = (offsetMs: number) => Date.parse('2026-08-31T18:00:00.000Z') + offsetMs;

  it('derives remaining time exactly as the real timer would', () => {
    expect(mirrorRemainingMs(mirror(), at(0))).toBe(20 * 60_000);
    expect(mirrorRemainingMs(mirror(), at(8 * 60_000))).toBe(12 * 60_000);
  });

  it('holds still while paused', () => {
    const paused = mirror({ phaseRunningSince: null, phaseAccumulatedMs: 5 * 60_000 });
    expect(mirrorRemainingMs(paused, at(0))).toBe(15 * 60_000);
    expect(mirrorRemainingMs(paused, at(60 * 60_000))).toBe(15 * 60_000);
  });

  it('clamps at zero rather than counting into the negative', () => {
    expect(mirrorRemainingMs(mirror(), at(60 * 60_000))).toBe(0);
  });

  it('survives a device clock moved backwards', () => {
    const running = mirror({
      phaseRunningSince: '2026-08-31T18:05:00.000Z',
      phaseAccumulatedMs: 60_000,
    });
    expect(mirrorRemainingMs(running, at(0))).toBe(19 * 60_000);
  });

  it('reports nothing when there is no phase to report on', () => {
    expect(mirrorRemainingMs(mirror({ phasePlannedMs: null }), at(0))).toBeNull();
    expect(mirrorRemainingMs(mirror({ phaseAccumulatedMs: null }), at(0))).toBeNull();
  });
});
