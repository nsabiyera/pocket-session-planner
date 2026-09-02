import { describe, expect, it } from 'vitest';
import {
  describePhaseClock,
  formatClock,
  formatPhaseTimer,
  phaseClock,
  phaseElapsedMs,
  sessionClock,
  sessionElapsedMs,
} from './timer';
import { applySessionCommand } from './state-machine';
import { unwrap } from '@/lib/result';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { asInterventionEventId } from '../ids';
import { isoDateTime, isoFromMs } from '../primitives';
import type { PhaseRun } from '../session-run';
import type { Session } from '../session';
import { buildSessionFromMethodology } from './build-from-methodology';
import { PLAY_PRACTICE_PLAY } from '../presets';
import { aSquad, T0 } from '@/test/builders';

/**
 * **The single most important test file in the project.**
 *
 * Every claim the app makes about surviving the field is a claim about this arithmetic:
 * screen lock, tab discard, a force-quit, a clock-pausing intervention and a device clock
 * moved backwards. The technique throughout is to advance a `FakeClock` and *re-derive*,
 * never to accumulate — because that is exactly what the running app does.
 */

const run = (over: Partial<PhaseRun> = {}): PhaseRun => ({
  phaseId: '00000000-0000-4000-8000-0000000000a1' as PhaseRun['phaseId'],
  startedAt: T0,
  runningSince: T0,
  accumulatedMs: 0,
  endedAt: null,
  skipped: false,
  ...over,
});

const phase = (minutes: number) =>
  ({ plannedDurationMin: minutes }) as unknown as Parameters<typeof phaseClock>[0];

const at = (offsetMs: number) => Date.parse(T0) + offsetMs;

describe('phaseElapsedMs', () => {
  it('derives elapsed from the wall clock while running', () => {
    expect(phaseElapsedMs(run(), at(0))).toBe(0);
    expect(phaseElapsedMs(run(), at(90_000))).toBe(90_000);
  });

  it('freezes at accumulatedMs while paused', () => {
    const paused = run({ runningSince: null, accumulatedMs: 42_000 });
    expect(phaseElapsedMs(paused, at(0))).toBe(42_000);
    expect(phaseElapsedMs(paused, at(600_000))).toBe(42_000);
  });

  it('freezes at accumulatedMs once ended, whatever the clock says', () => {
    const ended = run({ endedAt: isoFromMs(at(60_000)), accumulatedMs: 60_000 });
    expect(phaseElapsedMs(ended, at(999_999))).toBe(60_000);
  });

  it('adds the current running stretch on top of previously accumulated time', () => {
    const resumed = run({ accumulatedMs: 120_000, runningSince: isoFromMs(at(300_000)) });
    expect(phaseElapsedMs(resumed, at(360_000))).toBe(180_000);
  });

  it('survives a device clock moved backwards mid-session', () => {
    // A phone picking up network time can jump backwards. Without the Math.max guard the
    // coach would watch the timer run down, which is worse than it merely stalling.
    const running = run({ accumulatedMs: 120_000, runningSince: isoFromMs(at(300_000)) });
    expect(phaseElapsedMs(running, at(240_000))).toBe(120_000);
  });
});

describe('phaseClock', () => {
  it('reports remaining, overrun and progress against the plan', () => {
    const clock = phaseClock(phase(20), run(), at(5 * 60_000));
    expect(clock).toMatchObject({
      elapsedMs: 300_000,
      plannedMs: 1_200_000,
      remainingMs: 900_000,
      overrunMs: 0,
      isRunning: true,
      isOverrun: false,
      progress: 0.25,
    });
  });

  it('clamps remaining at zero and reports overrun instead of a negative countdown', () => {
    const clock = phaseClock(phase(10), run(), at(12 * 60_000));
    expect(clock.remainingMs).toBe(0);
    expect(clock.overrunMs).toBe(2 * 60_000);
    expect(clock.isOverrun).toBe(true);
    expect(clock.progress).toBe(1);
  });

  it('flags the final minute and the final ten seconds, but not once overrun', () => {
    expect(phaseClock(phase(10), run(), at(8 * 60_000)).isFinalMinute).toBe(false);
    expect(phaseClock(phase(10), run(), at(9 * 60_000 + 30_000)).isFinalMinute).toBe(true);
    expect(phaseClock(phase(10), run(), at(9 * 60_000 + 55_000)).isFinalTenSeconds).toBe(true);
    expect(phaseClock(phase(10), run(), at(11 * 60_000)).isFinalMinute).toBe(false);
  });

  it('is not running when paused or ended', () => {
    expect(phaseClock(phase(10), run({ runningSince: null }), at(0)).isRunning).toBe(false);
    expect(phaseClock(phase(10), run({ endedAt: T0 }), at(0)).isRunning).toBe(false);
  });

  it('treats a zero-length phase as complete rather than dividing by zero', () => {
    expect(phaseClock(phase(0), run(), at(0)).progress).toBe(1);
  });
});

describe('formatting', () => {
  it.each([
    [0, '0:00'],
    [9_000, '0:09'],
    [65_000, '1:05'],
    [2_060_000, '34:20'],
    [3_860_000, '1:04:20'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatClock(ms)).toBe(expected);
  });

  it('never renders a negative clock', () => {
    expect(formatClock(-5_000)).toBe('0:00');
  });

  it('prefixes an overrun with + rather than relying on colour alone (WCAG 1.4.1)', () => {
    const overrun = phaseClock(phase(10), run(), at(12 * 60_000));
    expect(formatPhaseTimer(overrun)).toBe('+2:00');
    expect(describePhaseClock(overrun)).toBe('2:00 over');

    const normal = phaseClock(phase(10), run(), at(60_000));
    expect(formatPhaseTimer(normal)).toBe('9:00');
    expect(describePhaseClock(normal)).toBe('9:00 left');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a real session, driven by a FakeClock, re-derived at every step.
// ---------------------------------------------------------------------------

function startedSession(): { session: Session; clock: FakeClock } {
  const clock = new FakeClock(T0);
  const draft = buildSessionFromMethodology(PLAY_PRACTICE_PLAY, {
    squad: aSquad(),
    objective: { text: 'Playing out', successCriteria: [], sourceActionId: null },
    now: T0,
    ids: new FakeIdGenerator(),
  });
  const planned = unwrap(applySessionCommand(draft, { kind: 'commitPlan' }, T0));
  const session = unwrap(applySessionCommand(planned, { kind: 'start' }, T0));
  return { session, clock };
}

const nowIso = (clock: FakeClock) => isoDateTime(clock.nowIso());

describe('a session run through the field scenarios', () => {
  it('keeps counting through a five-minute screen lock, because the drill really is running', () => {
    const { session, clock } = startedSession();

    clock.advanceMinutes(5); // screen locks; no code runs at all
    const phaseRun = session.run!.phaseRuns[0]!;
    expect(phaseElapsedMs(phaseRun, clock.now())).toBe(5 * 60_000);

    clock.advanceMinutes(5); // still locked
    expect(phaseElapsedMs(phaseRun, clock.now())).toBe(10 * 60_000);
  });

  it('survives a force-quit and reload by re-deriving from the persisted document', () => {
    const { session, clock } = startedSession();
    clock.advanceMinutes(7);

    // A force-quit is exactly this: the in-memory state is gone, the document is not.
    const reloaded: Session = JSON.parse(JSON.stringify(session));
    const phaseRun = reloaded.run!.phaseRuns[0]!;

    expect(phaseElapsedMs(phaseRun, clock.now())).toBe(7 * 60_000);
    // And it keeps going from there, with no catch-up step.
    clock.advanceMinutes(3);
    expect(phaseElapsedMs(phaseRun, clock.now())).toBe(10 * 60_000);
  });

  it('holds the clock across pause and resume, and loses nothing to the pause', () => {
    const { session, clock } = startedSession();

    clock.advanceMinutes(4);
    const paused = unwrap(applySessionCommand(session, { kind: 'pausePhase' }, nowIso(clock)));
    expect(phaseElapsedMs(paused.run!.phaseRuns[0]!, clock.now())).toBe(4 * 60_000);

    clock.advanceMinutes(10); // half-time chat, phone in pocket
    expect(phaseElapsedMs(paused.run!.phaseRuns[0]!, clock.now())).toBe(4 * 60_000);

    const resumed = unwrap(applySessionCommand(paused, { kind: 'resumePhase' }, nowIso(clock)));
    clock.advanceMinutes(2);
    expect(phaseElapsedMs(resumed.run!.phaseRuns[0]!, clock.now())).toBe(6 * 60_000);
  });

  it('stops the phase clock for a play-stopping intervention, and only for those', () => {
    const { session, clock } = startedSession();
    clock.advanceMinutes(3);

    const stopped = unwrap(
      applySessionCommand(
        session,
        {
          kind: 'logIntervention',
          id: asInterventionEventId('00000000-0000-4000-8000-0000000000e1'),
          mechanic: 'play_stop_play',
        },
        nowIso(clock),
      ),
    );
    expect(stopped.run!.openInterventionId).toBe('00000000-0000-4000-8000-0000000000e1');
    expect(stopped.run!.pauseReason).toBe('intervention');

    clock.advanceSeconds(45); // the coach is talking; the ball is not rolling
    expect(phaseElapsedMs(stopped.run!.phaseRuns[0]!, clock.now())).toBe(3 * 60_000);

    const resumed = unwrap(
      applySessionCommand(stopped, { kind: 'closeIntervention' }, nowIso(clock)),
    );
    expect(resumed.run!.interventionEvents[0]?.durationMs).toBe(45_000);
    expect(resumed.run!.openInterventionId).toBeNull();

    clock.advanceMinutes(1);
    expect(phaseElapsedMs(resumed.run!.phaseRuns[0]!, clock.now())).toBe(4 * 60_000);
  });

  it('does not stop the clock for an in-flow intervention', () => {
    const { session, clock } = startedSession();
    clock.advanceMinutes(3);

    const logged = unwrap(
      applySessionCommand(
        session,
        {
          kind: 'logIntervention',
          id: asInterventionEventId('00000000-0000-4000-8000-0000000000e2'),
          mechanic: 'in_flow',
        },
        nowIso(clock),
      ),
    );
    expect(logged.run!.openInterventionId).toBeNull();
    expect(logged.run!.interventionEvents[0]?.durationMs).toBe(0);

    clock.advanceMinutes(2);
    expect(phaseElapsedMs(logged.run!.phaseRuns[0]!, clock.now())).toBe(5 * 60_000);
  });

  it('survives a force-quit taken mid-intervention, with the clock still stopped', () => {
    const { session, clock } = startedSession();
    clock.advanceMinutes(2);

    const stopped = unwrap(
      applySessionCommand(
        session,
        {
          kind: 'logIntervention',
          id: asInterventionEventId('00000000-0000-4000-8000-0000000000e3'),
          mechanic: 'play_freeze_play',
        },
        nowIso(clock),
      ),
    );

    clock.advanceMinutes(4); // app killed while the coach is mid-sentence
    const reloaded: Session = JSON.parse(JSON.stringify(stopped));

    expect(reloaded.run!.openInterventionId).toBe('00000000-0000-4000-8000-0000000000e3');
    expect(phaseElapsedMs(reloaded.run!.phaseRuns[0]!, clock.now())).toBe(2 * 60_000);

    // Resuming closes the intervention with the full, honest stoppage.
    const resumed = unwrap(applySessionCommand(reloaded, { kind: 'resumePhase' }, nowIso(clock)));
    expect(resumed.run!.interventionEvents[0]?.durationMs).toBe(4 * 60_000);
  });

  it('runs into overrun and stays there until the coach decides to move on', () => {
    const { session, clock } = startedSession();
    const first = session.phases[0]!;

    clock.advanceMinutes(first.plannedDurationMin + 3);
    const clockNow = phaseClock(first, session.run!.phaseRuns[0]!, clock.now());

    expect(clockNow.isOverrun).toBe(true);
    expect(clockNow.overrunMs).toBe(3 * 60_000);
    expect(formatPhaseTimer(clockNow)).toBe('+3:00');
    // Never auto-advanced: a drill ending is a coaching decision.
    expect(session.run!.currentPhaseIndex).toBe(0);
  });

  it('carries elapsed time correctly across a phase change', () => {
    const { session, clock } = startedSession();

    clock.advanceMinutes(12);
    const advanced = unwrap(applySessionCommand(session, { kind: 'nextPhase' }, nowIso(clock)));

    expect(advanced.run!.phaseRuns).toHaveLength(2);
    expect(advanced.run!.phaseRuns[0]!.accumulatedMs).toBe(12 * 60_000);
    expect(advanced.run!.phaseRuns[0]!.endedAt).not.toBeNull();
    expect(phaseElapsedMs(advanced.run!.phaseRuns[1]!, clock.now())).toBe(0);

    clock.advanceMinutes(4);
    expect(sessionElapsedMs(advanced.run!, clock.now())).toBe(16 * 60_000);
  });

  it('restores the previous phase with its elapsed time intact on undo', () => {
    const { session, clock } = startedSession();

    clock.advanceMinutes(9);
    const advanced = unwrap(applySessionCommand(session, { kind: 'nextPhase' }, nowIso(clock)));
    clock.advanceSeconds(6); // the coach realises within the 8-second toast

    const undone = unwrap(applySessionCommand(advanced, { kind: 'undoNextPhase' }, nowIso(clock)));

    expect(undone.run!.phaseRuns).toHaveLength(1);
    expect(undone.run!.currentPhaseIndex).toBe(0);
    // Elapsed time intact — this is the entire point of the undo.
    expect(phaseElapsedMs(undone.run!.phaseRuns[0]!, clock.now())).toBe(9 * 60_000);

    clock.advanceMinutes(1);
    expect(phaseElapsedMs(undone.run!.phaseRuns[0]!, clock.now())).toBe(10 * 60_000);
  });

  it('reports the session clock against the plan, counting plan phases not run entries', () => {
    const { session, clock } = startedSession();
    clock.advanceMinutes(10);
    const advanced = unwrap(applySessionCommand(session, { kind: 'nextPhase' }, nowIso(clock)));
    clock.advanceMinutes(5);

    const clockNow = sessionClock(advanced, clock.now())!;
    expect(clockNow.elapsedMs).toBe(15 * 60_000);
    expect(clockNow.plannedMs).toBe(60 * 60_000);
    expect(clockNow.remainingMs).toBe(45 * 60_000);
    expect(clockNow.phaseNumber).toBe(2);
    expect(clockNow.phaseCount).toBe(4);
  });

  it('counts a revisited phase as its plan position, not as a fifth phase', () => {
    const { session, clock } = startedSession();
    const firstPhaseId = session.phases[0]!.id;

    clock.advanceMinutes(10);
    const second = unwrap(applySessionCommand(session, { kind: 'nextPhase' }, nowIso(clock)));
    clock.advanceMinutes(5);
    const back = unwrap(
      applySessionCommand(second, { kind: 'jumpToPhase', phaseId: firstPhaseId }, nowIso(clock)),
    );

    expect(back.run!.phaseRuns).toHaveLength(3);
    expect(sessionClock(back, clock.now())!.phaseNumber).toBe(1);
    expect(sessionClock(back, clock.now())!.phaseCount).toBe(4);
  });

  it('returns no session clock for a session that has not started', () => {
    const draft = buildSessionFromMethodology(PLAY_PRACTICE_PLAY, {
      squad: aSquad(),
      objective: { text: 'Playing out', successCriteria: [], sourceActionId: null },
      now: T0,
      ids: new FakeIdGenerator(),
    });
    expect(sessionClock(draft, Date.parse(T0))).toBeNull();
  });
});
