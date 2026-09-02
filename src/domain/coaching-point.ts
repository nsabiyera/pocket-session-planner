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

export const CoachingPointSchema = z.object({
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
});
export type CoachingPoint = z.infer<typeof CoachingPointSchema>;
export type CoachingPointInput = z.input<typeof CoachingPointSchema>;

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
