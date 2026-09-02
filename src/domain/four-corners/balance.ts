import { cornerForTag, cornerShortLabel, FOUR_CORNERS, type FourCorner } from '../four-corners';
import type { Observation } from '../observation';

/**
 * Corner balance — the reason this feature exists.
 *
 * The 4 Corner Model's whole claim is that the corners are *equally important*. A coach who
 * has logged thirty-four observations of a player, twenty-nine of them technical, is not
 * developing that player holistically; they are developing a quarter of them and cannot see
 * it. This turns the observations the coach is already logging into that sentence.
 *
 * Same shape as the intervention report: no extra tracking, no extra taps, one honest number.
 */

export interface CornerBalance {
  readonly countByCorner: Record<FourCorner, number>;
  readonly shareByCorner: Record<FourCorner, number>;
  /** Every observation considered, classified or not. */
  readonly total: number;
  readonly classified: number;
  /** Logged with no attribute tag — real, but invisible to the model. */
  readonly unclassified: number;
  /** Corners with nothing at all against them. The whole point of the report. */
  readonly neglected: FourCorner[];
  /** A corner holding more than half of everything classified, if there is one. */
  readonly dominant: FourCorner | null;
  /**
   * 0-1, where 1 is a perfectly even spread across all four corners.
   *
   * Normalised Shannon entropy, which is the standard way to score a distribution's evenness
   * and — unlike, say, "smallest share ÷ largest share" — degrades gracefully rather than
   * collapsing to zero the moment one corner is empty.
   */
  readonly evenness: number;
}

const zeroCounts = (): Record<FourCorner, number> => ({
  technical_tactical: 0,
  physical: 0,
  psychological: 0,
  social: 0,
});

/** More than this share in one corner and the app says so out loud. */
export const DOMINANT_CORNER_THRESHOLD = 0.5;

/**
 * Below this many observations the report stays quiet. Three observations spread 2/1/0/0 is
 * not a development bias, it is a Tuesday — and crying "you never look at the social corner"
 * after one session is how a coach learns to ignore the app.
 */
export const MIN_OBSERVATIONS_FOR_BALANCE = 8;

export function cornerBalance(observations: readonly Observation[]): CornerBalance {
  const countByCorner = zeroCounts();
  let classified = 0;

  for (const observation of observations) {
    const corner = cornerOfObservation(observation);
    if (corner === undefined) continue;
    countByCorner[corner] += 1;
    classified += 1;
  }

  const shareByCorner = zeroCounts();
  for (const corner of FOUR_CORNERS) {
    shareByCorner[corner] = classified === 0 ? 0 : countByCorner[corner] / classified;
  }

  const neglected = FOUR_CORNERS.filter((corner) => countByCorner[corner] === 0);
  const dominant =
    FOUR_CORNERS.find((corner) => shareByCorner[corner] > DOMINANT_CORNER_THRESHOLD) ?? null;

  return {
    countByCorner,
    shareByCorner,
    total: observations.length,
    classified,
    unclassified: observations.length - classified,
    neglected,
    dominant,
    evenness: evennessOf(shareByCorner),
  };
}

/**
 * An observation's corner: the one it was explicitly filed under, else the first of its tags
 * that maps to a known attribute.
 *
 * The fallback is what keeps logging at two taps. The coach taps a tag because it says the
 * thing they saw; the corner comes along for free rather than being a third decision.
 */
export function cornerOfObservation(observation: Observation): FourCorner | undefined {
  if (observation.corner !== undefined) return observation.corner;
  for (const tag of observation.tags) {
    const corner = cornerForTag(tag);
    if (corner !== undefined) return corner;
  }
  return undefined;
}

function evennessOf(share: Record<FourCorner, number>): number {
  const values = FOUR_CORNERS.map((corner) => share[corner]).filter((value) => value > 0);
  if (values.length <= 1) return values.length === 0 ? 0 : 0;

  const entropy = -values.reduce((total, value) => total + value * Math.log(value), 0);
  // Divide by the entropy of a perfectly even spread over all four corners, so the score is
  // absolute rather than relative to how many corners happen to be represented.
  return entropy / Math.log(FOUR_CORNERS.length);
}

/** Whether there is enough evidence for the report to be worth showing at all. */
export function hasEnoughForBalance(balance: CornerBalance): boolean {
  return balance.classified >= MIN_OBSERVATIONS_FOR_BALANCE;
}

/**
 * *"34 observations of Kai. 29 technical, 5 physical — nothing psychological or social."*
 *
 * Written to be readable at arm's length and to name the gap rather than scold about it.
 */
export function describeCornerBalance(balance: CornerBalance, subject: string): string {
  if (balance.classified === 0) {
    return balance.total === 0
      ? `Nothing logged for ${subject} yet.`
      : `${balance.total} observation${plural(balance.total)} for ${subject}, none tagged to a corner yet.`;
  }

  const present = FOUR_CORNERS.filter((corner) => balance.countByCorner[corner] > 0).map(
    (corner) => `${balance.countByCorner[corner]} ${cornerShortLabel(corner).toLowerCase()}`,
  );

  const head = `${balance.classified} observation${plural(balance.classified)} for ${subject}: ${present.join(', ')}`;
  if (balance.neglected.length === 0) return `${head}.`;

  const missing = balance.neglected.map((corner) => cornerShortLabel(corner).toLowerCase());
  return `${head} — nothing ${formatList(missing)}.`;
}

/** The nudge, phrased as a suggestion for next time rather than a verdict on last time. */
export function suggestNeglectedCorner(balance: CornerBalance): FourCorner | null {
  if (!hasEnoughForBalance(balance)) return null;
  // Prefer a corner with literally nothing; otherwise the thinnest one, but only when the
  // spread is genuinely lopsided.
  if (balance.neglected.length > 0) return balance.neglected[0] ?? null;
  if (balance.dominant === null) return null;

  return (
    FOUR_CORNERS.filter((corner) => corner !== balance.dominant).reduce((thinnest, corner) =>
      balance.countByCorner[corner] < balance.countByCorner[thinnest] ? corner : thinnest,
    ) ?? null
  );
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
