import { describe, expect, it } from 'vitest';
import { applySessionCommand, type SessionCommand } from './state-machine';
import { SessionSchema, type Session, type SessionStatus } from '../session';
import { isErr, unwrap } from '@/lib/result';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { asInterventionEventId } from '../ids';
import { isoDateTime } from '../primitives';
import { buildSessionFromMethodology } from './build-from-methodology';
import { PLAY_PRACTICE_PLAY } from '../presets';
import { aSquad, T0 } from '@/test/builders';

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
