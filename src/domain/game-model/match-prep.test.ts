import { describe, expect, it } from 'vitest';
import { describeCandidate, describePreparation, prepareMatch } from './match-prep';
import { reviewWeek } from './week-review';
import { morphocycleFor, type CycleSession } from '../morphocycle';
import { GameModelSchema, type GameModelInput, type PrincipleInput } from '../game-model';
import { MatchDetailsSchema, type MatchDetailsInput } from '../match-day';
import { asPrincipleId, type PrincipleId } from '../ids';
import { CURRENT_SCHEMA_VERSION } from '../primitives';
import { SQUAD_ID, T0, testId } from '@/test/builders';

const MATCH_DAY = '2026-09-12T14:00:00.000Z';
const at = (day: number): string => `2026-09-${String(day).padStart(2, '0')}T19:00:00.000Z`;

const principle = (over: Partial<PrincipleInput> & { id: string }): PrincipleInput => ({
  moment: 'offensive_organisation',
  level: 'macro',
  parentId: null,
  text: over.id,
  ...over,
  id: testId(over.id),
});

const model = () =>
  GameModelSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: T0,
    updatedAt: T0,
    id: testId('gm01'),
    squadId: SQUAD_ID,
    identity: 'We build from the back',
    principles: [
      principle({ id: 'build', text: 'Build from the back' }),
      principle({
        id: 'pivot',
        level: 'meso',
        parentId: testId('build'),
        text: 'Through the pivot',
      }),
      principle({ id: 'press', moment: 'defensive_organisation', text: 'Press high' }),
    ],
  } satisfies GameModelInput);

const match = (over: Partial<MatchDetailsInput> = {}) =>
  MatchDetailsSchema.parse({
    opponent: 'Eastfield Rovers',
    venue: 'away',
    fixtureType: 'league',
    format: '11v11',
    shapeName: '4-3-3',
    periodCount: 2,
    ...over,
  });

const fixture: CycleSession = {
  id: 'match',
  title: 'match',
  scheduledFor: MATCH_DAY,
  kind: 'match',
  effortQuality: null,
};

const training = (id: string, day: number): CycleSession => ({
  id,
  title: id,
  scheduledFor: at(day),
  kind: 'training',
  effortQuality: null,
});

/** A week that trained the given principles, in order. */
const weekTraining = (links: Record<string, string>) => {
  const sessions = Object.keys(links).map((id, index) => training(id, 8 + index));
  const cycle = morphocycleFor(fixture, [fixture, ...sessions], { level: 'senior' });
  const lookup = (id: string): PrincipleId | null => {
    const named = links[id];
    return named === undefined ? null : asPrincipleId(testId(named));
  };
  return reviewWeek(cycle, model(), lookup);
};

describe('the units to brief', () => {
  it('offers only the units the shape fields', () => {
    // A 2-1 has no midfield, so asking for a midfield brief would be asking a coach to brief
    // nobody.
    const prep = prepareMatch(match({ format: '3v3', shapeName: '2-1' }), weekTraining({}));
    expect(prep.units.map((unit) => unit.unit)).toEqual(['defence', 'attack']);
  });

  it('offers every unit when no shape has been chosen yet', () => {
    // An unset shape is a plan not yet finished, not a reason to block briefing.
    const prep = prepareMatch(match({ shapeName: null }), weekTraining({}));
    expect(prep.units.length).toBe(4);
  });

  it('attaches the objective a unit already has', () => {
    const prep = prepareMatch(
      match({ unitObjectives: [{ unit: 'midfield', text: 'Screen the back four' }] }),
      weekTraining({}),
    );
    const midfield = prep.units.find((unit) => unit.unit === 'midfield');
    expect(midfield?.objective?.text).toBe('Screen the back four');
    expect(prep.briefedCount).toBe(1);
  });
});

describe('the candidates', () => {
  it('offers the principles the week actually trained, in the order it ran them', () => {
    const prep = prepareMatch(match(), weekTraining({ tue: 'build', thu: 'pivot' }));
    expect(prep.candidates.map((p) => p.text)).toEqual([
      'Build from the back',
      'Through the pivot',
    ]);
  });

  it('offers a principle once however many sessions worked it', () => {
    const prep = prepareMatch(match(), weekTraining({ tue: 'build', wed: 'build', thu: 'pivot' }));
    expect(prep.candidates).toHaveLength(2);
  });

  it('offers nothing when the week named no principles', () => {
    expect(prepareMatch(match(), weekTraining({ tue: 'nothing' })).candidates).toEqual([]);
  });

  it('names the moment a candidate belongs to, and never a unit', () => {
    // A principle belongs to a moment, and a moment is not a unit — "build from the back"
    // concerns the keeper, the defence and the midfield at once.
    const prep = prepareMatch(match(), weekTraining({ tue: 'build' }));
    expect(describeCandidate(prep.candidates[0]!)).toBe('In possession');
  });
});

describe('trained but not briefed', () => {
  /**
   * The most useful line on the screen, and the reason to hold any of this as data: a principle
   * worked three times on the training pitch and briefed to nobody on Saturday is the gap
   * between a game model and a game.
   */
  it('names a principle the week trained and no unit was told about', () => {
    const prep = prepareMatch(match(), weekTraining({ tue: 'build', thu: 'pivot' }));
    expect(prep.unbriefed.map((p) => p.text)).toEqual(['Build from the back', 'Through the pivot']);
  });

  it('counts a principle as briefed once a unit carries its wording', () => {
    const prep = prepareMatch(
      match({ unitObjectives: [{ unit: 'defence', text: 'Build from the back' }] }),
      weekTraining({ tue: 'build', thu: 'pivot' }),
    );
    expect(prep.unbriefed.map((p) => p.text)).toEqual(['Through the pivot']);
  });

  it('matches on the wording rather than an exact id', () => {
    // A brief typed out by hand from the same line is the common case, and it should count.
    const prep = prepareMatch(
      match({ unitObjectives: [{ unit: 'defence', text: '  build from the back.  ' }] }),
      weekTraining({ tue: 'build' }),
    );
    expect(prep.unbriefed).toEqual([]);
  });
});

describe('describePreparation', () => {
  it('says nothing when the week trained nothing linked to the model', () => {
    // No gap to report, only a coach who has not used the link — saying so here would nag.
    expect(describePreparation(prepareMatch(match(), weekTraining({})))).toBeNull();
  });

  it('counts the briefed units and names the gap', () => {
    const prep = prepareMatch(match(), weekTraining({ tue: 'build', thu: 'pivot' }));
    expect(describePreparation(prep)).toBe(
      '0 of 4 units briefed. Trained but not briefed: "Build from the back" and "Through the pivot".',
    );
  });

  it('says so plainly when the week is fully briefed', () => {
    const prep = prepareMatch(
      match({ unitObjectives: [{ unit: 'defence', text: 'Build from the back' }] }),
      weekTraining({ tue: 'build' }),
    );
    expect(describePreparation(prep)).toBe(
      '1 of 4 units briefed. Everything the week trained is in a brief.',
    );
  });

  it('summarises rather than listing a long tail', () => {
    const prep = prepareMatch(match(), weekTraining({ a: 'build', b: 'pivot', c: 'press' }));
    expect(describePreparation(prep)).toContain('and 1 more');
  });

  it('prescribes nothing', () => {
    const prep = prepareMatch(match(), weekTraining({ tue: 'build' }));
    expect(describePreparation(prep)!).not.toMatch(/should|must|need to|remember to/i);
  });
});
