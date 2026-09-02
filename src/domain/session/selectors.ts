import type { PhaseId } from '../ids';
import {
  interventionBudget,
  resolvePhaseIntervention,
  type InterventionBudget,
  type InterventionPlan,
} from '../intervention';
import { PERIPHERAL_PHASE_KINDS } from '../methodology';
import { msOf } from '../primitives';
import type { PhaseRun } from '../session-run';
import type { Session, SessionPhase } from '../session';
import { phaseElapsedMs } from './timer';

/**
 * There is no `reviewed` status — `completed && reviewId !== null` is derivable, and a sixth
 * state would double the terminal-transition matrix for nothing. The UI asks this instead.
 */
export type SessionStage = 'plan' | 'do' | 'review' | 'archived';

export function sessionStage(session: Session): SessionStage {
  switch (session.status) {
    case 'draft':
    case 'planned':
      return 'plan';
    case 'in_progress':
      return 'do';
    case 'completed':
      return session.reviewId === null ? 'review' : 'archived';
    case 'abandoned':
      return 'archived';
  }
}

export function isReviewable(session: Session): boolean {
  return session.status === 'completed' && session.reviewId === null;
}

/** The phase the coach is looking at right now, resolved through the run. */
export function currentPhase(session: Session): SessionPhase | undefined {
  const phaseRun = session.run?.phaseRuns[session.run.currentPhaseIndex];
  if (!phaseRun) return undefined;
  return session.phases.find((phase) => phase.id === phaseRun.phaseId);
}

export function currentPhaseRun(session: Session): PhaseRun | undefined {
  return session.run?.phaseRuns[session.run.currentPhaseIndex];
}

/** `2/5` — the phase's position in the *plan*, not in the run log, which may revisit. */
export function phasePosition(session: Session): { number: number; count: number } {
  const ordered = [...session.phases].sort((a, b) => a.order - b.order);
  const phase = currentPhase(session);
  const index = phase ? ordered.findIndex((p) => p.id === phase.id) : -1;
  return { number: index >= 0 ? index + 1 : 0, count: ordered.length };
}

export function nextPhase(session: Session): SessionPhase | undefined {
  const ordered = [...session.phases].sort((a, b) => a.order - b.order);
  const phase = currentPhase(session);
  if (!phase) return ordered[0];
  return ordered[ordered.findIndex((p) => p.id === phase.id) + 1];
}

/**
 * Tie-break ranking for `mainPracticePhase`. Lower wins.
 *
 * Length alone is not enough: Whole-Part-Whole at 60 minutes gives the PART and both WHOLE
 * games fifteen minutes each, and a coaching point belongs in the part you are drilling, not
 * in the game you are using to diagnose. When the clock cannot separate them, the word
 * *practice* does.
 */
const PRACTICE_KIND_RANK: Partial<Record<SessionPhase['kind'], number>> = {
  skill_practice: 0,
  technical: 0,
  phase_of_play: 1,
  conditioned_game: 2,
  small_sided_game: 3,
  game: 3,
};

const practiceRank = (phase: SessionPhase): number => PRACTICE_KIND_RANK[phase.kind] ?? 4;

/**
 * The **main practice**: the longest phase that is not a warm-up, arrival, huddle, review or
 * water break. Carry-forward drops a coaching point here when it has no better idea, because
 * "the big one in the middle" is what a coach means by *the* practice.
 */
export function mainPracticePhase(session: Session): SessionPhase | undefined {
  const candidates = session.phases.filter((phase) => !PERIPHERAL_PHASE_KINDS.has(phase.kind));
  const pool = candidates.length > 0 ? candidates : session.phases;
  return pool.reduce<SessionPhase | undefined>((best, phase) => {
    if (!best) return phase;
    if (phase.plannedDurationMin !== best.plannedDurationMin) {
      return phase.plannedDurationMin > best.plannedDurationMin ? phase : best;
    }
    if (practiceRank(phase) !== practiceRank(best)) {
      return practiceRank(phase) < practiceRank(best) ? phase : best;
    }
    return phase.order < best.order ? phase : best;
  }, undefined);
}

export interface PhaseInterventionSummary {
  readonly phaseId: PhaseId;
  readonly plan: InterventionPlan;
  readonly budget: InterventionBudget;
  readonly count: number;
  readonly stoppageMs: number;
  readonly elapsedMs: number;
}

export interface InterventionSummary {
  readonly countByPhase: Map<PhaseId, number>;
  readonly byPhase: PhaseInterventionSummary[];
  readonly totalCount: number;
  readonly stoppageMs: number;
  /** Phase time minus the time play was actually stopped. */
  readonly ballRollingMs: number;
  /** The number coaches actually care about. `1` when nothing ran at all. */
  readonly ballRollingRatio: number;
  readonly overBudgetPhases: PhaseId[];
}

/** Below this, Review proposes a concrete intervention change for the next session. */
export const BALL_ROLLING_TARGET = 0.7;

/**
 * *"You stopped play 9 times in a 20-minute practice. Ball rolling time: 61%."*
 *
 * That single line is the most useful feedback this app can give a coach about their own
 * behaviour, and it falls straight out of the model — no extra tracking, no extra taps.
 *
 * `nowMs` matters because a still-open intervention is stopping play *right now*: the live
 * bar in Do mode shows a ratio that is currently falling, which is the honest picture.
 */
export function interventionSummary(session: Session, nowMs = Date.now()): InterventionSummary {
  const countByPhase = new Map<PhaseId, number>();
  const byPhase: PhaseInterventionSummary[] = [];
  const overBudgetPhases: PhaseId[] = [];

  const run = session.run;
  const events = run?.interventionEvents ?? [];

  let totalCount = 0;
  let stoppageMs = 0;
  let elapsedMs = 0;

  for (const phase of [...session.phases].sort((a, b) => a.order - b.order)) {
    const phaseEvents = events.filter((event) => event.phaseId === phase.id);
    const phaseStoppage = phaseEvents.reduce(
      (total, event) =>
        // A `null` duration means the intervention is still open — measure it up to now.
        total + (event.durationMs ?? Math.max(0, nowMs - msOf(event.at))),
      0,
    );

    // A phase revisited later has two runs; both count towards the same phase.
    const phaseElapsed = (run?.phaseRuns ?? [])
      .filter((phaseRun) => phaseRun.phaseId === phase.id)
      .reduce((total, phaseRun) => total + phaseElapsedMs(phaseRun, nowMs), 0);

    const plan = resolvePhaseIntervention(session, phase);
    const budget = interventionBudget(plan, phaseEvents.length);

    countByPhase.set(phase.id, phaseEvents.length);
    byPhase.push({
      phaseId: phase.id,
      plan,
      budget,
      count: phaseEvents.length,
      stoppageMs: phaseStoppage,
      elapsedMs: phaseElapsed,
    });

    if (budget.isOverBudget) overBudgetPhases.push(phase.id);
    totalCount += phaseEvents.length;
    stoppageMs += phaseStoppage;
    elapsedMs += phaseElapsed;
  }

  // Stoppage is clamped to the elapsed time. It can exceed it only through a device clock
  // change, and "ball rolling: -4%" helps nobody.
  const boundedStoppage = Math.min(stoppageMs, elapsedMs);
  const ballRollingMs = Math.max(0, elapsedMs - boundedStoppage);

  return {
    countByPhase,
    byPhase,
    totalCount,
    stoppageMs,
    ballRollingMs,
    ballRollingRatio: elapsedMs === 0 ? 1 : ballRollingMs / elapsedMs,
    overBudgetPhases,
  };
}

/** *"9 interventions, planned 4. Ball rolling time 61%."* — the Review report's one line. */
export function describeInterventionSummary(summary: InterventionSummary): string {
  const planned = summary.byPhase.reduce((total, phase) => total + (phase.budget.max ?? 0), 0);
  const percent = Math.round(summary.ballRollingRatio * 100);
  return `${summary.totalCount} intervention${summary.totalCount === 1 ? '' : 's'}, planned ${planned}. Ball rolling time ${percent}%.`;
}

/** Coaching points the coach never got to. Seeds the low-priority "Didn't get to" proposal. */
export function undeliveredCoachingPoints(session: Session) {
  return session.phases.flatMap((phase) =>
    phase.coachingPoints.filter((point) => !point.delivered).map((point) => ({ phase, point })),
  );
}

/** Phases that ran longer than planned, with by how much. Surfaced in Review, pre-filled. */
export function phaseOverruns(session: Session, nowMs = Date.now()) {
  const run = session.run;
  if (run === null) return [];

  return session.phases
    .map((phase) => {
      const actualMs = run.phaseRuns
        .filter((phaseRun) => phaseRun.phaseId === phase.id)
        .reduce((total, phaseRun) => total + phaseElapsedMs(phaseRun, nowMs), 0);
      const plannedMs = phase.plannedDurationMin * 60_000;
      return { phase, actualMs, plannedMs, overrunMs: actualMs - plannedMs };
    })
    .filter((entry) => entry.overrunMs > 60_000)
    .sort((a, b) => b.overrunMs - a.overrunMs);
}
