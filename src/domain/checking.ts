import type { CoachingPoint } from './coaching-point';
import type { Observation, ObservationRatingKind } from './observation';
import type { PracticeAdjustment } from './practice';
import type { CoachingPointId, PhaseId } from './ids';

/**
 * **The response half of checking for understanding** (ADR 0009 §3).
 *
 * Black and Wiliam's definition is information used to *modify the teaching while it is still
 * happening*. Every other line this app derives is reflective — ball rolling time, corner
 * bias, the said-against-checked count — and reflection arrives twenty minutes late. This
 * module is the one part of the feature that acts inside the session.
 *
 * ---
 *
 * **It invents nothing.** The regression it offers is text the coach wrote at plan time, in
 * their own words, and the trigger is an observation the coach logged themselves. The app
 * contributes the join and nothing else — no diagnosis, no verdict, and no suggestion the
 * coach has not already made to themselves on a Sunday.
 *
 * **Three conditions, all of them facts about the record.** No inference about a player, and
 * no claim that anybody failed to understand anything (ADR 0009 §1):
 *
 * 1. the coach predicted a misconception for this objective;
 * 2. they logged a `struggled` observation in this phase tagged with that prediction — *it
 *    went wrong the way we said it would*;
 * 3. they have not already made this practice easier, and they wrote down a way to.
 */

/**
 * Why `struggled` alone and not `working`.
 *
 * `working` is a player wrestling with the thing, which is where the learning is — making it
 * easier at that moment would take the practice away from them. `struggled` plus the predicted
 * error is the case the coach wrote a regression for.
 */
const TRIGGERING_RATING = 'struggled';

export interface RegressionOffer {
  /** The regression as the coach wrote it, offered verbatim and logged verbatim. */
  readonly text: string;
  /** How many other written regressions there are, for a coach who wants a different one. */
  readonly others: number;
}

export interface RegressionOfferInput {
  readonly phaseId: PhaseId;
  /** `Objective.commonMisconception` — null for a coach who typed their own objective. */
  readonly misconception: string | null;
  /** `SessionPhase.regressions`, in the order the coach wrote them. */
  readonly regressions: readonly string[];
  /** Every observation of this session. Filtered to the phase here, not by the caller. */
  readonly observations: readonly Pick<Observation, 'phaseId' | 'ratingKind' | 'tags'>[];
  /** `session.run.practiceAdjustments`. Filtered to the phase here too. */
  readonly adjustments: readonly Pick<PracticeAdjustment, 'phaseId' | 'direction'>[];
}

/**
 * *"You said this would happen. Here is what you wrote down to do about it."*
 *
 * Null — no offer at all — is the common case and the important one. A coach who typed their
 * own objective, a phase with no regression written, a phase where nothing has gone wrong the
 * predicted way, and a phase already made easier all get silence. There is no version of this
 * that nags.
 *
 * **The first regression wins.** A coach writes them in the order they would reach for them,
 * the same assumption the phase sheet already makes by listing them in that order, and
 * offering a choice here would turn a one-tap response into a decision at the worst possible
 * moment. `others` lets the bar say where the rest are.
 */
export function regressionOffer(input: RegressionOfferInput): RegressionOffer | null {
  const misconception = input.misconception?.trim() ?? '';
  if (misconception.length === 0) return null;

  const [first, ...rest] = input.regressions;
  if (first === undefined) return null;

  // Already made easier in this phase: the coach has responded, by this route or any other.
  // Deliberately blind to *which* regression they used, and to an off-plan one — a coach who
  // changed something they never wrote down has still responded.
  const alreadyEasier = input.adjustments.some(
    (adjustment) => adjustment.phaseId === input.phaseId && adjustment.direction === 'regressed',
  );
  if (alreadyEasier) return null;

  const key = misconception.toLowerCase();
  const predictedErrorSeen = input.observations.some(
    (observation) =>
      observation.phaseId === input.phaseId &&
      observation.ratingKind === TRIGGERING_RATING &&
      observation.tags.some((tag) => tag.trim().toLowerCase() === key),
  );
  if (!predictedErrorSeen) return null;

  return { text: first, others: rest.length };
}

/**
 * **Did it stick** — the coaching point to observation join (ADR 0009 phase 5).
 *
 * *"You said 'head up before you receive'. You logged it working afterwards."* And the case
 * that earns the feature: *"You said three points. You logged nothing about any of them."*
 *
 * **The wording is the whole feature.** An absent observation is an absence in the *record*,
 * not evidence the behaviour never appeared — a coach coaching a point is a coach not logging.
 * So every sentence says *"you logged nothing on it afterwards"* and never *"it didn't
 * stick"*, and the derivation below deliberately produces no verdict for the UI to dress up
 * as one. Same class of decision as `describeRepresentativeness` showing no number where it
 * has no defensible one.
 *
 * **It joins on `deliveredAt`, not on interventions.** The roadmap proposed joining
 * `InterventionEvent.coachingPointId`, which no UI has ever written. The chip the coach
 * already taps stamps `deliveredAt`, and `logObservation` now recovers `coachingPointId` from
 * the tag — so this needs no attribution step and no extra tap.
 */
export interface PointFollowUp {
  readonly pointId: CoachingPointId;
  readonly text: string;
  readonly checked: boolean;
  /** Observations tagged to this point, logged **after** it was marked said. */
  readonly loggedAfter: number;
  /** The ratings logged against it afterwards, oldest first. Counts, never a verdict. */
  readonly ratings: readonly ObservationRatingKind[];
}

export interface FollowUpSummary {
  /** Points the coach marked said. Points never said are a different report entirely. */
  readonly delivered: number;
  /** Of those, the ones with at least one observation logged afterwards. */
  readonly followedUp: number;
  /** Every said point, in phase order, with what the record holds about it. */
  readonly points: readonly PointFollowUp[];
}

export interface FollowUpInput {
  /** Phases in order; only the coaching points are read. */
  readonly phases: readonly {
    readonly coachingPoints: readonly Pick<
      CoachingPoint,
      'id' | 'text' | 'delivered' | 'deliveredAt' | 'checked'
    >[];
  }[];
  readonly observations: readonly Pick<Observation, 'coachingPointId' | 'ratingKind' | 'at'>[];
}

export function followUpSummary(input: FollowUpInput): FollowUpSummary {
  const points: PointFollowUp[] = [];

  for (const phase of input.phases) {
    for (const point of phase.coachingPoints) {
      if (!point.delivered) continue;

      /*
        Only observations logged *after* the point was marked said count as following it up.
        One logged at 3:00 about a point ticked at 7:00 is evidence about something else — and
        a coach who ticks their chips at the end of a phase would otherwise get a report full
        of follow-ups that happened before the coaching did.

        A point with no `deliveredAt` (imported, or hand-edited) counts everything, because the
        alternative is dropping real evidence over a missing timestamp.
      */
      const after = input.observations.filter(
        (observation) =>
          observation.coachingPointId === point.id &&
          (point.deliveredAt === null || observation.at >= point.deliveredAt),
      );

      points.push({
        pointId: point.id,
        text: point.text,
        checked: point.checked,
        loggedAfter: after.length,
        ratings: after
          .map((observation) => observation.ratingKind)
          .filter((rating): rating is ObservationRatingKind => rating !== null),
      });
    }
  }

  return {
    delivered: points.length,
    followedUp: points.filter((point) => point.loggedAfter > 0).length,
    points,
  };
}

/**
 * *"3 of the 5 points you said have something logged against them afterwards."*
 *
 * A count of the record, twice over. The zero case is the sharp one and it is still only a
 * statement about the record: *"you logged nothing about any of them"* — which may mean the
 * coach was busy coaching, and the app says so rather than concluding anything.
 */
export function describeFollowUp(summary: FollowUpSummary): string {
  const said = `${summary.delivered} point${summary.delivered === 1 ? '' : 's'} you said`;

  if (summary.followedUp === 0) {
    const them = summary.delivered === 1 ? 'it' : 'any of them';
    return `${said}, and nothing logged about ${them} afterwards.`;
  }
  if (summary.followedUp === summary.delivered) {
    return `Every one of the ${said} has something logged against it afterwards.`;
  }
  return `${summary.followedUp} of the ${said} have something logged against them afterwards.`;
}

/**
 * Whether the line is worth showing.
 *
 * **Two said points**, because with one the line is restating a single chip, and because the
 * whole value is the ratio. A session where nothing was ticked is covered by the
 * *"Didn't get to: …"* proposals instead.
 */
export const hasEnoughForFollowUp = (summary: FollowUpSummary): boolean => summary.delivered >= 2;

/**
 * What the offer bar says.
 *
 * A statement about the record and nothing more: a behaviour appeared, and the coach called
 * it in advance. It does not say *they did not understand it*, because the app cannot see
 * that and never claims to (ADR 0009 §1). It does not say *you should* anything either — the
 * fix on the other end of the tap is the coach's own sentence.
 */
export const REGRESSION_OFFER_MESSAGE = 'It went wrong the way you said it would.';
