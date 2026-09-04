import { err, ok, type Result } from '@/lib/result';
import {
  MAX_CHALLENGES_PER_SESSION,
  PlayerChallengeSchema,
  type ChallengeMeasure,
  type PlayerChallenge,
} from '@/domain/challenge';
import type { FourCorner } from '@/domain/four-corners';
import {
  asChallengeId,
  type ChallengeId,
  type PhaseId,
  type PlayerId,
  type SessionId,
} from '@/domain/ids';
import { SessionSchema, type Session } from '@/domain/session';
import { now, type ServiceContext } from '../context';

/**
 * Authoring player challenges — the `/plan/challenges` detour.
 *
 * Plan-time writes, so they live here rather than in the state machine, for the same reason
 * `updatePhase` does: they are not transitions, they need no run, and the schema is what
 * enforces their invariants. The run-time half — logging a sighting, ruling on the outcome —
 * is in `run-service` and goes through the reducer.
 *
 * These deliberately carry **no status guard**. A coach who wants to add a challenge to a
 * session already under way is a coach who just thought of something, and refusing that is
 * refusing the whole point. `updatePhase` takes the same position.
 */

export type ChallengeError =
  | { kind: 'session_not_found' }
  | { kind: 'challenge_not_found' }
  | { kind: 'too_many'; max: number }
  | { kind: 'unknown_phase'; phaseId: PhaseId };

export interface AddChallengeInput {
  playerId: PlayerId;
  text: string;
  /** Defaults to `count` with a target of 1 — the shape of nearly every challenge set. */
  measure?: ChallengeMeasure;
  targetCount?: number | null;
  /** Empty or omitted means the challenge is live for the whole session. */
  phaseIds?: readonly PhaseId[];
  corner?: FourCorner | null;
}

/**
 * One challenge, one player.
 *
 * A player may hold more than one — a coach who has two things to say to the same player is
 * not doing anything wrong — but the editor puts them one per row, because the useful default
 * is *one thing to think about* and a screen that encourages six is a screen that produces
 * none of them being watched.
 */
export async function addChallenge(
  ctx: ServiceContext,
  sessionId: SessionId,
  input: AddChallengeInput,
): Promise<Result<Session, ChallengeError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  if (current.challenges.length >= MAX_CHALLENGES_PER_SESSION) {
    return err({ kind: 'too_many', max: MAX_CHALLENGES_PER_SESSION });
  }

  const unknown = unknownPhase(current, input.phaseIds ?? []);
  if (unknown) return err({ kind: 'unknown_phase', phaseId: unknown });

  const measure = input.measure ?? 'count';
  const challenge = PlayerChallengeSchema.parse({
    id: asChallengeId(ctx.ids.uuid()),
    playerId: input.playerId,
    text: input.text,
    measure,
    // A counted challenge always needs a target and a judged one must not have one; default
    // rather than make the caller remember which.
    targetCount: measure === 'judged' ? null : (input.targetCount ?? 1),
    phaseIds: [...(input.phaseIds ?? [])],
    corner: input.corner ?? null,
    source: 'coach',
  });

  return write(ctx, { ...current, challenges: [...current.challenges, challenge] });
}

export interface UpdateChallengeInput {
  text?: string;
  measure?: ChallengeMeasure;
  targetCount?: number | null;
  phaseIds?: readonly PhaseId[];
  corner?: FourCorner | null;
  note?: string;
}

export async function updateChallenge(
  ctx: ServiceContext,
  sessionId: SessionId,
  challengeId: ChallengeId,
  changes: UpdateChallengeInput,
): Promise<Result<Session, ChallengeError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const existing = current.challenges.find((challenge) => challenge.id === challengeId);
  if (!existing) return err({ kind: 'challenge_not_found' });

  if (changes.phaseIds !== undefined) {
    const unknown = unknownPhase(current, changes.phaseIds);
    if (unknown) return err({ kind: 'unknown_phase', phaseId: unknown });
  }

  const measure = changes.measure ?? existing.measure;
  // Switching to `judged` drops the target and switching to `count` needs one, so the target
  // is resolved from the *resulting* measure rather than carried over blindly.
  const targetCount =
    measure === 'judged'
      ? null
      : (changes.targetCount ?? (existing.targetCount === null ? 1 : existing.targetCount));

  const next = PlayerChallengeSchema.parse({
    ...existing,
    ...(changes.text !== undefined ? { text: changes.text } : {}),
    ...(changes.corner !== undefined ? { corner: changes.corner } : {}),
    ...(changes.note !== undefined ? { note: changes.note } : {}),
    ...(changes.phaseIds !== undefined ? { phaseIds: [...changes.phaseIds] } : {}),
    measure,
    targetCount,
  });

  return write(ctx, {
    ...current,
    challenges: current.challenges.map((challenge) =>
      challenge.id === challengeId ? next : challenge,
    ),
  });
}

/**
 * Removes the challenge **and every sighting logged against it**.
 *
 * Both halves are required: the session schema rejects a `ChallengeEvent` whose challenge is
 * gone, so dropping only the challenge would make the session unwritable. Deleting evidence
 * is normally the wrong instinct, but a challenge the coach has removed is one they are
 * saying they never meant to set, and leaving orphaned sightings in the export would be
 * claiming they watched for something they had deleted.
 */
export async function removeChallenge(
  ctx: ServiceContext,
  sessionId: SessionId,
  challengeId: ChallengeId,
): Promise<Result<Session, ChallengeError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });
  if (!current.challenges.some((challenge) => challenge.id === challengeId)) {
    return err({ kind: 'challenge_not_found' });
  }

  const run = current.run;
  return write(ctx, {
    ...current,
    challenges: current.challenges.filter((challenge) => challenge.id !== challengeId),
    run:
      run === null
        ? null
        : {
            ...run,
            challengeEvents: run.challengeEvents.filter(
              (event) => event.challengeId !== challengeId,
            ),
          },
  });
}

/**
 * Drops challenges for players who are no longer in the squad.
 *
 * Called when a player is archived. A challenge nobody can be judged on is dead weight on
 * the Do screen, and the coach will not thank anyone for a row reading "undefined · three
 * forward passes".
 */
export async function pruneChallengesForPlayer(
  ctx: ServiceContext,
  sessionId: SessionId,
  playerId: PlayerId,
): Promise<Result<Session, ChallengeError>> {
  const current = await ctx.store.sessions.get(sessionId);
  if (!current) return err({ kind: 'session_not_found' });

  const doomed = new Set(
    current.challenges
      .filter((challenge) => challenge.playerId === playerId)
      .map((challenge) => challenge.id as string),
  );
  if (doomed.size === 0) return ok(current);

  const run = current.run;
  return write(ctx, {
    ...current,
    challenges: current.challenges.filter((challenge) => !doomed.has(challenge.id)),
    run:
      run === null
        ? null
        : {
            ...run,
            challengeEvents: run.challengeEvents.filter((event) => !doomed.has(event.challengeId)),
          },
  });
}

function unknownPhase(session: Session, phaseIds: readonly PhaseId[]): PhaseId | undefined {
  const known = new Set(session.phases.map((phase) => phase.id as string));
  return phaseIds.find((phaseId) => !known.has(phaseId));
}

/** Parse-then-persist, so a broken invariant fails here rather than on the next read. */
async function write(
  ctx: ServiceContext,
  session: Session,
): Promise<Result<Session, ChallengeError>> {
  const next = SessionSchema.parse({ ...session, updatedAt: now(ctx) });
  await ctx.store.sessions.put(next);
  return ok(next);
}

/** Challenges grouped by player, for the editor. Players with none are included, empty. */
export function challengesByPlayer(
  session: Session,
  playerIds: readonly PlayerId[],
): Map<PlayerId, PlayerChallenge[]> {
  const grouped = new Map<PlayerId, PlayerChallenge[]>(playerIds.map((id) => [id, []]));
  for (const challenge of session.challenges) {
    const existing = grouped.get(challenge.playerId);
    if (existing) existing.push(challenge);
    else grouped.set(challenge.playerId, [challenge]);
  }
  return grouped;
}
