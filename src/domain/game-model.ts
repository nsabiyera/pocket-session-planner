import { z } from 'zod';
import { GameModelIdSchema, PrincipleIdSchema, SquadIdSchema } from './ids';
import { nonEmptyText, optionalText, RecordMetaSchema } from './primitives';

/**
 * The game model — a squad's intended way of playing, decomposed into principles.
 *
 * The spine of tactical periodization (ADR 0007). Everything trained refers back to it, and
 * "specificity" — the method's supra-principle — means nothing without one to be specific *to*.
 *
 * **The app ships no principles.** Two of the canonical sources publish the framework and
 * withhold the operational detail: the morphocycle's day mapping and the enumeration of
 * principles both sit behind the Tactical Periodisation school. That turned out not to matter,
 * because the principles *are* the coach's game model — a shipped list would be somebody else's
 * idea of how this team plays. The app supplies the structure, the levels, and the one rule the
 * sources do describe.
 *
 * That rule is the tree. The University of Denver series puts it as a fractal: *"the meso and
 * the micro references only exist as such when they are in articulation with the macro
 * references"* — a micro-principle detached from its macro is a leaf off a tree. It still looks
 * like a leaf, and it is no longer alive. `refineGameModel` enforces exactly that, which makes
 * an incoherent hierarchy a rejected write rather than a season of drifting notes.
 */

/**
 * The four moments, in the order the game cycles through them.
 *
 * Not alphabetical and not the order the literature lists them in — a coach reads this as a
 * loop: we have it, we lose it, we defend, we win it back.
 */
export const MOMENTS = [
  'offensive_organisation',
  'transition_to_defence',
  'defensive_organisation',
  'transition_to_attack',
] as const;

export const MomentSchema = z.enum(MOMENTS);
export type Moment = z.infer<typeof MomentSchema>;

export const MOMENT_LABELS: Record<Moment, string> = {
  offensive_organisation: 'In possession',
  transition_to_defence: 'When we lose it',
  defensive_organisation: 'Out of possession',
  transition_to_attack: 'When we win it',
};

/**
 * The formal names, for a coach who works in the methodology's own vocabulary.
 *
 * Both sets ship because the audience spans a semi-pro coach who says "when we lose it" and one
 * who says "defensive transition", and neither should have to translate.
 */
export const MOMENT_FORMAL_LABELS: Record<Moment, string> = {
  offensive_organisation: 'Offensive organisation',
  transition_to_defence: 'Defensive transition',
  defensive_organisation: 'Defensive organisation',
  transition_to_attack: 'Offensive transition',
};

/**
 * The levels, coarsest first.
 *
 * **The naming varies across sources** — macro / meso / micro (/ sub) in one presentation,
 * principles / sub-principles / sub-sub-principles in another. The app picks one spelling and
 * says so rather than implying a standard exists. What is *not* in dispute is that the levels
 * nest, and the nesting is what `refineGameModel` polices.
 */
export const PRINCIPLE_LEVELS = ['macro', 'meso', 'micro', 'sub'] as const;

export const PrincipleLevelSchema = z.enum(PRINCIPLE_LEVELS);
export type PrincipleLevel = z.infer<typeof PrincipleLevelSchema>;

export const PRINCIPLE_LEVEL_LABELS: Record<PrincipleLevel, string> = {
  macro: 'How we play',
  meso: 'How we do that',
  micro: 'The detail',
  sub: 'The cue',
};

/** Depth of each level, so "one level up" is arithmetic rather than a lookup table. */
const LEVEL_DEPTH: Record<PrincipleLevel, number> = { macro: 0, meso: 1, micro: 2, sub: 3 };

export function levelDepth(level: PrincipleLevel): number {
  return LEVEL_DEPTH[level];
}

/** The level a principle at this level must hang from, or null for a macro. */
export function parentLevelOf(level: PrincipleLevel): PrincipleLevel | null {
  const depth = LEVEL_DEPTH[level];
  return depth === 0 ? null : (PRINCIPLE_LEVELS[depth - 1] ?? null);
}

export const PrincipleSchema = z.object({
  id: PrincipleIdSchema,
  moment: MomentSchema,
  level: PrincipleLevelSchema,
  /** Null only for a macro. Everything below hangs off exactly one level up. */
  parentId: PrincipleIdSchema.nullable().default(null),
  text: nonEmptyText(160),
});
export type Principle = z.infer<typeof PrincipleSchema>;
export type PrincipleInput = z.input<typeof PrincipleSchema>;

/**
 * A cap, chosen to be generous rather than tight.
 *
 * A professional coach's full model across four moments and four levels genuinely runs to
 * dozens of lines. The number exists so a corrupt import cannot put an unbounded array into a
 * document, not to tell a coach their model is too detailed.
 */
export const MAX_PRINCIPLES = 200;

const GameModelShape = {
  id: GameModelIdSchema,
  squadId: SquadIdSchema,
  /**
   * How this team plays, in one line. The thing a coach would say to a new signing.
   *
   * Required, and deliberately the only required field: a game model with an identity and no
   * principles yet is a real, useful state — it is where every coach starts.
   */
  identity: nonEmptyText(200),
  principles: z.array(PrincipleSchema).max(MAX_PRINCIPLES).default([]),
  /** The part no schema should structure. Opponent-agnostic notes on the model itself. */
  notes: optionalText(1000).default(''),
};

/**
 * The tree rule, and the two other things that would corrupt quietly.
 *
 * This is the one piece of the methodology the app can genuinely enforce rather than merely
 * record, so it is worth the strictness.
 */
export function refineGameModel(
  model: z.infer<z.ZodObject<typeof GameModelShape>>,
  ctx: z.RefinementCtx,
): void {
  const byId = new Map(model.principles.map((principle) => [principle.id, principle]));

  if (byId.size !== model.principles.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['principles'],
      message: 'Principle ids must be unique.',
    });
  }

  model.principles.forEach((principle, index) => {
    const expectedParent = parentLevelOf(principle.level);

    if (expectedParent === null) {
      // A macro principle *is* the trunk. Hanging it off something else would invert the tree.
      if (principle.parentId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['principles', index, 'parentId'],
          message: 'A macro principle cannot hang off another principle.',
        });
      }
      return;
    }

    if (principle.parentId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['principles', index, 'parentId'],
        message: `A ${principle.level} principle needs a ${expectedParent} principle above it.`,
      });
      return;
    }

    const parent = byId.get(principle.parentId);
    if (!parent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['principles', index, 'parentId'],
        message: 'Its parent principle is missing.',
      });
      return;
    }

    if (parent.level !== expectedParent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['principles', index, 'parentId'],
        message: `A ${principle.level} principle must hang off a ${expectedParent}, not a ${parent.level}.`,
      });
    }

    // A principle in a different moment from its parent is the incoherence the fractal
    // analogy warns about: the detail no longer describes the thing above it.
    if (parent.moment !== principle.moment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['principles', index, 'moment'],
        message: 'A principle must sit in the same moment as its parent.',
      });
    }
  });
}

export const GameModelSchema = RecordMetaSchema.extend(GameModelShape).superRefine(refineGameModel);
export type GameModel = z.infer<typeof GameModelSchema>;
export type GameModelInput = z.input<typeof GameModelSchema>;

/** Every principle for one moment, coarsest level first, in insertion order within a level. */
export function principlesForMoment(model: GameModel, moment: Moment): Principle[] {
  return model.principles
    .filter((principle) => principle.moment === moment)
    .sort((a, b) => levelDepth(a.level) - levelDepth(b.level));
}

/** The principles hanging directly off one, in insertion order. */
export function childrenOf(model: GameModel, parentId: Principle['id']): Principle[] {
  return model.principles.filter((principle) => principle.parentId === parentId);
}

/** The macro principles of a moment — the trunks a coach reads first. */
export function macroPrinciples(model: GameModel, moment: Moment): Principle[] {
  return model.principles.filter(
    (principle) => principle.moment === moment && principle.level === 'macro',
  );
}

/**
 * The moments with nothing said about them.
 *
 * The most useful thing the app can tell a coach about their own model, and the reason to hold
 * it as data at all: a model that says a great deal about being in possession and nothing about
 * losing the ball is a model with a hole in it, and that is invisible in a document.
 */
export function momentsWithoutPrinciples(model: GameModel): Moment[] {
  return MOMENTS.filter(
    (moment) => !model.principles.some((principle) => principle.moment === moment),
  );
}

/**
 * `Nine principles across three moments. Nothing yet on when we lose it.`
 *
 * Describes and does not prescribe, in the voice the practice-mix and minutes reports use. It
 * counts and it names the gap; it does not tell a coach how many principles they ought to have,
 * because no source says and inventing a number would be the app pretending to know.
 */
export function describeGameModel(model: GameModel): string {
  const total = model.principles.length;
  if (total === 0) return 'No principles yet. Start with one line per moment.';

  const covered = MOMENTS.length - momentsWithoutPrinciples(model).length;
  const counted = `${total} principle${total === 1 ? '' : 's'} across ${covered} moment${covered === 1 ? '' : 's'}.`;

  const missing = momentsWithoutPrinciples(model);
  if (missing.length === 0) return `${counted} All four moments covered.`;

  const named = missing.map((moment) => MOMENT_LABELS[moment].toLowerCase());
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}`;
  return `${counted} Nothing yet on ${list}.`;
}
