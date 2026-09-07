import { err, ok, type Result } from '@/lib/result';
import {
  asGameModelId,
  asPrincipleId,
  type PrincipleId,
  type SessionId,
  type SquadId,
} from '@/domain/ids';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import {
  GameModelSchema,
  parentLevelOf,
  type GameModel,
  type Moment,
  type Principle,
  type PrincipleLevel,
} from '@/domain/game-model';
import { SessionSchema, type Session } from '@/domain/session';
import { now, type ServiceContext } from '../context';

/**
 * Authoring a squad's game model.
 *
 * One model per squad, created on first write rather than up front — a coach who never opens
 * this screen has no game model, not an empty one, and `momentsWithoutPrinciples` on a model
 * that exists is a different statement from having no model at all.
 *
 * Every mutation re-parses through `GameModelSchema`, so the tree rule in `refineGameModel` is
 * enforced on the way in rather than trusted. That is the point of holding the hierarchy as
 * data: an incoherent model is a rejected write here, not a season of drifting notes.
 */

export type GameModelError =
  | { kind: 'squad_not_found' }
  | { kind: 'no_game_model' }
  | { kind: 'principle_not_found'; principleId: PrincipleId }
  | { kind: 'invalid'; message: string };

export async function getGameModel(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<GameModel | undefined> {
  return ctx.store.gameModels.findBySquad(squadId);
}

/**
 * Creates or replaces the identity line.
 *
 * The only required field, and deliberately the whole of step one: a coach with an identity and
 * no principles has a real game model, and it is where every one of them starts.
 */
export async function setIdentity(
  ctx: ServiceContext,
  squadId: SquadId,
  identity: string,
): Promise<Result<GameModel, GameModelError>> {
  const squad = await ctx.store.squads.get(squadId);
  if (!squad) return err({ kind: 'squad_not_found' });

  const at = now(ctx);
  const existing = await ctx.store.gameModels.findBySquad(squadId);

  return write(ctx, {
    ...(existing ?? {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: at,
      id: asGameModelId(ctx.ids.uuid()),
      squadId,
      principles: [],
      notes: '',
    }),
    identity,
    updatedAt: at,
  });
}

export interface AddPrincipleInput {
  squadId: SquadId;
  moment: Moment;
  level: PrincipleLevel;
  text: string;
  /** Required for everything below macro. The tree rule refuses it otherwise. */
  parentId?: PrincipleId;
}

/**
 * Adds one principle.
 *
 * The moment is **inherited from the parent** rather than taken from the caller when there is
 * one. A UI that let a coach add a micro-principle under an in-possession macro and then file it
 * under defending would be offering a way to build the incoherence the schema then rejects; it
 * is better to make that impossible than to report it.
 */
export async function addPrinciple(
  ctx: ServiceContext,
  input: AddPrincipleInput,
): Promise<Result<GameModel, GameModelError>> {
  const model = await ctx.store.gameModels.findBySquad(input.squadId);
  if (!model) return err({ kind: 'no_game_model' });

  const needsParent = parentLevelOf(input.level) !== null;
  if (needsParent && input.parentId === undefined) {
    return err({
      kind: 'invalid',
      message: `A ${input.level} principle needs a ${parentLevelOf(input.level)} above it.`,
    });
  }

  const parent =
    input.parentId === undefined
      ? undefined
      : model.principles.find((candidate) => candidate.id === input.parentId);

  if (input.parentId !== undefined && !parent) {
    return err({ kind: 'principle_not_found', principleId: input.parentId });
  }

  const principle: Principle = {
    id: asPrincipleId(ctx.ids.uuid()),
    moment: parent?.moment ?? input.moment,
    level: input.level,
    parentId: input.parentId ?? null,
    text: input.text,
  };

  return write(ctx, {
    ...model,
    principles: [...model.principles, principle],
    updatedAt: now(ctx),
  });
}

export async function editPrinciple(
  ctx: ServiceContext,
  squadId: SquadId,
  principleId: PrincipleId,
  text: string,
): Promise<Result<GameModel, GameModelError>> {
  const model = await ctx.store.gameModels.findBySquad(squadId);
  if (!model) return err({ kind: 'no_game_model' });
  if (!model.principles.some((candidate) => candidate.id === principleId)) {
    return err({ kind: 'principle_not_found', principleId });
  }

  return write(ctx, {
    ...model,
    principles: model.principles.map((principle) =>
      principle.id === principleId ? { ...principle, text } : principle,
    ),
    updatedAt: now(ctx),
  });
}

/**
 * Removes a principle **and everything below it**.
 *
 * Cascading is the only honest option. Leaving the children would orphan them — the exact leaf
 * off a tree the methodology warns about — and the schema would then refuse the next write, so
 * the alternative is not "keep the children" but "corrupt the model". The service returns how
 * many went so the UI can say `Removed 4` rather than implying one.
 */
export async function removePrinciple(
  ctx: ServiceContext,
  squadId: SquadId,
  principleId: PrincipleId,
): Promise<Result<{ model: GameModel; removed: number }, GameModelError>> {
  const model = await ctx.store.gameModels.findBySquad(squadId);
  if (!model) return err({ kind: 'no_game_model' });
  if (!model.principles.some((candidate) => candidate.id === principleId)) {
    return err({ kind: 'principle_not_found', principleId });
  }

  const doomed = descendantsOf(model, principleId);
  const kept = model.principles.filter((principle) => !doomed.has(principle.id));

  const result = await write(ctx, { ...model, principles: kept, updatedAt: now(ctx) });
  return result.ok ? ok({ model: result.value, removed: doomed.size }) : result;
}

export async function setNotes(
  ctx: ServiceContext,
  squadId: SquadId,
  notes: string,
): Promise<Result<GameModel, GameModelError>> {
  const model = await ctx.store.gameModels.findBySquad(squadId);
  if (!model) return err({ kind: 'no_game_model' });
  return write(ctx, { ...model, notes, updatedAt: now(ctx) });
}

/**
 * Names the principle a session is training.
 *
 * On the session rather than on the model, because it is a fact about that Tuesday and not
 * about the game model — which is also why it survives the principle later being deleted. See
 * the note on `Objective.principleId`.
 */
export async function setObjectivePrinciple(
  ctx: ServiceContext,
  sessionId: SessionId,
  principleId: PrincipleId | null,
): Promise<Result<Session, GameModelError>> {
  const session = await ctx.store.sessions.get(sessionId);
  if (!session) return err({ kind: 'invalid', message: 'That session is gone.' });

  const updated = SessionSchema.safeParse({
    ...session,
    objective: { ...session.objective, principleId },
    updatedAt: now(ctx),
  });
  if (!updated.success) {
    return err({ kind: 'invalid', message: 'Could not save that.' });
  }

  await ctx.store.sessions.put(updated.data);
  return ok(updated.data);
}

/** A principle and every principle beneath it, at any depth. */
function descendantsOf(model: GameModel, rootId: PrincipleId): Set<PrincipleId> {
  const doomed = new Set<PrincipleId>([rootId]);
  // Four levels, so this settles in at most four passes. A loop rather than recursion because
  // the parent-before-child ordering of the array is not guaranteed after an import.
  let growing = true;
  while (growing) {
    growing = false;
    for (const principle of model.principles) {
      if (
        principle.parentId !== null &&
        doomed.has(principle.parentId) &&
        !doomed.has(principle.id)
      ) {
        doomed.add(principle.id);
        growing = true;
      }
    }
  }
  return doomed;
}

/**
 * The single write path, so every mutation goes through the schema.
 *
 * A `ZodError` here is a bug in a caller rather than something a coach did — the UI prevents
 * the shapes the tree rule refuses — but it is returned rather than thrown so a caller on the
 * pitch gets a toast instead of a blank screen.
 */
async function write(
  ctx: ServiceContext,
  candidate: unknown,
): Promise<Result<GameModel, GameModelError>> {
  const parsed = GameModelSchema.safeParse(candidate);
  if (!parsed.success) {
    return err({ kind: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid model.' });
  }

  await ctx.store.gameModels.put(parsed.data);
  return ok(parsed.data);
}
