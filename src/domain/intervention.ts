import { z } from 'zod';
import {
  CoachingPointIdSchema,
  InterventionEventIdSchema,
  PhaseIdSchema,
  PlayerIdSchema,
} from './ids';
import { IsoDateTimeSchema, optionalText } from './primitives';

/**
 * Methodology decides what the *session* looks like. Intervention decides what the *coach*
 * does while it runs. They are related but orthogonal — you can run Whole-Part-Whole while
 * barely speaking, or Play-Practice-Play while stopping play every two minutes. Modelling
 * them separately is the only reason the second one is configurable at all.
 *
 * Three independent axes, grounded in the FA's Five Pillars plus the intervention mechanics
 * coaches actually use.
 */

/** WHAT the coach does — the FA Five Pillars. */
export const InterventionMethodSchema = z.enum([
  'command', // tell them, demonstrate, rehearse
  'question_and_answer', // "what's stopping you?", "how many touches to turn?"
  'observation_feedback', // watch, then feed back at a natural break
  'guided_discovery', // set the problem, let them find the answer
  'trial_and_error', // say nothing, let the game teach
]);
export type InterventionMethod = z.infer<typeof InterventionMethodSchema>;

/** HOW play is interrupted — the mechanic. */
export const InterventionMechanicSchema = z.enum([
  'in_flow', // coach on the run, play never stops. The default to aim for.
  'play_freeze_play', // freeze the picture, 5 seconds, restart. Use sparingly.
  'play_stop_play', // stop everyone, reset, restart
  'stop_some_play_on', // pull a few aside; the rest keep playing
  'individual_aside', // one player to the side, game continues
  'natural_break', // water breaks and goal kicks only
  'constraint_change', // change the practice, say nothing (the CLA's real intervention)
  'none', // observe only. Silence is a legitimate plan.
]);
export type InterventionMechanic = z.infer<typeof InterventionMechanicSchema>;

/** WHO it lands on. */
export const InterventionAudienceSchema = z.enum(['individual', 'unit', 'team']);
export type InterventionAudience = z.infer<typeof InterventionAudienceSchema>;

/**
 * Mechanics that genuinely halt play. Logging one of these **pauses the phase clock**, so
 * `stoppageMs` and therefore ball-rolling time are measured rather than estimated.
 *
 * `in_flow` and `constraint_change` do not appear here: the ball is still moving, so they
 * are logged as instantaneous events.
 */
const PLAY_STOPPING_MECHANICS: ReadonlySet<InterventionMechanic> = new Set([
  'play_freeze_play',
  'play_stop_play',
  'stop_some_play_on',
  'natural_break',
]);

export function mechanicStopsPlay(mechanic: InterventionMechanic): boolean {
  return PLAY_STOPPING_MECHANICS.has(mechanic);
}

export const InterventionPlanSchema = z.object({
  method: InterventionMethodSchema,
  mechanic: InterventionMechanicSchema,
  audience: InterventionAudienceSchema.default('team'),
  /**
   * The over-coaching guardrail. `null` = no budget set. Over-coaching is the classic
   * grassroots failing, so the app makes the intent explicit and then measures it.
   */
  maxPerPhase: z.number().int().min(0).max(20).nullable().default(null),
  maxDurationSec: z.number().int().min(5).max(300).nullable().default(null),
  notes: optionalText(300).optional(),
});
export type InterventionPlan = z.infer<typeof InterventionPlanSchema>;
export type InterventionPlanInput = z.input<typeof InterventionPlanSchema>;

export const InterventionEventSchema = z.object({
  id: InterventionEventIdSchema,
  phaseId: PhaseIdSchema,
  at: IsoDateTimeSchema,
  phaseElapsedMs: z.number().int().min(0),
  method: InterventionMethodSchema,
  mechanic: InterventionMechanicSchema,
  audience: InterventionAudienceSchema,
  /**
   * How long play was stopped. `null` while the intervention is still open — the Do-mode
   * bar is counting — or for a mechanic that never stops play.
   */
  durationMs: z.number().int().min(0).nullable().default(null),
  playerIds: z.array(PlayerIdSchema).max(30).default([]),
  coachingPointId: CoachingPointIdSchema.nullable().default(null),
  note: optionalText(500).optional(),
  /** True when it exceeded the plan's budget — the honest self-audit. */
  overBudget: z.boolean().default(false),
});
export type InterventionEvent = z.infer<typeof InterventionEventSchema>;
export type InterventionEventInput = z.input<typeof InterventionEventSchema>;

/**
 * The structural minimum `resolvePhaseIntervention` needs. Declared here rather than
 * importing `Session` and `SessionPhase` so this module stays a leaf — everything
 * downstream references it, and a cycle through `session.ts` would be tiresome.
 */
export interface HasInterventionPlan {
  readonly intervention: InterventionPlan;
}
export interface HasInterventionOverride {
  readonly intervention: InterventionPlan | null;
}

/**
 * The single accessor for "how am I coaching this phase". Nothing reads the raw fields.
 *
 * A phase override is how a coach says *"question them in the practice, then say nothing at
 * all in the final game"*.
 */
export function resolvePhaseIntervention(
  session: HasInterventionPlan,
  phase: HasInterventionOverride,
): InterventionPlan {
  return phase.intervention ?? session.intervention;
}

/** Whether a phase carries its own plan rather than inheriting the session's. */
export function hasPhaseOverride(phase: HasInterventionOverride): boolean {
  return phase.intervention !== null;
}

/**
 * Budget state for the phase currently running. `remaining` is `null` when no budget is
 * set — which renders as no counter at all, rather than as an unlimited one.
 */
export interface InterventionBudget {
  readonly max: number | null;
  readonly used: number;
  readonly remaining: number | null;
  readonly isOverBudget: boolean;
  /** `maxPerPhase: 0` is the "let them play" case and reads differently in the UI. */
  readonly isSilentPhase: boolean;
}

export function interventionBudget(plan: InterventionPlan, used: number): InterventionBudget {
  const max = plan.maxPerPhase;
  if (max === null) {
    return { max: null, used, remaining: null, isOverBudget: false, isSilentPhase: false };
  }
  return {
    max,
    used,
    remaining: Math.max(0, max - used),
    isOverBudget: used > max,
    isSilentPhase: max === 0,
  };
}

/**
 * Would logging one more intervention put this phase over budget? Called *before* the
 * event is written, to stamp `overBudget` on it.
 *
 * Note this never blocks. A coach who genuinely needs a third stop should take it; the
 * app's job is to make the choice visible and then report it honestly in Review.
 */
export function wouldExceedBudget(plan: InterventionPlan, usedBefore: number): boolean {
  return plan.maxPerPhase !== null && usedBefore + 1 > plan.maxPerPhase;
}

const METHOD_LABELS: Record<InterventionMethod, string> = {
  command: 'Command',
  question_and_answer: 'Q&A',
  observation_feedback: 'Observe & feed back',
  guided_discovery: 'Guided discovery',
  trial_and_error: 'Trial & error',
};

const MECHANIC_LABELS: Record<InterventionMechanic, string> = {
  in_flow: 'In the flow',
  play_freeze_play: 'Play–freeze–play',
  play_stop_play: 'Play–stop–play',
  stop_some_play_on: 'Stop some, play on',
  individual_aside: 'Individual aside',
  natural_break: 'Natural breaks',
  constraint_change: 'Change the constraint',
  none: 'Say nothing',
};

const AUDIENCE_LABELS: Record<InterventionAudience, string> = {
  individual: 'Individual',
  unit: 'Unit',
  team: 'Team',
};

export const interventionMethodLabel = (m: InterventionMethod): string => METHOD_LABELS[m];
export const interventionMechanicLabel = (m: InterventionMechanic): string => MECHANIC_LABELS[m];
export const interventionAudienceLabel = (a: InterventionAudience): string => AUDIENCE_LABELS[a];

/**
 * The one-line summary shown under the methodology control on `/plan` and, more importantly,
 * pinned under the phase name in Do mode — because the whole point of planning an
 * intervention is being reminded of it at the moment you are about to break it.
 */
export function describeInterventionPlan(plan: InterventionPlan): string {
  const parts = [MECHANIC_LABELS[plan.mechanic], METHOD_LABELS[plan.method]];
  if (plan.audience !== 'team') parts.push(AUDIENCE_LABELS[plan.audience].toLowerCase());
  if (plan.maxPerPhase === 0) parts.push('let them play');
  else if (plan.maxPerPhase !== null) parts.push(`max ${plan.maxPerPhase} per phase`);
  return parts.join(' · ');
}
