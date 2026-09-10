import { MAX_ACTIONS_APPLIED_PER_SESSION, type CarryForwardAction } from '@/domain/carry-forward';
import { CoachingPointSchema } from '@/domain/coaching-point';
import {
  asCoachingPointId,
  asPhaseId,
  type CarryForwardActionId,
  type PhaseId,
} from '@/domain/ids';
import { findObjectiveTemplateByText } from '@/domain/objectives';
import { PRIORITY_ORDER } from '@/domain/primitives';
import { rescaleSessionPhases } from '@/domain/session/build-from-methodology';
import { mainPracticePhase } from '@/domain/session/selectors';
import { SessionSchema, type Session, type SessionPhase } from '@/domain/session';
import type { IdGenerator } from '@/lib/id';
import type { IsoDateTime } from '@/domain/primitives';

/**
 * Pours a set of carry-forward actions into a fresh draft.
 *
 * Pure and deterministic — the persistence half lives in the planning service, which writes
 * the draft and the action updates in **one transaction**, so a session can never end up
 * seeded from an action that still reads as open.
 */

export interface ApplyCarryForwardResult {
  session: Session;
  applied: CarryForwardActionId[];
  skipped: Array<{ id: CarryForwardActionId; reason: string }>;
}

export function applyCarryForwardActions(
  draft: Session,
  actions: readonly CarryForwardAction[],
  ctx: { ids: IdGenerator; now: IsoDateTime },
): ApplyCarryForwardResult {
  const applied: CarryForwardActionId[] = [];
  const skipped: Array<{ id: CarryForwardActionId; reason: string }> = [];

  // Highest priority first, then oldest — a point the coach has been chasing since February
  // outranks one raised last week at the same priority.
  const ordered = [...actions].sort((a, b) => {
    const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return priority !== 0 ? priority : a.createdAt.localeCompare(b.createdAt);
  });

  let session = draft;
  let objectiveTaken = false;
  let phasesChanged = false;

  for (const action of ordered) {
    // **Hard cap.** More than five carried actions buries the objective under admin, and the
    // rest simply stay open for next time.
    if (applied.length >= MAX_ACTIONS_APPLIED_PER_SESSION) {
      skipped.push({ id: action.id, reason: 'Session already has five carried actions.' });
      continue;
    }

    const payload = action.payload;
    switch (payload.kind) {
      case 'objective': {
        if (!objectiveTaken) {
          objectiveTaken = true;
          session = {
            ...session,
            objective: {
              text: payload.text,
              successCriteria: payload.successCriteria.slice(0, 5),
              sourceActionId: action.id,
              principleId: null,
              // A revisited objective keeps its predicted error, which is the case where the
              // prediction has already earned its keep once. Found by text, because that is
              // all a stored action carries — see `findObjectiveTemplateByText`.
              commonMisconception:
                findObjectiveTemplateByText(payload.text)?.commonMisconception ?? null,
            },
          };
          applied.push(action.id);
        } else {
          // A second objective action folds in as success criteria rather than fighting the
          // first — two objectives in one session is two half-sessions.
          const room = 5 - session.objective.successCriteria.length;
          if (room <= 0) {
            skipped.push({ id: action.id, reason: 'The objective already has five criteria.' });
            break;
          }
          session = {
            ...session,
            objective: {
              ...session.objective,
              successCriteria: [
                ...session.objective.successCriteria,
                ...[payload.text, ...payload.successCriteria].slice(0, room),
              ],
            },
          };
          applied.push(action.id);
        }
        break;
      }

      case 'focus_player': {
        if (session.focusPlayers.some((f) => f.playerId === payload.playerId)) {
          skipped.push({ id: action.id, reason: 'Already a focus player.' });
          break;
        }
        session = {
          ...session,
          focusPlayers: [
            ...session.focusPlayers,
            {
              playerId: payload.playerId,
              reason: payload.targetBehaviour,
              sourceActionId: action.id,
            },
          ],
        };
        applied.push(action.id);
        break;
      }

      case 'coaching_point': {
        const target = phaseForKind(session, payload.preferredPhaseKind);
        if (!target) {
          skipped.push({ id: action.id, reason: 'No phase to put this coaching point in.' });
          break;
        }
        if (target.coachingPoints.length >= 10) {
          skipped.push({ id: action.id, reason: `${target.title} already has ten points.` });
          break;
        }

        const point = CoachingPointSchema.parse({
          id: asCoachingPointId(ctx.ids.uuid()),
          text: payload.text,
          source: 'carry_forward',
          // Only players who are actually a focus of this session — the schema forbids the
          // rest, and a point aimed at someone who is not here is noise.
          playerIds: payload.playerIds.filter((id) =>
            session.focusPlayers.some((f) => f.playerId === id),
          ),
          sourceActionId: action.id,
        });

        session = {
          ...session,
          phases: session.phases.map((phase) =>
            phase.id === target.id
              ? { ...phase, coachingPoints: [...phase.coachingPoints, point] }
              : phase,
          ),
        };
        applied.push(action.id);
        break;
      }

      case 'phase': {
        if (session.phases.length >= 12) {
          skipped.push({ id: action.id, reason: 'This session already has twelve phases.' });
          break;
        }

        const insertAt = Math.min(Math.max(0, payload.originalOrder), session.phases.length);
        const fresh = freshPhase(payload.phase, session, ctx, action.id);
        const ordered = [...session.phases].sort((a, b) => a.order - b.order);
        ordered.splice(insertAt, 0, fresh);

        session = {
          ...session,
          phases: ordered.map((phase, index) => ({ ...phase, order: index })),
        };
        phasesChanged = true;
        applied.push(action.id);
        break;
      }

      case 'intervention': {
        if (payload.targetPhaseKind === null) {
          session = { ...session, intervention: payload.plan, interventionTouched: true };
        } else {
          const target = phaseForKind(session, payload.targetPhaseKind);
          if (!target) {
            skipped.push({ id: action.id, reason: 'No phase of that kind in this session.' });
            break;
          }
          session = {
            ...session,
            phases: session.phases.map((phase) =>
              phase.id === target.id ? { ...phase, intervention: payload.plan } : phase,
            ),
          };
        }
        applied.push(action.id);
        break;
      }

      case 'reminder': {
        if (session.reminders.length >= 10) {
          skipped.push({ id: action.id, reason: 'Ten reminders is already too many.' });
          break;
        }
        session = { ...session, reminders: [...session.reminders, payload.text] };
        applied.push(action.id);
        break;
      }
    }
  }

  // Inserting a phase would otherwise silently make the session eighty minutes long.
  if (phasesChanged) {
    session = { ...session, phases: rescaleSessionPhases(session, session.plannedDurationMin) };
  }

  const parsed = SessionSchema.parse({
    ...session,
    seededFromActionIds: [...session.seededFromActionIds, ...applied].slice(0, 10),
    updatedAt: ctx.now,
  });

  return { session: parsed, applied, skipped };
}

/**
 * The phase a coaching point belongs in: one of the requested kind, else **the main
 * practice** — the longest phase that is not a warm-up, huddle or water break.
 */
function phaseForKind(
  session: Session,
  kind: SessionPhase['kind'] | null,
): SessionPhase | undefined {
  if (kind !== null) {
    const match = [...session.phases]
      .sort((a, b) => a.order - b.order)
      .find((phase) => phase.kind === kind);
    if (match) return match;
  }
  return mainPracticePhase(session);
}

/** A carried phase arrives with fresh ids, undelivered points, and no stale focus players. */
function freshPhase(
  phase: SessionPhase,
  session: Session,
  ctx: { ids: IdGenerator },
  actionId: CarryForwardActionId,
): SessionPhase {
  const focusIds = new Set(session.focusPlayers.map((f) => f.playerId));

  return {
    ...phase,
    id: asPhaseId(ctx.ids.uuid()) as PhaseId,
    sourceActionId: actionId,
    focusPlayerIds: phase.focusPlayerIds.filter((id) => focusIds.has(id)),
    coachingPoints: phase.coachingPoints.map((point) =>
      CoachingPointSchema.parse({
        ...point,
        id: asCoachingPointId(ctx.ids.uuid()),
        delivered: false,
        deliveredAt: null,
        playerIds: point.playerIds.filter((id) => focusIds.has(id)),
        sourceActionId: actionId,
      }),
    ),
  };
}
