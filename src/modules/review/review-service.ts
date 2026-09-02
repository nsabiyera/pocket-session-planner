import { err, ok, type Result } from '@/lib/result';
import {
  CarryForwardActionSchema,
  type CarryForwardAction,
  type CarryForwardProposal,
} from '@/domain/carry-forward';
import {
  asCarryForwardActionId,
  asReviewId,
  type CarryForwardActionId,
  type PlayerId,
  type SessionId,
  type SquadId,
} from '@/domain/ids';
import { cornerBalance, type CornerBalance } from '@/domain/four-corners/balance';
import type { Observation } from '@/domain/observation';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import {
  SessionReviewSchema,
  type ObjectiveOutcome,
  type SessionReview,
  type FocusPlayerReview,
  type PhaseReview,
  type SeededActionOutcome,
} from '@/domain/review';
import {
  interventionSummary,
  phaseOverruns,
  type InterventionSummary,
} from '@/domain/session/selectors';
import { SessionSchema, type Session } from '@/domain/session';
import { applyCarryForwardActions } from '../planning/apply-carry-forward';
import { deriveCarryForwardProposals } from './derive-carry-forward';
import { now, type ServiceContext } from '../context';

/**
 * `/review` — five taps and zero required typing.
 *
 * Most of what the screen shows is worked out here rather than asked for: the phases that
 * ran over, the focus players with no observations against them, and the intervention
 * report. The coach confirms; they do not fill in a form.
 */

export type ReviewError =
  | { kind: 'session_not_found' }
  | { kind: 'not_completed'; status: Session['status'] }
  | { kind: 'already_reviewed' }
  | { kind: 'no_draft' };

/** Everything `/review` needs to render, pre-computed. */
export interface ReviewDraftData {
  session: Session;
  observations: Observation[];
  interventions: InterventionSummary;
  /** *"Main practice ran 6 min over"* — offered as a confirmation, not a question. */
  overruns: ReturnType<typeof phaseOverruns>;
  /** *"Sam and Jo: no observations logged"* — the omission the coach most wants flagged. */
  unobservedFocusPlayerIds: FocusPlayerReview['playerId'][];
  /** The actions that seeded this session: *"last time you said X — did it move on?"* */
  seededActions: CarryForwardAction[];
  /** Which corners this session actually touched — the FA 4 Corner coverage line. */
  cornerCoverage: CornerBalance;
}

export async function loadReviewData(
  ctx: ServiceContext,
  sessionId: SessionId,
): Promise<Result<ReviewDraftData, ReviewError>> {
  const session = await ctx.store.sessions.get(sessionId);
  if (!session) return err({ kind: 'session_not_found' });
  if (session.status !== 'completed' && session.status !== 'abandoned') {
    return err({ kind: 'not_completed', status: session.status });
  }

  const observations = await ctx.store.observations.listBySession(sessionId);
  const seen = new Set(observations.map((observation) => observation.playerId));

  const seededActions = await ctx.store.actions.getMany(session.seededFromActionIds);

  return ok({
    session,
    observations,
    interventions: interventionSummary(session, ctx.clock.now()),
    overruns: phaseOverruns(session, ctx.clock.now()),
    unobservedFocusPlayerIds: session.focusPlayers
      .map((focus) => focus.playerId)
      .filter((playerId) => !seen.has(playerId)),
    seededActions,
    cornerCoverage: cornerBalance(observations),
  });
}

/** The pre-generated chips, derived from everything the session already knows. */
export async function proposeCarryForward(
  ctx: ServiceContext,
  sessionId: SessionId,
  review: SessionReview,
): Promise<Result<CarryForwardProposal[], ReviewError>> {
  const data = await loadReviewData(ctx, sessionId);
  if (!data.ok) return data;

  const players = await ctx.store.players.listBySquad(data.value.session.squadId, {
    includeArchived: true,
  });
  const openActions = await ctx.store.actions.listOpen(data.value.session.squadId);

  // Term-wide history for the focus players, so the 4 Corner nudge is judged against a
  // season rather than a single Tuesday.
  const playerHistory = new Map<PlayerId, Observation[]>();
  for (const focus of data.value.session.focusPlayers) {
    playerHistory.set(
      focus.playerId,
      await ctx.store.observations.listByPlayer(focus.playerId, { limit: 500 }),
    );
  }

  return ok(
    deriveCarryForwardProposals({
      session: data.value.session,
      review,
      observations: data.value.observations,
      interventions: data.value.interventions,
      openActions,
      players,
      playerHistory,
    }),
  );
}

export interface SaveReviewInput {
  sessionId: SessionId;
  objectiveOutcome: ObjectiveOutcome;
  metCriteria?: readonly number[];
  sessionRating?: number | null;
  interventionMatchedPlan?: boolean | null;
  phaseReviews?: readonly PhaseReview[];
  focusPlayerReviews?: readonly FocusPlayerReview[];
  seededActionOutcomes?: readonly SeededActionOutcome[];
  whatWorked?: readonly string[];
  whatDidnt?: readonly string[];
  note?: string;
  /** The chips the coach left ticked. **Nothing is written until this call.** */
  acceptedProposals: readonly CarryForwardProposal[];
}

export interface SaveReviewResult {
  review: SessionReview;
  createdActions: CarryForwardAction[];
  supersededActionIds: CarryForwardActionId[];
}

/**
 * Writes the review, the accepted carry-forward actions, the chained predecessors and the
 * session's `reviewId` — **in one transaction**, so the loop can never half-close.
 */
export async function saveReview(
  ctx: ServiceContext,
  input: SaveReviewInput,
): Promise<Result<SaveReviewResult, ReviewError>> {
  const session = await ctx.store.sessions.get(input.sessionId);
  if (!session) return err({ kind: 'session_not_found' });
  if (session.reviewId !== null) return err({ kind: 'already_reviewed' });
  if (session.status !== 'completed' && session.status !== 'abandoned') {
    return err({ kind: 'not_completed', status: session.status });
  }

  const at = now(ctx);
  const review = SessionReviewSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    id: asReviewId(ctx.ids.uuid()),
    sessionId: session.id,
    squadId: session.squadId,
    completedAt: at,
    objectiveOutcome: input.objectiveOutcome,
    metCriteria: input.metCriteria ?? [],
    sessionRating: input.sessionRating ?? null,
    interventionMatchedPlan: input.interventionMatchedPlan ?? null,
    phaseReviews: input.phaseReviews ?? [],
    focusPlayerReviews: input.focusPlayerReviews ?? [],
    seededActionOutcomes: input.seededActionOutcomes ?? [],
    whatWorked: input.whatWorked ?? [],
    whatDidnt: input.whatDidnt ?? [],
    note: input.note ?? '',
  });

  // Everything is computed *before* the transaction opens — IndexedDB auto-commits on the
  // first non-store await, so a single stray `await` in here would silently lose writes.
  const openActions = await ctx.store.actions.listOpen(session.squadId);
  const openById = new Map(openActions.map((action) => [action.id, action]));

  const createdActions: CarryForwardAction[] = [];
  const supersededActionIds: CarryForwardActionId[] = [];

  for (const proposal of input.acceptedProposals) {
    const predecessor =
      proposal.supersedesActionId === null ? undefined : openById.get(proposal.supersedesActionId);

    createdActions.push(
      CarryForwardActionSchema.parse({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: at,
        updatedAt: at,
        id: asCarryForwardActionId(ctx.ids.uuid()),
        squadId: session.squadId,
        kind: proposal.kind,
        title: proposal.title,
        detail: proposal.detail,
        priority: proposal.priority,
        status: 'open',
        payload: proposal.payload,
        originSessionId: session.id,
        supersedesActionId: predecessor?.id ?? null,
        // The number that turns into "you have chased this for three sessions".
        chainDepth: (predecessor?.chainDepth ?? -1) + 1,
        playerIds: proposal.playerIds,
      }),
    );

    if (predecessor) supersededActionIds.push(predecessor.id);
  }

  // Actions the coach explicitly closed out on the "did it move on?" question.
  const resolved = (input.seededActionOutcomes ?? [])
    .filter((outcome) => outcome.outcome === 'done')
    .map((outcome) => openById.get(outcome.actionId as CarryForwardActionId))
    .filter((action): action is CarryForwardAction => action !== undefined);

  const supersededActions = supersededActionIds
    .map((id) => openById.get(id))
    .filter((action): action is CarryForwardAction => action !== undefined)
    .map((action) => ({
      ...action,
      status: 'done' as const,
      resolutionNote: 'superseded',
      resolvedAt: at,
      updatedAt: at,
    }));

  const resolvedActions = resolved
    .filter((action) => !supersededActionIds.includes(action.id))
    .map((action) => ({
      ...action,
      status: 'done' as const,
      resolutionNote: 'done',
      resolvedAt: at,
      updatedAt: at,
    }));

  const updatedSession = SessionSchema.parse({ ...session, reviewId: review.id, updatedAt: at });

  await ctx.store.transact(
    ['reviews', 'sessions', 'carry_forward_actions', 'app_meta'],
    'readwrite',
    async (tx) => {
      await tx.reviews.put(review);
      await tx.sessions.put(updatedSession);
      await tx.actions.putMany([...createdActions, ...supersededActions, ...resolvedActions]);
      await tx.meta.patch({ activeSessionId: null }, at);
    },
  );

  return ok({ review, createdActions, supersededActionIds });
}

/**
 * Applies open actions to the current draft — the "pre-ticked checklist at the top of the
 * New Session screen".
 *
 * The draft write and the action updates happen in one transaction, so a session can never
 * be seeded from an action that still reads as open.
 */
export async function applyActionsToDraft(
  ctx: ServiceContext,
  squadId: SquadId,
  actionIds: readonly CarryForwardActionId[],
): Promise<
  Result<
    { session: Session; skipped: Array<{ id: CarryForwardActionId; reason: string }> },
    ReviewError
  >
> {
  const draft = await ctx.store.sessions.findDraft(squadId);
  if (!draft) return err({ kind: 'no_draft' });

  const at = now(ctx);
  const actions = await ctx.store.actions.getMany(actionIds);
  const result = applyCarryForwardActions(draft, actions, { ids: ctx.ids, now: at });

  const appliedSet = new Set(result.applied);
  const updatedActions = actions
    .filter((action) => appliedSet.has(action.id))
    .map((action) => ({
      ...action,
      status: 'planned' as const,
      appliedToSessionId: draft.id,
      updatedAt: at,
    }));

  await ctx.store.transact(['sessions', 'carry_forward_actions'], 'readwrite', async (tx) => {
    await tx.sessions.put(result.session);
    await tx.actions.putMany(updatedActions);
  });

  return ok({ session: result.session, skipped: result.skipped });
}

/** The open-action list for the planner, priority first and then oldest. */
export async function listOpenActions(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<CarryForwardAction[]> {
  return ctx.store.actions.listOpen(squadId);
}

export async function dropAction(
  ctx: ServiceContext,
  actionId: CarryForwardActionId,
  note = 'dropped',
): Promise<void> {
  const action = await ctx.store.actions.get(actionId);
  if (!action) return;

  const at = now(ctx);
  await ctx.store.actions.put({
    ...action,
    status: 'dropped',
    resolutionNote: note,
    resolvedAt: at,
    updatedAt: at,
  });
}
