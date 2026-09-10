import { err, isErr, ok, type Result } from '@/lib/result';
import {
  asChallengeEventId,
  asInterventionEventId,
  asObservationId,
  asPracticeAdjustmentId,
  type ChallengeId,
  type ObservationId,
  type PhaseId,
  type PlayerId,
  type PracticeAdjustmentId,
  type SessionId,
} from '@/domain/ids';
import type { ChallengeStatus } from '@/domain/challenge';
import type { MatchResult, MatchUnit } from '@/domain/match-day';
import type { EffortQuality } from '@/domain/morphocycle';
import { SessionSchema } from '@/domain/session';
import type { AdjustmentDirection, StepLetter } from '@/domain/practice';
import { coachingPointsMatch, normaliseCoachingPointText } from '@/domain/coaching-point';
import {
  CAPABILITY_TAG_CORNER,
  CAPABILITY_TAGS,
  capabilityForTag,
  type ActionMoment,
} from '@/domain/capabilities';
import {
  challengeSummary,
  sessionChallengeProgress,
  type ChallengeProgress,
  type ChallengeSummary,
} from '@/domain/session/challenges';
import {
  attributeForTag,
  CORNER_ATTRIBUTES,
  FOUR_CORNERS,
  type CornerAttribute,
  type FourCorner,
} from '@/domain/four-corners';
import type {
  InterventionAudience,
  InterventionMechanic,
  InterventionMethod,
} from '@/domain/intervention';
import {
  ObservationSchema,
  OBSERVATION_RATING_KIND,
  OBSERVATION_RATING_VALUE,
  type Observation,
  type ObservationRatingKind,
} from '@/domain/observation';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { currentPhase, currentPhaseRun } from '@/domain/session/selectors';
import {
  applySessionCommand,
  type SessionCommand,
  type TransitionError,
} from '@/domain/session/state-machine';
import { phaseElapsedMs } from '@/domain/session/timer';
import type { Session } from '@/domain/session';
import { writeResumeMirror, clearResumeMirror } from '@/lib/resume-mirror';
import { now, type ServiceContext } from '../context';

/**
 * Do mode's backend.
 *
 * Two rules govern everything here:
 *
 *  - **Write-through.** Every timer command persists *before* the UI re-renders, so a crash
 *    loses at most one frame. There is no debounce, no batching and no optimistic layer.
 *  - **Observations persist immediately**, as their own records. A coach logging three
 *    observations in ten seconds while the timer is also writing must not lose one to a
 *    read-modify-write race on a multi-KB session document.
 */

export type RunError =
  | { kind: 'session_not_found' }
  /** Load labelling on a youth squad. The safeguarding gate on `Squad.level` (ADR 0007). */
  | { kind: 'not_allowed' }
  | { kind: 'no_active_session' }
  | { kind: 'no_current_phase' }
  | { kind: 'transition'; error: TransitionError };

/**
 * Applies a session command and persists the result.
 *
 * The `localStorage` mirror is refreshed on the same call, so a cold start immediately after
 * any command can paint `Resume — Main practice, 8:42 left` before IndexedDB opens.
 */
export async function dispatch(
  ctx: ServiceContext,
  sessionId: SessionId,
  command: SessionCommand,
): Promise<Result<Session, RunError>> {
  const session = await ctx.store.sessions.get(sessionId);
  if (!session) return err({ kind: 'session_not_found' });

  const applied = applySessionCommand(session, command, now(ctx));
  if (!applied.ok) return err({ kind: 'transition', error: applied.error });

  await ctx.store.sessions.put(applied.value);
  await syncActivePointer(ctx, applied.value);

  return ok(applied.value);
}

/** Keeps `app_meta` and the synchronous mirror in step with the session's real state. */
async function syncActivePointer(ctx: ServiceContext, session: Session): Promise<void> {
  const at = now(ctx);
  const stillActive =
    session.status === 'draft' || session.status === 'planned' || session.status === 'in_progress';

  await ctx.store.meta.patch(
    { activeSessionId: stillActive ? session.id : null, activeSquadId: session.squadId },
    at,
  );

  if (!stillActive) {
    clearResumeMirror();
    return;
  }

  const phase = currentPhase(session);
  const phaseRun = currentPhaseRun(session);

  writeResumeMirror({
    activeSessionId: session.id,
    squadId: session.squadId,
    sessionTitle: session.title,
    phaseTitle: phase?.title ?? null,
    status: session.status,
    phaseRunningSince: phaseRun?.runningSince ?? null,
    phaseAccumulatedMs: phaseRun?.accumulatedMs ?? null,
    phasePlannedMs: phase ? phase.plannedDurationMin * 60_000 : null,
    updatedAt: at,
  });
}

export interface LogInterventionInput {
  method?: InterventionMethod;
  mechanic?: InterventionMechanic;
  audience?: InterventionAudience;
  playerIds?: readonly PlayerId[];
  note?: string;
}

/**
 * `✋ Intervene` — one tap.
 *
 * Everything is pre-filled from the phase's planned intervention, because the overwhelmingly
 * common case is the coach doing what they said they would, and that must not cost a form.
 * The long-press sheet supplies overrides through the same call.
 */
export async function logIntervention(
  ctx: ServiceContext,
  sessionId: SessionId,
  input: LogInterventionInput = {},
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, {
    kind: 'logIntervention',
    id: asInterventionEventId(ctx.ids.uuid()),
    ...input,
  });
}

export interface LogObservationInput {
  sessionId: SessionId;
  /** Omitted entirely for a team-wide note — never null. See ADR 0001. */
  playerId?: PlayerId;
  ratingKind?: ObservationRatingKind;
  tags?: readonly string[];
  text?: string;
  phaseId?: PhaseId;
  /**
   * The FA 4 Corner Model corner. Rarely passed explicitly — it is normally *inferred* from
   * the tag the coach tapped, which is what keeps logging at two taps.
   */
  corner?: FourCorner;
  attribute?: string;
  /**
   * Which part of the action the coach was watching. Never inferred — nothing in a tag says
   * whether they were watching the scan or the touch — so it arrives only when the coach
   * chose it on the sheet.
   */
  actionMoment?: ActionMoment;
  /** When the observation was logged against a specific coaching point, it inherits its corner. */
  coachingPointId?: string;
}

/**
 * Two taps: a focus-player chip, then one of `Good` / `Working` / `Struggled`.
 *
 * Written straight away as its own record. If the coach taps `Undo` on the toast we delete
 * it; we do not hold it in memory waiting to find out.
 */
export async function logObservation(
  ctx: ServiceContext,
  input: LogObservationInput,
): Promise<Result<Observation, RunError>> {
  const session = await ctx.store.sessions.get(input.sessionId);
  if (!session) return err({ kind: 'session_not_found' });

  const phase = input.phaseId
    ? session.phases.find((p) => p.id === input.phaseId)
    : currentPhase(session);
  if (!phase) return err({ kind: 'no_current_phase' });

  const at = now(ctx);
  const phaseRun = currentPhaseRun(session);
  const elapsed = phaseRun ? phaseElapsedMs(phaseRun, ctx.clock.now()) : 0;

  // Corner resolution, cheapest signal first: what the caller said, then the attribute the
  // tapped tag maps to, then the coaching point the observation was logged against. An
  // untagged note stays unclassified rather than being filed under a guess.
  const tagged = (input.tags ?? [])
    .map((tag) => attributeForTag(tag))
    .find((attribute): attribute is CornerAttribute => attribute !== undefined);

  /*
    **Recovering the coaching point from the tag**, which is what makes the did-it-stick join
    possible at all.

    The observation sheet's "This phase" group *is* this phase's coaching points, offered as
    their own text — so a coach who taps one has already told us which point they mean, and
    the id was simply being thrown away (`docs/known-issues.md` 3). This is recovery, not
    inference: the strings are the same strings, compared with the same normalisation the
    carry-forward dedupe uses.

    Scoped to this phase's points, so two phases carrying the same wording cannot cross over.
    An explicit `coachingPointId` from a caller still wins.
  */
  const point = input.coachingPointId
    ? phase.coachingPoints.find((candidate) => candidate.id === input.coachingPointId)
    : phase.coachingPoints.find((candidate) =>
        (input.tags ?? []).some((tag) => coachingPointsMatch(tag, candidate.text)),
      );

  // A capability tag carries no attribute, so it needs its own corner. Last in the chain:
  // an attribute that maps to the same word (`Positioning`) still decides for itself.
  const capabilityTagged = (input.tags ?? []).some((tag) => capabilityForTag(tag) !== undefined);

  const corner =
    input.corner ??
    tagged?.corner ??
    point?.corner ??
    (capabilityTagged ? CAPABILITY_TAG_CORNER : undefined);
  const attribute = input.attribute ?? tagged?.id;

  const observation = ObservationSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    id: asObservationId(ctx.ids.uuid()),
    sessionId: session.id,
    squadId: session.squadId,
    // Spread, so an unclassified observation has no `corner` key at all and stays out of
    // the `by-player-corner` index. See ADR 0001.
    ...(corner !== undefined ? { corner } : {}),
    ...(attribute !== undefined ? { attribute } : {}),
    // Same treatment: an observation the coach did not place in the action has no key at all,
    // rather than a null that would have to be told apart from a real answer.
    ...(input.actionMoment !== undefined ? { actionMoment: input.actionMoment } : {}),
    // Spread rather than assigned, so a team-wide observation has no `playerId` key at all.
    ...(input.playerId !== undefined ? { playerId: input.playerId } : {}),
    phaseId: phase.id,
    at,
    phaseElapsedMs: elapsed,
    kind: input.ratingKind ? OBSERVATION_RATING_KIND[input.ratingKind] : 'note',
    ratingKind: input.ratingKind ?? null,
    rating: input.ratingKind ? OBSERVATION_RATING_VALUE[input.ratingKind] : null,
    tags: input.tags ?? [],
    text: input.text ?? '',
    // Resolved above from the tag when the caller did not name one — see the comment there.
    coachingPointId: point?.id ?? null,
  });

  await ctx.store.observations.put(observation);
  return ok(observation);
}

/**
 * The `Logged for Maya · Undo` toast.
 *
 * A hard delete, not a soft one: a mis-tap seconds ago is not history, and leaving a
 * tombstone would make the chip count wrong.
 */
export async function undoObservation(
  ctx: ServiceContext,
  observationId: ObservationId,
): Promise<void> {
  await ctx.store.observations.hardDelete(observationId);
}

/**
 * `+1` on a challenge row — the coach saw the thing they asked for.
 *
 * One tap, no sheet, no confirmation. The whole value of a challenge is that it gets counted
 * in the two seconds between the pass landing and the next phase of play, and anything more
 * than a single tap means it does not get counted at all.
 */
export async function logChallengeProgress(
  ctx: ServiceContext,
  sessionId: SessionId,
  challengeId: ChallengeId,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, {
    kind: 'logChallengeProgress',
    id: asChallengeEventId(ctx.ids.uuid()),
    challengeId,
  });
}

/** The `Undo` on the `+1` toast. Pops the most recent sighting, never a counter. */
export async function undoChallengeProgress(
  ctx: ServiceContext,
  sessionId: SessionId,
  challengeId: ChallengeId,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'undoChallengeProgress', challengeId });
}

/**
 * *"Made it harder"* / *"Made it easier"* — one tap, mid-practice.
 *
 * `text` is the planned progression as written, frozen into the event, or empty when the
 * coach changed something they had never written down. Both are worth recording and the
 * second one is the more interesting.
 *
 * **Returns the id it minted**, unlike `logChallengeProgress`, because the Undo on the toast
 * has to name the exact adjustment: the two directions sit side by side in Do mode, and
 * popping "the last one" would remove the *easier* when the coach mis-tapped *harder*.
 */
export async function logPracticeAdjustment(
  ctx: ServiceContext,
  sessionId: SessionId,
  direction: AdjustmentDirection,
  text = '',
  /** The STEP letter, when the tap came off a constraint the coach had written down. */
  step?: StepLetter,
): Promise<Result<{ session: Session; id: PracticeAdjustmentId }, RunError>> {
  const id = asPracticeAdjustmentId(ctx.ids.uuid());
  const result = await dispatch(ctx, sessionId, {
    kind: 'logPracticeAdjustment',
    id,
    direction,
    text,
    ...(step === undefined ? {} : { step }),
  });
  return isErr(result) ? result : ok({ session: result.value, id });
}

/**
 * Who was on the pitch for one period of a match.
 *
 * The whole minutes report rests on this one interaction, so it is deliberately the cheapest
 * thing on the screen: the squad, tapped, once per period.
 */
export async function setPeriodPresence(
  ctx: ServiceContext,
  sessionId: SessionId,
  phaseId: PhaseId,
  playerIds: readonly PlayerId[],
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'setPeriodPresence', phaseId, playerIds });
}

/**
 * The score, at review. `null` clears it.
 *
 * Lives in the run service beside the other match writes rather than in review, because it is
 * the same session document and the same dispatch path.
 */
export async function setMatchResult(
  ctx: ServiceContext,
  sessionId: SessionId,
  result: MatchResult | null,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'setMatchResult', result });
}

/** Writes or replaces what a unit is being asked to do. Empty text removes it. */
export async function setUnitObjective(
  ctx: ServiceContext,
  sessionId: SessionId,
  unit: MatchUnit,
  text: string,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'setUnitObjective', unit, text });
}

/** The coach's ruling on a unit's objective. Re-tapping the same verdict clears it. */
export async function setUnitObjectiveStatus(
  ctx: ServiceContext,
  sessionId: SessionId,
  unit: MatchUnit,
  status: ChallengeStatus,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'setUnitObjectiveStatus', unit, status });
}

/**
 * The morphocycle emphasis a coach put on a session (ADR 0007, Phase 4).
 *
 * A label, not a measurement. Refused on a youth squad — the safeguarding gate lives on
 * `Squad.level`, and a service that trusted the UI to enforce it would be one deep link away
 * from putting adult load concepts against a squad of eleven-year-olds.
 */
export async function setEffortQuality(
  ctx: ServiceContext,
  sessionId: SessionId,
  effortQuality: EffortQuality | null,
): Promise<Result<Session, RunError>> {
  const session = await ctx.store.sessions.get(sessionId);
  if (!session) return err({ kind: 'session_not_found' });

  const squad = await ctx.store.squads.get(session.squadId);
  if (effortQuality !== null && squad?.level !== 'senior') {
    return err({ kind: 'not_allowed' });
  }

  const parsed = SessionSchema.safeParse({ ...session, effortQuality, updatedAt: now(ctx) });
  if (!parsed.success) return err({ kind: 'session_not_found' });

  await ctx.store.sessions.put(parsed.data);
  return ok(parsed.data);
}

/** The `Undo` on the adjustment toast. By id — see the note above. */
export async function undoPracticeAdjustment(
  ctx: ServiceContext,
  sessionId: SessionId,
  id: PracticeAdjustmentId,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'undoPracticeAdjustment', id });
}

/**
 * The coach's ruling — met, partly, missed, or back to `open`.
 *
 * Works after the session is finished as well as during it, because ruling on a challenge is
 * a natural part of Review and the state machine deliberately puts no run guard on it.
 */
export async function setChallengeStatus(
  ctx: ServiceContext,
  sessionId: SessionId,
  challengeId: ChallengeId,
  status: ChallengeStatus,
  note?: string,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, {
    kind: 'setChallengeStatus',
    challengeId,
    status,
    ...(note !== undefined ? { note } : {}),
  });
}

/**
 * **What the player said about their challenge** (ADR 0009 phase 7).
 *
 * Its own call rather than a second argument to `setChallengeStatus`, because the quote is
 * independent of the verdict: writing one down must never disturb a ruling the coach already
 * gave, and a coach can be told what a player thought before ruling, after, or instead.
 *
 * Stored verbatim. Nothing in the app reads anything out of it beyond the words.
 */
export async function setChallengePlayerWord(
  ctx: ServiceContext,
  sessionId: SessionId,
  challengeId: ChallengeId,
  said: string,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'setChallengePlayerWord', challengeId, said });
}

/** Everything `/run` needs for one repaint, in one round trip. */
export interface RunSnapshot {
  session: Session;
  observations: Observation[];
  /** Observation counts for the current phase, keyed by player — drives the chip badges. */
  phaseCountsByPlayer: Map<PlayerId, number>;
  /** Derived challenge state, still-open and furthest from target first. */
  challenges: ChallengeProgress[];
  challengeSummary: ChallengeSummary;
}

export async function loadRunSnapshot(
  ctx: ServiceContext,
  sessionId: SessionId,
): Promise<Result<RunSnapshot, RunError>> {
  const session = await ctx.store.sessions.get(sessionId);
  if (!session) return err({ kind: 'session_not_found' });

  const observations = await ctx.store.observations.listBySession(sessionId);
  const phase = currentPhase(session);

  const phaseCountsByPlayer = new Map<PlayerId, number>();
  for (const observation of observations) {
    if (observation.playerId === undefined) continue;
    if (phase && observation.phaseId !== phase.id) continue;
    phaseCountsByPlayer.set(
      observation.playerId,
      (phaseCountsByPlayer.get(observation.playerId) ?? 0) + 1,
    );
  }

  return ok({
    session,
    observations,
    phaseCountsByPlayer,
    challenges: sessionChallengeProgress(session, phase?.id),
    challengeSummary: challengeSummary(session),
  });
}

/**
 * Called every ~30 seconds while a session runs.
 *
 * Cheap, and the only thing standing between a forgotten session and a history entry
 * claiming a five-hour drill. If the gap since the last heartbeat is large, `/run` offers
 * the reconciliation sheet instead of silently carrying on.
 */
export async function heartbeat(
  ctx: ServiceContext,
  sessionId: SessionId,
): Promise<Result<Session, RunError>> {
  return dispatch(ctx, sessionId, { kind: 'heartbeat' });
}

/**
 * The observation sheet's tag bank, grouped by corner.
 *
 * This grouping is the whole mechanism behind corner tracking. The coach is already tapping
 * a tag to say what they saw; presenting those tags under four headings means the corner is
 * captured as a side effect rather than as a third decision — **and** it makes the empty
 * corner visible at the moment of logging, not just in the report afterwards.
 */
export interface ObservationTagGroup {
  /** `null` for this phase's own coaching points, which may not map to a corner. */
  readonly corner: FourCorner | null;
  readonly label: string;
  readonly tags: readonly string[];
}

export function observationTagGroups(session: Session, phaseId?: PhaseId): ObservationTagGroup[] {
  const phase = phaseId ? session.phases.find((p) => p.id === phaseId) : currentPhase(session);

  /*
   * **Deduped**, because a tag is a string and two identical strings are one button.
   *
   * The overlap that produced them is fixed at the source now, but sessions planned before
   * that — and any imported file — can still carry the same coaching point twice. Two
   * buttons reading "Head up before you receive" is a worse bug than the React duplicate-key
   * warning it also caused.
   */
  const pointTexts: string[] = [];
  const pointKeys = new Set<string>();
  for (const point of phase?.coachingPoints ?? []) {
    const key = normaliseCoachingPointText(point.text);
    if (pointKeys.has(key)) continue;
    pointKeys.add(key);
    pointTexts.push(point.text);
  }

  const groups: ObservationTagGroup[] = [];
  if (pointTexts.length > 0) {
    // This phase's own points come first: they are what the coach is actually looking for.
    groups.push({ corner: null, label: 'This phase', tags: pointTexts });
  }

  const used = new Set(pointTexts.map((tag) => tag.toLowerCase()));

  /*
   * **The predicted misconception, as one tag** (ADR 0009).
   *
   * This is the tag that makes a `struggled` observation mean something. *"Struggled"* on its
   * own is a shrug; *"struggled, and it was the thing we said would happen"* is a diagnosis,
   * and it is the difference between a card that can quote real evidence and one that says
   * "well done today".
   *
   * Second, directly under this phase's points, because the moment a coach reaches for the
   * sheet is usually the moment it has just gone wrong. `corner: null` and no attribute, so
   * the observation stays **unclassified** rather than being filed under a guess — the same
   * rule an untagged note follows.
   */
  const misconception = session.objective.commonMisconception?.trim() ?? '';
  if (misconception.length > 0 && !used.has(misconception.toLowerCase())) {
    groups.push({ corner: null, label: 'The mistake you expected', tags: [misconception] });
    used.add(misconception.toLowerCase());
  }

  /*
   * The FA's six core capabilities, above the corners.
   *
   * `corner: null` like this phase's points, because the group is not a corner — the corner
   * these file under is decided when the observation is written, by `CAPABILITY_TAG_CORNER`.
   *
   * They sit second because they describe the *action* the coach is watching, which is the
   * finer-grained question, and because four of the six were previously only reachable by
   * inference from an attribute that happened to mean the same thing. Deception was not
   * reachable at all.
   */
  const capabilityTags = CAPABILITY_TAGS.filter((tag) => !used.has(tag.toLowerCase()));
  if (capabilityTags.length > 0) {
    groups.push({ corner: null, label: 'Core capabilities', tags: capabilityTags });
    // Claim these names so the corner groups below drop their duplicates. `Positioning` is
    // both a capability and a technical attribute; offering the same word twice in one sheet
    // is a worse problem than losing it from the corner list, and both resolve identically.
    for (const tag of capabilityTags) used.add(tag.toLowerCase());
  }

  for (const corner of FOUR_CORNERS) {
    const tags = CORNER_ATTRIBUTES[corner]
      .map((attribute) => attribute.label)
      .filter((label) => !used.has(label.toLowerCase()));
    if (tags.length > 0) groups.push({ corner, label: cornerGroupLabel(corner), tags });
  }

  return groups;
}

function cornerGroupLabel(corner: FourCorner): string {
  return {
    technical_tactical: 'Technical / Tactical',
    physical: 'Physical',
    psychological: 'Psychological',
    social: 'Social',
  }[corner];
}

/** Flat list, kept for callers that only need something to show. */
export function observationTagsFor(session: Session, phaseId?: PhaseId): string[] {
  return observationTagGroups(session, phaseId).flatMap((group) => group.tags);
}
