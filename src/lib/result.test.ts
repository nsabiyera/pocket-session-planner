import { describe, expect, it } from 'vitest';
import {
  allResults,
  err,
  flatMapResult,
  isErr,
  isOk,
  mapResult,
  ok,
  unwrap,
  unwrapOr,
} from './result';

describe('Result', () => {
  it('narrows with isOk / isErr', () => {
    const good = ok(1);
    const bad = err('nope');

    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });

  it('maps the success channel and passes errors through', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(mapResult(err<string>('boom'), (n: number) => n * 3)).toEqual(err('boom'));
  });

  it('short-circuits flatMap on the first error', () => {
    const double = (n: number) => ok(n * 2);
    expect(flatMapResult(ok(2), double)).toEqual(ok(4));
    expect(flatMapResult(err<string>('boom'), double)).toEqual(err('boom'));
  });

  it('unwrapOr substitutes only on failure', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err('x'), 0)).toBe(0);
  });

  it('unwrap throws on an Err, which is why it is test-only', () => {
    expect(unwrap(ok('value'))).toBe('value');
    expect(() => unwrap(err({ kind: 'illegal' }))).toThrow(/illegal/);
  });

  it('allResults collects successes and stops at the first failure', () => {
    expect(allResults([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    expect(allResults([ok(1), err('bad'), ok(3)])).toEqual(err('bad'));
    expect(allResults([])).toEqual(ok([]));
  });
});
