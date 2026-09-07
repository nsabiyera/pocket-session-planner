import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KICK_OFF,
  MAX_FIXTURES_PER_PASTE,
  describeParsedFixture,
  parseFixtureLines,
} from './fixture-list';

describe('parsing a fixture list', () => {
  it('reads a date, a venue letter and an opponent', () => {
    const { fixtures, rejected } = parseFixtureLines('2026-09-14 A Eastfield Rovers');

    expect(rejected).toEqual([]);
    expect(fixtures).toEqual([
      { kickOffAt: '2026-09-14T14:00:00.000Z', venue: 'away', opponent: 'Eastfield Rovers' },
    ]);
  });

  it('reads a whole pasted list', () => {
    const { fixtures } = parseFixtureLines(
      ['2026-09-14 H Eastfield Rovers', '2026-09-21 A Northgate United', '', '  '].join('\n'),
    );
    expect(fixtures.map((f) => f.opponent)).toEqual(['Eastfield Rovers', 'Northgate United']);
  });

  it('accepts a bracketed venue', () => {
    expect(parseFixtureLines('2026-09-14 (a) Northgate').fixtures[0]?.venue).toBe('away');
  });

  it('accepts a neutral venue', () => {
    expect(parseFixtureLines('2026-09-14 N Cup Final').fixtures[0]?.venue).toBe('neutral');
  });

  it('defaults to home when no venue is given', () => {
    // A league list pasted from a website is often dates and opponents only, and home is the
    // half a coach can more readily correct from memory.
    const fixture = parseFixtureLines('2026-09-14 Eastfield Rovers').fixtures[0];
    expect(fixture?.venue).toBe('home');
    expect(fixture?.opponent).toBe('Eastfield Rovers');
  });

  /**
   * The case that decides whether the venue letter is safe to support at all. A bare letter
   * followed by more words is a venue; a *word* starting with that letter is an opponent.
   */
  it('does not mistake an opponent beginning with A for an away fixture', () => {
    const fixture = parseFixtureLines('2026-09-14 Athletic Bilbao').fixtures[0];
    expect(fixture?.venue).toBe('home');
    expect(fixture?.opponent).toBe('Athletic Bilbao');
  });

  it('takes a kick-off time when the line gives one', () => {
    expect(parseFixtureLines('2026-09-14 19:45 A Northgate').fixtures[0]?.kickOffAt).toBe(
      '2026-09-14T19:45:00.000Z',
    );
  });

  it('uses the documented default time otherwise', () => {
    expect(parseFixtureLines('2026-09-14 Northgate').fixtures[0]?.kickOffAt).toContain(
      `T${DEFAULT_KICK_OFF}`,
    );
  });
});

describe('what it refuses, and says why', () => {
  /**
   * The one place this deliberately improves on `parseRosterLines`, which silently drops a line
   * it cannot read. Losing one name in fifteen is recoverable at a glance; losing three
   * fixtures in twenty from a pasted season is not, and a coach would not find out until a week
   * in March came up empty.
   */
  it('reports a line with no date rather than dropping it', () => {
    const { fixtures, rejected } = parseFixtureLines('Saturday — Eastfield away');

    expect(fixtures).toEqual([]);
    expect(rejected).toEqual([
      {
        line: 'Saturday — Eastfield away',
        reason: 'No date at the start. Expected 2026-09-14 first.',
      },
    ]);
  });

  it('keeps the good lines and reports only the bad ones', () => {
    const { fixtures, rejected } = parseFixtureLines(
      ['2026-09-14 H Eastfield', 'next Tuesday vs Northgate', '2026-09-28 A Westbrook'].join('\n'),
    );

    expect(fixtures.map((f) => f.opponent)).toEqual(['Eastfield', 'Westbrook']);
    expect(rejected).toHaveLength(1);
  });

  /**
   * `new Date('2026-02-30')` rolls forward to 2 March without complaint, and a fixture quietly
   * moved by two days is the kind of thing nobody notices until the week around it is wrong.
   */
  it('refuses a date that does not exist', () => {
    const { fixtures, rejected } = parseFixtureLines('2026-02-30 H Eastfield');
    expect(fixtures).toEqual([]);
    expect(rejected[0]?.reason).toBe('That is not a real date.');
  });

  it('refuses a date with no opponent', () => {
    expect(parseFixtureLines('2026-09-14').rejected[0]?.reason).toBe(
      'No date at the start. Expected 2026-09-14 first.',
    );
  });

  it('refuses an opponent name that is too long for the schema', () => {
    const { rejected } = parseFixtureLines(`2026-09-14 H ${'x'.repeat(80)}`);
    expect(rejected[0]?.reason).toBe('That opponent name is too long.');
  });

  it('caps a paste and reports the overflow rather than truncating in silence', () => {
    const lines = Array.from(
      { length: MAX_FIXTURES_PER_PASTE + 3 },
      (_, index) => `2026-09-${String((index % 28) + 1).padStart(2, '0')} H Team ${index}`,
    );
    const { fixtures, rejected } = parseFixtureLines(lines.join('\n'));

    expect(fixtures).toHaveLength(MAX_FIXTURES_PER_PASTE);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]?.reason).toContain('More than');
  });

  it('reads nothing out of an empty box, and complains about nothing', () => {
    expect(parseFixtureLines('   \n  \n')).toEqual({ fixtures: [], rejected: [] });
  });
});

describe('describeParsedFixture', () => {
  it('reads back as a coach would say it', () => {
    // Asserted in parts rather than as one string: en-GB abbreviates September as "Sept" in
    // current CLDR and did not always, and this test should not fail on an ICU update.
    const text = describeParsedFixture({
      kickOffAt: '2026-09-14T14:00:00.000Z',
      venue: 'away',
      opponent: 'Eastfield Rovers',
    });

    expect(text).toContain('Away');
    expect(text).toContain('Eastfield Rovers');
    expect(text).toMatch(/14 Sept?/);
  });

  it('formats the date in UTC, so a fixture never drifts a day', () => {
    // A late kick-off read back in a negative-offset zone would otherwise show the day before.
    const text = describeParsedFixture({
      kickOffAt: '2026-09-14T23:30:00.000Z',
      venue: 'home',
      opponent: 'Northgate',
    });
    expect(text).toMatch(/14 Sept?/);
  });
});
