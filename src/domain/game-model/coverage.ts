import type { PrincipleId } from '../ids';
import {
  MOMENTS,
  MOMENT_LABELS,
  levelDepth,
  type GameModel,
  type Moment,
  type Principle,
  type PrincipleLevel,
} from '../game-model';

/**
 * What the sessions actually trained, against what the game model says.
 *
 * The point of Phase 3, and the first thing in this feature that can **falsify** a coach's own
 * plan rather than merely record it. A game model is a statement of intent; a term of sessions
 * is what happened. Holding both as data is what lets the app put them next to each other, and
 * a coach cannot do this from memory across a congested month.
 *
 * It describes and does not prescribe, in the voice the practice-mix, corner-balance and
 * minutes reports already use. There is no target number of sessions per principle and no
 * warning colour, because no source says what that number would be.
 */

/** A session, reduced to the two fields this module needs. */
export interface TrainedSession {
  readonly objective: { readonly principleId: PrincipleId | null; readonly text: string };
  readonly scheduledFor: string;
}

export interface PrincipleCoverage {
  readonly principle: Principle;
  readonly sessions: number;
  /** Most recent first, so `[0]` is the last time this was worked on. */
  readonly lastTrainedAt: string | null;
}

export interface MomentCoverage {
  readonly moment: Moment;
  readonly sessions: number;
  readonly lastTrainedAt: string | null;
}

export interface CoverageReport {
  /** Every principle in the model, most-trained first. Untouched ones sort last. */
  readonly principles: readonly PrincipleCoverage[];
  readonly moments: readonly MomentCoverage[];
  /**
   * Sessions whose principle id resolves to nothing in the current model.
   *
   * Not an error. A coach who reworks their game model in January leaves November's sessions
   * pointing at principles that no longer exist, and rewriting that history would be worse
   * than reporting it. See the note on `Objective.principleId`.
   */
  readonly orphanedSessions: number;
  /** Sessions with no principle at all — the normal state before a model exists. */
  readonly unlinkedSessions: number;
  readonly totalSessions: number;
}

export function coverageOf(model: GameModel, sessions: readonly TrainedSession[]): CoverageReport {
  const byPrinciple = new Map<string, { count: number; last: string | null }>();
  let orphaned = 0;
  let unlinked = 0;

  const known = new Set(model.principles.map((principle) => principle.id as string));

  for (const session of sessions) {
    const id = session.objective.principleId;
    if (id === null) {
      unlinked += 1;
      continue;
    }
    if (!known.has(id)) {
      orphaned += 1;
      continue;
    }

    const current = byPrinciple.get(id) ?? { count: 0, last: null };
    byPrinciple.set(id, {
      count: current.count + 1,
      last:
        current.last === null || session.scheduledFor > current.last
          ? session.scheduledFor
          : current.last,
    });
  }

  const principles: PrincipleCoverage[] = model.principles
    .map((principle) => {
      const found = byPrinciple.get(principle.id);
      return {
        principle,
        sessions: found?.count ?? 0,
        lastTrainedAt: found?.last ?? null,
      };
    })
    // Most trained first, then coarsest level, then authored order — so a coach scanning this
    // sees what they have worked on, and the untouched ones collect at the bottom where the
    // gap is obvious.
    .sort(
      (a, b) =>
        b.sessions - a.sessions || levelDepth(a.principle.level) - levelDepth(b.principle.level),
    );

  const moments: MomentCoverage[] = MOMENTS.map((moment) => {
    const inMoment = principles.filter((entry) => entry.principle.moment === moment);
    const dates = inMoment
      .map((entry) => entry.lastTrainedAt)
      .filter((date): date is string => date !== null);

    return {
      moment,
      sessions: inMoment.reduce((total, entry) => total + entry.sessions, 0),
      lastTrainedAt: dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b)),
    };
  });

  return {
    principles,
    moments,
    orphanedSessions: orphaned,
    unlinkedSessions: unlinked,
    totalSessions: sessions.length,
  };
}

/** Principles the model states and the sessions have never once worked on. */
export function untrainedPrinciples(report: CoverageReport): Principle[] {
  return report.principles.filter((entry) => entry.sessions === 0).map((entry) => entry.principle);
}

/**
 * Moments not trained since a cutoff.
 *
 * The seed of the horizontal-alternation report: the methodology's whole claim about a week is
 * that the moments are distributed rather than one of them hammered, and this is the fact that
 * claim rests on. A moment never trained at all counts — it is the strongest version of the
 * same gap.
 */
export function momentsNotTrainedSince(report: CoverageReport, since: string): Moment[] {
  return report.moments
    .filter((entry) => entry.lastTrainedAt === null || entry.lastTrainedAt < since)
    .map((entry) => entry.moment);
}

/** Below this, a coverage report is arithmetic on too little to mean anything. */
export const MIN_SESSIONS_FOR_COVERAGE = 4;

export function hasEnoughForCoverage(report: CoverageReport): boolean {
  return report.totalSessions - report.unlinkedSessions >= MIN_SESSIONS_FOR_COVERAGE;
}

/**
 * One sentence, or nothing.
 *
 * Nothing is right until there are enough linked sessions to say anything true. Four sessions
 * is the floor, matching the spirit of the corner-balance report's eight observations: a report
 * that accuses a coach of neglecting a moment after one Tuesday is a report they learn to
 * ignore.
 */
export function describeCoverage(report: CoverageReport): string | null {
  if (!hasEnoughForCoverage(report)) return null;

  const trained = report.principles.filter((entry) => entry.sessions > 0);
  if (trained.length === 0) return null;

  const untouched = untrainedPrinciples(report);
  const emptyMoments = report.moments.filter((entry) => entry.sessions === 0);

  const counted = `${trained.length} of ${report.principles.length} principles worked on across ${report.totalSessions - report.unlinkedSessions} session${report.totalSessions - report.unlinkedSessions === 1 ? '' : 's'}.`;

  const parts = [counted];

  if (emptyMoments.length > 0) {
    const named = emptyMoments.map((entry) => MOMENT_LABELS[entry.moment].toLowerCase());
    const list =
      named.length === 1
        ? named[0]
        : `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}`;
    parts.push(`Nothing on ${list}.`);
  } else if (untouched.length > 0) {
    parts.push(
      `${untouched.length} principle${untouched.length === 1 ? '' : 's'} not yet worked on.`,
    );
  }

  if (report.orphanedSessions > 0) {
    // Said plainly, because the alternative reading — that those sessions trained nothing — is
    // wrong and would understate the coach's own record.
    parts.push(
      `${report.orphanedSessions} session${report.orphanedSessions === 1 ? '' : 's'} named a principle the model no longer has.`,
    );
  }

  return parts.join(' ');
}

/**
 * `Sub-principle, worked 3 sessions running` — the carry-forward warning, given a level.
 *
 * Carry-forward already flags a coaching point chased three sessions running and tells the
 * coach to change the practice rather than the point. Against a game model that flag gains the
 * methodology's own diagnosis: a **sub-principle** worked three times without being acquired
 * is a propensity problem, not a principle problem. This names the level so the planner's
 * existing warning can say which.
 */
export function levelOfPrinciple(
  model: GameModel,
  principleId: PrincipleId | null,
): PrincipleLevel | null {
  if (principleId === null) return null;
  return model.principles.find((principle) => principle.id === principleId)?.level ?? null;
}
