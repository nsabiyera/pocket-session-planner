import type { IdGenerator } from '@/lib/id';
import { asPhaseId, asSessionId, type SessionId } from '../ids';
import type { MethodologySnapshot } from '../methodology';
import { CURRENT_SCHEMA_VERSION, type IsoDateTime } from '../primitives';
import type { Squad } from '../squad';
import {
  SessionSchema,
  type FocusPlayerAssignment,
  type Objective,
  type Session,
  type SessionPhase,
} from '../session';
import { periodName, type MatchDetailsInput, type PeriodCount } from '../match-day';
import { autoTitle } from './build-from-methodology';

/**
 * Match day is a methodology, and this is its snapshot.
 *
 * It is deliberately **not** in `METHODOLOGY_PRESETS`: those five are ways to design a
 * practice, and offering "Match day" in the training methodology picker would be nonsense.
 * But `Session.methodology` is a frozen snapshot rather than a live reference, so a match can
 * carry an honest description of how a coach coaches on a Saturday without pretending to be
 * one of the training presets.
 *
 * `hands_off` is the whole point. The coaching happened Tuesday; today you watch.
 */
export function matchDayMethodology(capturedAt: IsoDateTime): MethodologySnapshot {
  return {
    methodologyId: 'match-day' as MethodologySnapshot['methodologyId'],
    name: 'Match day',
    coachStance: 'hands_off',
    version: 1,
    originKind: 'builtin',
    referenceDurationMin: 60,
    coachPrompt: 'Watch. Say it at half time, not from the touchline.',
    capturedAt,
  };
}

/**
 * Defaults, and honestly labelled as such.
 *
 * England Football publishes maximum match durations by age, but this codebase does not carry
 * that table and inventing one here would put an FA-looking number in front of a coach that
 * the FA never said. So these are round numbers the coach edits, in the same spirit as the
 * group-size stepper in ADR 0004: a default, not a derivation.
 */
export const DEFAULT_PERIOD_MIN: Record<PeriodCount, number> = { 2: 20, 4: 10 };
const HALF_TIME_MIN = 5;
const BREAK_MIN = 2;

export interface BuildMatchOptions {
  squad: Squad;
  /** The **whole-team** objective. Units get `match.unitObjectives`; players get challenges. */
  objective: Objective;
  match: MatchDetailsInput;
  now: IsoDateTime;
  ids: IdGenerator;
  /** Minutes per period. Defaults by period count — see `DEFAULT_PERIOD_MIN`. */
  periodMin?: number;
  scheduledFor?: IsoDateTime;
  focusPlayers?: readonly FocusPlayerAssignment[];
  title?: string;
  sessionId?: SessionId;
}

/**
 * Turns a fixture into a runnable session: periods, breaks, and a half-time huddle.
 *
 * The periods are `game` phases and the intervals are `huddle` phases, both of which already
 * existed in `PhaseKind` — so Do mode's timer, its Undo, its observation logging and its
 * challenge tallies all work on a match without knowing one is happening.
 *
 * Intervention is where the difference bites. The periods carry `maxPerPhase: 0` with
 * mechanic `none`: you cannot stop a referee's game to coach, and the app should not offer a
 * button that implies you can. The huddles carry a real budget, because half time is the one
 * moment on a Saturday when coaching is actually possible.
 */
export function buildMatch(options: BuildMatchOptions): Session {
  const {
    squad,
    objective,
    match,
    now,
    ids,
    scheduledFor = now,
    focusPlayers = [],
    title,
    sessionId,
  } = options;

  const periodCount = match.periodCount;
  const periodMin = options.periodMin ?? DEFAULT_PERIOD_MIN[periodCount];

  const phases: SessionPhase[] = [];
  let order = 0;

  for (let index = 0; index < periodCount; index += 1) {
    phases.push(periodPhase(periodName(index, periodCount), order, periodMin, ids));
    order += 1;

    const isLast = index === periodCount - 1;
    if (isLast) continue;

    // The midpoint is half time whatever the period count; the others are just breaks.
    const isHalfTime = index === periodCount / 2 - 1;
    phases.push(
      huddlePhase(
        isHalfTime ? 'Half time' : 'Break',
        order,
        isHalfTime ? HALF_TIME_MIN : BREAK_MIN,
        isHalfTime,
        ids,
      ),
    );
    order += 1;
  }

  const plannedDurationMin = phases.reduce((total, phase) => total + phase.plannedDurationMin, 0);

  return SessionSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    id: sessionId ?? asSessionId(ids.uuid()),
    squadId: squad.id,
    kind: 'match',
    match,
    title: title ?? autoTitle(objective.text, scheduledFor),
    objective,
    methodology: matchDayMethodology(now),
    // Watch, do not shout. The periods restate it so a phase never inherits something louder.
    intervention: {
      method: 'observation_feedback',
      mechanic: 'none',
      audience: 'team',
      maxPerPhase: 0,
    },
    interventionTouched: false,
    focusPlayers,
    phases,
    plannedDurationMin,
    scheduledFor,
    status: 'draft',
    run: null,
    reviewId: null,
  });
}

function periodPhase(
  title: string,
  order: number,
  minutes: number,
  ids: IdGenerator,
): SessionPhase {
  return {
    ...blankPhase(ids),
    order,
    kind: 'game',
    title,
    plannedDurationMin: minutes,
    intervention: {
      method: 'observation_feedback',
      mechanic: 'none',
      audience: 'team',
      maxPerPhase: 0,
      maxDurationSec: null,
    },
    coachPrompts: [
      'Watch for the thing you worked on this week.',
      'Note who did it. That is the review.',
    ],
  };
}

function huddlePhase(
  title: string,
  order: number,
  minutes: number,
  isHalfTime: boolean,
  ids: IdGenerator,
): SessionPhase {
  return {
    ...blankPhase(ids),
    order,
    kind: 'huddle',
    title,
    plannedDurationMin: minutes,
    // A unit audience by default: half time is where "midfield, screen in front of the back
    // three" gets said, and `InterventionAudience` already has the word for it.
    intervention: {
      method: 'question_and_answer',
      mechanic: 'none',
      audience: 'unit',
      maxPerPhase: isHalfTime ? 2 : 1,
      maxDurationSec: null,
    },
    coachPrompts: isHalfTime
      ? ['One thing for the team, one for a unit. Not six things.', 'Ask before you tell.']
      : ['Drinks. Say nothing tactical.'],
  };
}

/**
 * The shared blank. A match period is not a designed practice, so `spectrum`, `area`,
 * `groupSize` and the STEP constraints stay null — a game is the thing practices are
 * representative *of*, and filling those in would put invented practice design into a report.
 */
function blankPhase(ids: IdGenerator): SessionPhase {
  return {
    id: asPhaseId(ids.uuid()),
    order: 0,
    kind: 'game',
    title: '',
    plannedDurationMin: 1,
    intervention: null,
    coachingPoints: [],
    focusPlayerIds: [],
    progressions: [],
    regressions: [],
    spectrum: null,
    area: null,
    groupSize: null,
    constraints: [],
    playerChoice: false,
    imageIds: [],
    organisation: '',
    coachPrompts: [],
    fromTemplateId: null,
    sourceActionId: null,
  };
}

/** The periods, in order — the phases a match is actually played in. */
export function periodsOf(session: Session): SessionPhase[] {
  return [...session.phases].sort((a, b) => a.order - b.order).filter((p) => p.kind === 'game');
}
