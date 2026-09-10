import { z } from 'zod';
import { CarryForwardActionIdSchema, CoachingPointIdSchema, PlayerIdSchema } from './ids';
import { FourCornerSchema } from './four-corners';
import { IsoDateTimeSchema, nonEmptyText } from './primitives';

/**
 * Where a coaching point came from. This is not decoration: `carry_forward` is what lets Do
 * mode render a *"carried from 14 Mar"* marker on exactly the things that were carried, and
 * it is what closes the loop between one session and the next.
 */
export const CoachingPointSourceSchema = z.enum(['methodology', 'coach', 'carry_forward']);
export type CoachingPointSource = z.infer<typeof CoachingPointSourceSchema>;

export const CoachingPointSchema = z
  .object({
    id: CoachingPointIdSchema,
    text: nonEmptyText(160),
    source: CoachingPointSourceSchema,
    /** Empty means the point is for everyone; otherwise it is aimed at these players. */
    playerIds: z.array(PlayerIdSchema).max(30).default([]),
    /**
     * Ticked off in Do mode. A point still `false` at the end of a completed session becomes
     * a low-priority *"Didn't get to: …"* carry-forward proposal.
     */
    delivered: z.boolean().default(false),
    deliveredAt: IsoDateTimeSchema.nullable().default(null),
    /**
     * **Did the coach find out whether it landed?** (ADR 0009.)
     *
     * `delivered` records that you said it. This records that you asked somebody to say it
     * back or show it back — and it is a fact about the *coach's action*, not a verdict on
     * the players. Nothing anywhere reads this as "they understood it", because a check is a
     * record and understanding is not observable.
     *
     * Additive with a default, so no migration: `DB_VERSION` is bumped only for stores and
     * indexes, and document shape changes ride `RecordMeta.schemaVersion`. Every session
     * written before this parses unchanged, and reads as **unchecked** — which is the honest
     * value for them, because nobody can now say whether those points were checked. Same
     * reasoning `InterventionEvent.styleChosen` records for its own default.
     */
    checked: z.boolean().default(false),
    checkedAt: IsoDateTimeSchema.nullable().default(null),
    /** Set when this point was seeded by a carry-forward action, for the "carried from" marker. */
    sourceActionId: CarryForwardActionIdSchema.nullable().default(null),
    /**
     * Which corner of the FA 4 Corner Model this point develops.
     *
     * Nullable rather than omitted because it is not indexed, and because "we never classified
     * this one" is a meaningful state that should survive a JSON export legibly. An observation
     * logged against the point inherits it.
     */
    corner: FourCornerSchema.nullable().default(null),
  })
  .superRefine((point, ctx) => {
    // You cannot check a point you never made. The chip can only reach `checked` through
    // `said`, so this only ever fires on a hand-edited import — which is exactly when an
    // invariant is worth having, because the review line is arithmetic over these two fields.
    if (point.checked && !point.delivered) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checked'],
        message: 'A coaching point cannot be checked without having been delivered.',
      });
    }
  });
export type CoachingPoint = z.infer<typeof CoachingPointSchema>;
export type CoachingPointInput = z.input<typeof CoachingPointSchema>;

/**
 * **The three states of the chip in Do mode**, in the order the coach taps through them.
 *
 * The roadmap's open question was a third state versus a long press. Third state, because the
 * tap budget says so and because the app's existing long-press is a cautionary tale — it is
 * documented, reported on, and was never wired up (`docs/known-issues.md`).
 */
export const COACHING_POINT_STATES = ['planned', 'said', 'checked'] as const;
export type CoachingPointState = (typeof COACHING_POINT_STATES)[number];

export function coachingPointState(
  point: Pick<CoachingPoint, 'delivered' | 'checked'>,
): CoachingPointState {
  if (point.checked) return 'checked';
  return point.delivered ? 'said' : 'planned';
}

/**
 * **Monotone, and it wraps.**
 *
 * The risk with a third state is a mis-tap recording a check that never happened, which would
 * poison the one line in Review worth having. Cycling forward is the cheapest defence: a
 * mis-tap over-counts by one, the coach can see it did, and one more tap takes it back to
 * `planned` rather than needing a gesture they have to learn.
 */
export function nextCoachingPointState(current: CoachingPointState): CoachingPointState {
  if (current === 'planned') return 'said';
  return current === 'said' ? 'checked' : 'planned';
}

/**
 * What the chip shows, and what a screen reader says instead.
 *
 * Both live here so they cannot drift apart, and neither of them says *understood* — the glyph
 * is a tally of coach actions, not a grade. See ADR 0009 §1.
 */
const STATE_GLYPHS: Record<CoachingPointState, string> = {
  planned: '○',
  said: '✓',
  checked: '✓✓',
};

const STATE_LABELS: Record<CoachingPointState, string> = {
  planned: 'not said yet',
  said: 'said it',
  checked: 'said it, and checked it',
};

export const coachingPointGlyph = (state: CoachingPointState): string => STATE_GLYPHS[state];
export const coachingPointStateLabel = (state: CoachingPointState): string => STATE_LABELS[state];

/**
 * How many points the coach said, and how many they found out about.
 *
 * `total` is carried because it is free, but the line below deliberately does **not** report
 * it: the points never delivered already have their own carry-forward proposal, and saying it
 * twice would read as a telling-off rather than a count.
 */
export interface CoachingPointChecks {
  readonly total: number;
  readonly delivered: number;
  readonly checked: number;
}

export function coachingPointChecks(
  points: readonly Pick<CoachingPoint, 'delivered' | 'checked'>[],
): CoachingPointChecks {
  let delivered = 0;
  let checked = 0;
  for (const point of points) {
    if (point.delivered) delivered += 1;
    if (point.checked) checked += 1;
  }
  return { total: points.length, delivered, checked };
}

/**
 * *"5 coaching points delivered. 1 checked."*
 *
 * The line ADR 0009 put first, and it is as sharp as ball-rolling time for the same reason:
 * two counts of things the coach actually did, with no target and no verdict attached. There
 * is no correct ratio here and the app never suggests one — a coach who checked one point
 * properly had a better night than one who ticked five chips.
 *
 * The zero case says **"none marked checked"** rather than "none checked". The chip defaults
 * to unticked, so zero means *nothing was recorded* at least as often as it means *nothing was
 * checked* — the `engagement.ts` zero-case rule, and the same reason old sessions can read
 * this way without the line becoming a lie about them.
 */
export function describeCoachingPointChecks(checks: CoachingPointChecks): string {
  const points = `${checks.delivered} coaching point${checks.delivered === 1 ? '' : 's'} delivered.`;
  return checks.checked === 0
    ? `${points} None marked checked.`
    : `${points} ${checks.checked} checked.`;
}

/**
 * Whether the line is worth showing.
 *
 * The floor is **one delivered point**, and it is a floor about the arithmetic rather than a
 * sample size: the line compares checking against saying, so with nothing recorded as said
 * there is nothing to compare. A session where the coach ticked no chips at all is already
 * covered by the *"Didn't get to: …"* proposals.
 */
export function hasEnoughForCheckLine(checks: CoachingPointChecks): boolean {
  return checks.delivered >= 1;
}

/**
 * Normalisation for dedupe: lowercase, strip punctuation, collapse whitespace.
 *
 * Deliberately deterministic rather than fuzzy. A coach who writes "Scan before receiving"
 * twice gets one action; a coach who writes something genuinely different gets two. Fuzzy
 * matching would occasionally merge two real points, which is worse than an occasional
 * duplicate the coach can delete.
 */
export function normaliseCoachingPointText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function coachingPointsMatch(a: string, b: string): boolean {
  return normaliseCoachingPointText(a) === normaliseCoachingPointText(b);
}
