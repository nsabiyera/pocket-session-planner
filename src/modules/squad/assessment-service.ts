import { err, ok, type Result } from '@/lib/result';
import {
  asPlayerAssessmentId,
  type PlayerAssessmentId,
  type PlayerId,
  type SessionId,
  type SquadId,
} from '@/domain/ids';
import type { FourCorner } from '@/domain/four-corners';
import {
  cornerBalance,
  suggestNeglectedCorner,
  type CornerBalance,
} from '@/domain/four-corners/balance';
import {
  cornerDeltas,
  emptyCornerNotes,
  emptyCornerRatings,
  PlayerAssessmentSchema,
  type CornerDelta,
  type CornerNotes,
  type CornerRatings,
  type PlayerAssessment,
} from '@/domain/player-assessment';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { now, type ServiceContext } from '../context';

/**
 * The FA 4 Corner Model, as the coach actually meets it.
 *
 * Two halves, deliberately different in cost:
 *
 *  - **The balance report is free.** It is derived from observations the coach already logs,
 *    and it answers "am I developing a whole player or a quarter of one".
 *  - **The assessment is deliberate.** Four taps, occasionally, to record a judgement the
 *    observations cannot make on their own: *where is this player now.*
 */

export type AssessmentError = { kind: 'player_not_found' } | { kind: 'assessment_not_found' };

export interface RecordAssessmentInput {
  playerId: PlayerId;
  ratings?: Partial<CornerRatings>;
  notes?: Partial<CornerNotes>;
  focusCorner?: FourCorner | null;
  sessionId?: SessionId | null;
}

export async function recordAssessment(
  ctx: ServiceContext,
  input: RecordAssessmentInput,
): Promise<Result<PlayerAssessment, AssessmentError>> {
  const player = await ctx.store.players.get(input.playerId);
  if (!player) return err({ kind: 'player_not_found' });

  const at = now(ctx);
  const assessment = PlayerAssessmentSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    id: asPlayerAssessmentId(ctx.ids.uuid()),
    playerId: player.id,
    squadId: player.squadId,
    assessedAt: at,
    // A half-finished assessment is still worth keeping — a coach who only has a view on two
    // corners today should not be forced to invent the other two.
    ratings: { ...emptyCornerRatings(), ...input.ratings },
    notes: { ...emptyCornerNotes(), ...input.notes },
    focusCorner: input.focusCorner ?? null,
    sessionId: input.sessionId ?? null,
  });

  await ctx.store.assessments.put(assessment);
  return ok(assessment);
}

export async function updateAssessment(
  ctx: ServiceContext,
  assessmentId: PlayerAssessmentId,
  changes: {
    ratings?: Partial<CornerRatings>;
    notes?: Partial<CornerNotes>;
    focusCorner?: FourCorner | null;
  },
): Promise<Result<PlayerAssessment, AssessmentError>> {
  const current = await ctx.store.assessments.get(assessmentId);
  if (!current) return err({ kind: 'assessment_not_found' });

  const next = PlayerAssessmentSchema.parse({
    ...current,
    ratings: { ...current.ratings, ...changes.ratings },
    notes: { ...current.notes, ...changes.notes },
    focusCorner: changes.focusCorner === undefined ? current.focusCorner : changes.focusCorner,
    updatedAt: now(ctx),
  });

  await ctx.store.assessments.put(next);
  return ok(next);
}

/** Everything the player profile's 4 Corner panel needs, in one round trip. */
export interface CornerProfile {
  readonly balance: CornerBalance;
  readonly latest: PlayerAssessment | null;
  readonly previous: PlayerAssessment | null;
  /** What moved between the two most recent assessments. Empty when there is no pair. */
  readonly deltas: CornerDelta[];
  readonly history: PlayerAssessment[];
  /** The corner the app would nudge towards, or null when the spread is reasonable. */
  readonly suggestion: FourCorner | null;
}

export async function loadCornerProfile(
  ctx: ServiceContext,
  playerId: PlayerId,
): Promise<CornerProfile> {
  const [observations, history] = await Promise.all([
    ctx.store.observations.listByPlayer(playerId, { limit: 500 }),
    ctx.store.assessments.listByPlayer(playerId, { limit: 20 }),
  ]);

  const balance = cornerBalance(observations);
  const latest = history[0] ?? null;
  const previous = history[1] ?? null;

  return {
    balance,
    latest,
    previous,
    deltas: latest && previous ? cornerDeltas(previous, latest) : [],
    history,
    suggestion: suggestNeglectedCorner(balance),
  };
}

/**
 * The same report for a whole squad — which corner is the *coach* neglecting, as opposed to
 * neglecting for one player.
 *
 * This is often the more useful of the two. A coach who never logs anything social is not
 * doing it selectively; they are doing it to everyone.
 */
export async function loadSquadCornerBalance(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<CornerBalance> {
  const observations = await ctx.store.observations.listBySquad(squadId, { limit: 2000 });
  return cornerBalance(observations);
}
