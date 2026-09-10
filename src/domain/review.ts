import { z } from 'zod';
import {
  PhaseIdSchema,
  PlayerIdSchema,
  ReviewIdSchema,
  SessionIdSchema,
  SquadIdSchema,
} from './ids';
import {
  IsoDateTimeSchema,
  nonEmptyText,
  optionalText,
  RatingSchema,
  RecordMetaSchema,
} from './primitives';

/**
 * `/review` is five taps and zero required typing. Everything here that the app can work
 * out on its own is pre-filled and the coach only confirms it; the free-text fields sit at
 * the very bottom, keyboard only if wanted.
 */

/** The three 72px buttons: Yes / Partly / No, plus the one nobody expects to tap. */
export const ObjectiveOutcomeSchema = z.enum(['exceeded', 'met', 'partially_met', 'not_met']);
export type ObjectiveOutcome = z.infer<typeof ObjectiveOutcomeSchema>;

/** Outcomes that mean the objective needs another go rather than a progression. */
export const UNMET_OUTCOMES: ReadonlySet<ObjectiveOutcome> = new Set<ObjectiveOutcome>([
  'partially_met',
  'not_met',
]);

export const PhaseReviewSchema = z.object({
  phaseId: PhaseIdSchema,
  ranAsPlanned: z.boolean().default(true),
  rating: RatingSchema.nullable().default(null),
  /** Ticking this proposes a frozen copy of the phase as a one-tap re-run next session. */
  wouldRunAgain: z.boolean().default(false),
  note: optionalText(300).default(''),
});
export type PhaseReview = z.infer<typeof PhaseReviewSchema>;

export const FocusPlayerProgressSchema = z.enum(['progressed', 'no_change', 'regressed']);
export type FocusPlayerProgress = z.infer<typeof FocusPlayerProgressSchema>;

export const FocusPlayerReviewSchema = z.object({
  playerId: PlayerIdSchema,
  progress: FocusPlayerProgressSchema,
  /** Becomes the target behaviour of the next session's focus-player action, verbatim. */
  nextStep: optionalText(160).default(''),
  note: optionalText(300).default(''),
});
export type FocusPlayerReview = z.infer<typeof FocusPlayerReviewSchema>;

/**
 * The coach's answer to *"last time you said X — did it move on?"*, recorded against the
 * actions that seeded this session. This is the half of the loop that closes it.
 */
export const SeededActionOutcomeSchema = z.object({
  actionId: z.string().uuid(),
  outcome: z.enum(['done', 'still_open']),
  note: optionalText(200).default(''),
});
export type SeededActionOutcome = z.infer<typeof SeededActionOutcomeSchema>;

export const SessionReviewSchema = RecordMetaSchema.extend({
  id: ReviewIdSchema,
  sessionId: SessionIdSchema,
  squadId: SquadIdSchema,
  completedAt: IsoDateTimeSchema,
  objectiveOutcome: ObjectiveOutcomeSchema,
  /** Which of the objective's success criteria were actually met, by index into the list. */
  metCriteria: z.array(z.number().int().min(0).max(4)).max(5).default([]),
  sessionRating: RatingSchema.nullable().default(null),
  /** Did the coach's own intervention behaviour match the plan? Answered by the report. */
  interventionMatchedPlan: z.boolean().nullable().default(null),
  phaseReviews: z.array(PhaseReviewSchema).max(12).default([]),
  focusPlayerReviews: z.array(FocusPlayerReviewSchema).max(30).default([]),
  seededActionOutcomes: z.array(SeededActionOutcomeSchema).max(10).default([]),
  whatWorked: z.array(nonEmptyText(200)).max(5).default([]),
  whatDidnt: z.array(nonEmptyText(200)).max(5).default([]),
  /**
   * **The takeaway** — the one sentence the coach left the players with (ADR 0009 phase 6).
   *
   * Every other field on this document is the coach talking to themselves. This is the only
   * record of what they said to the squad, and it is read back at the *start* of the next
   * session: *"Last week you told them: …"*. Symmetric to the existing *"Last time you said…"*,
   * but pointed at the players — which is what turns a planning loop into a learning loop.
   *
   * Stored as a **quote**, never parsed and never aggregated. Nothing reads anything *out* of
   * it beyond the words, because anything else would be the fabricated evidence
   * `engagement.ts` refuses.
   *
   * Optional, and the last field on the screen. It is the only place in this feature that adds
   * a keyboard to the flow, so it has to be entirely skippable.
   */
  takeaway: optionalText(200).default(''),
  note: optionalText(1000).default(''),
});
export type SessionReview = z.infer<typeof SessionReviewSchema>;
export type SessionReviewInput = z.input<typeof SessionReviewSchema>;

export function objectiveWasMet(outcome: ObjectiveOutcome): boolean {
  return !UNMET_OUTCOMES.has(outcome);
}

/** The success criteria the coach did *not* tick — what a "Revisit" action carries forward. */
export function unmetCriteria(
  criteria: readonly string[],
  review: Pick<SessionReview, 'metCriteria'>,
): string[] {
  const met = new Set(review.metCriteria);
  return criteria.filter((_, index) => !met.has(index));
}
