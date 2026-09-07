import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD_MIN, buildMatch, matchDayMethodology, periodsOf } from './build-match';
import { SessionSchema, phasesInOrder, totalPlannedPhaseMin } from '../session';
import { resolvePhaseIntervention } from '../intervention';
import { minutesPlayed } from '../match-day';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { aSquad, T0, playerId } from '@/test/builders';
import type { MatchDetailsInput } from '../match-day';

const objective = {
  text: 'Play out from the back',
  successCriteria: [],
  sourceActionId: null,
  principleId: null,
};

const fixture = (over: Partial<MatchDetailsInput> = {}): MatchDetailsInput => ({
  opponent: 'Eastfield Rovers',
  venue: 'away',
  fixtureType: 'league',
  format: '7v7',
  shapeName: '2-3-1',
  periodCount: 2,
  ...over,
});

const build = (over = {}, match: Partial<MatchDetailsInput> = {}) =>
  buildMatch({
    squad: aSquad(),
    objective,
    match: fixture(match),
    now: T0,
    ids: new FakeIdGenerator(),
    ...over,
  });

describe('buildMatch', () => {
  it('produces a valid match draft with no run', () => {
    const session = build();
    expect(session.kind).toBe('match');
    expect(session.status).toBe('draft');
    expect(session.run).toBeNull();
    expect(session.match?.opponent).toBe('Eastfield Rovers');
  });

  it('builds two halves with a half time between them', () => {
    const titles = phasesInOrder(build()).map((phase) => phase.title);
    expect(titles).toEqual(['First half', 'Half time', 'Second half']);
  });

  it('builds four quarters with a half time in the middle and breaks either side', () => {
    // Youth football commonly plays quarters. An app that assumed halves would be wrong for a
    // large share of the grassroots game.
    const titles = phasesInOrder(build({}, { periodCount: 4 })).map((phase) => phase.title);
    expect(titles).toEqual([
      'First quarter',
      'Break',
      'Second quarter',
      'Half time',
      'Third quarter',
      'Break',
      'Fourth quarter',
    ]);
  });

  it('makes the periods games and the intervals huddles', () => {
    const kinds = phasesInOrder(build()).map((phase) => phase.kind);
    // Both already existed in PhaseKind, which is why Do mode needs no idea a match is on.
    expect(kinds).toEqual(['game', 'huddle', 'game']);
  });

  it('gives periodsOf only the periods actually played', () => {
    expect(periodsOf(build({}, { periodCount: 4 })).map((p) => p.title)).toEqual([
      'First quarter',
      'Second quarter',
      'Third quarter',
      'Fourth quarter',
    ]);
  });

  it('defaults the period length by period count and totals the whole fixture', () => {
    const halves = build();
    expect(periodsOf(halves)[0]?.plannedDurationMin).toBe(DEFAULT_PERIOD_MIN[2]);
    expect(halves.plannedDurationMin).toBe(totalPlannedPhaseMin(halves));

    const quarters = build({}, { periodCount: 4 });
    expect(periodsOf(quarters)[0]?.plannedDurationMin).toBe(DEFAULT_PERIOD_MIN[4]);
  });

  it('honours an explicit period length', () => {
    expect(periodsOf(build({ periodMin: 35 }))[0]?.plannedDurationMin).toBe(35);
  });
});

describe('how a coach is allowed to coach during a match', () => {
  it('gives every period a zero intervention budget', () => {
    // You cannot stop a referee's game to coach, so the app must not offer a button that
    // implies you can. This is the same modelling that makes "let them play" a budget rather
    // than a slogan in Play-Practice-Play's final phase.
    const session = build();
    for (const period of periodsOf(session)) {
      const plan = resolvePhaseIntervention(session, period);
      expect(plan.maxPerPhase).toBe(0);
      expect(plan.mechanic).toBe('none');
    }
  });

  it('gives half time a real budget, aimed at a unit', () => {
    const session = build();
    const halfTime = phasesInOrder(session).find((phase) => phase.title === 'Half time')!;
    const plan = resolvePhaseIntervention(session, halfTime);
    expect(plan.maxPerPhase).toBe(2);
    expect(plan.audience).toBe('unit');
  });

  it('snapshots match day as hands off, without joining the training presets', () => {
    const session = build();
    expect(session.methodology.name).toBe('Match day');
    expect(session.methodology.coachStance).toBe('hands_off');
    expect(matchDayMethodology(T0).methodologyId).toBe('match-day');
  });
});

describe('a match period is not a designed practice', () => {
  it('leaves the practice-design fields null on every phase', () => {
    // A game is the thing practices are representative *of*. Filling these in would put
    // invented practice design into a season report.
    for (const phase of build().phases) {
      expect(phase.spectrum).toBeNull();
      expect(phase.area).toBeNull();
      expect(phase.groupSize).toBeNull();
      expect(phase.constraints).toEqual([]);
    }
  });
});

describe('the match / training discriminator', () => {
  it('rejects a match with no match details', () => {
    const session = build();
    expect(() => SessionSchema.parse({ ...session, match: null })).toThrow();
  });

  it('rejects a training session carrying match details', () => {
    const session = build();
    expect(() => SessionSchema.parse({ ...session, kind: 'training' })).toThrow();
  });

  it('rejects a shape that is not played at this format', () => {
    expect(() => build({}, { format: '5v5', shapeName: '4-3-3' })).toThrow();
  });

  it('accepts a shape that is played at this format', () => {
    expect(build({}, { format: '5v5', shapeName: '2-2' }).match?.shapeName).toBe('2-2');
  });

  it('rejects more starters than the format has shirts', () => {
    const lineup = Array.from({ length: 8 }, (_, index) => ({
      playerId: playerId(`p${index}`),
      unit: 'midfield' as const,
    }));
    expect(() => build({}, { format: '7v7', lineup })).toThrow();
  });

  it('rejects two objectives for the same unit', () => {
    expect(() =>
      build(
        {},
        {
          unitObjectives: [
            { unit: 'midfield', text: 'Screen the back three' },
            { unit: 'midfield', text: 'Get forward' },
          ],
        },
      ),
    ).toThrow();
  });

  it('accepts one objective per unit', () => {
    const session = build(
      {},
      {
        unitObjectives: [
          { unit: 'defence', text: 'Start the play, do not clear it' },
          { unit: 'midfield', text: 'Screen in front of the back three' },
        ],
      },
    );
    expect(session.match?.unitObjectives).toHaveLength(2);
  });

  it('rejects presence recorded against a period that does not exist', () => {
    const session = build();
    expect(() =>
      SessionSchema.parse({
        ...session,
        match: {
          ...session.match,
          presence: [{ phaseId: playerId('ghost'), playerIds: [] }],
        },
      }),
    ).toThrow();
  });
});

describe('minutes, end to end', () => {
  it('adds up a player who played one half of two', () => {
    const session = build();
    const periods = periodsOf(session);
    const kai = playerId('kai');

    const withPresence = SessionSchema.parse({
      ...session,
      match: {
        ...session.match,
        presence: [
          { phaseId: periods[0]!.id, playerIds: [kai] },
          { phaseId: periods[1]!.id, playerIds: [] },
        ],
      },
    });

    const actual = new Map(periods.map((period) => [period.id, period.plannedDurationMin]));
    expect(minutesPlayed(withPresence.match!, actual).get(kai)).toBe(DEFAULT_PERIOD_MIN[2]);
  });
});
