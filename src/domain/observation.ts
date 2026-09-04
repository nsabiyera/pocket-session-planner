import { z } from 'zod';
import {
  CoachingPointIdSchema,
  ObservationIdSchema,
  PhaseIdSchema,
  PlayerIdSchema,
  SessionIdSchema,
  SquadIdSchema,
} from './ids';
import { ActionMomentSchema } from './capabilities';
import { CornerAttributeIdSchema, FourCornerSchema } from './four-corners';
import { IsoDateTimeSchema, optionalText, RatingSchema, RecordMetaSchema } from './primitives';

/**
 * Observations are **their own aggregate**, not embedded in the session.
 *
 * Two reasons, both practical. During Do, the coach logs with cold thumbs while the timer is
 * already writing the session document every few seconds; appending a small independent
 * record avoids read-modify-write races on a multi-KB document. And "everything about Kai
 * this term" becomes a single `by-player-at` index scan rather than a full walk of the
 * sessions store.
 *
 * (Intervention events go the other way — inside the session — because they are low-volume,
 * written by the same timer-owning code path, and never queried across sessions.)
 */

/** The three 72px buttons on the observation sheet, in order. */
export const ObservationRatingKindSchema = z.enum(['good', 'working', 'struggled']);
export type ObservationRatingKind = z.infer<typeof ObservationRatingKindSchema>;

export const ObservationKindSchema = z.enum([
  'strength', // did the thing well
  'development', // the thing to work on
  'effort', // attitude, not ability
  'note', // neutral
]);
export type ObservationKind = z.infer<typeof ObservationKindSchema>;

/** The 1-5 numeric equivalent, so `rating <= 2` triggers work in carry-forward. */
export const OBSERVATION_RATING_VALUE: Record<ObservationRatingKind, number> = {
  struggled: 2,
  working: 3,
  good: 5,
};

export const OBSERVATION_RATING_KIND: Record<ObservationRatingKind, ObservationKind> = {
  struggled: 'development',
  working: 'development',
  good: 'strength',
};

export const ObservationSchema = RecordMetaSchema.extend({
  id: ObservationIdSchema,
  sessionId: SessionIdSchema,
  /** Denormalised so "everything about this squad this term" is one index range. */
  squadId: SquadIdSchema,
  /**
   * **Optional-omitted, never nullable.** `by-player-at` is an index on this field, and
   * IndexedDB skips records whose index key path resolves to `undefined` — which means
   * team-wide observations are correctly excluded from a player's timeline for free.
   * That is the desired semantics, and it is why this is `.optional()`. See ADR 0001.
   */
  playerId: PlayerIdSchema.optional(),
  /** Indexed; always present because an observation is always logged inside a phase. */
  phaseId: PhaseIdSchema,
  at: IsoDateTimeSchema,
  /** Elapsed time within the phase, so Review can say *when* in the practice it happened. */
  phaseElapsedMs: z.number().int().min(0).default(0),
  kind: ObservationKindSchema,
  ratingKind: ObservationRatingKindSchema.nullable().default(null),
  rating: RatingSchema.nullable().default(null),
  /** Chips drawn from this phase's coaching points plus a generic bank. */
  tags: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  text: optionalText(500).default(''),
  /** Set when the observation was logged against a specific coaching point. */
  coachingPointId: CoachingPointIdSchema.nullable().default(null),
  /**
   * The FA 4 Corner Model corner this observation belongs to.
   *
   * **Optional-omitted, never nullable**, because `by-player-corner` indexes it — and an
   * unclassified observation genuinely should not appear in "everything social about Kai".
   * See ADR 0001.
   *
   * Usually inferred from the tag the coach tapped rather than asked for, which is what
   * keeps logging at two taps. See `cornerOfObservation`.
   */
  corner: FourCornerSchema.optional(),
  /** The specific attribute within that corner, when one was chosen. */
  attribute: CornerAttributeIdSchema.optional(),
  /**
   * **When** in the action this was seen: before the ball arrives, as it arrives, or after
   * it has gone. The FA's window — *"what each player does before, during and after they
   * receive the ball"*.
   *
   * **Optional-omitted, and genuinely optional.** Unlike the corner, this cannot be inferred
   * from anything: only the coach knows which part of the action they were watching. So it is
   * offered as a pre-selection on the observation sheet and never required — logging stays at
   * two taps, and an observation with no moment is a normal observation, not an incomplete
   * one.
   */
  actionMoment: ActionMomentSchema.optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;
export type ObservationInput = z.input<typeof ObservationSchema>;

export function isTeamObservation(observation: Observation): boolean {
  return observation.playerId === undefined;
}

/** Effective 1-5 value: an explicit rating wins, else the tapped token's equivalent. */
export function observationValue(observation: Observation): number | null {
  if (observation.rating !== null) return observation.rating;
  if (observation.ratingKind !== null) return OBSERVATION_RATING_VALUE[observation.ratingKind];
  return null;
}
