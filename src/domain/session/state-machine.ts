import { err, ok, type Result } from '@/lib/result';
import type {
  ChallengeEventId,
  ChallengeId,
  CoachingPointId,
  InterventionEventId,
  PhaseId,
  PlayerId,
} from '../ids';
import type { ChallengeEvent, ChallengeStatus } from '../challenge';
import {
  mechanicStopsPlay,
  resolvePhaseIntervention,
  wouldExceedBudget,
  type InterventionAudience,
  type InterventionEvent,
  type InterventionMechanic,
  type InterventionMethod,
} from '../intervention';
import { msOf, type IsoDateTime } from '../primitives';
import type { PhaseRun, SessionRunState } from '../session-run';
import type { Session, SessionPhase } from '../session';
import { phaseElapsedMs } from './timer';

/**
 * The session lifecycle, as a **pure total reducer that never throws**.
 *
 *     draft ──commitPlan──► planned ──start──► in_progress ──finish──► completed
 *       ▲                     │                      │                 (terminal)
 *       │◄──reopenPlan────────┘                      │
 *       │                     │ abandon              │ abandon(reason)
 *       └────restore──────  abandoned ◄──────────────┘
 *
 * Deliberately illegal: `in_progress → planned` (rewinding the plan once observations exist
 * corrupts the evidence trail — abandon, then duplicate into a fresh draft), `completed → *`,
 * and `abandoned → in_progress`.
 *
 * An illegal transition is a normal outcome the UI renders, not an exception it has to
 * catch, so everything here returns a `Result`. `noFallthroughCasesInSwitch` keeps the
 * command switch exhaustive.
 */

export type TransitionErrorCode =
  'illegal_transition' | 'guard_failed' | 'not_found' | 'no_run' | 'already_at_boundary';

export interface TransitionError {
  readonly code: TransitionErrorCode;
  readonly message: string;
}

const fail = (code: TransitionErrorCode, message: string): Result<never, TransitionError> =>
  err({ code, message });

/**
 * Every command carries its own ids and timestamps rather than generating them, so the
 * reducer stays pure and every test is deterministic.
 */
export type SessionCommand =
  | { readonly kind: 'commitPlan' }
  | { readonly kind: 'reopenPlan' }
  | { readonly kind: 'start' }
  | { readonly kind: 'pausePhase' }
  | { readonly kind: 'resumePhase' }
  | { readonly kind: 'nextPhase' }
  | { readonly kind: 'undoNextPhase' }
  | { readonly kind: 'jumpToPhase'; readonly phaseId: PhaseId }
  | { readonly kind: 'skipPhase' }
  | { readonly kind: 'extendPhase'; readonly minutes: number }
  | {
      readonly kind: 'logIntervention';
      readonly id: InterventionEventId;
      readonly method?: InterventionMethod;
      readonly mechanic?: InterventionMechanic;
      readonly audience?: InterventionAudience;
      readonly playerIds?: readonly PlayerId[];
      readonly coachingPointId?: CoachingPointId | null;
      readonly note?: string;
    }
  | { readonly kind: 'closeIntervention' }
  | {
      readonly kind: 'setCoachingPointDelivered';
      readonly pointId: CoachingPointId;
      readonly delivered: boolean;
    }
  | {
      readonly kind: 'logChallengeProgress';
      readonly id: ChallengeEventId;
      readonly challengeId: ChallengeId;
    }
  | { readonly kind: 'undoChallengeProgress'; readonly challengeId: ChallengeId }
  | {
      readonly kind: 'setChallengeStatus';
      readonly challengeId: ChallengeId;
      /** `open` un-rules it, which is what the Undo on the ruling toast sends. */
      readonly status: ChallengeStatus;
      readonly note?: string;
    }
  | { readonly kind: 'heartbeat' }
  | { readonly kind: 'reconcileToLastActivity' }
  | { readonly kind: 'finish' }
  | { readonly kind: 'abandon'; readonly reason: string }
  | { readonly kind: 'restore' };

/**
 * Applies one command. The caller persists the result — **write-through**: every timer
 * command hits IndexedDB before the UI re-renders, so a crash loses at most one frame.
 *
 * `updatedAt` is bumped here rather than by the caller. The reducer already has `now`, and
 * a forgotten bump would silently break import/merge, which resolves conflicts on it.
 */
export function applySessionCommand(
  session: Session,
  command: SessionCommand,
  now: IsoDateTime,
): Result<Session, TransitionError> {
  const result = reduce(session, command, now);
  return result.ok ? ok({ ...result.value, updatedAt: now }) : result;
}

function reduce(
  session: Session,
  command: SessionCommand,
  now: IsoDateTime,
): Result<Session, TransitionError> {
  switch (command.kind) {
    case 'commitPlan':
      return commitPlan(session);
    case 'reopenPlan':
      return reopenPlan(session);
    case 'start':
      return start(session, now);
    case 'pausePhase':
      return pausePhase(session, now, 'coach');
    case 'resumePhase':
      return resumePhase(session, now);
    case 'nextPhase':
      return moveToPhase(session, now, { direction: 'next' });
    case 'undoNextPhase':
      return undoNextPhase(session, now);
    case 'jumpToPhase':
      return moveToPhase(session, now, { direction: 'jump', phaseId: command.phaseId });
    case 'skipPhase':
      return moveToPhase(session, now, { direction: 'next', skipCurrent: true });
    case 'extendPhase':
      return extendPhase(session, command.minutes);
    case 'logIntervention':
      return logIntervention(session, command, now);
    case 'closeIntervention':
      return closeIntervention(session, now);
    case 'setCoachingPointDelivered':
      return setCoachingPointDelivered(session, command.pointId, command.delivered, now);
    case 'logChallengeProgress':
      return logChallengeProgress(session, command, now);
    case 'undoChallengeProgress':
      return undoChallengeProgress(session, command.challengeId);
    case 'setChallengeStatus':
      return setChallengeStatus(session, command, now);
    case 'heartbeat':
      return heartbeat(session, now);
    case 'reconcileToLastActivity':
      return reconcileToLastActivity(session);
    case 'finish':
      return finish(session, now);
    case 'abandon':
      return abandon(session, command.reason, now);
    case 'restore':
      return restore(session);
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function commitPlan(session: Session): Result<Session, TransitionError> {
  if (session.status !== 'draft') {
    return fail('illegal_transition', `Cannot commit a plan from "${session.status}".`);
  }
  if (session.objective.text.trim().length === 0) {
    return fail('guard_failed', 'A session needs an objective before it can be planned.');
  }
  if (session.phases.length === 0) {
    return fail('guard_failed', 'A session needs at least one phase.');
  }
  // Phase durations not summing to the session total is deliberately a **warning, not a
  // block** — a coach who plans 55 minutes of phases in a 60-minute session has left
  // themselves slack, which is good practice, not an error.
  return ok({ ...session, status: 'planned' });
}

function reopenPlan(session: Session): Result<Session, TransitionError> {
  if (session.status !== 'planned') {
    return fail('illegal_transition', `Cannot reopen a plan from "${session.status}".`);
  }
  if (session.run !== null) {
    return fail('guard_failed', 'A session that has been run cannot go back to draft.');
  }
  return ok({ ...session, status: 'draft' });
}

function start(session: Session, now: IsoDateTime): Result<Session, TransitionError> {
  if (session.status === 'in_progress') {
    // Idempotent: a double-tap on a 96px button in the rain must not restart the session.
    return ok(session);
  }
  if (session.status !== 'planned') {
    return fail('illegal_transition', `Cannot start a session from "${session.status}".`);
  }
  if (session.run !== null) {
    return fail('guard_failed', 'This session already has a run.');
  }

  const first = orderedPhases(session)[0];
  if (!first) {
    return fail('guard_failed', 'A session needs at least one phase to start.');
  }

  const run: SessionRunState = {
    startedAt: now,
    endedAt: null,
    currentPhaseIndex: 0,
    phaseRuns: [newPhaseRun(first.id, now)],
    pauseReason: null,
    openInterventionId: null,
    lastHeartbeatAt: now,
    interventionEvents: [],
    challengeEvents: [],
  };

  return ok({ ...session, status: 'in_progress', run });
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function pausePhase(
  session: Session,
  now: IsoDateTime,
  reason: 'coach' | 'intervention',
): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run, phaseRun, index } = running.value;

  if (phaseRun.runningSince === null) return ok(session); // already paused; idempotent

  const paused: PhaseRun = {
    ...phaseRun,
    runningSince: null,
    accumulatedMs: phaseElapsedMs(phaseRun, msOf(now)),
  };

  return ok(
    withRun(session, {
      ...run,
      phaseRuns: replaceAt(run.phaseRuns, index, paused),
      pauseReason: reason,
    }),
  );
}

function resumePhase(session: Session, now: IsoDateTime): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run, phaseRun, index } = running.value;

  if (phaseRun.runningSince !== null) return ok(session); // already running; idempotent

  // Resuming while an intervention is open closes it too — the coach is putting the ball
  // back down, which is exactly the event the ball-rolling metric is counting.
  const closed = run.openInterventionId !== null ? closeOpenIntervention(run, now) : run;

  const resumed: PhaseRun = { ...phaseRun, runningSince: now };
  return ok(
    withRun(session, {
      ...closed,
      phaseRuns: replaceAt(closed.phaseRuns, index, resumed),
      pauseReason: null,
      openInterventionId: null,
    }),
  );
}

interface MoveOptions {
  direction: 'next' | 'jump';
  phaseId?: PhaseId;
  skipCurrent?: boolean;
}

/**
 * Ends the open phase run and opens a new one.
 *
 * A revisited phase gets a **second `PhaseRun`**, rather than the first one being reopened.
 * Coaches genuinely do go back to a practice, and "we ran it, played, then went back to it"
 * is the truth; folding the two together would lose the shape of the session.
 *
 * Note this **never auto-advances**. A drill ending is a coaching decision, and a timer that
 * moves the session on by itself is a timer that will do it while the coach is talking.
 */
function moveToPhase(
  session: Session,
  now: IsoDateTime,
  options: MoveOptions,
): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run, phaseRun, index } = running.value;

  const ordered = orderedPhases(session);
  let target: SessionPhase | undefined;

  if (options.direction === 'jump') {
    target = ordered.find((phase) => phase.id === options.phaseId);
    if (!target) return fail('not_found', `No phase ${options.phaseId} in this session.`);
  } else {
    const currentPosition = ordered.findIndex((phase) => phase.id === phaseRun.phaseId);
    target = ordered[currentPosition + 1];
    if (!target) {
      return fail(
        'already_at_boundary',
        'This is the last phase — finish the session rather than advancing.',
      );
    }
  }

  const closedRun = run.openInterventionId !== null ? closeOpenIntervention(run, now) : run;
  const ended = endPhaseRun(phaseRun, now, options.skipCurrent === true);

  const phaseRuns = [...replaceAt(closedRun.phaseRuns, index, ended), newPhaseRun(target.id, now)];

  return ok(
    withRun(session, {
      ...closedRun,
      phaseRuns,
      currentPhaseIndex: phaseRuns.length - 1,
      pauseReason: null,
      openInterventionId: null,
    }),
  );
}

/**
 * The 8-second Undo toast on `Next phase`. Pops the run that was just opened and reopens the
 * previous one **with its elapsed time intact** — which is the whole point, and the reason
 * this is a distinct command rather than a jump backwards.
 */
function undoNextPhase(session: Session, now: IsoDateTime): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run, index } = running.value;

  if (index === 0 || run.phaseRuns.length < 2) {
    return fail('already_at_boundary', 'There is no phase advance to undo.');
  }

  const previous = run.phaseRuns[index - 1];
  if (!previous) return fail('not_found', 'The previous phase run has gone missing.');

  const reopened: PhaseRun = { ...previous, endedAt: null, runningSince: now, skipped: false };
  const phaseRuns = [...run.phaseRuns.slice(0, index - 1), reopened];

  return ok(
    withRun(session, {
      ...run,
      phaseRuns,
      currentPhaseIndex: phaseRuns.length - 1,
      pauseReason: null,
    }),
  );
}

/**
 * `−5/+5` on the phase sheet. This genuinely rewrites `plannedDurationMin`: the coach is
 * saying "this drill is now 25 minutes", not "ignore that I overran". Review measures the
 * overrun against the revised plan, which is what they would expect.
 */
function extendPhase(session: Session, minutes: number): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { phaseRun } = running.value;

  const phase = session.phases.find((p) => p.id === phaseRun.phaseId);
  if (!phase) return fail('not_found', 'The running phase is not in the plan.');

  const next = phase.plannedDurationMin + minutes;
  if (next < 1 || next > 240) {
    return fail('guard_failed', `A phase cannot be ${next} minutes long.`);
  }

  return ok({
    ...session,
    phases: session.phases.map((p) => (p.id === phase.id ? { ...p, plannedDurationMin: next } : p)),
  });
}

// ---------------------------------------------------------------------------
// Intervention
// ---------------------------------------------------------------------------

/**
 * One tap. The event is pre-filled with the phase's *planned* method, mechanic and audience,
 * because the overwhelmingly common case is the coach doing what they said they would — and
 * that must not cost a form.
 *
 * For any mechanic that actually stops play, this also pauses the phase clock, so
 * `stoppageMs` and ball-rolling time are **measured rather than estimated**.
 */
function logIntervention(
  session: Session,
  command: Extract<SessionCommand, { kind: 'logIntervention' }>,
  now: IsoDateTime,
): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run, phaseRun } = running.value;

  const phase = session.phases.find((p) => p.id === phaseRun.phaseId);
  if (!phase) return fail('not_found', 'The running phase is not in the plan.');

  const plan = resolvePhaseIntervention(session, phase);
  const mechanic = command.mechanic ?? plan.mechanic;
  const usedBefore = run.interventionEvents.filter((e) => e.phaseId === phase.id).length;

  const event: InterventionEvent = {
    id: command.id,
    phaseId: phase.id,
    at: now,
    phaseElapsedMs: phaseElapsedMs(phaseRun, msOf(now)),
    method: command.method ?? plan.method,
    mechanic,
    audience: command.audience ?? plan.audience,
    // Instantaneous unless it stops play, in which case it stays open until the coach
    // resumes and we can stamp a real duration.
    durationMs: mechanicStopsPlay(mechanic) ? null : 0,
    playerIds: [...(command.playerIds ?? [])],
    coachingPointId: command.coachingPointId ?? null,
    ...(command.note !== undefined ? { note: command.note } : {}),
    // The honest self-audit. This never blocks — a coach who genuinely needs a third stop
    // should take it; the app's job is to make the choice visible and report it in Review.
    overBudget: wouldExceedBudget(plan, usedBefore),
  };

  const withEvent: SessionRunState = {
    ...run,
    interventionEvents: [...run.interventionEvents, event],
  };

  if (!mechanicStopsPlay(mechanic)) {
    return ok(withRun(session, withEvent));
  }

  const paused = pausePhase(withRun(session, withEvent), now, 'intervention');
  if (!paused.ok) return paused;
  const pausedRun = paused.value.run;
  if (pausedRun === null) return fail('no_run', 'The run vanished while pausing.');

  return ok(withRun(paused.value, { ...pausedRun, openInterventionId: event.id }));
}

/** `Resume play` on the live intervention bar. Stamps the real duration and restarts the clock. */
function closeIntervention(session: Session, now: IsoDateTime): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  if (running.value.run.openInterventionId === null) {
    return fail('guard_failed', 'No intervention is open.');
  }
  return resumePhase(session, now);
}

function closeOpenIntervention(run: SessionRunState, now: IsoDateTime): SessionRunState {
  const openId = run.openInterventionId;
  if (openId === null) return run;

  return {
    ...run,
    openInterventionId: null,
    interventionEvents: run.interventionEvents.map((event) =>
      event.id === openId && event.durationMs === null
        ? { ...event, durationMs: Math.max(0, msOf(now) - msOf(event.at)) }
        : event,
    ),
  };
}

function setCoachingPointDelivered(
  session: Session,
  pointId: CoachingPointId,
  delivered: boolean,
  now: IsoDateTime,
): Result<Session, TransitionError> {
  let found = false;
  const phases = session.phases.map((phase) => ({
    ...phase,
    coachingPoints: phase.coachingPoints.map((point) => {
      if (point.id !== pointId) return point;
      found = true;
      return { ...point, delivered, deliveredAt: delivered ? now : null };
    }),
  }));

  if (!found) return fail('not_found', `No coaching point ${pointId} in this session.`);
  return ok({ ...session, phases });
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

/**
 * `+1` on a challenge row — the coach saw it happen.
 *
 * Deliberately **does not check that the challenge is live in this phase**. Phase scoping
 * decides what Do mode puts in front of the coach; it does not get to tell them they did not
 * see what they just saw. The event carries its own `phaseId`, so Review can still say the
 * left-foot challenge was met twice outside the rondo.
 *
 * Nor does it refuse a challenge the coach has already ruled on. Seeing the thing happen
 * after calling it missed is information, and `effectiveChallengeStatus` keeps the explicit
 * ruling in charge of what is displayed.
 */
function logChallengeProgress(
  session: Session,
  command: Extract<SessionCommand, { kind: 'logChallengeProgress' }>,
  now: IsoDateTime,
): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run, phaseRun } = running.value;

  const challenge = session.challenges.find((c) => c.id === command.challengeId);
  if (!challenge) {
    return fail('not_found', `No challenge ${command.challengeId} in this session.`);
  }

  const event: ChallengeEvent = {
    id: command.id,
    challengeId: challenge.id,
    phaseId: phaseRun.phaseId,
    at: now,
    phaseElapsedMs: phaseElapsedMs(phaseRun, msOf(now)),
  };

  return ok(withRun(session, { ...run, challengeEvents: [...run.challengeEvents, event] }));
}

/**
 * The `Undo` on the `+1` toast. Pops the **most recent** sighting for that challenge.
 *
 * A pop rather than a decrement is the whole reason the tally is derived: there is no counter
 * to drive below zero, and the evidence and the number cannot come apart.
 */
function undoChallengeProgress(
  session: Session,
  challengeId: ChallengeId,
): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run } = running.value;

  // A reverse scan rather than `findLastIndex`, which is ES2023 and this project targets
  // ES2022 — and iOS Safari is the platform that actually matters here.
  let lastIndex = -1;
  for (let i = run.challengeEvents.length - 1; i >= 0; i -= 1) {
    if (run.challengeEvents[i]?.challengeId === challengeId) {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex === -1) return fail('not_found', 'There is no sighting to undo.');

  return ok(
    withRun(session, {
      ...run,
      challengeEvents: [
        ...run.challengeEvents.slice(0, lastIndex),
        ...run.challengeEvents.slice(lastIndex + 1),
      ],
    }),
  );
}

/**
 * The coach's ruling: met, partly, missed — or back to `open`, which is what the Undo on the
 * ruling toast sends.
 *
 * **No run required**, following `setCoachingPointDelivered`. Ruling on challenges is a
 * natural part of Review, which happens after `finish`, and a guard here would make the
 * obvious moment the impossible one.
 */
function setChallengeStatus(
  session: Session,
  command: Extract<SessionCommand, { kind: 'setChallengeStatus' }>,
  now: IsoDateTime,
): Result<Session, TransitionError> {
  if (!session.challenges.some((challenge) => challenge.id === command.challengeId)) {
    return fail('not_found', `No challenge ${command.challengeId} in this session.`);
  }

  const challenges = session.challenges.map((challenge) =>
    challenge.id === command.challengeId
      ? {
          ...challenge,
          status: command.status,
          // `open` must carry no `settledAt` — the schema refuses the combination, because
          // "not ruled on, ruled on at 19:42" is not a state that means anything.
          settledAt: command.status === 'open' ? null : now,
          ...(command.note !== undefined ? { note: command.note } : {}),
        }
      : challenge,
  );

  return ok({ ...session, challenges });
}

// ---------------------------------------------------------------------------
// Survival
// ---------------------------------------------------------------------------

function heartbeat(session: Session, now: IsoDateTime): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  return ok(withRun(session, { ...running.value.run, lastHeartbeatAt: now }));
}

/**
 * The answer to *"End at last activity (19:42)?"* on the reconciliation sheet, shown when a
 * run has been open for more than three hours. Closes the session at the last heartbeat
 * rather than now, so a forgotten session does not claim a five-hour drill.
 */
function reconcileToLastActivity(session: Session): Result<Session, TransitionError> {
  const running = requireRun(session);
  if (!running.ok) return running;
  return finish(session, running.value.run.lastHeartbeatAt);
}

// ---------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------

function finish(session: Session, now: IsoDateTime): Result<Session, TransitionError> {
  if (session.status === 'completed') return ok(session); // idempotent
  if (session.status !== 'in_progress') {
    return fail('illegal_transition', `Cannot finish a session from "${session.status}".`);
  }
  const running = requireRun(session);
  if (!running.ok) return running;
  const { run, phaseRun, index } = running.value;

  const closed = closeOpenIntervention(run, now);
  const ended = endPhaseRun(phaseRun, now, false);

  return ok({
    ...session,
    status: 'completed',
    run: {
      ...closed,
      phaseRuns: replaceAt(closed.phaseRuns, index, ended),
      endedAt: now,
      pauseReason: null,
      openInterventionId: null,
      lastHeartbeatAt: now,
    },
  });
}

/**
 * Abandoning **preserves the run and the observations**. A session that was rained off after
 * twenty minutes still happened, and what the coach saw in those twenty minutes is still
 * evidence.
 */
function abandon(
  session: Session,
  reason: string,
  now: IsoDateTime,
): Result<Session, TransitionError> {
  if (session.status === 'completed') {
    return fail('illegal_transition', 'A completed session cannot be abandoned.');
  }
  if (session.status === 'abandoned') return ok(session); // idempotent
  if (reason.trim().length === 0) {
    return fail('guard_failed', 'Abandoning a session requires a reason.');
  }

  const run = session.run;
  const closedRun =
    run === null
      ? null
      : (() => {
          const closed = closeOpenIntervention(run, now);
          const current = closed.phaseRuns[closed.currentPhaseIndex];
          return {
            ...closed,
            phaseRuns: current
              ? replaceAt(
                  closed.phaseRuns,
                  closed.currentPhaseIndex,
                  endPhaseRun(current, now, false),
                )
              : closed.phaseRuns,
            endedAt: now,
            pauseReason: null,
            openInterventionId: null,
          };
        })();

  return ok({ ...session, status: 'abandoned', abandonReason: reason.trim(), run: closedRun });
}

function restore(session: Session): Result<Session, TransitionError> {
  if (session.status !== 'abandoned') {
    return fail('illegal_transition', `Cannot restore a session from "${session.status}".`);
  }
  if (session.run !== null) {
    return fail(
      'guard_failed',
      'This session was already under way — duplicate it into a fresh draft instead.',
    );
  }
  return ok({ ...session, status: 'draft', abandonReason: null });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RunContext {
  run: SessionRunState;
  phaseRun: PhaseRun;
  index: number;
}

function requireRun(session: Session): Result<RunContext, TransitionError> {
  if (session.status !== 'in_progress') {
    return fail(
      'illegal_transition',
      `This command needs a running session, not "${session.status}".`,
    );
  }
  const run = session.run;
  if (run === null) return fail('no_run', 'This session has no run.');

  const index = run.currentPhaseIndex;
  const phaseRun = run.phaseRuns[index];
  if (!phaseRun) return fail('not_found', 'The current phase run is missing.');

  return ok({ run, phaseRun, index });
}

function withRun(session: Session, run: SessionRunState): Session {
  return { ...session, run };
}

function newPhaseRun(phaseId: PhaseId, now: IsoDateTime): PhaseRun {
  return {
    phaseId,
    startedAt: now,
    runningSince: now,
    accumulatedMs: 0,
    endedAt: null,
    skipped: false,
  };
}

function endPhaseRun(phaseRun: PhaseRun, now: IsoDateTime, skipped: boolean): PhaseRun {
  return {
    ...phaseRun,
    accumulatedMs: phaseElapsedMs(phaseRun, msOf(now)),
    runningSince: null,
    endedAt: now,
    skipped: skipped || phaseRun.skipped,
  };
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const next = [...items];
  next[index] = value;
  return next;
}

function orderedPhases(session: Session): SessionPhase[] {
  return [...session.phases].sort((a, b) => a.order - b.order);
}
