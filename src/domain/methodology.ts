import { z } from 'zod';
import { MethodologyIdSchema, PhaseTemplateIdSchema } from './ids';
import { InterventionPlanSchema } from './intervention';
import {
  MAX_ADJUSTMENT_TEXT,
  MAX_ADJUSTMENTS_PER_PHASE,
  MAX_CONSTRAINTS_PER_PHASE,
  PhaseConstraintSchema,
  PhaseTargetsSchema,
  PracticeSpectrumSchema,
} from './practice';
import {
  DurationMinSchema,
  IsoDateTimeSchema,
  nonEmptyText,
  optionalText,
  RecordMetaSchema,
  type IsoDateTime,
} from './primitives';

/**
 * The kinds of thing that happen in a session. Deliberately a closed list plus `custom`:
 * carry-forward needs `preferredPhaseKind` to mean something, and Do mode picks its default
 * observation tags off it.
 */
export const PhaseKindSchema = z.enum([
  'arrival',
  'warm_up',
  'technical',
  'skill_practice',
  'phase_of_play',
  'small_sided_game',
  'conditioned_game',
  'game',
  'huddle',
  'player_review',
  'water_break',
  'custom',
]);
export type PhaseKind = z.infer<typeof PhaseKindSchema>;

/** Phase kinds that are never "the main practice" when carry-forward has to pick one. */
export const PERIPHERAL_PHASE_KINDS: ReadonlySet<PhaseKind> = new Set<PhaseKind>([
  'arrival',
  'warm_up',
  'huddle',
  'player_review',
  'water_break',
]);

/**
 * How much the coach talks, in the abstract. Distinct from `InterventionPlan`, which is the
 * concrete, per-session, per-phase configuration. This is a one-word characterisation used
 * for sorting and for the methodology picker's subtitle.
 */
export const CoachStanceSchema = z.enum(['hands_off', 'guided', 'directive']);
export type CoachStance = z.infer<typeof CoachStanceSchema>;

export const MethodologyPhaseTemplateSchema = z.object({
  id: PhaseTemplateIdSchema,
  order: z.number().int().min(0),
  kind: PhaseKindSchema,
  title: nonEmptyText(60),
  /**
   * Fraction of the session this phase should take. Weights across a methodology sum to 1
   * (±0.001), which is what lets `scalePhaseDurations` retarget any total length.
   * A weight of exactly 0 means "fixed length, excluded from the scaled pool" — water breaks.
   */
  durationWeight: z.number().min(0).max(1),
  /** Used when `durationWeight` is 0. Ignored otherwise. */
  defaultDurationMin: DurationMinSchema.default(5),
  intent: nonEmptyText(300),
  /** Shown in Do mode as the coach's own reminder of what this phase is for. */
  coachPrompts: z.array(nonEmptyText(200)).max(6).default([]),
  defaultCoachingPoints: z.array(nonEmptyText(160)).max(8).default([]),
  /** Overrides the methodology's session-level plan for this phase. Null = inherit. */
  defaultIntervention: InterventionPlanSchema.nullable().default(null),
  /**
   * Seeds `SessionPhase.spectrum`, so the practice spectrum costs zero taps on the default
   * path. **Null means this template is not a practice** — a huddle, a water break, a
   * debrief — rather than "a practice we have no opinion about".
   *
   * Per template rather than a global `PhaseKind` map on purpose. `technical → unopposed`
   * and `game → matched_up` are obvious, but `skill_practice` and `phase_of_play` are not:
   * Play-Practice-Play's PRACTICE is an overload, Whole-Part-Whole's PART is unopposed with
   * interference, and only the methodology that wrote them knows which.
   */
  defaultSpectrum: PracticeSpectrumSchema.nullable().default(null),
  /**
   * Seeds `SessionPhase.targets`, so direction costs zero taps on the default path too.
   *
   * **Null here is weaker than `defaultSpectrum`'s null**, and the difference matters. There,
   * null means *this template is not a practice*. Here it means only *this methodology has no
   * opinion*: Play-Practice-Play's PRACTICE is an overload, and whether the coach runs it to
   * a goal or as a rondo is genuinely theirs to decide, so the preset says nothing rather
   * than guessing on their behalf.
   *
   * Seeded only where the methodology actually dictates it — the games it insists are games,
   * and the unopposed blocks where there is nothing to play towards by construction.
   */
  defaultTargets: PhaseTargetsSchema.nullable().default(null),
  /**
   * Ways to make this practice harder or easier, seeding `SessionPhase.progressions` and
   * `.regressions`.
   *
   * The prose was **already written** — it just lived where nothing could act on it. *"Add
   * pressure once it is clean"* was a coaching point, *"Progress it as soon as it looks
   * easy"* was a coach prompt, *"passive, then live"* was buried in an `intent` string. This
   * moves it somewhere Do mode can put it under the coach's thumb at 7:40 on a wet Tuesday.
   *
   * **Empty is a statement, not an omission.** Whole-Part-Whole's two WHOLE games and the
   * Constraints-Led free game ship with none on purpose: changing those destroys the very
   * comparison the methodology exists to make. `presets.test.ts` pins that.
   */
  defaultProgressions: z
    .array(nonEmptyText(MAX_ADJUSTMENT_TEXT))
    .max(MAX_ADJUSTMENTS_PER_PHASE)
    .default([]),
  defaultRegressions: z
    .array(nonEmptyText(MAX_ADJUSTMENT_TEXT))
    .max(MAX_ADJUSTMENTS_PER_PHASE)
    .default([]),
  /**
   * The STEP conditions this practice starts with.
   *
   * Constraints-Led is the reason this exists: its restrict / reward-and-relate phases put
   * their whole method in a *title* — "Constrained game A — restrict" — and left the actual
   * condition for the coach to remember. Now the condition is data, and Review can say which
   * letter it was.
   */
  defaultConstraints: z.array(PhaseConstraintSchema).max(MAX_CONSTRAINTS_PER_PHASE).default([]),
  /**
   * Whether this phase is one where the players decide something.
   *
   * Guided Discovery is the reason this can be preset at all: *"Run the practice again with
   * the change they chose - even if you would have chosen a different one"* is a phase whose
   * entire method is the players' decision. Most phases are not, and default to `false`.
   */
  defaultPlayerChoice: z.boolean().default(false),
  /**
   * **The earlier phase this one has to match** (ADR 0011 §3).
   *
   * Whole-Part-Whole's whole method is in its two WHOLE games being *the same game*: its own
   * coach prompt says *"Phase 4 must be the SAME game as phase 2, or you cannot claim
   * transfer"*, and until now nothing enforced, compared or even recorded that. This is the
   * claim, as data.
   *
   * **It points backwards, at a template with a lower `order`.** That is not a style rule —
   * it is what makes a cycle unrepresentable rather than merely invalid, so the comparison
   * can never loop. The later game references the earlier one, which is also the direction a
   * coach reads it in.
   *
   * **On the template rather than the session**, because it is methodology knowledge: the
   * methodology that wrote the two phases is the only thing that knows they are a pair.
   * `cloneMethodology` remaps it, and {@link refineTemplates} rejects a reference that does
   * not resolve. What lands on the session is a `PhaseId`, resolved at build time — see
   * `SessionPhase.pairedWithPhaseId` for why it cannot be looked up later.
   */
  pairsWith: PhaseTemplateIdSchema.nullable().default(null),
  isOptional: z.boolean().default(false),
});
export type MethodologyPhaseTemplate = z.infer<typeof MethodologyPhaseTemplateSchema>;
export type MethodologyPhaseTemplateInput = z.input<typeof MethodologyPhaseTemplateSchema>;

export const MethodologyOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin') }),
  z.object({
    kind: z.literal('custom'),
    /** Custom methodologies **clone, never inherit** — see the module docstring. */
    clonedFrom: MethodologyIdSchema.nullable().default(null),
    clonedFromVersion: z.number().int().min(1).nullable().default(null),
  }),
]);
export type MethodologyOrigin = z.infer<typeof MethodologyOriginSchema>;

const MethodologyShape = {
  id: MethodologyIdSchema,
  origin: MethodologyOriginSchema,
  name: nonEmptyText(60),
  summary: nonEmptyText(200),
  coachStance: CoachStanceSchema,
  /** Bumped when a preset is improved in a later release. Snapshots record what they saw. */
  version: z.number().int().min(1),
  /** The length the weights were authored against — 60 minutes for every built-in. */
  referenceDurationMin: DurationMinSchema,
  /** The session-level default. Each phase template may override it. */
  defaultIntervention: InterventionPlanSchema,
  /** One line the coach sees while planning. Shaped as an instruction, not a description. */
  coachPrompt: optionalText(200).optional(),
  phaseTemplates: z.array(MethodologyPhaseTemplateSchema).min(1).max(12),
};

/**
 * Cross-template invariants. Enforced here rather than at the call site so a hand-edited
 * import file and a coach-built custom methodology are held to the same rules.
 */
function refineTemplates(
  templates: readonly MethodologyPhaseTemplate[],
  ctx: z.RefinementCtx,
): void {
  const orders = templates.map((t) => t.order);
  if (new Set(orders).size !== orders.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phaseTemplates'],
      message: 'Phase template `order` values must be unique.',
    });
  }

  const ids = templates.map((t) => t.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phaseTemplates'],
      message: 'Phase template ids must be unique.',
    });
  }

  /*
    The pairing has to resolve, point backwards, and not point at itself. Enforced here rather
    than at the call site so a hand-edited import file and a coach-built custom methodology are
    held to the same rule — and because a dangling pair would silently produce no comparison at
    all, which looks exactly like a methodology that never asked for one.
  */
  const byId = new Map(templates.map((template) => [template.id, template]));
  templates.forEach((template, index) => {
    if (template.pairsWith === null) return;

    const issue = (message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phaseTemplates', index, 'pairsWith'],
        message,
      });

    if (template.pairsWith === template.id) {
      issue('A phase cannot be paired with itself.');
      return;
    }

    const target = byId.get(template.pairsWith);
    if (!target) {
      issue('Its paired phase is missing.');
      return;
    }

    // Backwards only, which is what rules out a cycle.
    if (target.order >= template.order) {
      issue('A paired phase must come earlier in the session.');
    }
  });

  const sum = templates.reduce((total, t) => total + t.durationWeight, 0);
  if (Math.abs(sum - 1) > 0.001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phaseTemplates'],
      message: `Phase duration weights must sum to 1 (±0.001); got ${sum.toFixed(4)}.`,
    });
  }
}

export const MethodologySchema = RecordMetaSchema.extend(MethodologyShape).superRefine(
  (methodology, ctx) => refineTemplates(methodology.phaseTemplates, ctx),
);
export type Methodology = z.infer<typeof MethodologySchema>;
export type MethodologyInput = z.input<typeof MethodologySchema>;

/**
 * Built-in presets are **code-resident, not seeded**, so they carry no `RecordMeta`. They
 * live in `src/domain/presets/` and are merged into `MethodologyRepository.list()` at read
 * time. Seeding would write a copy that immediately drifts from the app, turning every
 * preset improvement into a migration that has to guess whether the coach edited the row.
 */
export const MethodologyPresetSchema = z
  .object(MethodologyShape)
  .superRefine((methodology, ctx) => refineTemplates(methodology.phaseTemplates, ctx));
export type MethodologyPreset = z.infer<typeof MethodologyPresetSchema>;

/**
 * The frozen copy embedded in every session.
 *
 * This is the reason a coach's history is safe: editing a methodology, deleting it, or
 * shipping an improved preset in a later release can never rewrite what a session said it
 * was doing at the time.
 */
export const MethodologySnapshotSchema = z.object({
  methodologyId: MethodologyIdSchema,
  name: nonEmptyText(60),
  coachStance: CoachStanceSchema,
  version: z.number().int().min(1),
  originKind: z.enum(['builtin', 'custom']),
  referenceDurationMin: DurationMinSchema,
  coachPrompt: optionalText(200).optional(),
  capturedAt: IsoDateTimeSchema,
});
export type MethodologySnapshot = z.infer<typeof MethodologySnapshotSchema>;

export function snapshotMethodology(
  methodology: Methodology | MethodologyPreset,
  capturedAt: IsoDateTime,
): MethodologySnapshot {
  return {
    methodologyId: methodology.id,
    name: methodology.name,
    coachStance: methodology.coachStance,
    version: methodology.version,
    originKind: methodology.origin.kind,
    referenceDurationMin: methodology.referenceDurationMin,
    ...(methodology.coachPrompt !== undefined ? { coachPrompt: methodology.coachPrompt } : {}),
    capturedAt,
  };
}

/** Templates in the order a session runs them. */
export function orderedTemplates(
  methodology: Methodology | MethodologyPreset,
): MethodologyPhaseTemplate[] {
  return [...methodology.phaseTemplates].sort((a, b) => a.order - b.order);
}

const STANCE_LABELS: Record<CoachStance, string> = {
  hands_off: 'Hands off',
  guided: 'Guided',
  directive: 'Directive',
};
export const coachStanceLabel = (stance: CoachStance): string => STANCE_LABELS[stance];

const PHASE_KIND_LABELS: Record<PhaseKind, string> = {
  arrival: 'Arrival',
  warm_up: 'Warm-up',
  technical: 'Technical',
  skill_practice: 'Skill practice',
  phase_of_play: 'Phase of play',
  small_sided_game: 'Small-sided game',
  conditioned_game: 'Conditioned game',
  game: 'Game',
  huddle: 'Huddle',
  player_review: 'Player review',
  water_break: 'Water break',
  custom: 'Custom',
};
export const phaseKindLabel = (kind: PhaseKind): string => PHASE_KIND_LABELS[kind];
