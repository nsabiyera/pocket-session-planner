import { z } from 'zod';
import { MAX_CHALLENGES_PER_SESSION, PlayerChallengeSchema } from './challenge';
import { MAX_IMAGES_PER_PHASE } from './phase-image';
import { CoachingPointSchema } from './coaching-point';
import {
  CarryForwardActionIdSchema,
  PhaseIdSchema,
  PhaseImageIdSchema,
  PhaseTemplateIdSchema,
  PlayerIdSchema,
  PrincipleIdSchema,
  ReviewIdSchema,
  SessionIdSchema,
  SquadIdSchema,
} from './ids';
import { InterventionPlanSchema } from './intervention';
import {
  MAX_CONSTRAINTS_PER_PHASE,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  PhaseConstraintSchema,
  PhaseTargetsSchema,
  PracticeAreaSchema,
  PracticeSpectrumSchema,
} from './practice';
import { MatchDetailsSchema, refineMatchDetails } from './match-day';
import { EffortQualitySchema } from './morphocycle';
import { MethodologySnapshotSchema, PhaseKindSchema } from './methodology';
import {
  MAX_MISCONCEPTION,
  MAX_OPTION,
  MAX_OPTIONS_PER_OBJECTIVE,
  MAX_TACTICAL_PROBLEM,
} from './objectives';
import {
  DurationMinSchema,
  IsoDateTimeSchema,
  nonEmptyText,
  optionalText,
  RecordMetaSchema,
} from './primitives';
import { SessionRunStateSchema } from './session-run';

export const SessionStatusSchema = z.enum([
  'draft',
  'planned',
  'in_progress',
  'completed',
  'abandoned',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * There is deliberately **no `reviewed` status**. `completed && reviewId !== null` is
 * derivable, and a sixth state would double the terminal-transition matrix for nothing.
 * The UI uses the `sessionStage` selector instead.
 */

export const ObjectiveSchema = z.object({
  text: nonEmptyText(140),
  /** Capped at 5. A session with six success criteria has no objective. */
  successCriteria: z.array(nonEmptyText(120)).max(5).default([]),
  /** Set when the objective was seeded by carry-forward, for the "carried from" marker. */
  sourceActionId: CarryForwardActionIdSchema.nullable().default(null),
  /**
   * The game-model principle this session is training (ADR 0007, Phase 3).
   *
   * **Deliberately unvalidated against the game model.** The model is a different document, so
   * a schema on this one cannot resolve the id — and it should not want to. Sessions are
   * evidence of what was trained: a coach who later rewrites their game model must not have
   * their history rewritten with it, so a principle that has since been removed leaves a
   * *dangling id on purpose* and the report says the principle is gone rather than pretending
   * the session trained something else.
   *
   * Nullable and defaulted, so every session written before this parses unchanged and a coach
   * who never authors a game model is never asked for one.
   */
  principleId: PrincipleIdSchema.nullable().default(null),
  /**
   * **What the coach expected to go wrong** (ADR 0009), snapshotted off the objective library
   * the same way `successCriteria` is.
   *
   * A snapshot rather than a lookup, for the reason every other field here is one: a session
   * is evidence of what was planned, and a library entry reworded next season must not
   * rewrite what a coach was working from in March.
   *
   * **Null means the coach did not say**, and that is the honest reading for two different
   * coaches: one who planned before this existed, and one who typed their own objective
   * rather than tapping a chip. Neither gets an invented prediction — the line and the tag
   * simply do not appear. Same treatment as `principleId`, and no migration for the same
   * reason (ADR 0009 §8).
   */
  commonMisconception: optionalText(MAX_MISCONCEPTION).nullable().default(null),
  /**
   * **The game problem the session was built around** (ADR 0011 §1), snapshotted off the
   * objective library exactly as `successCriteria` and `commonMisconception` are, and for the
   * same reason: a library entry reworded next season must not rewrite what a coach was
   * working from in March.
   *
   * **Null means the coach did not say**, and that reads honestly for both coaches who get it
   * — one who planned before this existed, and one who typed their own objective. Neither is
   * handed an invented problem: the pinned line simply does not appear. Additive, defaulted
   * and not indexed, so this needs no migration (ADR 0009 §8), the same free path
   * `commonMisconception` and `principleId` both took.
   */
  tacticalProblem: optionalText(MAX_TACTICAL_PROBLEM).nullable().default(null),
  /**
   * **The options this session's problem offers** (ADR 0011 §4), snapshotted off the library
   * beside the problem itself.
   *
   * An array with a default rather than nullable, because unlike the problem there is no
   * difference worth preserving between *the coach did not say* and *there are none*: either
   * way the sheet shows no option chips. Empty is the honest value for a typed objective, for
   * the two library entries that pose no choice, and for every session planned before this.
   */
  options: z.array(nonEmptyText(MAX_OPTION)).max(MAX_OPTIONS_PER_OBJECTIVE).default([]),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const FocusPlayerAssignmentSchema = z.object({
  playerId: PlayerIdSchema,
  /** Why this player is a focus — usually lifted verbatim from the last review's next step. */
  reason: optionalText(160).optional(),
  sourceActionId: CarryForwardActionIdSchema.nullable().default(null),
});
export type FocusPlayerAssignment = z.infer<typeof FocusPlayerAssignmentSchema>;

/**
 * **Plan-time only.** What actually happened lives in `Session.run.phaseRuns[]` and in the
 * `observations` store. Keeping the two strictly separate is what makes re-planning safe:
 * editing a phase can never corrupt the evidence of what a coach saw.
 */
export const SessionPhaseSchema = z.object({
  id: PhaseIdSchema,
  order: z.number().int().min(0),
  kind: PhaseKindSchema,
  title: nonEmptyText(60),
  plannedDurationMin: DurationMinSchema,
  /** Overrides `session.intervention`. Null = inherit. Read via `resolvePhaseIntervention`. */
  intervention: InterventionPlanSchema.nullable().default(null),
  coachingPoints: z.array(CoachingPointSchema).max(10).default([]),
  /** Must be a subset of the session's focus players — enforced below. */
  focusPlayerIds: z.array(PlayerIdSchema).max(30).default([]),
  progressions: z.array(nonEmptyText(160)).max(5).default([]),
  regressions: z.array(nonEmptyText(160)).max(5).default([]),
  /**
   * **The practice design.** All three are nullable-with-default, which is what makes this a
   * free change: not indexed, so ADR 0001's optional-omitted rule does not apply, and a
   * session written before this shipped parses unchanged with three nulls. Null means *the
   * coach did not say*, never *zero*.
   */
  spectrum: PracticeSpectrumSchema.nullable().default(null),
  /** The grid, in metres. See the note on `PracticeAreaSchema` about metres vs yards. */
  area: PracticeAreaSchema.nullable().default(null),
  /**
   * **What they were playing towards** (ADR 0011 §2). Null means the coach did not say, never
   * *nothing to score in* — that is the explicit `none`, and the difference is the whole
   * reason this is nullable rather than defaulted to a value.
   *
   * Additive, defaulted and not indexed, so a session planned before this parses unchanged
   * and the match comparison simply reads as it did before.
   */
  targets: PhaseTargetsSchema.nullable().default(null),
  /** Players in *this practice* — not the squad, and not `focusPlayerIds`. */
  groupSize: z.number().int().min(MIN_GROUP_SIZE).max(MAX_GROUP_SIZE).nullable().default(null),
  /**
   * The STEP conditions on this practice: the letter is a tap, the text is the coach's own.
   * See `PhaseConstraintSchema` for why only the letter is structured.
   */
  constraints: z.array(PhaseConstraintSchema).max(MAX_CONSTRAINTS_PER_PHASE).default([]),
  /**
   * **Did the players choose something here?** The FA's fourth area, as one optional tap.
   *
   * A fact about the phase, not a rating of the coach - which is what keeps a read-only
   * player-facing summary additive later rather than a rewrite. `false` means *not recorded*
   * as much as it means *no*, which is exactly why `describeChoice` counts and stops.
   */
  playerChoice: z.boolean().default(false),
  /**
   * Photographs of this practice drawn out. **Ids only** - the bytes live in their own store,
   * so the session document stays small enough for Do mode to rewrite on every tap.
   *
   * A phase carried forward keeps these, which is the point: re-running last week's rondo
   * should bring last week's drawing with it.
   */
  imageIds: z.array(PhaseImageIdSchema).max(MAX_IMAGES_PER_PHASE).default([]),
  /**
   * Stays. The three fields above take the part a schema can compare across sessions; this
   * takes the part it should never try to — "two neutrals, keeper joins in when we score".
   */
  organisation: optionalText(500).default(''),
  /**
   * Copied from the methodology template. **The first is pinned in Do mode** above this
   * phase's coaching points, and all six are listed in the phase sheet — see
   * {@link leadCoachPrompt} for why one rather than all of them.
   */
  coachPrompts: z.array(nonEmptyText(200)).max(6).default([]),
  /**
   * **The earlier phase of this session that this one is supposed to match** (ADR 0011 §3).
   *
   * Resolved from `MethodologyPhaseTemplate.pairsWith` when the session is built, and
   * **deliberately stored rather than looked up later.** The roadmap's Phase 0 amendment said
   * the comparison would need no session state and be derived through `fromTemplateId`; that
   * is true only while the methodology document still exists and still says the same thing.
   * A methodology can be edited or deleted, and `MethodologySnapshot` exists precisely so
   * that cannot rewrite history — a review line that appeared or vanished depending on
   * whether the coach later tidied their methodologies would be the same drift in a new place.
   *
   * So this is a `PhaseId` within this session, and nothing outside the session is consulted
   * to read it. It is **not** a frozen copy of the practice: the comparison reads both phases
   * live, so editing either one changes what the app says, which is the entire point.
   *
   * Points backwards, at a phase with a lower `order` — see the note on `pairsWith` for why
   * that rules out a cycle rather than merely discouraging one.
   */
  pairedWithPhaseId: PhaseIdSchema.nullable().default(null),
  /** Provenance back to the methodology that generated this phase. */
  fromTemplateId: PhaseTemplateIdSchema.nullable().default(null),
  sourceActionId: CarryForwardActionIdSchema.nullable().default(null),
});
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;
export type SessionPhaseInput = z.input<typeof SessionPhaseSchema>;

/**
 * Training or a match.
 *
 * A discriminator rather than a second aggregate: a match reuses phases (as periods),
 * challenges, the run state machine, observations and the whole review pipeline, so a new
 * object store would buy a truer noun and pay for it in duplicated machinery. See the note at
 * the top of `match-day.ts`.
 *
 * Defaulted, so every session written before match day shipped is a `training` session
 * without a migration — the same free path the practice-design fields took.
 */
export const SessionKindSchema = z.enum(['training', 'match']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

const SessionShape = {
  id: SessionIdSchema,
  squadId: SquadIdSchema,
  /** Auto-generated as `{Objective} · {short date}`. There is no session-name field. */
  title: nonEmptyText(80),
  kind: SessionKindSchema.default('training'),
  /**
   * Present exactly when `kind` is `match` — enforced below, both ways, because a match
   * without a shape to play or a training session carrying an opponent would each be a
   * quietly corrupt record that still parsed.
   */
  match: MatchDetailsSchema.nullable().default(null),
  /** On a match this is the **whole-team** objective. Units get their own; players get challenges. */
  objective: ObjectiveSchema,
  /** Frozen at creation. Editing or deleting the source can never rewrite this. */
  methodology: MethodologySnapshotSchema,
  /** The session-level plan. Phases may override it. */
  intervention: InterventionPlanSchema,
  /**
   * Set once the coach edits the intervention by hand. Changing methodology re-derives the
   * plan **unless** this is true, so a deliberate choice is never silently discarded.
   */
  interventionTouched: z.boolean().default(false),
  focusPlayers: z.array(FocusPlayerAssignmentSchema).max(30).default([]),
  /**
   * Per-player challenges: *one thing* this player is trying to do today.
   *
   * Session-level rather than per-phase because that is how a coach says it — "Kai, three
   * forward passes today" — with `PlayerChallenge.phaseIds` narrowing it when they mean
   * only the rondo. Unlike `SessionPhase.focusPlayerIds` these are **not** constrained to
   * the session's focus players; see the note on `PlayerChallenge.playerId`.
   */
  challenges: z.array(PlayerChallengeSchema).max(MAX_CHALLENGES_PER_SESSION).default([]),
  phases: z.array(SessionPhaseSchema).max(12).default([]),
  plannedDurationMin: DurationMinSchema,
  /**
   * Always set — it defaults to "now" when the draft is created and is editable in the
   * phase-editor header. Required rather than nullable because it is half of the
   * `[squadId, scheduledFor]` index, and IndexedDB drops records whose index key path
   * resolves to `undefined`. See ADR 0001.
   */
  scheduledFor: IsoDateTimeSchema,
  status: SessionStatusSchema,
  run: SessionRunStateSchema.nullable().default(null),
  reviewId: ReviewIdSchema.nullable().default(null),
  /**
   * The morphocycle emphasis a coach put on this session (ADR 0007, Phase 4).
   *
   * A **label the coach assigned**, not a measurement and not a prescription — there is no RPE
   * here, no intensity percentage and no session-load arithmetic. Meaningless on a youth squad,
   * where `Squad.level` gates the whole feature off; nullable and defaulted so it costs nothing
   * to every session that will never carry one.
   */
  effortQuality: EffortQualitySchema.nullable().default(null),
  /** Shown as a pre-session checklist on the Do screen. Seeded by `reminder` actions. */
  reminders: z.array(nonEmptyText(160)).max(10).default([]),
  seededFromActionIds: z.array(CarryForwardActionIdSchema).max(10).default([]),
  abandonReason: optionalText(200).nullable().default(null),
  notes: optionalText(1000).default(''),
};

/**
 * Cross-field invariants. Each has a test. These are the rules that cannot be expressed by
 * a field schema, and every one of them protects something that would otherwise corrupt
 * quietly rather than loudly.
 */
function refineSession(session: z.infer<z.ZodObject<typeof SessionShape>>, ctx: z.RefinementCtx) {
  const phaseIds = new Set(session.phases.map((p) => p.id));
  const focusIds = new Set(session.focusPlayers.map((f) => f.playerId));

  if (phaseIds.size !== session.phases.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phases'],
      message: 'Phase ids must be unique.',
    });
  }

  const orders = session.phases.map((p) => p.order);
  if (new Set(orders).size !== orders.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phases'],
      message: 'Phase `order` values must be unique.',
    });
  }

  if (focusIds.size !== session.focusPlayers.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['focusPlayers'],
      message: 'A player can only be a focus player once.',
    });
  }

  // A phase cannot focus a player the session is not focusing — otherwise Do mode would
  // render a chip for someone who does not exist in the session's own focus row.
  session.phases.forEach((phase, index) => {
    for (const playerId of phase.focusPlayerIds) {
      if (!focusIds.has(playerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phases', index, 'focusPlayerIds'],
          message: `Phase focus player ${playerId} is not a focus player of the session.`,
        });
      }
    }
  });

  /*
    The pairing has to resolve within this session, point backwards, and not point at itself —
    the same three rules `refineTemplates` holds the methodology to, restated here because a
    session can be edited long after the methodology that built it.
  */
  const orderById = new Map(session.phases.map((phase) => [phase.id, phase.order]));
  session.phases.forEach((phase, index) => {
    if (phase.pairedWithPhaseId === null) return;

    const issue = (message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phases', index, 'pairedWithPhaseId'],
        message,
      });

    if (phase.pairedWithPhaseId === phase.id) {
      issue('A phase cannot be paired with itself.');
      return;
    }

    const pairedOrder = orderById.get(phase.pairedWithPhaseId);
    if (pairedOrder === undefined) {
      issue('Its paired phase is not in this session.');
      return;
    }

    if (pairedOrder >= phase.order) {
      issue('A paired phase must come earlier in the session.');
    }
  });

  const challengeIds = new Set(session.challenges.map((c) => c.id));
  if (challengeIds.size !== session.challenges.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['challenges'],
      message: 'Challenge ids must be unique.',
    });
  }

  // A challenge scoped to a phase that no longer exists would be watched for in no phase at
  // all — invisible in Do mode, and silently unjudgeable. Better to reject the write than to
  // let the coach set something they will never be shown.
  session.challenges.forEach((challenge, index) => {
    for (const phaseId of challenge.phaseIds) {
      if (!phaseIds.has(phaseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['challenges', index, 'phaseIds'],
          message: `Challenge phase ${phaseId} is not a phase of this session.`,
        });
      }
    }
  });

  if (session.status === 'in_progress' && session.run === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['run'],
      message: 'An in_progress session must have a run.',
    });
  }

  if ((session.status === 'draft' || session.status === 'planned') && session.run !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['run'],
      message: `A ${session.status} session must not have a run.`,
    });
  }

  // The discriminator, enforced in both directions. A match with no match block has no
  // opponent, shape or units; a training session carrying one would export as evidence of a
  // fixture that never happened. Either way the record parses, which is what makes it worth
  // rejecting here rather than discovering in a season report.
  if (session.kind === 'match' && session.match === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['match'],
      message: 'A match session must carry its match details.',
    });
  }

  if (session.kind === 'training' && session.match !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['match'],
      message: 'A training session must not carry match details.',
    });
  }

  if (session.match !== null) {
    refineMatchDetails(session.match, (path, message) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['match', ...path], message });
    });

    // Presence is recorded against periods, so a stale phase id would credit minutes to a
    // period that no longer exists — and minutes are the whole point of recording it.
    session.match.presence.forEach((period, index) => {
      if (!phaseIds.has(period.phaseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['match', 'presence', index, 'phaseId'],
          message: `Presence references unknown period ${period.phaseId}.`,
        });
      }
    });
  }

  if (session.status === 'abandoned' && session.abandonReason === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['abandonReason'],
      message: 'Abandoning a session requires a reason.',
    });
  }

  if (session.run !== null) {
    // Every phase run must point at a phase that still exists, or the timer has nothing to
    // measure against and Review has nothing to report.
    session.run.phaseRuns.forEach((phaseRun, index) => {
      if (!phaseIds.has(phaseRun.phaseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['run', 'phaseRuns', index, 'phaseId'],
          message: `Phase run references unknown phase ${phaseRun.phaseId}.`,
        });
      }
    });

    if (session.run.currentPhaseIndex >= session.run.phaseRuns.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['run', 'currentPhaseIndex'],
        message: 'currentPhaseIndex is out of range.',
      });
    }

    for (const [index, event] of session.run.interventionEvents.entries()) {
      if (!phaseIds.has(event.phaseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['run', 'interventionEvents', index, 'phaseId'],
          message: `Intervention event references unknown phase ${event.phaseId}.`,
        });
      }
    }

    // A sighting whose challenge has been deleted would inflate no tally and belong to
    // nobody, but it would still be exported as evidence of something that is gone.
    for (const [index, event] of session.run.challengeEvents.entries()) {
      if (!challengeIds.has(event.challengeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['run', 'challengeEvents', index, 'challengeId'],
          message: `Challenge event references unknown challenge ${event.challengeId}.`,
        });
      }
      if (!phaseIds.has(event.phaseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['run', 'challengeEvents', index, 'phaseId'],
          message: `Challenge event references unknown phase ${event.phaseId}.`,
        });
      }
    }
  }
}

export const SessionSchema = RecordMetaSchema.extend(SessionShape).superRefine(refineSession);
export type Session = z.infer<typeof SessionSchema>;
export type SessionInput = z.input<typeof SessionSchema>;

export function phasesInOrder(session: Session): SessionPhase[] {
  return [...session.phases].sort((a, b) => a.order - b.order);
}

export function findPhase(session: Session, phaseId: SessionPhase['id']): SessionPhase | undefined {
  return session.phases.find((p) => p.id === phaseId);
}

export function isFocusPlayer(session: Session, playerId: FocusPlayerAssignment['playerId']) {
  return session.focusPlayers.some((f) => f.playerId === playerId);
}

/** Sum of the planned phase durations, which need not equal `plannedDurationMin`. */
export function totalPlannedPhaseMin(session: Session): number {
  return session.phases.reduce((total, phase) => total + phase.plannedDurationMin, 0);
}

/**
 * **The one coach prompt Do mode shows for this phase**, and null when there is none.
 *
 * `coachPrompts` holds up to six. Do mode shows the **first** and the phase sheet lists them
 * all, for three reasons that all point the same way:
 *
 * 1. **The presets already rank them.** Whole-Part-Whole's WHOLE reads *"Say almost nothing.
 *    You are diagnosing, not fixing."* and then *"Pick ONE problem to take into the PART."*
 *    The first is the instruction for the next twelve minutes; the second is for the end of
 *    them. Written in that order, by a human, on purpose — so taking the first is reading the
 *    author's intent rather than guessing at relevance.
 * 2. **Rotating would be worse than picking.** A line that changes while a coach is looking
 *    away is a line they cannot rely on, and it would need per-phase timer state to do it.
 * 3. **Six at once is a paragraph.** Do mode fits 667px without scrolling; a block that grows
 *    with the methodology is the one thing the header budget cannot absorb.
 *
 * The prompts past the first are not lost — {@link SessionPhase.coachPrompts} is listed in
 * full in the phase sheet, which is a deliberate tap and has no height budget.
 */
export function leadCoachPrompt(phase: SessionPhase): string | null {
  return phase.coachPrompts[0] ?? null;
}
