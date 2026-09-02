import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic } from './haptics';
import { asset, BASE_PATH, SERVICE_WORKER_SCOPE, SERVICE_WORKER_URL } from './base-path';

const original = Object.getOwnPropertyDescriptor(navigator, 'vibrate');

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'vibrate', original);
  else Reflect.deleteProperty(navigator as object, 'vibrate');
  vi.restoreAllMocks();
});

const withVibrate = (impl: (pattern: number | number[]) => boolean) => {
  Object.defineProperty(navigator, 'vibrate', { value: impl, configurable: true });
};

describe('haptics', () => {
  it('sends a distinct pattern per event, so a coach can tell them apart without looking', () => {
    const calls: Array<number | number[]> = [];
    withVibrate((pattern) => {
      calls.push(pattern);
      return true;
    });

    haptic('tap');
    haptic('warn');
    haptic('overrun');
    haptic('pause');

    expect(calls).toHaveLength(4);
    expect(calls[1]).toBe(200);
    // Three buzzes for an overrun — unmistakable against the single warning buzz.
    expect(Array.isArray(calls[2])).toBe(true);
    expect(new Set(calls.map((c) => JSON.stringify(c))).size).toBe(4);
  });

  it('does nothing where vibrate is unsupported — iOS, and every desktop', () => {
    Reflect.deleteProperty(navigator as object, 'vibrate');
    expect(() => haptic('tap')).not.toThrow();
  });

  it('swallows a throw rather than breaking the tap that caused it', () => {
    withVibrate(() => {
      throw new Error('not allowed while hidden');
    });
    expect(() => haptic('confirm')).not.toThrow();
  });
});

describe('base path', () => {
  it('prefixes an asset path, normalising a missing leading slash', () => {
    expect(asset('/icons/icon-192.png')).toBe(`${BASE_PATH}/icons/icon-192.png`);
    expect(asset('icons/icon-192.png')).toBe(`${BASE_PATH}/icons/icon-192.png`);
  });

  it('agrees with itself about the service worker URL and its scope', () => {
    expect(SERVICE_WORKER_URL).toBe(`${BASE_PATH}/sw.js`);
    expect(SERVICE_WORKER_SCOPE).toBe(`${BASE_PATH}/`);
    // The worker must live at or above its scope, or registration is rejected outright.
    expect(SERVICE_WORKER_URL.startsWith(SERVICE_WORKER_SCOPE)).toBe(true);
  });
});
