import { describe, expect, it } from 'vitest';
import {
  currentPhase,
  describeInterventionSummary,
  interventionSummary,
  isReviewable,
  mainPracticePhase,
  nextPhase,
  phaseOverruns,
  phasePosition,
  sessionStage,
  undeliveredCoachingPoints,
} from './selectors';
import { applySessionCommand } from './state-machine';
import { unwrap } from '@/lib/result';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { asInterventionEventId, asReviewId } from '../ids';
import { isoDateTime } from '../primitives';
import { buildSessionFromMethodology } from './build-from-methodology';
import { PLAY_PRACTICE_PLAY, WHOLE_PART_WHOLE } from '../presets';
import { aPhase, aSession, aSquad, T0 } from '@/test/builders';

const nowIso = (clock: FakeClock) => isoDateTime(clock.nowIso());

function startedSession(preset = PLAY_PRACTICE_PLAY) {
  const draft = buildSessionFromMethodology(preset, {
    squad: aSquad(),
    objective: {
      text: 'Playing out',
      successCriteria: [],
      sourceActionId: null,
      principleId: null,
      commonMisconception: null,
    },
    now: T0,
    ids: new FakeIdGenerator(),
  });
  const planned = unwrap(applySessionCommand(draft, { kind: 'commitPlan' }, T0));
  return unwrap(applySessionCommand(planned, { kind: 'start' }, T0));
}

const eventId = (n: number) =>
  asInterventionEventId(`00000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, '0')}`);

describe('sessionStage', () => {
  it('maps status to the screen the coach should be on', () => {
    expect(sessionStage(aSession({ status: 'draft' }))).toBe('plan');
    expect(sessionStage(aSession({ status: 'planned' }))).toBe('plan');
    expect(sessionStage(startedSession())).toBe('do');
  });

  it('derives "needs review" rather than adding a sixth status', () => {
    const completed = unwrap(applySessionCommand(startedSession(), { kind: 'finish' }, T0));
    expect(sessionStage(completed)).toBe('review');
    expect(isReviewable(completed)).toBe(true);

    const reviewed = {
      ...completed,
      reviewId: asReviewId('00000000-0000-4000-8000-0000000000r1'.replace('r', 'a')),
    };
    expect(sessionStage(reviewed)).toBe('archived');
    expect(isReviewable(reviewed)).toBe(false);
  });

  it('files an abandoned session under archived, reviewable or not', () => {
    const abandoned = unwrap(
      applySessionCommand(startedSession(), { kind: 'abandon', reason: 'Rain' }, T0),
    );
    expect(sessionStage(abandoned)).toBe('archived');
    expect(isReviewable(abandoned)).toBe(false);
  });
});

describe('phase navigation selectors', () => {
  it('resolves the current phase, its position and the next one', () => {
    const session = startedSession();
    expect(currentPhase(session)?.order).toBe(0);
    expect(phasePosition(session)).toEqual({ number: 1, count: 4 });
    expect(nextPhase(session)?.order).toBe(1);
  });

  it('reports the plan position after a jump backwards, not the run-log length', () => {
    const session = startedSession();
    const first = session.phases[0]!;
    const advanced = unwrap(applySessionCommand(session, { kind: 'nextPhase' }, T0));
    const back = unwrap(
      applySessionCommand(advanced, { kind: 'jumpToPhase', phaseId: first.id }, T0),
    );

    expect(phasePosition(back)).toEqual({ number: 1, count: 4 });
    expect(back.run?.phaseRuns).toHaveLength(3);
  });

  it('has no current phase before the session starts', () => {
    expect(currentPhase(aSession())).toBeUndefined();
    expect(phasePosition(aSession())).toEqual({ number: 0, count: 1 });
    expect(nextPhase(aSession())?.title).toBe('warmup');
  });
});

describe('mainPracticePhase', () => {
  it('picks the longest non-peripheral phase — "the big one in the middle"', () => {
    const session = startedSession();
    expect(mainPracticePhase(session)?.title).toMatch(/^PRACTICE/);
  });

  it('prefers the drill over the game when the clock cannot separate them', () => {
    // Whole-Part-Whole at 60 minutes gives PART and both WHOLE games fifteen minutes each.
    // A coaching point belongs in the part you are drilling.
    const session = startedSession(WHOLE_PART_WHOLE);
    const minutes = session.phases.map((p) => p.plannedDurationMin);
    expect(minutes.filter((m) => m === Math.max(...minutes))).toHaveLength(3);
    expect(mainPracticePhase(session)?.title).toMatch(/^PART/);
  });

  it('ignores warm-ups and water breaks even when they are long', () => {
    const session = aSession({
      phases: [
        aPhase('warmup', { order: 0, kind: 'warm_up', plannedDurationMin: 40 }),
        aPhase('practice', { order: 1, kind: 'skill_practice', plannedDurationMin: 15 }),
      ],
    });
    expect(mainPracticePhase(session)?.title).toBe('practice');
  });

  it('falls back to the longest phase when every phase is peripheral', () => {
    const session = aSession({
      phases: [
        aPhase('warmup', { order: 0, kind: 'warm_up', plannedDurationMin: 10 }),
        aPhase('huddle', { order: 1, kind: 'huddle', plannedDurationMin: 20 }),
      ],
    });
    expect(mainPracticePhase(session)?.title).toBe('huddle');
  });

  it('breaks a length tie on the earlier phase, for stability', () => {
    const session = aSession({
      phases: [
        aPhase('first', { order: 0, kind: 'skill_practice', plannedDurationMin: 20 }),
        aPhase('second', { order: 1, kind: 'skill_practice', plannedDurationMin: 20 }),
      ],
    });
    expect(mainPracticePhase(session)?.title).toBe('first');
  });

  it('returns undefined for a session with no phases at all', () => {
    expect(mainPracticePhase({ ...aSession(), phases: [] })).toBeUndefined();
  });
});

describe('interventionSummary', () => {
  it('reports a clean sheet for a session that never started', () => {
    const summary = interventionSummary(aSession(), Date.parse(T0));
    expect(summary.totalCount).toBe(0);
    expect(summary.stoppageMs).toBe(0);
    // Nothing ran, so nothing was interrupted. 1 is the honest answer, not 0.
    expect(summary.ballRollingRatio).toBe(1);
  });

  it('computes ball-rolling time from real stoppages, not estimates', () => {
    const clock = new FakeClock(T0);
    let session = startedSession();

    // 20 minutes of phase one, with three play-stopping interventions of a minute each.
    for (let i = 0; i < 3; i += 1) {
      clock.advanceMinutes(5);
      session = unwrap(
        applySessionCommand(
          session,
          { kind: 'logIntervention', id: eventId(i + 1), mechanic: 'play_stop_play' },
          nowIso(clock),
        ),
      );
      clock.advanceMinutes(1);
      session = unwrap(applySessionCommand(session, { kind: 'closeIntervention' }, nowIso(clock)));
    }
    clock.advanceMinutes(5);

    const summary = interventionSummary(session, clock.now());
    expect(summary.totalCount).toBe(3);
    expect(summary.stoppageMs).toBe(3 * 60_000);
    // 20 minutes of clock ran (the stoppages did not advance it); 3 of those minutes were
    // logged as stoppage, so 17 of 20 had the ball rolling.
    expect(summary.ballRollingMs).toBe(17 * 60_000);
    expect(summary.ballRollingRatio).toBeCloseTo(17 / 20, 5);
  });

  it('counts an in-flow intervention without charging it any stoppage', () => {
    const clock = new FakeClock(T0);
    let session = startedSession();
    clock.advanceMinutes(10);
    session = unwrap(
      applySessionCommand(
        session,
        { kind: 'logIntervention', id: eventId(1), mechanic: 'in_flow' },
        nowIso(clock),
      ),
    );
    clock.advanceMinutes(10);

    const summary = interventionSummary(session, clock.now());
    expect(summary.totalCount).toBe(1);
    expect(summary.stoppageMs).toBe(0);
    expect(summary.ballRollingRatio).toBe(1);
  });

  it('counts a still-open intervention up to now, so the live ratio is honest', () => {
    const clock = new FakeClock(T0);
    let session = startedSession();
    clock.advanceMinutes(10);
    session = unwrap(
      applySessionCommand(
        session,
        { kind: 'logIntervention', id: eventId(1), mechanic: 'play_stop_play' },
        nowIso(clock),
      ),
    );
    clock.advanceMinutes(2); // still talking

    const summary = interventionSummary(session, clock.now());
    expect(summary.stoppageMs).toBe(2 * 60_000);
    expect(summary.ballRollingMs).toBe(8 * 60_000);
  });

  it('flags the phases that went over budget', () => {
    let session = startedSession();
    for (let i = 0; i < 3; i += 1) {
      session = unwrap(
        applySessionCommand(session, { kind: 'logIntervention', id: eventId(i + 1) }, T0),
      );
    }

    const summary = interventionSummary(session, Date.parse(T0));
    expect(summary.overBudgetPhases).toEqual([session.phases[0]?.id]);
    expect(summary.byPhase[0]?.budget).toMatchObject({ max: 2, used: 3, isOverBudget: true });
  });

  it('reports a zero-budget phase as silent, and over the moment it is broken', () => {
    let session = startedSession();
    const finalPlay = session.phases[session.phases.length - 1]!;
    session = unwrap(
      applySessionCommand(session, { kind: 'jumpToPhase', phaseId: finalPlay.id }, T0),
    );

    const before = interventionSummary(session, Date.parse(T0));
    expect(before.byPhase[3]?.budget.isSilentPhase).toBe(true);
    expect(before.byPhase[3]?.budget.isOverBudget).toBe(false);

    session = unwrap(applySessionCommand(session, { kind: 'logIntervention', id: eventId(1) }, T0));
    expect(interventionSummary(session, Date.parse(T0)).overBudgetPhases).toEqual([finalPlay.id]);
  });

  it('sums a revisited phase across both of its runs', () => {
    const clock = new FakeClock(T0);
    let session = startedSession();
    const first = session.phases[0]!;

    clock.advanceMinutes(10);
    session = unwrap(applySessionCommand(session, { kind: 'nextPhase' }, nowIso(clock)));
    clock.advanceMinutes(5);
    session = unwrap(
      applySessionCommand(session, { kind: 'jumpToPhase', phaseId: first.id }, nowIso(clock)),
    );
    clock.advanceMinutes(4);

    const summary = interventionSummary(session, clock.now());
    expect(summary.byPhase[0]?.elapsedMs).toBe(14 * 60_000);
  });

  it('never reports a negative ball-rolling time, whatever the clock has done', () => {
    const clock = new FakeClock(T0);
    let session = startedSession();
    clock.advanceMinutes(1);
    session = unwrap(
      applySessionCommand(
        session,
        { kind: 'logIntervention', id: eventId(1), mechanic: 'play_stop_play' },
        nowIso(clock),
      ),
    );
    clock.advanceMinutes(30); // an intervention left open for half an hour

    const summary = interventionSummary(session, clock.now());
    expect(summary.ballRollingMs).toBeGreaterThanOrEqual(0);
    expect(summary.ballRollingRatio).toBeGreaterThanOrEqual(0);
    expect(summary.ballRollingRatio).toBeLessThanOrEqual(1);
  });
});

describe('describeInterventionSummary', () => {
  it('reads as the one line that makes the next-session fix land', () => {
    let session = startedSession();
    for (let i = 0; i < 3; i += 1) {
      session = unwrap(
        applySessionCommand(session, { kind: 'logIntervention', id: eventId(i + 1) }, T0),
      );
    }
    const line = describeInterventionSummary(interventionSummary(session, Date.parse(T0)));
    expect(line).toMatch(/^3 interventions, planned \d+\. Ball rolling time \d+%\.$/);
  });

  it('gets the singular right', () => {
    const session = unwrap(
      applySessionCommand(startedSession(), { kind: 'logIntervention', id: eventId(1) }, T0),
    );
    expect(describeInterventionSummary(interventionSummary(session, Date.parse(T0)))).toMatch(
      /^1 intervention,/,
    );
  });
});

describe('review inputs', () => {
  it('lists the coaching points the coach never got to', () => {
    const session = startedSession(WHOLE_PART_WHOLE);
    const all = session.phases.flatMap((p) => p.coachingPoints);
    expect(undeliveredCoachingPoints(session)).toHaveLength(all.length);

    const first = all[0]!;
    const delivered = unwrap(
      applySessionCommand(
        session,
        { kind: 'setCoachingPointState', pointId: first.id, state: 'said' },
        T0,
      ),
    );
    expect(undeliveredCoachingPoints(delivered)).toHaveLength(all.length - 1);
  });

  it('reports which phases ran over, biggest first, ignoring rounding', () => {
    const clock = new FakeClock(T0);
    let session = startedSession();
    const first = session.phases[0]!;

    clock.advanceMinutes(first.plannedDurationMin + 6);
    session = unwrap(applySessionCommand(session, { kind: 'nextPhase' }, nowIso(clock)));
    clock.advanceSeconds(20);

    const overruns = phaseOverruns(session, clock.now());
    expect(overruns).toHaveLength(1);
    expect(overruns[0]?.phase.id).toBe(first.id);
    expect(overruns[0]?.overrunMs).toBe(6 * 60_000);
  });

  it('reports nothing for a session that never ran', () => {
    expect(phaseOverruns(aSession(), Date.parse(T0))).toEqual([]);
  });
});
