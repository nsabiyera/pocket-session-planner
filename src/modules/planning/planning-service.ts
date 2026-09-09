import { err, ok, type Result } from '@/lib/result';
import {
  asChallengeId,
  asCoachingPointId,
  asPhaseId,
  asSessionId,
  type MethodologyId,
  type PhaseId,
  type PlayerId,
  type SessionId,
  type SquadId,
} from '@/domain/ids';
import { CoachingPointSchema, normaliseCoachingPointText } from '@/domain/coaching-point';
import { findObjectiveTemplate } from '@/domain/objectives';
import type { InterventionPlan } from '@/domain/intervention';
import { CURRENT_SCHEMA_VERSION, isoDateTime, type IsoDateTime } from '@/domain/primitives';
import {
  autoTitle,
  buildSessionFromMethodology,
  rescaleSessionPhases,
} from '@/domain/session/build-from-methodology';
import { buildMatch } from '@/domain/session/build-match';
import { MatchDetailsSchema, describeFixture, matchFormatOf } from '@/domain/match-day';
import { ageBandOf } from '@/domain/practice/match';
import type { ParsedFixture } from '@/domain/fixture-list';
import type { MatchDetailsInput } from '@/domain/match-day';
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

export interface StartMatchInput {
  squadId: SquadId;
  /** The **whole-team** objective. Units get their own; players get challenges. */
  objectiveText: string;
  objectiveTemplateId?: string;
  match: MatchDetailsInput;
  periodMin?: number;
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
    principleId: null,
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

/**
 * Creates a **match** draft, replacing any existing draft.
 *
 * Same one-draft-at-a-time rule as `startDraft` (ADR 0003), and deliberately the same
 * replacement behaviour: a coach who taps `Match day` has decided.
 *
 * No methodology lookup, because a match is not one of the training presets — `buildMatch`
 * carries its own snapshot. That is the only structural difference between this and
 * `startDraft`; everything downstream, the phase editor and Do mode included, treats what
 * comes back as an ordinary session.
 */
export async function startMatchDraft(
  ctx: ServiceContext,
  input: StartMatchInput,
): Promise<Result<Session, PlanningError>> {
  const squad = await ctx.store.squads.get(input.squadId);
  if (!squad) return err({ kind: 'squad_not_found' });

  const at = now(ctx);
  const template = input.objectiveTemplateId
    ? findObjectiveTemplate(input.objectiveTemplateId)
    : undefined;

  const objective: Objective = {
    text: input.objectiveText,
    successCriteria: [...(template?.successCriteria ?? [])],
    sourceActionId: null,
    principleId: null,
  };

  const session = buildMatch({
    squad,
    objective,
    match: input.match,
    now: at,
    ids: ctx.ids,
    ...(input.periodMin !== undefined ? { periodMin: input.periodMin } : {}),
    ...(input.scheduledFor !== undefined ? { scheduledFor: input.scheduledFor } : {}),
    focusPlayers: (input.focusPlayerIds ?? []).map((playerId) => ({
      playerId,
      sourceActionId: null,
    })),
  });

  const existingDraft = await ctx.store.sessions.findDraft(input.squadId);
  await ctx.store.transact(['sessions', 'app_meta'], 'readwrite', async (tx) => {
    if (existingDraft) await tx.sessions.hardDelete(existingDraft.id);
    await tx.sessions.put(session);
    await tx.meta.patch({ activeSessionId: session.id, activeSquadId: input.squadId }, at);
  });

  return ok(session);
}

/**
 * Adds a run of fixtures, each committed straight to `planned`.
 *
 * **Not drafts.** `startMatchDraft` replaces the squad's single draft (ADR 0003), so entering a
 * second fixture would discard the first — which is exactly why there was no fixture list until
 * now. A fixture goes to `planned` instead, where sessions accumulate freely, and the draft slot
 * stays free for the session a coach is actually composing.
 *
 * The team objective starts as the fixture line. That is a **label, not an objective**: in July
 * a coach does not know what March's game is about. It carries no `principleId`, so every report
 * downstream correctly counts the fixture as unlinked until the brief is written — which is the
 * honest reading rather than a placeholder pretending to be a plan.
 */
export async function addFixtures(
  ctx: ServiceContext,
  squadId: SquadId,
  fixtures: readonly ParsedFixture[],
): Promise<Result<Session[], PlanningError>> {
  const squad = await ctx.store.squads.get(squadId);
  if (!squad) return err({ kind: 'squad_not_found' });

  const band = ageBandOf(squad.ageGroup);
  const format = band === null ? '11v11' : (matchFormatOf(band) ?? '11v11');
  const at = now(ctx);
  const created: Session[] = [];

  for (const fixture of fixtures) {
    const details: MatchDetailsInput = {
      opponent: fixture.opponent,
      venue: fixture.venue,
      fixtureType: 'league',
      format,
      shapeName: null,
      periodCount: 2,
    };

    const draft = buildMatch({
      squad,
      objective: {
        text: describeFixture(MatchDetailsSchema.parse(details)),
        successCriteria: [],
        sourceActionId: null,
        principleId: null,
      },
      match: details,
      now: at,
      ids: ctx.ids,
      scheduledFor: isoDateTime(fixture.kickOffAt),
    });

    // Straight past the draft slot. `commitPlan`'s only guard is a non-empty objective, which
    // the fixture line satisfies.
    const planned = applySessionCommand(draft, { kind: 'commitPlan' }, at);
    if (!planned.ok) return err({ kind: 'transition', error: planned.error });
    created.push(planned.value);
  }

  await ctx.store.sessions.putMany(created);
  return ok(created);
}

/** Every fixture for a squad, soonest first. */
export async function listFixtures(ctx: ServiceContext, squadId: SquadId): Promise<Session[]> {
  const sessions = await ctx.store.sessions.listBySquad(squadId, { limit: 200 });
  return sessions
    .filter((session) => session.kind === 'match')
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1));
}

function addObjectivePoints(
  ctx: ServiceContext,
  session: Session,
  texts: readonly string[],
): Session {
  const target = mainPracticePhase(session);
  if (!target || texts.length === 0) return session;

  /*
   * **Skip anything the phase already says.**
   *
   * The methodology preset and the objective library overlap — both offer "Head up before
   * you receive" for playing out from the back — so appending blindly put the same
   * instruction in front of the coach twice in Do mode, and made the observation tag bank
   * offer the same button twice. Normalised, so punctuation and case do not smuggle a
   * duplicate through.
   */
  const seen = new Set(
    target.coachingPoints.map((point) => normaliseCoachingPointText(point.text)),
  );

  const points = texts
    .filter((text) => {
      const key = normaliseCoachingPointText(text);
      if (seen.has(key)) return false;
      // Also guards a library entry that repeats itself.
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((text) =>
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

/**
 * Sticky last-used methodology, so the segmented control is already right.
 *
 * **Training sessions only.** A match carries the `match-day` snapshot, which is deliberately
 * not one of the training presets and therefore does not resolve — so before this filter,
 * planning a match and then tapping `New session` failed outright with
 * `methodology_not_found`. It is also the wrong answer even where it resolves: how you coached
 * on Saturday is no guide to how you want to practise on Tuesday.
 */
export async function lastUsedMethodologyId(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<MethodologyId> {
  const recent = await ctx.store.sessions.listBySquad(squadId, { limit: 10 });
  const training = recent.find((session) => session.kind !== 'match');
  return training?.methodology.methodologyId ?? (DEFAULT_METHODOLOGY_ID as MethodologyId);
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
 *
 * On a match the same line runs through the match block: the shape and the units to talk to
 * are the plan and repeat; presence, the score and the conditions are the record of a game
 * that was played once.
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

  // Phases get fresh ids, so anything pointing at a phase has to be remapped rather than
  // copied — a challenge still holding the *source* session's phase id would be rejected by
  // the schema, and silently dropping its scope would quietly widen the challenge.
  const phaseIdBySource = new Map<string, PhaseId>(
    source.phases.map((phase) => [phase.id as string, asPhaseId(ctx.ids.uuid())]),
  );

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
    // Period presence points at the *source* session's periods, which no longer exist once
    // the phases are remapped — and it would be a lie besides, crediting this week's fixture
    // with minutes played in last week's. The score and the conditions belong to that game
    // too. The unit objectives are asks, so they come back the way challenges do: open.
    match:
      source.match === null
        ? null
        : {
            ...source.match,
            unitObjectives: source.match.unitObjectives.map((objective) => ({
              ...objective,
              status: 'open',
            })),
            presence: [],
            result: null,
            conditions: '',
          },
    // The *asks* are worth repeating; last week's verdict on them is not. Every challenge
    // comes back open, with no sightings and no ruling, for a player still in the squad.
    challenges: source.challenges.map((challenge) => ({
      ...challenge,
      id: asChallengeId(ctx.ids.uuid()),
      status: 'open',
      settledAt: null,
      note: '',
      sourceActionId: null,
      phaseIds: challenge.phaseIds
        .map((phaseId) => phaseIdBySource.get(phaseId))
        .filter((phaseId): phaseId is PhaseId => phaseId !== undefined),
    })),
    phases: source.phases.map((phase) => ({
      ...phase,
      id: phaseIdBySource.get(phase.id) ?? asPhaseId(ctx.ids.uuid()),
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
