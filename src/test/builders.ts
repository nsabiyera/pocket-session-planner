import { CarryForwardActionSchema, type CarryForwardAction } from '@/domain/carry-forward';
import {
  ChallengeEventSchema,
  PlayerChallengeSchema,
  type ChallengeEvent,
  type PlayerChallenge,
} from '@/domain/challenge';
import {
  CapabilityScanSchema,
  emptyCapabilityNotes,
  emptyCapabilityRatings,
  type CapabilityScan,
} from '@/domain/capabilities/scan';
import { CoachingPointSchema, type CoachingPoint } from '@/domain/coaching-point';
import {
  asCapabilityScanId,
  asCarryForwardActionId,
  asChallengeEventId,
  asChallengeId,
  asCoachingPointId,
  asObservationId,
  asPhaseId,
  asPlayerAssessmentId,
  asPlayerId,
  asReviewId,
  asSessionId,
  asSquadId,
  type ChallengeId,
  type PhaseId,
  type PlayerId,
  type SquadId,
} from '@/domain/ids';
import { InterventionPlanSchema, type InterventionPlan } from '@/domain/intervention';
import { ObservationSchema, type Observation } from '@/domain/observation';
import { PlayerSchema, type Player } from '@/domain/player';
import {
  emptyCornerNotes,
  emptyCornerRatings,
  PlayerAssessmentSchema,
  type PlayerAssessment,
} from '@/domain/player-assessment';
import { CURRENT_SCHEMA_VERSION, isoDateTime, type IsoDateTime } from '@/domain/primitives';
import { SessionReviewSchema, type SessionReview } from '@/domain/review';
import {
  SessionSchema,
  SessionPhaseSchema,
  type Session,
  type SessionPhase,
} from '@/domain/session';
import { SquadSchema, type Squad } from '@/domain/squad';

/**
 * Builders for tests. Every id is deterministic and derived from a short label, so a failing
 * assertion prints `…-warmup` rather than a UUID nobody can place.
 */

/**
 * A stable v4-shaped UUID derived from a human label, so `aPlayer('kai')` yields the same id
 * in every test that mentions Kai. FNV-1a because it is four lines and deterministic — the
 * ids must be *hex*, so the label cannot simply be embedded.
 */
export function testId(label: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const tail = hash.toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-0000${tail}`;
}

export const T0 = isoDateTime('2026-08-31T18:00:00.000Z');

const meta = (at: IsoDateTime = T0) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  createdAt: at,
  updatedAt: at,
});

export const SQUAD_ID = asSquadId(testId('squad1'));

export function aSquad(over: Partial<Squad> = {}): Squad {
  return SquadSchema.parse({
    ...meta(),
    id: SQUAD_ID,
    name: 'U12 Reds',
    ageGroup: 'U12',
    defaultSessionDurationMin: 60,
    ...over,
  });
}

export function aPlayer(label: string, over: Partial<Player> = {}): Player {
  return PlayerSchema.parse({
    ...meta(),
    id: asPlayerId(testId(label)),
    squadId: SQUAD_ID,
    name: label.charAt(0).toUpperCase() + label.slice(1),
    ...over,
  });
}

export function playerId(label: string): PlayerId {
  return asPlayerId(testId(label));
}

export function phaseId(label: string): PhaseId {
  return asPhaseId(testId(label));
}

export function aCoachingPoint(label: string, over: Partial<CoachingPoint> = {}): CoachingPoint {
  return CoachingPointSchema.parse({
    id: asCoachingPointId(testId(label)),
    text: `Coaching point ${label}`,
    source: 'methodology',
    ...over,
  });
}

export function challengeId(label: string): ChallengeId {
  return asChallengeId(testId(label));
}

/**
 * A counted challenge with a target of 3 for Kai, unless told otherwise. Counted rather than
 * judged because the tally is the half with arithmetic in it.
 */
export function aChallenge(label: string, over: Partial<PlayerChallenge> = {}): PlayerChallenge {
  return PlayerChallengeSchema.parse({
    id: asChallengeId(testId(label)),
    playerId: asPlayerId(testId('kai')),
    text: `Challenge ${label}`,
    measure: 'count',
    targetCount: 3,
    source: 'coach',
    ...over,
  });
}

/** One sighting, in the `warmup` phase unless told otherwise. */
export function aChallengeEvent(label: string, over: Partial<ChallengeEvent> = {}): ChallengeEvent {
  return ChallengeEventSchema.parse({
    id: asChallengeEventId(testId(label)),
    challengeId: asChallengeId(testId('challenge1')),
    phaseId: asPhaseId(testId('warmup')),
    at: T0,
    ...over,
  });
}

export function anInterventionPlan(over: Partial<InterventionPlan> = {}): InterventionPlan {
  return InterventionPlanSchema.parse({
    method: 'observation_feedback',
    mechanic: 'in_flow',
    ...over,
  });
}

export function aPhase(label: string, over: Partial<SessionPhase> = {}): SessionPhase {
  return SessionPhaseSchema.parse({
    id: asPhaseId(testId(label)),
    order: 0,
    kind: 'skill_practice',
    title: label,
    plannedDurationMin: 20,
    ...over,
  });
}

export function aSession(over: Partial<Session> = {}): Session {
  return SessionSchema.parse({
    ...meta(),
    id: asSessionId(testId('session1')),
    squadId: SQUAD_ID,
    title: 'Playing out from the back · 31 Aug',
    objective: { text: 'Playing out from the back', successCriteria: [] },
    methodology: {
      methodologyId: 'play-practice-play',
      name: 'Play-Practice-Play',
      coachStance: 'guided',
      version: 1,
      originKind: 'builtin',
      referenceDurationMin: 60,
      capturedAt: T0,
    },
    intervention: anInterventionPlan(),
    focusPlayers: [],
    phases: [aPhase('warmup', { order: 0, kind: 'warm_up', plannedDurationMin: 10 })],
    plannedDurationMin: 60,
    scheduledFor: T0,
    status: 'draft',
    ...over,
  });
}

export function anObservation(label: string, over: Partial<Observation> = {}): Observation {
  return ObservationSchema.parse({
    ...meta(),
    id: asObservationId(testId(label)),
    sessionId: asSessionId(testId('session1')),
    squadId: SQUAD_ID,
    phaseId: asPhaseId(testId('warmup')),
    at: T0,
    kind: 'strength',
    ...over,
  });
}

export function anAssessment(
  label: string,
  over: Partial<PlayerAssessment> = {},
): PlayerAssessment {
  return PlayerAssessmentSchema.parse({
    ...meta(),
    id: asPlayerAssessmentId(testId(label)),
    playerId: asPlayerId(testId('kai')),
    squadId: SQUAD_ID,
    assessedAt: T0,
    ratings: emptyCornerRatings(),
    notes: emptyCornerNotes(),
    ...over,
  });
}

/** A turning scan of Kai with nothing rated yet, unless told otherwise. */
export function aScan(label: string, over: Partial<CapabilityScan> = {}): CapabilityScan {
  return CapabilityScanSchema.parse({
    ...meta(),
    id: asCapabilityScanId(testId(label)),
    playerId: asPlayerId(testId('kai')),
    squadId: SQUAD_ID,
    skill: 'turning',
    scannedAt: T0,
    ratings: emptyCapabilityRatings(),
    notes: emptyCapabilityNotes(),
    ...over,
  });
}

export function aReview(over: Partial<SessionReview> = {}): SessionReview {
  return SessionReviewSchema.parse({
    ...meta(),
    id: asReviewId(testId('review1')),
    sessionId: asSessionId(testId('session1')),
    squadId: SQUAD_ID,
    completedAt: T0,
    objectiveOutcome: 'met',
    ...over,
  });
}

export function anAction(
  label: string,
  over: Partial<CarryForwardAction> = {},
): CarryForwardAction {
  const kind = over.kind ?? 'reminder';
  return CarryForwardActionSchema.parse({
    ...meta(),
    id: asCarryForwardActionId(testId(label)),
    squadId: SQUAD_ID,
    kind,
    title: `Action ${label}`,
    payload: over.payload ?? { kind: 'reminder', text: `Action ${label}` },
    originSessionId: asSessionId(testId('session1')),
    ...over,
  });
}

export function squadId(): SquadId {
  return SQUAD_ID;
}
