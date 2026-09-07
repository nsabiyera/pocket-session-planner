import { describe, expect, it } from 'vitest';
import {
  CLASSICAL_PATTERN,
  EFFORT_QUALITIES,
  EFFORT_QUALITY_HINTS,
  EFFORT_QUALITY_LABELS,
  dayLabel,
  departuresFromPattern,
  describeMorphocycle,
  isAcquisitive,
  morphocycleFor,
  repeatedQualities,
  type CycleSession,
  type EffortQuality,
} from './morphocycle';

/** Saturday 12 September 2026, kick-off. */
const MATCH_DAY = '2026-09-12T14:00:00.000Z';

const at = (day: number, hour = 19): string =>
  `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

const session = (
  id: string,
  scheduledFor: string,
  over: Partial<CycleSession> = {},
): CycleSession => ({
  id,
  title: id,
  scheduledFor,
  kind: 'training',
  effortQuality: null,
  ...over,
});

const fixture = (scheduledFor = MATCH_DAY, id = 'match'): CycleSession =>
  session(id, scheduledFor, { kind: 'match' });

const senior = (
  sessions: readonly CycleSession[],
  match = fixture(),
  pattern?: Readonly<Record<number, EffortQuality>>,
) => morphocycleFor(match, sessions, { level: 'senior', ...(pattern ? { pattern } : {}) });

describe('day labels', () => {
  it('names days the way the method does', () => {
    expect(dayLabel(4)).toBe('MD-4');
    expect(dayLabel(1)).toBe('MD-1');
    expect(dayLabel(0)).toBe('MD');
    expect(dayLabel(-1)).toBe('MD+1');
  });
});

describe('building the cycle from the fixture list', () => {
  it('labels each session by days to the match', () => {
    const cycle = senior([
      fixture(),
      session('tue', at(8)),
      session('wed', at(9)),
      session('thu', at(10)),
      session('fri', at(11)),
    ]);

    expect(cycle.days.map((day) => day.label)).toEqual(['MD-4', 'MD-3', 'MD-2', 'MD-1']);
  });

  /**
   * The behaviour that makes this the method's own cycle rather than an approximation: a
   * morphocycle is the span between two matches, so a midweek game compresses it.
   */
  it('compresses to three days in a two-game week', () => {
    const cycle = senior([
      fixture('2026-09-09T19:00:00.000Z', 'midweek'),
      fixture(),
      session('thu', at(10)),
      session('fri', at(11)),
    ]);

    expect(cycle.spanDays).toBe(3);
    expect(cycle.days.map((day) => day.label)).toEqual(['MD-2', 'MD-1']);
  });

  it('stretches across a break', () => {
    const cycle = senior([
      fixture('2026-09-01T14:00:00.000Z', 'earlier'),
      fixture(),
      session('a', at(4)),
      session('b', at(8)),
      session('c', at(10)),
    ]);

    expect(cycle.spanDays).toBe(11);
    expect(cycle.days).toHaveLength(3);
  });

  it('ignores sessions before the previous match', () => {
    // Those belong to the previous cycle, and counting them would make every week look busier
    // than it was.
    const cycle = senior([
      fixture('2026-09-05T14:00:00.000Z', 'last-week'),
      fixture(),
      session('last-tuesday', at(1)),
      session('this-thursday', at(10)),
    ]);

    expect(cycle.days.map((day) => day.session.id)).toEqual(['this-thursday']);
  });

  it('ignores a session on the match day itself', () => {
    // That is the warm-up, not a training day, and it would otherwise render an MD row.
    const cycle = senior([fixture(), session('warm-up', '2026-09-12T12:00:00.000Z')]);
    expect(cycle.days).toEqual([]);
  });

  it('ignores anything after the match', () => {
    const cycle = senior([fixture(), session('after', at(14))]);
    expect(cycle.days).toEqual([]);
  });

  it('has no span when there was no previous match', () => {
    const cycle = senior([fixture(), session('tue', at(8))]);
    expect(cycle.spanDays).toBeNull();
    expect(cycle.days).toHaveLength(1);
  });
});

describe('what the pattern suggests', () => {
  it('offers the classical reading for a standard week', () => {
    const cycle = senior([
      fixture(),
      session('tue', at(8)),
      session('wed', at(9)),
      session('thu', at(10)),
      session('fri', at(11)),
    ]);

    expect(cycle.days.map((day) => day.suggested)).toEqual([
      'tension',
      'duration',
      'velocity',
      'activation',
    ]);
  });

  it('suggests recovery the day after a match, whatever the pattern says', () => {
    // The one thing every source agrees on.
    const cycle = senior([
      fixture('2026-09-06T14:00:00.000Z', 'sunday'),
      fixture(),
      session('mon', at(7)),
      session('thu', at(10)),
    ]);

    expect(cycle.days[0]?.suggested).toBe('recovery');
  });

  /**
   * Beyond the pattern's range it suggests nothing rather than extrapolating — a mapping whose
   * own sources disagree inside its range has no business being extended past it.
   */
  it('suggests nothing for a day the pattern does not cover', () => {
    const cycle = senior([
      fixture('2026-09-01T14:00:00.000Z', 'earlier'),
      fixture(),
      session('six-days-out', at(6)),
    ]);

    expect(cycle.days[0]?.label).toBe('MD-6');
    expect(cycle.days[0]?.suggested).toBeNull();
  });

  it('honours a coach’s own pattern over the classical one', () => {
    // In tactical periodization the morphocycle derives from the club's game model, so the
    // pattern is the coach's. This is the method's position, not a hedge.
    const cycle = senior([fixture(), session('thu', at(10))], fixture(), { 2: 'duration' });
    expect(cycle.days[0]?.suggested).toBe('duration');
  });

  it('reports where the coach departed from the pattern, without correcting it', () => {
    const cycle = senior([
      fixture(),
      session('thu', at(10), { effortQuality: 'duration' }), // MD-2, pattern says velocity
      session('fri', at(11), { effortQuality: 'activation' }), // MD-1, agrees
    ]);

    const departures = departuresFromPattern(cycle);
    expect(departures).toHaveLength(1);
    expect(departures[0]?.session.id).toBe('thu');
  });
});

describe('horizontal alternation', () => {
  /**
   * The method's whole claim about a week is that the same sub-dynamic is not hammered on
   * consecutive days. This is the one thing in the morphocycle the app can check rather than
   * merely display.
   */
  it('names a quality worked on consecutive days', () => {
    const cycle = senior([
      fixture(),
      session('wed', at(9), { effortQuality: 'tension' }),
      session('thu', at(10), { effortQuality: 'tension' }),
    ]);

    expect(repeatedQualities(cycle)).toEqual(['tension']);
  });

  it('says nothing when the week alternates', () => {
    const cycle = senior([
      fixture(),
      session('wed', at(9), { effortQuality: 'tension' }),
      session('thu', at(10), { effortQuality: 'velocity' }),
    ]);

    expect(repeatedQualities(cycle)).toEqual([]);
  });

  it('does not flag consecutive recovery or activation days', () => {
    // Only the acquisitive qualities carry the week's demand, so only those can be hammered.
    const cycle = senior([
      fixture(),
      session('wed', at(9), { effortQuality: 'recovery' }),
      session('thu', at(10), { effortQuality: 'recovery' }),
    ]);

    expect(repeatedQualities(cycle)).toEqual([]);
  });
});

describe('the youth gate', () => {
  /**
   * The safeguarding line from ADR 0007. Tension, duration and velocity are adult load
   * concepts, and a professional club runs an academy full of children on the same app.
   */
  const youth = (sessions: readonly CycleSession[]) =>
    morphocycleFor(fixture(), sessions, { level: 'youth' });

  it('still builds the cycle, because the sessions before a game are just facts', () => {
    const cycle = youth([fixture(), session('tue', at(8)), session('thu', at(10))]);
    expect(cycle.days).toHaveLength(2);
    expect(cycle.days.map((day) => day.label)).toEqual(['MD-4', 'MD-2']);
  });

  it('allows no load labelling', () => {
    expect(youth([fixture()]).loadLabellingAllowed).toBe(false);
    expect(senior([fixture()]).loadLabellingAllowed).toBe(true);
  });

  it('reports no departures and no repeats, whatever is stored', () => {
    // Even if a squad was switched from senior to youth with labels already recorded, the
    // youth view must not start reasoning about them.
    const cycle = youth([
      fixture(),
      session('wed', at(9), { effortQuality: 'tension' }),
      session('thu', at(10), { effortQuality: 'tension' }),
    ]);

    expect(repeatedQualities(cycle)).toEqual([]);
    expect(departuresFromPattern(cycle)).toEqual([]);
  });

  it('describes the week without a word about load', () => {
    const cycle = youth([fixture(), session('tue', at(8)), session('thu', at(10))]);
    const text = describeMorphocycle(cycle)!;
    expect(text).toBe('2 sessions before this game.');
    expect(text).not.toMatch(/tension|duration|velocity|acquisitive/i);
  });
});

describe('describeMorphocycle', () => {
  it('says nothing when there are no sessions before the game', () => {
    expect(describeMorphocycle(senior([fixture()]))).toBeNull();
  });

  it('counts the sessions and the span', () => {
    const cycle = senior([
      fixture('2026-09-05T14:00:00.000Z', 'last-week'),
      fixture(),
      session('tue', at(8)),
      session('thu', at(10)),
    ]);
    expect(describeMorphocycle(cycle)).toBe(
      '2 sessions before this game, 7 days since the last one. None labelled yet.',
    );
  });

  it('counts the acquisitive days once labelled', () => {
    const cycle = senior([
      fixture(),
      session('tue', at(8), { effortQuality: 'tension' }),
      session('wed', at(9), { effortQuality: 'recovery' }),
      session('thu', at(10), { effortQuality: 'velocity' }),
    ]);
    expect(describeMorphocycle(cycle)).toContain('2 acquisitive');
  });

  it('names a quality worked twice running', () => {
    const cycle = senior([
      fixture(),
      session('wed', at(9), { effortQuality: 'tension' }),
      session('thu', at(10), { effortQuality: 'tension' }),
    ]);
    expect(describeMorphocycle(cycle)).toContain('Tension worked on consecutive days');
  });

  it('prescribes nothing', () => {
    // No load numbers, no targets, no advice — the app reports the labels a coach assigned.
    const cycle = senior([
      fixture(),
      session('tue', at(8), { effortQuality: 'tension' }),
      session('thu', at(10), { effortQuality: 'velocity' }),
    ]);
    expect(describeMorphocycle(cycle)!).not.toMatch(/should|must|too much|target|%|RPE/i);
  });
});

describe('the vocabulary', () => {
  it('labels and explains every quality', () => {
    for (const quality of EFFORT_QUALITIES) {
      expect(EFFORT_QUALITY_LABELS[quality]).toBeTruthy();
      expect(EFFORT_QUALITY_HINTS[quality]).toBeTruthy();
    }
  });

  it('counts only the three sub-dynamics as acquisitive', () => {
    expect(EFFORT_QUALITIES.filter(isAcquisitive)).toEqual(['tension', 'duration', 'velocity']);
  });

  it('ships a pattern that covers the four days before a game', () => {
    expect(Object.keys(CLASSICAL_PATTERN).sort()).toEqual(['1', '2', '3', '4']);
  });
});
