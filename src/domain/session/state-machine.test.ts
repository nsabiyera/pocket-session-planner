import { describe, expect, it } from 'vitest';
import { applySessionCommand, type SessionCommand } from './state-machine';
import { SessionSchema, type Session, type SessionStatus } from '../session';
import { isErr, unwrap } from '@/lib/result';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { asChallengeEventId, asInterventionEventId, asPracticeAdjustmentId } from '../ids';
import type { ChallengeStatus, PlayerChallenge } from '../challenge';
import { isoDateTime } from '../primitives';
import { buildSessionFromMethodology } from './build-from-methodology';
import { PLAY_PRACTICE_PLAY } from '../presets';
import { aChallenge, aSquad, challengeId, playerId, testId, T0 } from '@/test/builders';

const clockOf = () => new FakeClock(T0);
const nowIso = (clock: FakeClock) => isoDateTime(clock.nowIso());

function draftSession(): Session {
  return buildSessionFromMethodology(PLAY_PRACTICE_PLAY, {
    squad: aSquad(),
    objective: { text: 'Playing out from the back', successCriteria: [], sourceActionId: null },
    now: T0,
    ids: new FakeIdGenerator(),
  });
}

const apply = (session: Session, command: SessionCommand, at = T0) =>
  applySessionCommand(session, command, at);

const applyOk = (session: Session, command: SessionCommand, at = T0) =>
  unwrap(apply(session, command, at));

function plannedSession(): Session {
  return applyOk(draftSession(), { kind: 'commitPlan' });
}

function runningSession(): Session {
  return applyOk(plannedSession(), { kind: 'start' });
}

function completedSession(): Session {
  return applyOk(runningSession(), { kind: 'finish' });
}

function abandonedDraft(): Session {
  return applyOk(draftSession(), { kind: 'abandon', reason: 'Pitch flooded' });
}

describe('the reducer never throws and always produces a valid session', () => {
  const commands: SessionCommand[] = [
    { kind: 'commitPlan' },
    { kind: 'reopenPlan' },
    { kind: 'start' },
    { kind: 'pausePhase' },
    { kind: 'resumePhase' },
    { kind: 'nextPhase' },
    { kind: 'undoNextPhase' },
    { kind: 'skipPhase' },
    { kind: 'extendPhase', minutes: 5 },
    { kind: 'closeIntervention' },
    {
      kind: 'logChallengeProgress',
      id: asChallengeEventId(testId('sighting')),
      challengeId: challengeId('c1'),
    },
    { kind: 'undoChallengeProgress', challengeId: challengeId('c1') },
    { kind: 'setChallengeStatus', challengeId: challengeId('c1'), status: 'met' },
    { kind: 'heartbeat' },
    { kind: 'reconcileToLastActivity' },
    { kind: 'finish' },
    { kind: 'abandon', reason: 'Rain' },
    { kind: 'restore' },
  ];

  const states: Array<[SessionStatus, () => Session]> = [
    ['draft', draftSession],
    ['planned', plannedSession],
    ['in_progress', runningSession],
    ['completed', completedSession],
    ['abandoned', abandonedDraft],
  ];

  for (const [status, build] of states) {
    for (const command of commands) {
      it(`${command.kind} on a ${status} session returns a Result, never a throw`, () => {
        const result = apply(build(), command);
        if (result.ok) {
          // Anything the reducer emits must still satisfy every cross-field invariant.
          expect(SessionSchema.safeParse(result.value).success).toBe(true);
        } else {
          expect(result.error.code).toBeTruthy();
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('commitPlan', () => {
  it('moves a draft to planned', () => {
    expect(plannedSession().status).toBe('planned');
  });

  it('refuses a session with no phases', () => {
    const empty = { ...draftSession(), phases: [] };
    const result = apply(empty, { kind: 'commitPlan' });
    expect(isErr(result) && result.error.code).toBe('guard_failed');
  });

  it('allows phase durations that do not sum to the session total — a warning, not a block', () => {
    const short = {
      ...draftSession(),
      phases: draftSession().phases.map((p) => ({ ...p, plannedDurationMin: 5 })),
    };
    expect(apply(short, { kind: 'commitPlan' }).ok).toBe(true);
  });

  it('cannot be applied twice', () => {
    const result = apply(plannedSession(), { kind: 'commitPlan' });
    expect(isErr(result) && result.error.code).toBe('illegal_transition');
  });
});

describe('reopenPlan', () => {
  it('takes a planned session back to draft', () => {
    expect(applyOk(plannedSession(), { kind: 'reopenPlan' }).status).toBe('draft');
  });

  it('refuses a session that is already running', () => {
    const result = apply(runningSession(), { kind: 'reopenPlan' });
    expect(isErr(result) && result.error.code).toBe('illegal_transition');
  });
});

describe('start', () => {
  it('creates a run on the first phase and marks the session in progress', () => {
    const session = runningSession();
    expect(session.status).toBe('in_progress');
    expect(session.run?.phaseRuns).toHaveLength(1);
    expect(session.run?.phaseRuns[0]?.phaseId).toBe(session.phases[0]?.id);
    expect(session.run?.phaseRuns[0]?.runningSince).toBe(T0);
    expect(session.run?.currentPhaseIndex).toBe(0);
  });

  it('is idempotent — a double-tap in the rain must not restart the session', () => {
    const first = runningSession();
    const clock = clockOf();
    clock.advanceMinutes(5);
    const second = applyOk(first, { kind: 'start' }, nowIso(clock));
    expect(second.run?.startedAt).toBe(T0);
    expect(second.run?.phaseRuns).toHaveLength(1);
  });

  it('refuses to start a draft — commit the plan first', () => {
    const result = apply(draftSession(), { kind: 'start' });
    expect(isErr(result) && result.error.code).toBe('illegal_transition');
  });
});

describe('phase movement', () => {
  it('advances, ending the current run and opening the next', () => {
    const clock = clockOf();
    clock.advanceMinutes(10);
    const advanced = applyOk(runningSession(), { kind: 'nextPhase' }, nowIso(clock));

    expect(advanced.run?.phaseRuns).toHaveLength(2);
    expect(advanced.run?.phaseRuns[0]?.endedAt).toBe(nowIso(clock));
    expect(advanced.run?.phaseRuns[0]?.skipped).toBe(false);
    expect(advanced.run?.currentPhaseIndex).toBe(1);
  });

  it('marks a skipped phase as skipped, and still records what it ran', () => {
    const clock = clockOf();
    clock.advanceMinutes(2);
    const skipped = applyOk(runningSession(), { kind: 'skipPhase' }, nowIso(clock));
    expect(skipped.run?.phaseRuns[0]?.skipped).toBe(true);
    expect(skipped.run?.phaseRuns[0]?.accumulatedMs).toBe(2 * 60_000);
  });

  it('refuses to advance past the last phase — finish the session instead', () => {
    let session = runningSession();
    for (let i = 1; i < session.phases.length; i += 1) {
      session = applyOk(session, { kind: 'nextPhase' });
    }
    const result = apply(session, { kind: 'nextPhase' });
    expect(isErr(result) && result.error.code).toBe('already_at_boundary');
  });

  it('jumps to an arbitrary phase, appending a fresh run rather than reopening', () => {
    const session = runningSession();
    const last = session.phases[session.phases.length - 1]!;
    const jumped = applyOk(session, { kind: 'jumpToPhase', phaseId: last.id });

    expect(jumped.run?.phaseRuns).toHaveLength(2);
    expect(jumped.run?.phaseRuns[1]?.phaseId).toBe(last.id);
  });

  it('rejects a jump to a phase that is not in this session', () => {
    const result = apply(runningSession(), {
      kind: 'jumpToPhase',
      phaseId: '00000000-0000-4000-8000-0000000000ff' as never,
    });
    expect(isErr(result) && result.error.code).toBe('not_found');
  });

  it('refuses to undo when there is nothing to undo', () => {
    const result = apply(runningSession(), { kind: 'undoNextPhase' });
    expect(isErr(result) && result.error.code).toBe('already_at_boundary');
  });
});

describe('pause and resume', () => {
  it('folds the running stretch into accumulatedMs on pause', () => {
    const clock = clockOf();
    clock.advanceMinutes(3);
    const paused = applyOk(runningSession(), { kind: 'pausePhase' }, nowIso(clock));

    expect(paused.run?.phaseRuns[0]?.runningSince).toBeNull();
    expect(paused.run?.phaseRuns[0]?.accumulatedMs).toBe(3 * 60_000);
    expect(paused.run?.pauseReason).toBe('coach');
  });

  it('is idempotent in both directions', () => {
    const paused = applyOk(runningSession(), { kind: 'pausePhase' });
    expect(applyOk(paused, { kind: 'pausePhase' })).toEqual(paused);

    const resumed = applyOk(paused, { kind: 'resumePhase' });
    expect(applyOk(resumed, { kind: 'resumePhase' }).run?.phaseRuns[0]?.runningSince).toBe(
      resumed.run?.phaseRuns[0]?.runningSince,
    );
  });
});

describe('extendPhase', () => {
  it('rewrites the planned duration, because that is what the coach means', () => {
    const session = runningSession();
    const before = session.phases[0]!.plannedDurationMin;
    const extended = applyOk(session, { kind: 'extendPhase', minutes: 5 });
    expect(extended.phases[0]?.plannedDurationMin).toBe(before + 5);
  });

  it('shortens too, but never below one minute', () => {
    const session = runningSession();
    const result = apply(session, { kind: 'extendPhase', minutes: -999 });
    expect(isErr(result) && result.error.code).toBe('guard_failed');
  });
});

describe('interventions', () => {
  const logId = asInterventionEventId('00000000-0000-4000-8000-0000000000e1');

  it('pre-fills from the phase plan, so one tap is a complete record', () => {
    const session = runningSession();
    const logged = applyOk(session, { kind: 'logIntervention', id: logId });
    const event = logged.run?.interventionEvents[0];

    // The first Play-Practice-Play phase plans observation + in_flow, max 2.
    expect(event).toMatchObject({
      method: 'observation_feedback',
      mechanic: 'in_flow',
      audience: 'team',
      overBudget: false,
      durationMs: 0,
    });
  });

  it('stamps overBudget on the intervention that crosses the line, and never blocks', () => {
    let session = runningSession();
    const ids = ['e1', 'e2', 'e3'].map((suffix) =>
      asInterventionEventId(`00000000-0000-4000-8000-0000000000${suffix}`),
    );
    for (const id of ids) {
      session = applyOk(session, { kind: 'logIntervention', id });
    }

    const flags = session.run?.interventionEvents.map((e) => e.overBudget);
    expect(flags).toEqual([false, false, true]);
  });

  it('holds a coach to a zero budget by flagging the very first intervention', () => {
    let session = runningSession();
    const finalPlay = session.phases[session.phases.length - 1]!;
    session = applyOk(session, { kind: 'jumpToPhase', phaseId: finalPlay.id });
    session = applyOk(session, { kind: 'logIntervention', id: logId });

    expect(session.run?.interventionEvents[0]?.overBudget).toBe(true);
  });

  it('refuses to close an intervention that is not open', () => {
    const result = apply(runningSession(), { kind: 'closeIntervention' });
    expect(isErr(result) && result.error.code).toBe('guard_failed');
  });

  it('closes an open intervention when the phase advances', () => {
    const clock = clockOf();
    const session = applyOk(
      runningSession(),
      { kind: 'logIntervention', id: logId, mechanic: 'play_stop_play' },
      nowIso(clock),
    );
    clock.advanceSeconds(30);
    const advanced = applyOk(session, { kind: 'nextPhase' }, nowIso(clock));

    expect(advanced.run?.openInterventionId).toBeNull();
    expect(advanced.run?.interventionEvents[0]?.durationMs).toBe(30_000);
  });
});

describe('coaching points', () => {
  it('marks a point delivered and back again', () => {
    const session = runningSession();
    const point = session.phases.flatMap((p) => p.coachingPoints)[0]!;

    const delivered = applyOk(session, {
      kind: 'setCoachingPointDelivered',
      pointId: point.id,
      delivered: true,
    });
    const found = delivered.phases.flatMap((p) => p.coachingPoints).find((p) => p.id === point.id);
    expect(found?.delivered).toBe(true);
    expect(found?.deliveredAt).toBe(T0);

    const undone = applyOk(delivered, {
      kind: 'setCoachingPointDelivered',
      pointId: point.id,
      delivered: false,
    });
    expect(
      undone.phases.flatMap((p) => p.coachingPoints).find((p) => p.id === point.id)?.deliveredAt,
    ).toBeNull();
  });

  it('reports a point that is not in this session', () => {
    const result = apply(runningSession(), {
      kind: 'setCoachingPointDelivered',
      pointId: '00000000-0000-4000-8000-0000000000cc' as never,
      delivered: true,
    });
    expect(isErr(result) && result.error.code).toBe('not_found');
  });
});

const sightingId = (label: string) => asChallengeEventId(testId(label));

const logSighting = (label: string, challenge = 'c1'): SessionCommand => ({
  kind: 'logChallengeProgress',
  id: sightingId(label),
  challengeId: challengeId(challenge),
});

/** A running session holding one counted challenge for Kai, target 3. */
function runningWithChallenge(over: Partial<PlayerChallenge> = {}): Session {
  return { ...runningSession(), challenges: [aChallenge('c1', { targetCount: 3, ...over })] };
}

const currentPhaseIdOf = (session: Session) =>
  session.run?.phaseRuns[session.run.currentPhaseIndex]?.phaseId;

describe('logChallengeProgress', () => {
  it('appends a sighting stamped with the phase, the wall clock and the phase clock', () => {
    const clock = clockOf();
    const session = runningWithChallenge();
    clock.advanceMinutes(4);
    const logged = applyOk(session, logSighting('e1'), nowIso(clock));

    expect(logged.run?.challengeEvents).toEqual([
      {
        id: sightingId('e1'),
        challengeId: challengeId('c1'),
        phaseId: currentPhaseIdOf(session),
        at: nowIso(clock),
        phaseElapsedMs: 4 * 60_000,
      },
    ]);
    expect(SessionSchema.safeParse(logged).success).toBe(true);
  });

  it('is the tally: three taps are three events, never a counter', () => {
    let session = runningWithChallenge();
    for (const label of ['e1', 'e2', 'e3']) {
      session = applyOk(session, logSighting(label));
    }

    expect(session.run?.challengeEvents).toHaveLength(3);
    // Nothing on the challenge itself moved — the number is derived from the evidence.
    expect(session.challenges[0]?.status).toBe('open');
  });

  it('reports a challenge this session does not hold', () => {
    const result = apply(runningWithChallenge(), logSighting('e1', 'ghost'));
    expect(isErr(result) && result.error.code).toBe('not_found');
  });

  it('needs a running session — there is no phase to log a sighting against', () => {
    const planned = { ...plannedSession(), challenges: [aChallenge('c1', { targetCount: 3 })] };
    const result = apply(planned, logSighting('e1'));
    expect(isErr(result) && result.error.code).toBe('illegal_transition');
  });

  it('counts a sighting in a phase the challenge does not name', () => {
    // Phase scoping decides what Do mode puts in front of the coach. It does not get to tell
    // them they did not see what they just saw.
    const base = runningSession();
    const elsewhere = base.phases
      .filter((phase) => phase.id !== currentPhaseIdOf(base))
      .map((phase) => phase.id);
    const session = {
      ...base,
      challenges: [aChallenge('c1', { targetCount: 3, phaseIds: elsewhere.slice(0, 1) })],
    };

    const logged = applyOk(session, logSighting('e1'));
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(logged.run?.challengeEvents[0]?.phaseId).toBe(currentPhaseIdOf(base));
  });

  it('counts a sighting after the coach has already ruled on it', () => {
    const ruled = runningWithChallenge({ status: 'missed', settledAt: T0 });
    const logged = applyOk(ruled, logSighting('e1'));

    expect(logged.run?.challengeEvents).toHaveLength(1);
    // The ruling stays in charge of what is displayed; the sighting is still recorded.
    expect(logged.challenges[0]?.status).toBe('missed');
  });
});

describe('undoChallengeProgress', () => {
  const undo = (challenge = 'c1'): SessionCommand => ({
    kind: 'undoChallengeProgress',
    challengeId: challengeId(challenge),
  });

  it('pops the most recent sighting for that challenge and leaves the others alone', () => {
    let session: Session = {
      ...runningSession(),
      challenges: [
        aChallenge('c1', { targetCount: 3 }),
        aChallenge('c2', { targetCount: 3, playerId: playerId('maya') }),
      ],
    };
    session = applyOk(session, logSighting('e1', 'c1'));
    session = applyOk(session, logSighting('e2', 'c2'));
    session = applyOk(session, logSighting('e3', 'c1'));

    const undone = applyOk(session, undo('c1'));
    expect(undone.run?.challengeEvents.map((event) => event.id)).toEqual([
      sightingId('e1'),
      sightingId('e2'),
    ]);
    expect(SessionSchema.safeParse(undone).success).toBe(true);
  });

  it('cannot drive a tally below zero — an extra undo simply has nothing to pop', () => {
    const logged = applyOk(runningWithChallenge(), logSighting('e1'));
    const undone = applyOk(logged, undo());

    expect(undone.run?.challengeEvents).toEqual([]);
    const again = apply(undone, undo());
    expect(isErr(again) && again.error.code).toBe('not_found');
  });

  it('reports that there is no sighting to undo', () => {
    const result = apply(runningWithChallenge(), undo());
    expect(isErr(result) && result.error.code).toBe('not_found');
  });

  it('needs a running session', () => {
    const planned = { ...plannedSession(), challenges: [aChallenge('c1', { targetCount: 3 })] };
    expect(isErr(apply(planned, undo()))).toBe(true);
  });
});

describe('setChallengeStatus', () => {
  const rule = (status: ChallengeStatus, note?: string, challenge = 'c1'): SessionCommand => ({
    kind: 'setChallengeStatus',
    challengeId: challengeId(challenge),
    status,
    ...(note !== undefined ? { note } : {}),
  });

  it('records the ruling and when it was made', () => {
    const clock = clockOf();
    clock.advanceMinutes(50);
    const ruled = applyOk(runningWithChallenge(), rule('partly'), nowIso(clock));

    expect(ruled.challenges[0]?.status).toBe('partly');
    expect(ruled.challenges[0]?.settledAt).toBe(nowIso(clock));
    expect(SessionSchema.safeParse(ruled).success).toBe(true);
  });

  it('stores a note when one is given, and leaves an existing one alone when not', () => {
    const withNote = applyOk(runningWithChallenge(), rule('met', 'Two of them were superb'));
    expect(withNote.challenges[0]?.note).toBe('Two of them were superb');

    const reruled = applyOk(withNote, rule('partly'));
    expect(reruled.challenges[0]?.note).toBe('Two of them were superb');
  });

  it('un-rules back to open and clears settledAt — the Undo on the ruling toast', () => {
    const ruled = applyOk(runningWithChallenge(), rule('missed'));
    const reopened = applyOk(ruled, rule('open'));

    expect(reopened.challenges[0]?.status).toBe('open');
    expect(reopened.challenges[0]?.settledAt).toBeNull();
    // "Not ruled on, ruled on at 18:00" is not a state that means anything.
    expect(SessionSchema.safeParse(reopened).success).toBe(true);
  });

  it('rules on a finished session, because that is where Review happens', () => {
    const finished = applyOk(runningWithChallenge(), { kind: 'finish' });
    const ruled = applyOk(finished, rule('met'));

    expect(ruled.status).toBe('completed');
    expect(ruled.challenges[0]?.status).toBe('met');
  });

  it('rules on a session that never ran at all', () => {
    const planned = { ...plannedSession(), challenges: [aChallenge('c1', { targetCount: 3 })] };
    expect(applyOk(planned, rule('missed')).challenges[0]?.status).toBe('missed');
  });

  it('touches only the challenge named', () => {
    const session: Session = {
      ...runningSession(),
      challenges: [
        aChallenge('c1', { targetCount: 3 }),
        aChallenge('c2', { targetCount: 3, playerId: playerId('maya') }),
      ],
    };
    const ruled = applyOk(session, rule('met', undefined, 'c2'));

    expect(ruled.challenges[0]?.status).toBe('open');
    expect(ruled.challenges[1]?.status).toBe('met');
  });

  it('reports a challenge this session does not hold', () => {
    const result = apply(runningWithChallenge(), rule('met', undefined, 'ghost'));
    expect(isErr(result) && result.error.code).toBe('not_found');
  });
});

describe('finish', () => {
  it('ends the open phase run and the session', () => {
    const clock = clockOf();
    clock.advanceMinutes(58);
    const finished = applyOk(runningSession(), { kind: 'finish' }, nowIso(clock));

    expect(finished.status).toBe('completed');
    expect(finished.run?.endedAt).toBe(nowIso(clock));
    expect(finished.run?.phaseRuns[0]?.endedAt).toBe(nowIso(clock));
    expect(finished.run?.phaseRuns[0]?.accumulatedMs).toBe(58 * 60_000);
  });

  it('is idempotent, and terminal', () => {
    const finished = completedSession();
    expect(applyOk(finished, { kind: 'finish' })).toEqual(finished);
    expect(isErr(apply(finished, { kind: 'start' }))).toBe(true);
    expect(isErr(apply(finished, { kind: 'reopenPlan' }))).toBe(true);
    expect(isErr(apply(finished, { kind: 'abandon', reason: 'no' }))).toBe(true);
  });
});

describe('reconcileToLastActivity', () => {
  it('ends the session at the last heartbeat, not at now', () => {
    const clock = clockOf();
    let session = runningSession();
    clock.advanceMinutes(50);
    session = applyOk(session, { kind: 'heartbeat' }, nowIso(clock));

    const lastActivity = nowIso(clock);
    clock.advanceMinutes(60 * 5); // phone in a bag overnight

    const reconciled = applyOk(session, { kind: 'reconcileToLastActivity' }, nowIso(clock));
    expect(reconciled.status).toBe('completed');
    expect(reconciled.run?.endedAt).toBe(lastActivity);
    expect(reconciled.run?.phaseRuns[0]?.accumulatedMs).toBe(50 * 60_000);
  });
});

describe('abandon and restore', () => {
  it('requires a reason', () => {
    const result = apply(runningSession(), { kind: 'abandon', reason: '   ' });
    expect(isErr(result) && result.error.code).toBe('guard_failed');
  });

  it('preserves the run — twenty minutes of evidence is still evidence', () => {
    const clock = clockOf();
    clock.advanceMinutes(20);
    const abandoned = applyOk(
      runningSession(),
      { kind: 'abandon', reason: 'Thunder' },
      nowIso(clock),
    );

    expect(abandoned.status).toBe('abandoned');
    expect(abandoned.abandonReason).toBe('Thunder');
    expect(abandoned.run?.phaseRuns[0]?.accumulatedMs).toBe(20 * 60_000);
    expect(abandoned.run?.endedAt).toBe(nowIso(clock));
  });

  it('restores an abandoned session that never ran', () => {
    const restored = applyOk(abandonedDraft(), { kind: 'restore' });
    expect(restored.status).toBe('draft');
    expect(restored.abandonReason).toBeNull();
  });

  it('refuses to restore a session that was under way — duplicate it instead', () => {
    const abandoned = applyOk(runningSession(), { kind: 'abandon', reason: 'Thunder' });
    const result = apply(abandoned, { kind: 'restore' });
    expect(isErr(result) && result.error.code).toBe('guard_failed');
  });

  it('never allows abandoned to become in_progress again', () => {
    const abandoned = applyOk(runningSession(), { kind: 'abandon', reason: 'Thunder' });
    expect(isErr(apply(abandoned, { kind: 'start' }))).toBe(true);
  });
});

describe('bookkeeping', () => {
  it('bumps updatedAt on every successful command', () => {
    const clock = clockOf();
    clock.advanceMinutes(1);
    const started = applyOk(plannedSession(), { kind: 'start' }, nowIso(clock));
    expect(started.updatedAt).toBe(nowIso(clock));
    expect(started.createdAt).toBe(T0);
  });

  it('records a heartbeat without touching anything else', () => {
    const clock = clockOf();
    const session = runningSession();
    clock.advanceSeconds(30);
    const beaten = applyOk(session, { kind: 'heartbeat' }, nowIso(clock));

    expect(beaten.run?.lastHeartbeatAt).toBe(nowIso(clock));
    expect(beaten.run?.phaseRuns).toEqual(session.run?.phaseRuns);
  });

  it('leaves the input untouched — the reducer is pure', () => {
    const session = runningSession();
    const snapshot = JSON.parse(JSON.stringify(session));
    applyOk(session, { kind: 'nextPhase' });
    expect(JSON.parse(JSON.stringify(session))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Practice adjustments
// ---------------------------------------------------------------------------

const adjustmentId = (label: string) => asPracticeAdjustmentId(testId(label));

const logAdjustment = (
  label: string,
  direction: 'progressed' | 'regressed' = 'progressed',
  text = 'Add a second defender',
): SessionCommand => ({
  kind: 'logPracticeAdjustment',
  id: adjustmentId(label),
  direction,
  text,
});

describe('logPracticeAdjustment', () => {
  it('stamps the phase, the wall clock and the phase clock', () => {
    const clock = clockOf();
    const session = runningSession();
    clock.advanceMinutes(6);
    const logged = applyOk(session, logAdjustment('a1'), nowIso(clock));

    expect(logged.run?.practiceAdjustments).toEqual([
      {
        id: adjustmentId('a1'),
        phaseId: currentPhaseIdOf(session),
        direction: 'progressed',
        text: 'Add a second defender',
        // No letter: this tap came from a progression, not from a written constraint.
        step: null,
        at: nowIso(clock),
        phaseElapsedMs: 6 * 60_000,
      },
    ]);
    expect(SessionSchema.safeParse(logged).success).toBe(true);
  });

  it('records an off-plan change with empty text rather than refusing it', () => {
    // A coach who changes something they never wrote down has done the most interesting
    // thing in the session. An app that only accepted the plan would record the plan.
    const logged = applyOk(runningSession(), logAdjustment('a1', 'regressed', ''));
    expect(logged.run?.practiceAdjustments[0]?.text).toBe('');
    expect(logged.run?.practiceAdjustments[0]?.direction).toBe('regressed');
  });

  it('does not accept text that was never in the plan as a problem', () => {
    const logged = applyOk(runningSession(), logAdjustment('a1', 'progressed', 'Something else'));
    expect(logged.run?.practiceAdjustments[0]?.text).toBe('Something else');
  });

  it('never stops the clock, opens a pause, or logs an intervention', () => {
    // The load-bearing property. A coach who takes a defender out mid-rondo has coached
    // without saying a word, and every number on the review screen must keep saying so.
    const before = runningSession();
    const after = applyOk(before, logAdjustment('a1'));

    expect(after.run?.pauseReason).toBeNull();
    expect(after.run?.openInterventionId).toBeNull();
    expect(after.run?.interventionEvents).toEqual([]);
    expect(after.run?.phaseRuns[0]?.runningSince).toBe(before.run?.phaseRuns[0]?.runningSince);
  });

  it('refuses when there is no run', () => {
    expect(isErr(apply(plannedSession(), logAdjustment('a1')))).toBe(true);
    expect(isErr(apply(draftSession(), logAdjustment('a1')))).toBe(true);
  });

  it('keeps every adjustment, including repeats of the same text', () => {
    let session = applyOk(runningSession(), logAdjustment('a1'));
    session = applyOk(session, logAdjustment('a2'));
    expect(session.run?.practiceAdjustments).toHaveLength(2);
  });
});

describe('undoPracticeAdjustment', () => {
  it('removes the one named, not the most recent', () => {
    // The two directions sit side by side in Do mode. Popping "the last one" would remove
    // the *easier* the coach meant to keep when they mis-tapped *harder*.
    let session = applyOk(runningSession(), logAdjustment('a1', 'progressed'));
    session = applyOk(session, logAdjustment('a2', 'regressed'));

    const undone = applyOk(session, {
      kind: 'undoPracticeAdjustment',
      id: adjustmentId('a1'),
    });

    expect(undone.run?.practiceAdjustments.map((a) => a.id)).toEqual([adjustmentId('a2')]);
    expect(undone.run?.practiceAdjustments[0]?.direction).toBe('regressed');
  });

  it('fails rather than silently doing nothing when there is nothing to undo', () => {
    const session = runningSession();
    expect(
      isErr(apply(session, { kind: 'undoPracticeAdjustment', id: adjustmentId('nope') })),
    ).toBe(true);
  });
});

describe('the STEP letter on an adjustment', () => {
  it('carries the letter when the tap came off a written constraint', () => {
    const logged = applyOk(runningSession(), {
      kind: 'logPracticeAdjustment',
      id: adjustmentId('a1'),
      direction: 'progressed',
      text: 'Two touches maximum',
      step: 'task',
    });
    expect(logged.run?.practiceAdjustments[0]?.step).toBe('task');
  });

  it('stays null for an off-plan change rather than guessing a letter', () => {
    // The coach was busy. Asking them to classify it mid-rondo would cost the recording.
    const logged = applyOk(runningSession(), logAdjustment('a1', 'regressed', ''));
    expect(logged.run?.practiceAdjustments[0]?.step).toBeNull();
  });

  it('never infers the letter from the words', () => {
    // ADR 0004 refused to parse prose for exactly this reason: a silently wrong letter in a
    // season report is worse than no letter.
    const logged = applyOk(
      runningSession(),
      logAdjustment('a1', 'progressed', 'Shrink the pitch to 15x15'),
    );
    expect(logged.run?.practiceAdjustments[0]?.step).toBeNull();
  });
});
