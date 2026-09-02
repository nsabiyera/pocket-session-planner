import { err, ok, type Result } from '@/lib/result';
import {
  asCoachingPointId,
  asPhaseId,
  asSessionId,
  type MethodologyId,
  type PlayerId,
  type SessionId,
  type SquadId,
} from '@/domain/ids';
import { CoachingPointSchema } from '@/domain/coaching-point';
import { findObjectiveTemplate } from '@/domain/objectives';
import type { InterventionPlan } from '@/domain/intervention';
import { CURRENT_SCHEMA_VERSION, type IsoDateTime } from '@/domain/primitives';
import {
  autoTitle,
  buildSessionFromMethodology,
  rescaleSessionPhases,
} from '@/domain/session/build-from-methodology';
import { applySessionCommand, type TransitionError } from '@/domain/session/state-machine';
import { mainPracticePhase } from '@/domain/session/selectors';
import { SessionSchema, type Objective, type Session, type SessionPhase } from '@/domain/session';
import { DEFAULT_METHODOLOGY_ID } from '@/domain/presets';
import { now, type ServiceContext } from '../context';

/**
 * The composer behind `/plan`.
 *
 * The target is four taps and zero typing, so almost everything here is about *defaults*:
 * last-used methodology, the squad's default duration, focus players carried forward from
 * the last review, and coaching points that arrive with the objective.
 *
 * There is exactly **one draft** at a time (ADR 0003), which is what lets `/plan` be a
 * singleton route and removes the save-draft button entirely.
 */

export interface StartDraftInput {
  squadId: SquadId;
  objectiveText: string;
  /** Set when the objective came from the curated library, so its points come with it. */
  objectiveTemplateId?: string;
  methodologyId?: MethodologyId;
  totalMin?: number;
  focusPlayerIds?: readonly PlayerId[];
  scheduledFor?: IsoDateTime;
}

export type PlanningError =
  | { kind: 'squad_not_found' }
  | { kind: 'methodology_not_found'; methodologyId: string }
  | { kind: 'no_draft' }
  | { kind: 'session_not_found' }
  | { kind: 'transition'; error: TransitionError };

/**
 * Creates the draft, replacing any existing one.
 *
 * Replacing rather than refusing is deliberate: a coach who taps `New session` has decided,
 * and a modal asking "you already have a draft, discard it?" is one more thing between them
 * and the pitch. The old draft was never committed, so nothing of value is lost.
 */
export async function startDraft(
  ctx: ServiceContext,
  input: StartDraftInput,
): Promise<Result<Session, PlanningError>> {
  const squad = await ctx.store.squads.get(input.squadId);
  if (!squad) return err({ kind: 'squad_not_found' });

  const methodologyId = input.methodologyId ?? (await lastUsedMethodologyId(ctx, input.squadId));
  const methodology = await ctx.store.methodologies.resolve(methodologyId);
  if (!methodology) return err({ kind: 'methodology_not_found', methodologyId });

  const at = now(ctx);
  const template = input.objectiveTemplateId
    ? findObjectiveTemplate(input.objectiveTemplateId)
    : undefined;

  const objective: Objective = {
    text: input.objectiveText,
    successCriteria: [...(template?.successCriteria ?? [])],
    sourceActionId: null,
  };

  const session = buildSessionFromMethodology(methodology, {
    squad,
    objective,
    now: at,
    ids: ctx.ids,
    ...(input.totalMin !== undefined ? { totalMin: input.totalMin } : {}),
    ...(input.scheduledFor !== undefined ? { scheduledFor: input.scheduledFor } : {}),
    focusPlayers: (input.focusPlayerIds ?? []).map((playerId) => ({
      playerId,
      sourceActionId: null,
    })),
  });

  // The objective's own coaching points land in the main practice — the phase the coach
  // actually means when they say "the practice".
  const withPoints = template ? addObjectivePoints(ctx, session, template.coachingPoints) : session;

  const existingDraft = await ctx.store.sessions.findDraft(input.squadId);
  await ctx.store.transact(['sessions', 'app_meta'], 'readwrite', async (tx) => {
    if (existingDraft) await tx.sessions.hardDelete(existingDraft.id);
    await tx.sessions.put(withPoints);
    await tx.meta.patch({ activeSessionId: withPoints.id, activeSquadId: input.squadId }, at);
  });

  return ok(withPoints);
}

function addObjectivePoints(
  ctx: ServiceContext,
  session: Session,
  texts: readonly string[],
): Session {
  const target = mainPracticePhase(session);
  if (!target || texts.length === 0) return session;

  const points = texts.slice(0, 6).map((text) =>
    CoachingPointSchema.parse({
      id: asCoachingPointId(ctx.ids.uuid()),
      text,
      source: 'coach',
    }),
  );

  return {
    ...session,
    phases: session.phases.map((phase) =>
      phase.id === target.id
        ? { ...phase, coachingPoints: [...phase.coachingPoints, ...points].slice(0, 10) }
        : phase,
    ),
  };
}

/** Sticky last-used methodology, so the segmented control is already right. */
export async function lastUsedMethodologyId(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<MethodologyId> {
  const recent = await ctx.store.sessions.listBySquad(squadId, { limit: 1 });
  return recent[0]?.methodology.methodologyId ?? (DEFAULT_METHODOLOGY_ID as MethodologyId);
}

export async function getDraft(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<Session | undefined> {
  return ctx.store.sessions.findDraft(squadId);
}

/**
 * Swapping methodology rebuilds the phases from scratch — that is the whole point of the
 * control. The **intervention plan is re-derived too, unless the coach has touched it**, so
 * a deliberate choice is never silently discarded by a later methodology change.
 */
export async function changeMethodology(
  ctx: ServiceContext,
  sessionId: SessionId,
  methodologyId: MethodologyId,
): Promise<Result<Session, PlanningError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const squad = await ctx.store.squads.get(current.squadId);
  if (!squad) return err({ kind: 'squad_not_found' });

  const methodology = await ctx.store.methodologies.resolve(methodologyId);
  if (!methodology) return err({ kind: 'methodology_not_found', methodologyId });

  const at = now(ctx);
  const rebuilt = buildSessionFromMethodology(methodology, {
    squad,
    objective: current.objective,
    now: at,
    ids: ctx.ids,
    totalMin: current.plannedDurationMin,
    scheduledFor: current.scheduledFor,
    focusPlayers: current.focusPlayers,
    sessionId: current.id,
    title: current.title,
    reminders: current.reminders,
    seededFromActionIds: current.seededFromActionIds,
    ...(current.interventionTouched ? { intervention: current.intervention } : {}),
  });

  const next: Session = {
    ...rebuilt,
    createdAt: current.createdAt,
    interventionTouched: current.interventionTouched,
    notes: current.notes,
  };

  await ctx.store.sessions.put(next);
  return ok(next);
}

export interface UpdateDraftInput {
  objective?: Objective;
  totalMin?: number;
  focusPlayerIds?: readonly PlayerId[];
  scheduledFor?: IsoDateTime;
  notes?: string;
  title?: string;
}

export async function updateDraft(
  ctx: ServiceContext,
  sessionId: SessionId,
  changes: UpdateDraftInput,
): Promise<Result<Session, PlanningError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const at = now(ctx);
  let phases: SessionPhase[] = current.phases;
  let focusPlayers = current.focusPlayers;

  if (changes.focusPlayerIds !== undefined) {
    const wanted = new Set<PlayerId>(changes.focusPlayerIds);
    focusPlayers = [
      // Keep existing assignments (and their carry-forward provenance) where still wanted.
      ...current.focusPlayers.filter((f) => wanted.has(f.playerId)),
      ...changes.focusPlayerIds
        .filter((id) => !current.focusPlayers.some((f) => f.playerId === id))
        .map((playerId) => ({ playerId, sourceActionId: null })),
    ];
    // A phase cannot focus a player the session no longer focuses — the schema enforces it,
    // so prune rather than let the write throw.
    phases = phases.map((phase) => ({
      ...phase,
      focusPlayerIds: phase.focusPlayerIds.filter((id) => wanted.has(id)),
    }));
  }

  if (changes.totalMin !== undefined && changes.totalMin !== current.plannedDurationMin) {
    phases = rescaleSessionPhases({ ...current, phases }, changes.totalMin);
  }

  const objective = changes.objective ?? current.objective;
  const scheduledFor = changes.scheduledFor ?? current.scheduledFor;

  const next = SessionSchema.parse({
    ...current,
    objective,
    scheduledFor,
    focusPlayers,
    phases,
    plannedDurationMin: changes.totalMin ?? current.plannedDurationMin,
    notes: changes.notes ?? current.notes,
    // Retitle automatically as long as the coach has not named it themselves.
    title:
      changes.title ??
      (current.title === autoTitle(current.objective.text, current.scheduledFor)
        ? autoTitle(objective.text, scheduledFor)
        : current.title),
    updatedAt: at,
  });

  await ctx.store.sessions.put(next);
  return ok(next);
}

/** Replaces a phase wholesale — the phase editor's save. */
export async function updatePhase(
  ctx: ServiceContext,
  sessionId: SessionId,
  phase: SessionPhase,
): Promise<Result<Session, PlanningError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const next = SessionSchema.parse({
    ...current,
    phases: current.phases.map((p) => (p.id === phase.id ? phase : p)),
    updatedAt: now(ctx),
  });

  await ctx.store.sessions.put(next);
  return ok(next);
}

export async function reorderPhases(
  ctx: ServiceContext,
  sessionId: SessionId,
  orderedIds: readonly SessionPhase['id'][],
): Promise<Result<Session, PlanningError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const next = SessionSchema.parse({
    ...current,
    phases: current.phases.map((phase) => ({
      ...phase,
      order: position.get(phase.id) ?? phase.order,
    })),
    updatedAt: now(ctx),
  });

  await ctx.store.sessions.put(next);
  return ok(next);
}

/**
 * Sets the intervention plan, at session level or for one phase, and marks it **touched** so
 * a later methodology change will not overwrite it.
 */
export async function setIntervention(
  ctx: ServiceContext,
  sessionId: SessionId,
  plan: InterventionPlan | null,
  phaseId?: SessionPhase['id'],
): Promise<Result<Session, PlanningError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const next = SessionSchema.parse({
    ...current,
    ...(phaseId === undefined
      ? { intervention: plan ?? current.intervention, interventionTouched: true }
      : {
          phases: current.phases.map((phase) =>
            phase.id === phaseId ? { ...phase, intervention: plan } : phase,
          ),
        }),
    updatedAt: now(ctx),
  });

  await ctx.store.sessions.put(next);
  return ok(next);
}

/** `Start session ▸`: commit the plan and start the run, in one write. */
export async function commitAndStart(
  ctx: ServiceContext,
  sessionId: SessionId,
): Promise<Result<Session, PlanningError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const at = now(ctx);
  const committed =
    current.status === 'draft'
      ? applySessionCommand(current, { kind: 'commitPlan' }, at)
      : ok(current);
  if (!committed.ok) return err({ kind: 'transition', error: committed.error });

  const started = applySessionCommand(committed.value, { kind: 'start' }, at);
  if (!started.ok) return err({ kind: 'transition', error: started.error });

  await ctx.store.transact(['sessions', 'app_meta'], 'readwrite', async (tx) => {
    await tx.sessions.put(started.value);
    await tx.meta.patch({ activeSessionId: started.value.id }, at);
  });

  return ok(started.value);
}

/**
 * **Repeat** on the last-session card — the two-tap path.
 *
 * Clones the objective, methodology snapshot, intervention plan and phases into a fresh
 * draft, resets every coaching point to undelivered, and drops all run data. What it
 * deliberately does *not* clone is the run, the review link or the carry-forward provenance:
 * this is a new session that looks like the old one, not a copy of the old one.
 */
export async function repeatSession(
  ctx: ServiceContext,
  sessionId: SessionId,
  options: { focusPlayerIds?: readonly PlayerId[] } = {},
): Promise<Result<Session, PlanningError>> {
  const source = await ctx.store.sessions.get(sessionId);
  if (!source) return err({ kind: 'session_not_found' });

  const at = now(ctx);
  const focusPlayers =
    options.focusPlayerIds === undefined
      ? source.focusPlayers.map((f) => ({ playerId: f.playerId, sourceActionId: null }))
      : options.focusPlayerIds.map((playerId) => ({ playerId, sourceActionId: null }));
  const focusIds = new Set(focusPlayers.map((f) => f.playerId));

  const draft = SessionSchema.parse({
    ...source,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: asSessionId(ctx.ids.uuid()),
    createdAt: at,
    updatedAt: at,
    scheduledFor: at,
    title: autoTitle(source.objective.text, at),
    status: 'draft',
    run: null,
    reviewId: null,
    abandonReason: null,
    seededFromActionIds: [],
    objective: { ...source.objective, sourceActionId: null },
    focusPlayers,
    phases: source.phases.map((phase) => ({
      ...phase,
      id: asPhaseId(ctx.ids.uuid()),
      focusPlayerIds: phase.focusPlayerIds.filter((id) => focusIds.has(id)),
      sourceActionId: null,
      coachingPoints: phase.coachingPoints.map((point) => ({
        ...point,
        id: asCoachingPointId(ctx.ids.uuid()),
        delivered: false,
        deliveredAt: null,
        sourceActionId: null,
      })),
    })),
  });

  const existingDraft = await ctx.store.sessions.findDraft(source.squadId);
  await ctx.store.transact(['sessions', 'app_meta'], 'readwrite', async (tx) => {
    if (existingDraft) await tx.sessions.hardDelete(existingDraft.id);
    await tx.sessions.put(draft);
    await tx.meta.patch({ activeSessionId: draft.id }, at);
  });

  return ok(draft);
}

export async function discardDraft(ctx: ServiceContext, squadId: SquadId): Promise<void> {
  const draft = await ctx.store.sessions.findDraft(squadId);
  if (!draft) return;

  const at = now(ctx);
  await ctx.store.transact(['sessions', 'app_meta'], 'readwrite', async (tx) => {
    await tx.sessions.hardDelete(draft.id);
    await tx.meta.patch({ activeSessionId: null }, at);
  });
}
