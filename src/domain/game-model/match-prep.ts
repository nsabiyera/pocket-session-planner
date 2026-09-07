import {
  MATCH_UNIT_LABELS,
  findShape,
  unitsOf,
  type MatchDetails,
  type MatchUnit,
  type UnitObjective,
} from '../match-day';
import { MOMENT_LABELS, type Principle } from '../game-model';
import type { WeekReview } from './week-review';

/**
 * Match preparation — what the week trained, turned into what you say to each unit.
 *
 * The screen the original request described, and last because it is mostly a view over
 * everything before it. The one genuinely new thing it does is close the loop the whole feature
 * exists for: a principle worked three times on the training pitch and briefed to nobody on
 * Saturday is the gap between a game model and a game.
 *
 * **It does not assign principles to units.** A principle belongs to a *moment*, and a moment
 * is not a unit — "build from the back" concerns the keeper, the defence and the midfield at
 * once. Deriving a unit from a moment would be inventing a fact, so the app offers the week's
 * principles as candidate wording and the coach chooses the unit. That turns typing into
 * tapping, which is the only honest help available here.
 *
 * **No opponent model.** The roadmap ruled out a scouting database and this keeps to it: the
 * coach's own note about the team they are playing, and nothing the app claims to know about
 * them.
 */

export interface BriefedUnit {
  readonly unit: MatchUnit;
  readonly label: string;
  /** Null when this unit has nothing asked of it yet. */
  readonly objective: UnitObjective | null;
}

export interface MatchPreparation {
  /** The units this shape actually fields, so a 2-1 is never asked for a midfield brief. */
  readonly units: readonly BriefedUnit[];
  /**
   * Principles the week's sessions actually trained, offered as candidate wording.
   *
   * Ordered as the week ran them, because the last thing trained is the freshest and the most
   * likely thing a coach wants to say on Saturday.
   */
  readonly candidates: readonly Principle[];
  /**
   * Trained this week, and named in no unit's brief.
   *
   * The most useful line on the screen, and the reason to hold any of this as data: it is the
   * gap between what a squad practised and what it was told.
   */
  readonly unbriefed: readonly Principle[];
  readonly briefedCount: number;
}

export function prepareMatch(match: MatchDetails, review: WeekReview): MatchPreparation {
  const shape = match.shapeName === null ? undefined : findShape(match.format, match.shapeName);

  // With no shape chosen the coach can still brief, so fall back to every unit rather than
  // offering none — an unset shape is a plan not yet finished, not a reason to block.
  const fielded: MatchUnit[] = shape
    ? unitsOf(shape, match.format)
    : (Object.keys(MATCH_UNIT_LABELS) as MatchUnit[]);

  const units: BriefedUnit[] = fielded.map((unit) => ({
    unit,
    label: MATCH_UNIT_LABELS[unit],
    objective: match.unitObjectives.find((objective) => objective.unit === unit) ?? null,
  }));

  const candidates = dedupe(
    review.days
      .map((day) => day.principle)
      .filter((principle): principle is Principle => principle !== null),
  );

  const briefedText = new Set(match.unitObjectives.map((objective) => normalise(objective.text)));

  return {
    units,
    candidates,
    // Matched on the wording, because that is what a coach actually copies across. An exact
    // principle id would miss the common case of a brief typed out by hand from the same line.
    unbriefed: candidates.filter((principle) => !briefedText.has(normalise(principle.text))),
    briefedCount: units.filter((unit) => unit.objective !== null).length,
  };
}

const normalise = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/, '');

function dedupe(principles: readonly Principle[]): Principle[] {
  const seen = new Set<string>();
  const out: Principle[] = [];
  for (const principle of principles) {
    if (seen.has(principle.id)) continue;
    seen.add(principle.id);
    out.push(principle);
  }
  return out;
}

/**
 * One sentence, or nothing.
 *
 * Nothing when the week trained nothing linked to the model — there is then no gap to report,
 * only a coach who has not used the link, and saying so here would be nagging.
 */
export function describePreparation(prep: MatchPreparation): string | null {
  if (prep.candidates.length === 0) return null;

  const briefed = `${prep.briefedCount} of ${prep.units.length} units briefed.`;

  if (prep.unbriefed.length === 0) {
    return `${briefed} Everything the week trained is in a brief.`;
  }

  const named = prep.unbriefed
    .slice(0, 2)
    .map((principle) => `"${principle.text}"`)
    .join(' and ');
  const more = prep.unbriefed.length > 2 ? ` and ${prep.unbriefed.length - 2} more` : '';

  return `${briefed} Trained but not briefed: ${named}${more}.`;
}

/** `In possession · The detail` — where a candidate principle sits, for the picker. */
export function describeCandidate(principle: Principle): string {
  return MOMENT_LABELS[principle.moment];
}
