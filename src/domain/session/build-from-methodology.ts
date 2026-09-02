import type { IdGenerator } from '@/lib/id';
import { CoachingPointSchema, type CoachingPoint } from '../coaching-point';
import {
  asCoachingPointId,
  asPhaseId,
  asSessionId,
  type PhaseTemplateId,
  type SessionId,
} from '../ids';
import type { InterventionPlan } from '../intervention';
import {
  orderedTemplates,
  snapshotMethodology,
  type Methodology,
  type MethodologyPhaseTemplate,
  type MethodologyPreset,
} from '../methodology';
import { CURRENT_SCHEMA_VERSION, type IsoDateTime } from '../primitives';
import type { Squad } from '../squad';
import {
  SessionSchema,
  type FocusPlayerAssignment,
  type Objective,
  type Session,
  type SessionPhase,
} from '../session';
import { scalePhaseDurations } from './phase-scaling';

export interface BuildSessionOptions {
  squad: Squad;
  objective: Objective;
  now: IsoDateTime;
  ids: IdGenerator;
  /** Defaults to the squad's configured session length, so this costs no taps on `/plan`. */
  totalMin?: number;
  scheduledFor?: IsoDateTime;
  focusPlayers?: readonly FocusPlayerAssignment[];
  /** Optional phases (a water break) are in unless the coach turns them off. */
  includeOptionalPhases?: boolean;
  /**
   * An explicit plan overriding the methodology's. Passing this sets `interventionTouched`,
   * so a later methodology change will not silently discard it.
   */
  intervention?: InterventionPlan;
  stepMin?: number;
  title?: string;
  sessionId?: SessionId;
  reminders?: readonly string[];
  seededFromActionIds?: Session['seededFromActionIds'];
}

/**
 * Turns `methodology × objective × duration` into a full draft session: real phases, real
 * minutes, prefilled coaching points, and an intervention plan already derived from the
 * methodology at both session and phase level.
 *
 * This is step 3 of the four-tap create flow, and the reason intervention configuration
 * costs zero taps on the default path — the methodology already implies how the coach
 * intends to coach, so it seeds everything and the coach only intervenes when they disagree.
 */
export function buildSessionFromMethodology(
  methodology: Methodology | MethodologyPreset,
  options: BuildSessionOptions,
): Session {
  const {
    squad,
    objective,
    now,
    ids,
    totalMin = squad.defaultSessionDurationMin,
    scheduledFor = now,
    focusPlayers = [],
    includeOptionalPhases = true,
    intervention,
    stepMin = 5,
    title,
    sessionId,
    reminders = [],
    seededFromActionIds = [],
  } = options;

  const templates = orderedTemplates(methodology).filter(
    (template) => includeOptionalPhases || !template.isOptional,
  );
  const durations = scalePhaseDurations(templates, totalMin, stepMin);

  const phases = templates.map((template, index) =>
    phaseFromTemplate(template, index, durations.get(template.id), ids),
  );

  return SessionSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    id: sessionId ?? asSessionId(ids.uuid()),
    squadId: squad.id,
    title: title ?? autoTitle(objective.text, scheduledFor),
    objective,
    methodology: snapshotMethodology(methodology, now),
    intervention: intervention ?? methodology.defaultIntervention,
    interventionTouched: intervention !== undefined,
    focusPlayers,
    phases,
    plannedDurationMin: totalMin,
    scheduledFor,
    status: 'draft',
    run: null,
    reviewId: null,
    reminders,
    seededFromActionIds,
  });
}

function phaseFromTemplate(
  template: MethodologyPhaseTemplate,
  order: number,
  minutes: number | undefined,
  ids: IdGenerator,
): SessionPhase {
  return {
    id: asPhaseId(ids.uuid()),
    order,
    kind: template.kind,
    title: template.title,
    plannedDurationMin: minutes ?? template.defaultDurationMin,
    // Copy the template's override down, so a phase that inherits at the methodology level
    // still inherits at the session level. `resolvePhaseIntervention` handles the rest.
    intervention: template.defaultIntervention,
    coachingPoints: template.defaultCoachingPoints.map((text) =>
      methodologyCoachingPoint(text, ids),
    ),
    focusPlayerIds: [],
    progressions: [],
    regressions: [],
    organisation: '',
    // Carried through so Do mode can show the coach their own reminder of what this is for.
    coachPrompts: [...template.coachPrompts],
    fromTemplateId: template.id,
    sourceActionId: null,
  };
}

function methodologyCoachingPoint(text: string, ids: IdGenerator): CoachingPoint {
  return CoachingPointSchema.parse({
    id: asCoachingPointId(ids.uuid()),
    text,
    source: 'methodology',
  });
}

/**
 * `{Objective} · {short date}`. There is deliberately no session-name field — a coach
 * naming their sessions is a coach not out on the pitch.
 */
export function autoTitle(objectiveText: string, scheduledFor: IsoDateTime): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(scheduledFor));
  const suffix = ` · ${date}`;
  const room = 80 - suffix.length;
  const objective =
    objectiveText.length > room ? `${objectiveText.slice(0, room - 1).trimEnd()}…` : objectiveText;
  return `${objective}${suffix}`;
}

/**
 * Re-scales every phase to a new session length, preserving their relative proportions.
 *
 * Used by the duration stepper and — importantly — after carry-forward inserts a phase, so
 * adding a practice does not silently make the session 80 minutes long.
 */
export function rescaleSessionPhases(
  session: Session,
  totalMin: number,
  stepMin = 5,
): SessionPhase[] {
  const ordered = [...session.phases].sort((a, b) => a.order - b.order);
  const currentTotal = ordered.reduce((total, phase) => total + phase.plannedDurationMin, 0);
  if (currentTotal <= 0 || ordered.length === 0) return ordered;

  // Reuse the apportionment by expressing the current plan as weights. Fixed-length phases
  // are not distinguishable here — a re-scale is the coach saying "make the whole thing
  // shorter", and a water break shrinking with it is the expected behaviour.
  const pseudoTemplates = ordered.map<MethodologyPhaseTemplate>((phase, index) => ({
    id: phase.id as unknown as PhaseTemplateId,
    order: index,
    kind: phase.kind,
    title: phase.title,
    durationWeight: phase.plannedDurationMin / currentTotal,
    defaultDurationMin: phase.plannedDurationMin,
    intent: phase.title,
    coachPrompts: [],
    defaultCoachingPoints: [],
    defaultIntervention: null,
    isOptional: false,
  }));

  const durations = scalePhaseDurations(pseudoTemplates, totalMin, stepMin);
  return ordered.map((phase, index) => ({
    ...phase,
    order: index,
    plannedDurationMin:
      durations.get(phase.id as unknown as PhaseTemplateId) ?? phase.plannedDurationMin,
  }));
}
