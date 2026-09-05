import { z } from 'zod';

/**
 * Ids are **branded**. There are fifteen of them in this model and most are UUIDs, so
 * structurally they are all just `string` — which means without a brand nothing stops a
 * `PhaseId` being passed where a `PlayerId` belongs. Branding costs one `.brand<>()` call
 * and a cast at the parse boundary, and buys a compile error on every such mix-up.
 */

export const SquadIdSchema = z.string().uuid().brand<'SquadId'>();
export type SquadId = z.infer<typeof SquadIdSchema>;

export const PlayerIdSchema = z.string().uuid().brand<'PlayerId'>();
export type PlayerId = z.infer<typeof PlayerIdSchema>;

/**
 * **Methodology ids are not UUIDs.**
 *
 * Built-ins use stable slugs (`constraints-led`) so a session created two years ago still
 * resolves its origin, and so a preset can be improved in a later release without an id
 * migration. Custom methodologies use UUIDs — which also match this pattern, since a
 * lowercase UUID is a valid slug. That overlap is deliberate: one id type, two conventions,
 * and `Methodology.origin` is the discriminator, not the id format.
 */
const SLUG_OR_UUID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const MethodologyIdSchema = z.string().regex(SLUG_OR_UUID).brand<'MethodologyId'>();
export type MethodologyId = z.infer<typeof MethodologyIdSchema>;

/** Same convention as `MethodologyId`: preset phase templates are slugs, cloned ones UUIDs. */
export const PhaseTemplateIdSchema = z.string().regex(SLUG_OR_UUID).brand<'PhaseTemplateId'>();
export type PhaseTemplateId = z.infer<typeof PhaseTemplateIdSchema>;

export const SessionIdSchema = z.string().uuid().brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionIdSchema>;

export const PhaseIdSchema = z.string().uuid().brand<'PhaseId'>();
export type PhaseId = z.infer<typeof PhaseIdSchema>;

export const CoachingPointIdSchema = z.string().uuid().brand<'CoachingPointId'>();
export type CoachingPointId = z.infer<typeof CoachingPointIdSchema>;

export const ObservationIdSchema = z.string().uuid().brand<'ObservationId'>();
export type ObservationId = z.infer<typeof ObservationIdSchema>;

export const InterventionEventIdSchema = z.string().uuid().brand<'InterventionEventId'>();
export type InterventionEventId = z.infer<typeof InterventionEventIdSchema>;

export const PlayerAssessmentIdSchema = z.string().uuid().brand<'PlayerAssessmentId'>();
export type PlayerAssessmentId = z.infer<typeof PlayerAssessmentIdSchema>;

/** A per-player challenge set at plan time. */
export const ChallengeIdSchema = z.string().uuid().brand<'ChallengeId'>();
export type ChallengeId = z.infer<typeof ChallengeIdSchema>;

/** One logged sighting of a challenge being met, during the run. */
export const ChallengeEventIdSchema = z.string().uuid().brand<'ChallengeEventId'>();
export type ChallengeEventId = z.infer<typeof ChallengeEventIdSchema>;

/** One recorded change to how hard a practice was, during the run. */
export const PracticeAdjustmentIdSchema = z.string().uuid().brand<'PracticeAdjustmentId'>();
export type PracticeAdjustmentId = z.infer<typeof PracticeAdjustmentIdSchema>;

/** A photographed drawing of a practice, referenced by the phase it belongs to. */
export const PhaseImageIdSchema = z.string().uuid().brand<'PhaseImageId'>();
export type PhaseImageId = z.infer<typeof PhaseImageIdSchema>;

/** One player put under the microscope on one skill, across the six core capabilities. */
export const CapabilityScanIdSchema = z.string().uuid().brand<'CapabilityScanId'>();
export type CapabilityScanId = z.infer<typeof CapabilityScanIdSchema>;

export const ReviewIdSchema = z.string().uuid().brand<'ReviewId'>();
export type ReviewId = z.infer<typeof ReviewIdSchema>;

export const CarryForwardActionIdSchema = z.string().uuid().brand<'CarryForwardActionId'>();
export type CarryForwardActionId = z.infer<typeof CarryForwardActionIdSchema>;

/**
 * Casting helpers for the one place a cast is legitimate: turning a freshly generated UUID
 * into a branded id. Everywhere else, parse.
 */
export const asSquadId = (v: string): SquadId => SquadIdSchema.parse(v);
export const asPlayerId = (v: string): PlayerId => PlayerIdSchema.parse(v);
export const asMethodologyId = (v: string): MethodologyId => MethodologyIdSchema.parse(v);
export const asPhaseTemplateId = (v: string): PhaseTemplateId => PhaseTemplateIdSchema.parse(v);
export const asSessionId = (v: string): SessionId => SessionIdSchema.parse(v);
export const asPhaseId = (v: string): PhaseId => PhaseIdSchema.parse(v);
export const asCoachingPointId = (v: string): CoachingPointId => CoachingPointIdSchema.parse(v);
export const asObservationId = (v: string): ObservationId => ObservationIdSchema.parse(v);
export const asInterventionEventId = (v: string): InterventionEventId =>
  InterventionEventIdSchema.parse(v);
export const asPlayerAssessmentId = (v: string): PlayerAssessmentId =>
  PlayerAssessmentIdSchema.parse(v);
export const asChallengeId = (v: string): ChallengeId => ChallengeIdSchema.parse(v);
export const asChallengeEventId = (v: string): ChallengeEventId => ChallengeEventIdSchema.parse(v);
export const asPracticeAdjustmentId = (v: string): PracticeAdjustmentId =>
  PracticeAdjustmentIdSchema.parse(v);
export const asPhaseImageId = (v: string): PhaseImageId => PhaseImageIdSchema.parse(v);
export const asCapabilityScanId = (v: string): CapabilityScanId => CapabilityScanIdSchema.parse(v);
export const asReviewId = (v: string): ReviewId => ReviewIdSchema.parse(v);
export const asCarryForwardActionId = (v: string): CarryForwardActionId =>
  CarryForwardActionIdSchema.parse(v);
