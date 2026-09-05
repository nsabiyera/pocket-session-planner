import type { PhaseId } from '../ids';
import {
  interventionBudget,
  resolvePhaseIntervention,
  type InterventionBudget,
  type InterventionEvent,
  type InterventionPlan,
} from '../intervention';
import { PERIPHERAL_PHASE_KINDS } from '../methodology';
import { msOf } from '../primitives';
import type { PhaseRun } from '../session-run';
import {
  describeSessionShape,
  relativePlayingArea,
  type AdjustmentSummary,
  type PracticeSpectrum,
} from '../practice';
import { ageBandOf } from '../practice/match';
import type { ChoiceSummary } from '../engagement';
import { phasesInOrder, type Session, type SessionPhase } from '../session';
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

/**
 * The practice spectrums of this session's phases, in order.
 *
 * Phases with no spectrum are **skipped, not defaulted** — a water break is not a practice,
 * and a phase the coach never classified is not an unopposed one. Guessing either way would
 * put a shape in the report that nobody chose.
 */
export function sessionSpectrums(session: Session): PracticeSpectrum[] {
  return phasesInOrder(session)
    .map((phase) => phase.spectrum)
    .filter((spectrum): spectrum is PracticeSpectrum => spectrum !== null);
}

/**
 * *"Overloaded → matched-up. The practice got more game-like as it went."*
 *
 * Null when fewer than two phases carry a spectrum — one practice is not a shape.
 */
export function describeSessionPractice(session: Session): string | null {
  return describeSessionShape(sessionSpectrums(session));
}

/**
 * How the coach changed the difficulty of their own practices.
 *
 * `phasesWithAPlan` and `plannedUnused` count the **plan** side, which is what lets Review
 * say *"you wrote three ways to change it and used none"* — the sentence that pairs with the
 * existing `chainDepth` warning. A phase can be adjusted without a plan (off-plan text is
 * empty) and planned without being adjusted; both are facts worth keeping apart.
 */
export function adjustmentSummary(session: Session): AdjustmentSummary {
  const adjustments = session.run?.practiceAdjustments ?? [];

  const planned = session.phases.filter(
    (phase) => phase.progressions.length > 0 || phase.regressions.length > 0,
  );

  // Match on the frozen text, so an adjustment logged off-plan never counts a written one
  // as used. Normalised only for whitespace — the text was frozen from the plan verbatim.
  const usedTexts = new Set(
    adjustments.map((adjustment) => adjustment.text.trim()).filter((text) => text.length > 0),
  );
  const plannedTexts = planned.flatMap((phase) => [...phase.progressions, ...phase.regressions]);

  return {
    total: adjustments.length,
    progressed: adjustments.filter((a) => a.direction === 'progressed').length,
    regressed: adjustments.filter((a) => a.direction === 'regressed').length,
    phasesAdjusted: new Set(adjustments.map((a) => a.phaseId)).size,
    phasesWithAPlan: planned.length,
    plannedUnused: plannedTexts.filter((text) => !usedTexts.has(text.trim())).length,
  };
}

/**
 * The spectrum of each session's **main practice**, oldest first.
 *
 * `null` for a session planned before the field existed, or whose coach left it unset —
 * carried through rather than dropped, so `practiceMix` can report how much of the term it
 * could not see. Silently omitting them would make a coach with two classified sessions look
 * like a coach with a habit.
 */
export function mainPracticeSpectrums(sessions: readonly Session[]): (PracticeSpectrum | null)[] {
  return sessions.map((session) => mainPracticePhase(session)?.spectrum ?? null);
}

/**
 * Where the players got to decide something.
 *
 * A water break is excluded from the denominator because it is not a coaching moment at all.
 * Huddles are **in**: *"leave with one agreed adjustment"* is a choice, and Guided Discovery's
 * whole method turns on it.
 */
export function choiceSummary(session: Session): ChoiceSummary {
  const considered = session.phases.filter((phase) => phase.kind !== 'water_break');
  return {
    phasesWithChoice: considered.filter((phase) => phase.playerChoice).length,
    phasesConsidered: considered.length,
  };
}

/**
 * The **last practice** of the session - what the players actually finished on.
 *
 * Not simply the last phase: sessions routinely end on a review huddle or a water break, and
 * "you finished on a huddle" answers nobody's question about whether the practice looked like
 * the game. Peripheral kinds are skipped from the end backwards.
 */
export function lastPracticePhase(session: Session): SessionPhase | undefined {
  const ordered = phasesInOrder(session);
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const phase = ordered[i]!;
    if (!PERIPHERAL_PHASE_KINDS.has(phase.kind)) return phase;
  }
  return undefined;
}

/**
 * What the session finished on, ready for the match comparison.
 *
 * `practiceArea` is null unless the coach recorded **both** the grid and the group size -
 * `relativePlayingArea` has no denominator otherwise, and inventing one would be the guess
 * ADR 0004 refused.
 */
export function representativeness(session: Session, ageGroup: string | undefined) {
  const phase = lastPracticePhase(session);
  const area =
    phase?.area && phase.groupSize !== null && phase.groupSize !== undefined
      ? relativePlayingArea(phase.area, phase.groupSize)
      : null;

  return {
    spectrum: phase?.spectrum ?? null,
    practiceArea: area,
    band: ageBandOf(ageGroup),
  };
}

/**
 * Every intervention across a term, with the measured clock behind it.
 *
 * Reuses `interventionSummary` per session rather than re-deriving, so the term's ball
 * rolling time is the same measured number the review screen shows - summed, never averaged
 * over sessions, because a 90-minute session and a 45-minute one do not get an equal vote.
 *
 * Only completed sessions: a draft has no run, and an in-progress one has a clock still
 * moving, which would make the number change every time the coach looked at it.
 */
export function coachingStyleInput(sessions: readonly Session[], nowMs = Date.now()) {
  const played = sessions.filter((session) => session.status === 'completed');

  let ballRollingMs = 0;
  let elapsedMs = 0;
  const events: InterventionEvent[] = [];

  for (const session of played) {
    const summary = interventionSummary(session, nowMs);
    ballRollingMs += summary.ballRollingMs;
    elapsedMs += summary.byPhase.reduce((total, phase) => total + phase.elapsedMs, 0);
    events.push(...(session.run?.interventionEvents ?? []));
  }

  return { sessions: played.length, events, ballRollingMs, elapsedMs };
}
