import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock';
import { systemClock } from './clock';
import { cryptoIdGenerator } from './id';
import { FakeIdGenerator } from './fake-id-generator';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('FakeClock', () => {
  it('starts at a fixed instant and reports it both ways', () => {
    const clock = new FakeClock('2026-08-31T18:00:00.000Z');
    expect(clock.nowIso()).toBe('2026-08-31T18:00:00.000Z');
    expect(clock.now()).toBe(Date.parse('2026-08-31T18:00:00.000Z'));
  });

  it('advances by ms, seconds and minutes', () => {
    const clock = new FakeClock('2026-08-31T18:00:00.000Z');
    clock.advance(500).advanceSeconds(30).advanceMinutes(2);
    expect(clock.nowIso()).toBe('2026-08-31T18:02:30.500Z');
  });

  it('can be set backwards, which is how a device clock change is simulated', () => {
    const clock = new FakeClock('2026-08-31T18:10:00.000Z');
    clock.set('2026-08-31T18:00:00.000Z');
    expect(clock.nowIso()).toBe('2026-08-31T18:00:00.000Z');
  });

  it('accepts an epoch-millisecond start', () => {
    expect(new FakeClock(0).nowIso()).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('systemClock', () => {
  it('reports the same instant both ways', () => {
    const before = Date.now();
    const iso = systemClock.nowIso();
    const after = Date.now();

    expect(Date.parse(iso)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(iso)).toBeLessThanOrEqual(after);
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);
  });
});

describe('id generators', () => {
  it('cryptoIdGenerator produces distinct v4 UUIDs', () => {
    const a = cryptoIdGenerator.uuid();
    const b = cryptoIdGenerator.uuid();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('FakeIdGenerator is deterministic and still UUID-shaped, so branded schemas parse it', () => {
    const ids = new FakeIdGenerator();
    expect(ids.uuid()).toBe('00000000-0000-4000-8000-000000000001');
    expect(ids.uuid()).toBe('00000000-0000-4000-8000-000000000002');
    expect(ids.uuid()).toMatch(UUID_V4);
    expect(ids.issued).toBe(3);

    ids.reset();
    expect(ids.uuid()).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('falls back to random bytes where crypto.randomUUID is unavailable', () => {
    // A LAN device test over plain http is not a secure context, and `crypto.randomUUID`
    // is undefined there. Crashing on id generation would make the app untestable on the
    // one device that matters.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) },
      configurable: true,
    });
    try {
      expect(cryptoIdGenerator.uuid()).toMatch(UUID_V4);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('falls back again where there is no crypto object at all', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(cryptoIdGenerator.uuid()).toMatch(UUID_V4);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('a prefix keeps two generators from colliding within one test', () => {
    const a = new FakeIdGenerator('aaaa');
    const b = new FakeIdGenerator('bbbb');
    expect(a.uuid()).not.toBe(b.uuid());
    expect(a.uuid()).toMatch(UUID_V4);
  });
});
