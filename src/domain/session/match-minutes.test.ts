import { describe, expect, it } from 'vitest';
import { buildMatch, periodsOf } from './build-match';
import { describeMinutes, matchMinutes, periodMinutes } from './match-minutes';
import { applySessionCommand } from './state-machine';
import { SessionSchema, type Session } from '../session';
import { isoDateTime, msOf } from '../primitives';
import { unwrap } from '@/lib/result';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { aSquad, T0, playerId } from '@/test/builders';
import type { PlayerId } from '../ids';

const KAI = playerId('kai');
const SAM = playerId('sam');
const ROSA = playerId('rosa');
const SQUAD: PlayerId[] = [KAI, SAM, ROSA];

const objective = { text: 'Play out from the back', successCriteria: [], sourceActionId: null };

function aMatch(periodCount: 2 | 4 = 2): Session {
  return buildMatch({
    squad: aSquad(),
    objective,
    match: {
      opponent: 'Eastfield Rovers',
      venue: 'home',
      fixtureType: 'league',
      format: '7v7',
      shapeName: '2-3-1',
      periodCount,
    },
    now: T0,
    ids: new FakeIdGenerator(),
    periodMin: 20,
  });
}

/** Plays the match through, leaving each period with a real elapsed time. */
function played(session: Session, minutesPerPeriod: number[]): Session {
  let current = unwrap(applySessionCommand(session, { kind: 'commitPlan' }, T0));
  let clock = msOf(T0);
  current = unwrap(applySessionCommand(current, { kind: 'start' }, isoDateTime(iso(clock))));

  minutesPerPeriod.forEach((minutes, index) => {
    clock += minutes * 60_000;
    const at = isoDateTime(iso(clock));
    const isLast = index === minutesPerPeriod.length - 1;
    current = unwrap(applySessionCommand(current, { kind: isLast ? 'finish' : 'nextPhase' }, at));
    if (!isLast) {
      // Step straight through the break so the next period starts clean.
      clock += 60_000;
      current = unwrap(
        applySessionCommand(current, { kind: 'nextPhase' }, isoDateTime(iso(clock))),
      );
    }
  });

  return current;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z');

function withPresence(session: Session, presence: { phaseId: string; playerIds: PlayerId[] }[]) {
  return SessionSchema.parse({
    ...session,
    match: { ...session.match, presence },
  });
}

describe('periodMinutes', () => {
  it('is empty before the match has run', () => {
    expect(periodMinutes(aMatch()).size).toBe(0);
  });

  it('reports what a period actually ran, not what was planned', () => {
    // The referee stretched the first half. The report should say 26, not 20.
    const session = played(aMatch(), [26, 20]);
    const periods = periodsOf(session);
    const minutes = periodMinutes(session, msOf(T0) + 60 * 60_000);

    expect(minutes.get(periods[0]!.id)).toBe(26);
    expect(minutes.get(periods[1]!.id)).toBe(20);
  });

  it('counts only the periods, never the breaks', () => {
    const session = played(aMatch(), [20, 20]);
    expect(periodMinutes(session, msOf(T0) + 60 * 60_000).size).toBe(2);
  });
});

describe('matchMinutes', () => {
  it('is null for a training session', () => {
    const training = { ...aMatch(), kind: 'training' as const, match: null };
    expect(matchMinutes(training, SQUAD)).toBeNull();
  });

  it('adds a player’s periods up into minutes', () => {
    const session = played(aMatch(), [20, 20]);
    const periods = periodsOf(session);
    const withRecord = withPresence(session, [
      { phaseId: periods[0]!.id, playerIds: [KAI, SAM] },
      { phaseId: periods[1]!.id, playerIds: [KAI] },
    ]);

    const report = matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000)!;
    const byPlayer = new Map(report.rows.map((row) => [row.playerId, row]));

    expect(byPlayer.get(KAI)?.minutes).toBe(40);
    expect(byPlayer.get(SAM)?.minutes).toBe(20);
    expect(byPlayer.get(SAM)?.periodsPlayed).toBe(1);
    expect(report.availableMinutes).toBe(40);
  });

  /**
   * The ordering is the feature. The reason to open this report is to find the player who
   * barely got on, and sorting by most-played puts that answer at the bottom of the list.
   */
  it('puts the least played first', () => {
    const session = played(aMatch(), [20, 20]);
    const periods = periodsOf(session);
    const withRecord = withPresence(session, [
      { phaseId: periods[0]!.id, playerIds: [KAI, SAM, ROSA] },
      { phaseId: periods[1]!.id, playerIds: [KAI, SAM] },
    ]);

    const report = matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000)!;
    expect(report.rows[0]?.playerId).toBe(ROSA);
    expect(report.rows[0]?.minutes).toBe(20);
  });

  it('shows a player who never got on, rather than leaving them out', () => {
    const session = played(aMatch(), [20, 20]);
    const periods = periodsOf(session);
    const withRecord = withPresence(session, [
      { phaseId: periods[0]!.id, playerIds: [KAI] },
      { phaseId: periods[1]!.id, playerIds: [KAI] },
    ]);

    const report = matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000)!;
    // A list about who played that quietly omitted the two who did not would be useless.
    expect(report.rows).toHaveLength(3);
    expect(report.rows[0]?.minutes).toBe(0);
  });

  it('reports the share of the minutes actually available', () => {
    const session = played(aMatch(), [20, 20]);
    const periods = periodsOf(session);
    const withRecord = withPresence(session, [
      { phaseId: periods[0]!.id, playerIds: [KAI] },
      { phaseId: periods[1]!.id, playerIds: [] },
    ]);

    const report = matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000)!;
    expect(report.rows.find((row) => row.playerId === KAI)?.share).toBeCloseTo(0.5);
  });

  it('reports the spread between most and least played', () => {
    const session = played(aMatch(), [20, 20]);
    const periods = periodsOf(session);
    const withRecord = withPresence(session, [
      { phaseId: periods[0]!.id, playerIds: [KAI, SAM] },
      { phaseId: periods[1]!.id, playerIds: [KAI] },
    ]);

    expect(matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000)!.spreadMinutes).toBe(20);
  });

  it('knows when nothing was recorded', () => {
    const session = played(aMatch(), [20, 20]);
    expect(matchMinutes(session, SQUAD, msOf(T0) + 60 * 60_000)!.recorded).toBe(false);
  });
});

describe('describeMinutes', () => {
  it('says nothing when presence was never recorded', () => {
    // "0 minutes for everyone" would be an accusation built out of an unticked box.
    const session = played(aMatch(), [20, 20]);
    expect(describeMinutes(matchMinutes(session, SQUAD, msOf(T0) + 60 * 60_000))).toBeNull();
  });

  it('reports a spread, and who did not get on', () => {
    const session = played(aMatch(), [20, 20]);
    const periods = periodsOf(session);
    const withRecord = withPresence(session, [
      { phaseId: periods[0]!.id, playerIds: [KAI, SAM] },
      { phaseId: periods[1]!.id, playerIds: [KAI] },
    ]);

    expect(describeMinutes(matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000))).toBe(
      '2 played, between 20 and 40 minutes of 40. 1 did not get on. To the nearest half.',
    );
  });

  it('says so plainly when everyone played the same', () => {
    const session = played(aMatch(), [20, 20]);
    const periods = periodsOf(session);
    const withRecord = withPresence(session, [
      { phaseId: periods[0]!.id, playerIds: [KAI, SAM, ROSA] },
      { phaseId: periods[1]!.id, playerIds: [KAI, SAM, ROSA] },
    ]);

    expect(describeMinutes(matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000))).toBe(
      '3 played, 40 minutes each of 40. To the nearest half.',
    );
  });

  it('names quarters when the match was played in quarters', () => {
    const session = played(aMatch(4), [10, 10, 10, 10]);
    const periods = periodsOf(session);
    const withRecord = withPresence(
      session,
      periods.map((period) => ({ phaseId: period.id, playerIds: [KAI] })),
    );

    expect(describeMinutes(matchMinutes(withRecord, SQUAD, msOf(T0) + 60 * 60_000))).toContain(
      'To the nearest quarter.',
    );
  });
});

describe('the setPeriodPresence command', () => {
  it('records who was on for a period', () => {
    const session = played(aMatch(), [20, 20]);
    const period = periodsOf(session)[0]!;

    const next = unwrap(
      applySessionCommand(
        session,
        { kind: 'setPeriodPresence', phaseId: period.id, playerIds: [KAI, SAM] },
        T0,
      ),
    );
    expect(next.match?.presence).toEqual([{ phaseId: period.id, playerIds: [KAI, SAM] }]);
  });

  it('replaces that period rather than appending, so a correction is idempotent', () => {
    const session = played(aMatch(), [20, 20]);
    const period = periodsOf(session)[0]!;

    let next = unwrap(
      applySessionCommand(
        session,
        { kind: 'setPeriodPresence', phaseId: period.id, playerIds: [KAI] },
        T0,
      ),
    );
    next = unwrap(
      applySessionCommand(
        next,
        { kind: 'setPeriodPresence', phaseId: period.id, playerIds: [KAI, SAM] },
        T0,
      ),
    );

    expect(next.match?.presence).toHaveLength(1);
    expect(next.match?.presence[0]?.playerIds).toEqual([KAI, SAM]);
  });

  it('clears the period when nobody is ticked', () => {
    const session = played(aMatch(), [20, 20]);
    const period = periodsOf(session)[0]!;

    let next = unwrap(
      applySessionCommand(
        session,
        { kind: 'setPeriodPresence', phaseId: period.id, playerIds: [KAI] },
        T0,
      ),
    );
    next = unwrap(
      applySessionCommand(
        next,
        { kind: 'setPeriodPresence', phaseId: period.id, playerIds: [] },
        T0,
      ),
    );
    expect(next.match?.presence).toEqual([]);
  });

  it('refuses a training session', () => {
    const training = SessionSchema.parse({
      ...aMatch(),
      kind: 'training',
      match: null,
    });
    const result = applySessionCommand(
      training,
      { kind: 'setPeriodPresence', phaseId: training.phases[0]!.id, playerIds: [KAI] },
      T0,
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a break — presence belongs to a period', () => {
    const session = played(aMatch(), [20, 20]);
    const halfTime = session.phases.find((phase) => phase.kind === 'huddle')!;
    const result = applySessionCommand(
      session,
      { kind: 'setPeriodPresence', phaseId: halfTime.id, playerIds: [KAI] },
      T0,
    );
    expect(result.ok).toBe(false);
  });
});
