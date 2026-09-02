import { z } from 'zod';
import { FOUR_CORNERS, FourCornerSchema, type FourCorner } from './four-corners';
import { PlayerAssessmentIdSchema, PlayerIdSchema, SessionIdSchema, SquadIdSchema } from './ids';
import { IsoDateTimeSchema, optionalText, RatingSchema, RecordMetaSchema } from './primitives';

/**
 * A point-in-time 4 Corner profile of one player.
 *
 * The corner *balance* report is derived from observations and costs the coach nothing. This
 * is the other half of how the FA model is actually used: a deliberate, occasional judgement
 * — "where is this player, across all four corners, right now" — recorded so that the same
 * question in three months has something to compare against.
 *
 * Deliberately cheap: four taps, notes optional. A profiling ritual that takes twenty minutes
 * per player is a ritual that happens once.
 */

const CornerRatingsSchema = z.object({
  technical_tactical: RatingSchema.nullable().default(null),
  physical: RatingSchema.nullable().default(null),
  psychological: RatingSchema.nullable().default(null),
  social: RatingSchema.nullable().default(null),
});
export type CornerRatings = z.infer<typeof CornerRatingsSchema>;

const CornerNotesSchema = z.object({
  technical_tactical: optionalText(300).default(''),
  physical: optionalText(300).default(''),
  psychological: optionalText(300).default(''),
  social: optionalText(300).default(''),
});
export type CornerNotes = z.infer<typeof CornerNotesSchema>;

export const PlayerAssessmentSchema = RecordMetaSchema.extend({
  id: PlayerAssessmentIdSchema,
  playerId: PlayerIdSchema,
  squadId: SquadIdSchema,
  assessedAt: IsoDateTimeSchema,
  ratings: CornerRatingsSchema,
  notes: CornerNotesSchema.default({}),
  /** Set when the assessment was captured during a session review rather than standalone. */
  sessionId: SessionIdSchema.nullable().default(null),
  /** The one corner the coach intends to work on next. Seeds a carry-forward action. */
  focusCorner: FourCornerSchema.nullable().default(null),
});
export type PlayerAssessment = z.infer<typeof PlayerAssessmentSchema>;
export type PlayerAssessmentInput = z.input<typeof PlayerAssessmentSchema>;

export const emptyCornerRatings = (): CornerRatings => ({
  technical_tactical: null,
  physical: null,
  psychological: null,
  social: null,
});

export const emptyCornerNotes = (): CornerNotes => ({
  technical_tactical: '',
  physical: '',
  psychological: '',
  social: '',
});

/** Corners the coach actually rated. A half-finished assessment is still worth keeping. */
export function ratedCorners(assessment: PlayerAssessment): FourCorner[] {
  return FOUR_CORNERS.filter((corner) => assessment.ratings[corner] !== null);
}

export function isComplete(assessment: PlayerAssessment): boolean {
  return ratedCorners(assessment).length === FOUR_CORNERS.length;
}

/** Mean across the rated corners. `null` when nothing was rated. */
export function overallRating(assessment: PlayerAssessment): number | null {
  const rated = ratedCorners(assessment);
  if (rated.length === 0) return null;
  const total = rated.reduce((sum, corner) => sum + (assessment.ratings[corner] ?? 0), 0);
  return total / rated.length;
}

export interface CornerDelta {
  readonly corner: FourCorner;
  readonly from: number;
  readonly to: number;
  readonly change: number;
}

/**
 * What moved between two assessments.
 *
 * Only corners rated in *both* appear — comparing a rated corner against an unrated one
 * would invent a change out of an omission, which is exactly the kind of quiet lie that
 * makes a coach stop trusting a progress screen.
 */
export function cornerDeltas(previous: PlayerAssessment, current: PlayerAssessment): CornerDelta[] {
  return FOUR_CORNERS.flatMap((corner) => {
    const from = previous.ratings[corner];
    const to = current.ratings[corner];
    if (from === null || to === null) return [];
    return [{ corner, from, to, change: to - from }];
  });
}
