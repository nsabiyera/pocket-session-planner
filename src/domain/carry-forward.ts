import { z } from 'zod';
import { CarryForwardActionIdSchema, PlayerIdSchema, SessionIdSchema, SquadIdSchema } from './ids';
import { InterventionPlanSchema } from './intervention';
import { PhaseKindSchema } from './methodology';
import { SessionPhaseSchema } from './session';
import {
  IsoDateTimeSchema,
  nonEmptyText,
  optionalText,
  PrioritySchema,
  RecordMetaSchema,
} from './primitives';

/**
 * The seed material for the next session. This is the part that makes the app a coaching
 * system rather than a notes app: a review produces actions, and those actions pre-fill the
 * objective, the focus players and the coaching points of session two.
 */
export const CarryForwardKindSchema = z.enum([
  'objective',
  'focus_player',
  'coaching_point',
  'phase',
  'intervention',
  'reminder',
]);
export type CarryForwardKind = z.infer<typeof CarryForwardKindSchema>;

export const CarryForwardStatusSchema = z.enum(['open', 'planned', 'done', 'dropped']);
export type CarryForwardStatus = z.infer<typeof CarryForwardStatusSchema>;

/**
 * The payload is a discriminated union on the same `kind` as the action itself. A
 * `superRefine` pins the two together, because a `focus_player` action carrying an
 * `objective` payload would apply as neither.
 */
export const CarryForwardPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('objective'),
    text: nonEmptyText(140),
    /** Carries only the **unmet** criteria forward. */
    successCriteria: z.array(nonEmptyText(120)).max(5).default([]),
    /** `progress` prefills "add pressure / reduce time"; `revisit` restates it verbatim. */
    intent: z.enum(['revisit', 'progress']).default('revisit'),
  }),
  z.object({
    kind: z.literal('focus_player'),
    playerId: PlayerIdSchema,
    targetBehaviour: nonEmptyText(160),
  }),
  z.object({
    kind: z.literal('coaching_point'),
    text: nonEmptyText(160),
    playerIds: z.array(PlayerIdSchema).max(30).default([]),
    /** Where this point belongs. Falls back to the main practice when absent. */
    preferredPhaseKind: PhaseKindSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('phase'),
    /** A frozen copy, coaching points reset to undelivered and ids stripped on apply. */
    phase: SessionPhaseSchema,
    originalOrder: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('intervention'),
    plan: InterventionPlanSchema,
    /** Null targets the whole session; otherwise the phase whose kind this is. */
    targetPhaseKind: PhaseKindSchema.nullable().default(null),
    rationale: optionalText(200).default(''),
  }),
  z.object({
    kind: z.literal('reminder'),
    text: nonEmptyText(160),
  }),
]);
export type CarryForwardPayload = z.infer<typeof CarryForwardPayloadSchema>;

const ActionShape = {
  id: CarryForwardActionIdSchema,
  squadId: SquadIdSchema,
  kind: CarryForwardKindSchema,
  /** Normalised for dedupe and chaining; shown verbatim as the chip label. */
  title: nonEmptyText(160),
  detail: optionalText(300).default(''),
  priority: PrioritySchema.default('normal'),
  status: CarryForwardStatusSchema.default('open'),
  payload: CarryForwardPayloadSchema,
  originSessionId: SessionIdSchema,
  /** Set when this action was applied to a draft; cleared if that draft is abandoned. */
  appliedToSessionId: SessionIdSchema.nullable().default(null),
  /**
   * Chaining. A proposal matching an open action does not duplicate it — it creates a
   * successor and marks the predecessor `done`.
   */
  supersedesActionId: CarryForwardActionIdSchema.nullable().default(null),
  /**
   * `chainDepth >= 3` renders as a flag in the planner: *"You've chased this for 3
   * sessions — change the practice, not the point."* Genuinely useful coaching feedback,
   * and it falls straight out of the model.
   */
  chainDepth: z.number().int().min(0).max(50).default(0),
  resolutionNote: optionalText(200).nullable().default(null),
  resolvedAt: IsoDateTimeSchema.nullable().default(null),
  /** Denormalised from the payload so `by-player` can be a multiEntry index. */
  playerIds: z.array(PlayerIdSchema).max(30).default([]),
};

export const CarryForwardActionSchema = RecordMetaSchema.extend(ActionShape).superRefine(
  (action, ctx) => {
    if (action.payload.kind !== action.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload', 'kind'],
        message: `Payload kind "${action.payload.kind}" does not match action kind "${action.kind}".`,
      });
    }
  },
);
export type CarryForwardAction = z.infer<typeof CarryForwardActionSchema>;
export type CarryForwardActionInput = z.input<typeof CarryForwardActionSchema>;

/** The depth at which the planner stops helping and starts warning. */
export const CHAIN_DEPTH_WARNING = 3;

export function isChainStuck(action: CarryForwardAction): boolean {
  return action.chainDepth >= CHAIN_DEPTH_WARNING;
}

export function isOpenAction(action: CarryForwardAction): boolean {
  return action.status === 'open' && action.deletedAt === undefined;
}

/**
 * A proposal is what the review screen renders as a checkbox. It becomes a
 * `CarryForwardAction` only when the coach taps Save review — a coach who feels the app is
 * inventing homework for them will stop using it.
 */
export const CarryForwardProposalSchema = z.object({
  kind: CarryForwardKindSchema,
  title: nonEmptyText(160),
  detail: optionalText(300).default(''),
  priority: PrioritySchema.default('normal'),
  payload: CarryForwardPayloadSchema,
  playerIds: z.array(PlayerIdSchema).max(30).default([]),
  /** Pre-ticked in the UI. Anything speculative arrives unticked. */
  defaultSelected: z.boolean().default(false),
  /** Which rule produced this, for tests and for the "why am I seeing this" affordance. */
  trigger: z.string().min(1).max(60),
  /** Set when this proposal chains an existing open action rather than starting fresh. */
  supersedesActionId: CarryForwardActionIdSchema.nullable().default(null),
});
export type CarryForwardProposal = z.infer<typeof CarryForwardProposalSchema>;

/** A review that generates thirty checkboxes is a review nobody completes. */
export const MAX_PROPOSALS = 8;

/** Applying more than this to one session buries the objective under admin. */
export const MAX_ACTIONS_APPLIED_PER_SESSION = 5;
