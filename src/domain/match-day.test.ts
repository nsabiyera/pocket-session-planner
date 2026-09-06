import { describe, expect, it } from 'vitest';
import {
  MATCH_FORMATS,
  MATCH_UNITS,
  SHAPES_BY_FORMAT,
  describeFixture,
  describeShape,
  findShape,
  hasGoalkeeper,
  matchFormatOf,
  matchOutcome,
  minutesPlayed,
  periodName,
  shapesFor,
  teamSizeOf,
  unitCountsOf,
  unitsOf,
  type MatchDetails,
  type MatchFormat,
} from './match-day';
import { AGE_BANDS } from './practice/match';

describe('formats and team sizes', () => {
  it('reads the team size out of the format name', () => {
    expect(teamSizeOf('5v5')).toBe(5);
    expect(teamSizeOf('11v11')).toBe(11);
  });

  it('plays 3v3 without goalkeepers, and everything else with one', () => {
    // The FA's u7 format has no keepers. Getting this wrong is the kind of detail that tells
    // a coach immediately whether the app was written by someone who has been there.
    expect(hasGoalkeeper('3v3')).toBe(false);
    for (const format of MATCH_FORMATS.filter((f) => f !== '3v3')) {
      expect(hasGoalkeeper(format)).toBe(true);
    }
  });

  it('answers the format from the age band the squad already has', () => {
    expect(matchFormatOf('u7')).toBe('3v3');
    expect(matchFormatOf('u9')).toBe('5v5');
    expect(matchFormatOf('u11')).toBe('7v7');
    expect(matchFormatOf('u13')).toBe('9v9');
    expect(matchFormatOf('u16')).toBe('11v11');
  });

  it('has a format for every age band the app knows', () => {
    for (const band of AGE_BANDS) {
      expect(matchFormatOf(band)).not.toBeNull();
    }
  });
});

describe('the shapes', () => {
  /**
   * The load-bearing test. A shape that does not field exactly the format's team is a shape
   * that would put a coach on the pitch a player short, and it would look perfectly plausible
   * in a list.
   */
  it.each(MATCH_FORMATS)('every %s shape fields exactly the right number of players', (format) => {
    const size = teamSizeOf(format);
    for (const shape of shapesFor(format)) {
      const outfield = shape.lines.reduce((total, line) => total + line, 0);
      const keeper = hasGoalkeeper(format) ? 1 : 0;
      expect(outfield + keeper, `${format} ${shape.name}`).toBe(size);
    }
  });

  it.each(MATCH_FORMATS)('names every %s shape by its own numbers', (format) => {
    for (const shape of shapesFor(format)) {
      expect(shape.name).toBe(shape.lines.join('-'));
    }
  });

  it.each(MATCH_FORMATS)('offers %s more than one shape, and never a duplicate', (format) => {
    const names = shapesFor(format).map((shape) => shape.name);
    expect(names.length).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);
  });

  it('never offers a shape from another format', () => {
    // Offering a u9 coach a 4-3-3 would be the app being confidently wrong in public.
    expect(findShape('5v5', '4-3-3')).toBeUndefined();
    expect(findShape('11v11', '2-3-1')).toBeUndefined();
    expect(findShape('7v7', '2-3-1')).toBeDefined();
  });

  it('derives units back to front, folding the middle bands into midfield', () => {
    const shape = findShape('11v11', '4-2-3-1')!;
    // A 4-2-3-1 has two midfield bands; a coach still calls all five of them the midfield.
    expect(unitCountsOf(shape, '11v11')).toEqual({
      goalkeeper: 1,
      defence: 4,
      midfield: 5,
      attack: 1,
    });
  });

  it('gives a two-line shape no midfield rather than a guessed one', () => {
    const shape = findShape('3v3', '2-1')!;
    expect(unitCountsOf(shape, '3v3')).toEqual({
      goalkeeper: 0,
      defence: 2,
      midfield: 0,
      attack: 1,
    });
    expect(unitsOf(shape, '3v3')).toEqual(['defence', 'attack']);
  });

  it('lists only the units a shape actually fields', () => {
    expect(unitsOf(findShape('7v7', '2-3-1')!, '7v7')).toEqual([
      'goalkeeper',
      'defence',
      'midfield',
      'attack',
    ]);
  });

  it('describes a shape the way a coach would say it', () => {
    expect(describeShape(findShape('7v7', '2-3-1')!, '7v7')).toBe(
      '2-3-1 — a back two, three in midfield, one up top.',
    );
  });
});

describe('periods', () => {
  it('names halves and quarters, not array indexes', () => {
    expect(periodName(0, 2)).toBe('First half');
    expect(periodName(1, 2)).toBe('Second half');
    expect(periodName(0, 4)).toBe('First quarter');
    expect(periodName(3, 4)).toBe('Fourth quarter');
  });
});

const details = (over: Partial<MatchDetails> = {}): MatchDetails => ({
  opponent: 'Eastfield Rovers',
  venue: 'away',
  fixtureType: 'league',
  format: '7v7' as MatchFormat,
  shapeName: '2-3-1',
  periodCount: 2,
  unitObjectives: [],
  lineup: [],
  presence: [],
  result: null,
  conditions: '',
  ...over,
});

describe('minutes played', () => {
  it('adds up the periods a player was on for', () => {
    const match = details({
      presence: [
        { phaseId: 'p1' as never, playerIds: ['kai' as never, 'sam' as never] },
        { phaseId: 'p2' as never, playerIds: ['kai' as never] },
      ],
    });
    const minutes = minutesPlayed(
      match,
      new Map([
        ['p1', 20],
        ['p2', 20],
      ]),
    );
    expect(minutes.get('kai')).toBe(40);
    expect(minutes.get('sam')).toBe(20);
  });

  it('uses what a period actually ran, not what was planned', () => {
    const match = details({
      presence: [{ phaseId: 'p1' as never, playerIds: ['kai' as never] }],
    });
    // The referee stretched the half. The report should say so.
    expect(minutesPlayed(match, new Map([['p1', 26]])).get('kai')).toBe(26);
  });

  it('returns nothing for a player who was not there, rather than zero', () => {
    // Absent and benched are different facts, and the difference is the whole point of
    // recording minutes at all.
    const minutes = minutesPlayed(details({ presence: [] }), new Map());
    expect(minutes.has('kai')).toBe(false);
  });
});

describe('the result', () => {
  it('says won, lost or drew', () => {
    expect(matchOutcome({ goalsFor: 3, goalsAgainst: 1 })).toBe('Won 3–1');
    expect(matchOutcome({ goalsFor: 0, goalsAgainst: 4 })).toBe('Lost 0–4');
    expect(matchOutcome({ goalsFor: 2, goalsAgainst: 2 })).toBe('Drew 2–2');
  });

  it('says nothing at all when nobody recorded it', () => {
    expect(matchOutcome(null)).toBeNull();
  });
});

describe('the fixture line', () => {
  it('reads like a coach wrote it', () => {
    expect(describeFixture(details({ venue: 'away' }))).toBe('Away to Eastfield Rovers');
    expect(describeFixture(details({ venue: 'home' }))).toBe('At home to Eastfield Rovers');
    expect(describeFixture(details({ venue: 'neutral' }))).toBe('Against Eastfield Rovers');
  });
});

describe('the vocabulary', () => {
  it('names four units, keeper first', () => {
    expect(MATCH_UNITS).toEqual(['goalkeeper', 'defence', 'midfield', 'attack']);
  });

  it('has shapes for every format', () => {
    for (const format of MATCH_FORMATS) {
      expect(SHAPES_BY_FORMAT[format].length).toBeGreaterThan(0);
    }
  });
});
