import {
  CarryForwardProposalSchema,
  MAX_PROPOSALS,
  type CarryForwardAction,
  type CarryForwardKind,
  type CarryForwardProposal,
} from '@/domain/carry-forward';
import { normaliseCoachingPointText } from '@/domain/coaching-point';
import {
  challengePointSignals,
  describeChallengePoint,
  type SettledChallenge,
} from '@/domain/challenge/point';
import type { PlayerId } from '@/domain/ids';
import { cornerLabel, cornerShortLabel } from '@/domain/four-corners';
import {
  cornerBalance,
  describeCornerBalance,
  suggestNeglectedCorner,
} from '@/domain/four-corners/balance';
import type { PhaseKind } from '@/domain/methodology';
import type { Observation } from '@/domain/observation';
import type { Player } from '@/domain/player';
import { PRIORITY_ORDER, type Priority } from '@/domain/primitives';
import { unmetCriteria, type SessionReview } from '@/domain/review';
import { BALL_ROLLING_TARGET, type InterventionSummary } from '@/domain/session/selectors';
import type { Session } from '@/domain/session';

/**
 * Turns a finished session into the seed material for the next one.
 *
 * **Propose, never auto-create.** Everything here renders as a checklist the coach edits and
 * confirms; nothing is written until they tap `Save review`. A coach who feels the app is
 * inventing homework for them will stop using it, and then the loop closes on nothing.
 */

export interface DeriveCarryForwardInput {
  session: Session;
  review: SessionReview;
  observations: readonly Observation[];
  interventions: InterventionSummary;
  /** Open actions for this squad, used for chaining and for dedupe. */
  openActions: readonly CarryForwardAction[];
  /**
   * The roster, only so proposals can name people. Optional because the derivation is
   * correct without it — a proposal that says "this player" is still actionable, and the
   * review screen renders the chip against the real name anyway.
   */
  players?: readonly Player[];
  /**
   * Every observation of each focus player, across the whole term — not just this session.
   *
   * The 4 Corner balance nudge is meaningless on one session's worth of data: a coach who
   * logged three technical notes on Tuesday has not neglected the social corner, they have
   * had one session. Keyed by player, and optional so the derivation still works without it.
   */
  playerHistory?: ReadonlyMap<PlayerId, readonly Observation[]>;
  /**
   * Every challenge this squad's players were set and settled, across the term, oldest
   * first. Optional for the same reason `playerHistory` is: the derivation is correct
   * without it, it just cannot make this one judgement.
   */
  challengeHistory?: readonly SettledChallenge[];
}

/** First name where we have one, so a chip reads "Keep focusing on Kai". */
function playerLabel(input: DeriveCarryForwardInput, playerId: PlayerId): string {
  const player = input.players?.find((candidate) => candidate.id === playerId);
  if (!player) return 'this player';
  return player.name.split(/\s+/)[0] ?? player.name;
}

/**
 * Every rule that can produce a proposal, as a closed set.
 *
 * These strings are also `RationaleId`s: the "why am I seeing this" disclosure on a chip
 * looks the trigger straight up in `src/domain/rationale.ts`, which is what
 * `CarryForwardProposal.trigger`'s docstring always intended. Adding a rule here without
 * adding its explanation there is a chip with an empty `?`, and `rationale.test.ts` fails on
 * it. The compiler covers the other direction: `proposal()` below only accepts one of these.
 */
export const CARRY_FORWARD_TRIGGERS = [
  'objective:unmet',
  'objective:met',
  'focus-player:no-progress',
  'focus-player:next-step',
  'observation:struggled',
  'intervention:ball-rolling',
  'intervention:unused-plan',
  'four-corners:neglected',
  'phase:run-again',
  'coaching-point:undelivered',
  'review:what-didnt',
  'challenge:pitched-wrong',
] as const;

export type CarryForwardTrigger = (typeof CARRY_FORWARD_TRIGGERS)[number];

/**
 * Trigger specificity, used as the secondary sort. A proposal about one named player beats a
 * generic reminder at the same priority, because it is the one the coach can act on.
 */
const TRIGGER_RANK: Record<CarryForwardTrigger, number> = {
  'objective:unmet': 0,
  'focus-player:no-progress': 1,
  'focus-player:next-step': 2,
  'observation:struggled': 3,
  'intervention:ball-rolling': 4,
  'phase:run-again': 5,
  'objective:met': 6,
  'coaching-point:undelivered': 7,
  'four-corners:neglected': 8,
  'intervention:unused-plan': 9,
  'review:what-didnt': 10,
  // Below the named-player proposals but above the generic ones: it names a player *and*
  // a specific ask, but it fires on a term of evidence rather than on tonight.
  'challenge:pitched-wrong': 3.5,
};

export function deriveCarryForwardProposals(
  input: DeriveCarryForwardInput,
): CarryForwardProposal[] {
  const proposals: CarryForwardProposal[] = [
    ...objectiveProposals(input),
    ...focusPlayerProposals(input),
    ...observationProposals(input),
    ...interventionProposals(input),
    ...fourCornerProposals(input),
    ...phaseProposals(input),
    ...undeliveredPointProposals(input),
    ...challengePointProposals(input),
    ...whatDidntProposals(input),
  ];

  const deduped = dedupe(proposals);
  const chained = deduped.map((proposal) => chain(proposal, input.openActions));

  // **Volume guard.** A review that generates thirty checkboxes is a review nobody
  // completes, so the eight most useful survive and the rest are simply not offered.
  return chained
    .sort((a, b) => {
      const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priority !== 0) return priority;
      return rankOf(a.trigger) - rankOf(b.trigger);
    })
    .slice(0, MAX_PROPOSALS);
}

// ---------------------------------------------------------------------------

/** A proposal read back off a stored action can carry a trigger this build never had. */
function rankOf(trigger: string): number {
  return Object.hasOwn(TRIGGER_RANK, trigger) ? TRIGGER_RANK[trigger as CarryForwardTrigger] : 99;
}

function proposal(
  fields: Omit<
    CarryForwardProposal,
    'detail' | 'priority' | 'playerIds' | 'defaultSelected' | 'supersedesActionId' | 'trigger'
  > & {
    /** Narrowed from the schema's `string`, so a new rule cannot skip the registry. */
    trigger: CarryForwardTrigger;
  } & Partial<Pick<CarryForwardProposal, 'detail' | 'priority' | 'playerIds' | 'defaultSelected'>>,
): CarryForwardProposal {
  return CarryForwardProposalSchema.parse(fields);
}

function objectiveProposals({ session, review }: DeriveCarryForwardInput): CarryForwardProposal[] {
  const text = session.objective.text;
  const unmet = unmetCriteria(session.objective.successCriteria, review);

  if (review.objectiveOutcome === 'not_met' || review.objectiveOutcome === 'partially_met') {
    return [
      proposal({
        kind: 'objective',
        title: `Revisit: ${text}`,
        detail:
          unmet.length > 0
            ? `Still to get: ${unmet.join('; ')}`
            : 'Run this objective again next session.',
        priority: 'high',
        // Only the criteria they did *not* meet travel forward. Carrying the met ones would
        // make the next review look like no progress had been made at all.
        payload: { kind: 'objective', text, successCriteria: unmet, intent: 'revisit' },
        defaultSelected: true,
        trigger: 'objective:unmet',
      }),
    ];
  }

  return [
    proposal({
      kind: 'objective',
      title: `Progress: ${text}`,
      detail: 'Add pressure / reduce time / increase distance',
      priority: 'normal',
      payload: {
        kind: 'objective',
        text,
        successCriteria: [...session.objective.successCriteria],
        intent: 'progress',
      },
      // Unticked: a met objective may well mean it is time to move on to something else.
      defaultSelected: false,
      trigger: 'objective:met',
    }),
  ];
}

function focusPlayerProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  const out: CarryForwardProposal[] = [];

  for (const focusReview of input.review.focusPlayerReviews) {
    const nextStep = focusReview.nextStep.trim();

    if (focusReview.progress === 'regressed' || focusReview.progress === 'no_change') {
      out.push(
        proposal({
          kind: 'focus_player',
          title: `Keep focusing on ${playerLabel(input, focusReview.playerId)}`,
          detail: nextStep,
          priority: focusReview.progress === 'regressed' ? 'high' : 'normal',
          payload: {
            kind: 'focus_player',
            playerId: focusReview.playerId,
            targetBehaviour: nextStep.length > 0 ? nextStep : input.session.objective.text,
          },
          playerIds: [focusReview.playerId],
          defaultSelected: true,
          trigger: 'focus-player:no-progress',
        }),
      );
    }

    if (nextStep.length > 0) {
      out.push(
        proposal({
          kind: 'coaching_point',
          title: nextStep,
          detail: `For ${playerLabel(input, focusReview.playerId)}`,
          priority: 'normal',
          payload: {
            kind: 'coaching_point',
            text: nextStep,
            playerIds: [focusReview.playerId],
            // Put it where their work actually happened, not wherever is convenient.
            preferredPhaseKind: clusterPhaseKind(input, focusReview.playerId),
          },
          playerIds: [focusReview.playerId],
          defaultSelected: true,
          trigger: 'focus-player:next-step',
        }),
      );
    }
  }

  return out;
}

/** Where a player's observations clustered — the phase kind they were seen in most. */
function clusterPhaseKind(input: DeriveCarryForwardInput, playerId: PlayerId): PhaseKind | null {
  const counts = new Map<PhaseKind, number>();
  const phaseKindOf = new Map(input.session.phases.map((phase) => [phase.id, phase.kind]));

  for (const observation of input.observations) {
    if (observation.playerId !== playerId) continue;
    const kind = phaseKindOf.get(observation.phaseId);
    if (kind === undefined) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  let best: PhaseKind | null = null;
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

function observationProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  const struggles = input.observations.filter(
    (observation) =>
      observation.kind === 'development' &&
      observation.rating !== null &&
      observation.rating <= 2 &&
      observation.playerId !== undefined,
  );

  const out: CarryForwardProposal[] = [];
  for (const observation of struggles) {
    // The tag is the coaching point; the free text is the fallback.
    const text = observation.tags[0] ?? observation.text.trim();
    if (text.length === 0) continue;

    out.push(
      proposal({
        kind: 'coaching_point',
        title: text,
        detail: `${playerLabel(input, observation.playerId!)} struggled with this`,
        priority: 'normal',
        payload: {
          kind: 'coaching_point',
          text,
          playerIds: [observation.playerId!],
          preferredPhaseKind: clusterPhaseKind(input, observation.playerId!),
        },
        playerIds: [observation.playerId!],
        defaultSelected: true,
        trigger: 'observation:struggled',
      }),
    );
  }
  return out;
}

function interventionProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  const { interventions, session } = input;
  const out: CarryForwardProposal[] = [];

  const belowTarget = interventions.ballRollingRatio < BALL_ROLLING_TARGET;
  const overBudget = interventions.overBudgetPhases.length > 0;

  if (belowTarget || overBudget) {
    const percent = Math.round(interventions.ballRollingRatio * 100);
    out.push(
      proposal({
        kind: 'intervention',
        title: `Coach more in the flow next session`,
        // A concrete plan change for next time, not a scolding about last time.
        detail: belowTarget
          ? `Ball rolling time was ${percent}%. Try in-flow coaching in the main practice.`
          : `${interventions.overBudgetPhases.length} phase(s) went over the intervention budget.`,
        priority: 'normal',
        payload: {
          kind: 'intervention',
          plan: { ...session.intervention, mechanic: 'in_flow', maxPerPhase: 2 },
          targetPhaseKind: null,
          rationale: `Ball rolling time ${percent}%`,
        },
        defaultSelected: true,
        trigger: 'intervention:ball-rolling',
      }),
    );
  }

  // The opposite failure, and a genuinely interesting one: a coach who planned to coach
  // directly and then said nothing all session either did not need the plan, or bottled it.
  if (interventions.totalCount === 0 && session.intervention.method === 'command') {
    out.push(
      proposal({
        kind: 'intervention',
        title: 'You planned to coach directly and never stopped play',
        detail: 'Was the plan right, or was the session?',
        priority: 'low',
        payload: {
          kind: 'intervention',
          plan: session.intervention,
          targetPhaseKind: null,
          rationale: 'No interventions logged against a command plan',
        },
        defaultSelected: false,
        trigger: 'intervention:unused-plan',
      }),
    );
  }

  return out;
}

/**
 * The FA 4 Corner Model nudge.
 *
 * > "Each of these 'corners' is equally important, and no one corner works in isolation."
 *
 * A coach who has logged twenty-nine technical observations of a player and nothing social
 * is developing a quarter of them, and cannot see it from inside the habit. This is the
 * cheapest possible intervention: name the gap, suggest the corner, leave it unticked.
 *
 * Unticked on purpose — it is a nudge, not homework. The coach may have excellent reasons.
 */
function fourCornerProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  if (!input.playerHistory) return [];

  const out: CarryForwardProposal[] = [];
  for (const focus of input.session.focusPlayers) {
    const observations = input.playerHistory.get(focus.playerId);
    if (!observations) continue;

    const balance = cornerBalance(observations);
    const corner = suggestNeglectedCorner(balance);
    if (corner === null) continue;

    const name = playerLabel(input, focus.playerId);
    out.push(
      proposal({
        kind: 'focus_player',
        title: `Look at the ${cornerShortLabel(corner).toLowerCase()} corner with ${name}`,
        detail: describeCornerBalance(balance, name),
        priority: 'normal',
        payload: {
          kind: 'focus_player',
          playerId: focus.playerId,
          targetBehaviour: `${cornerLabel(corner)} — the corner you have looked at least`,
        },
        playerIds: [focus.playerId],
        defaultSelected: false,
        trigger: 'four-corners:neglected',
      }),
    );
  }
  return out;
}

function phaseProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  const out: CarryForwardProposal[] = [];

  for (const phaseReview of input.review.phaseReviews) {
    const worthRepeating = phaseReview.wouldRunAgain;
    const worthFixing =
      !phaseReview.ranAsPlanned && phaseReview.rating !== null && phaseReview.rating <= 2;
    if (!worthRepeating && !worthFixing) continue;

    const phase = input.session.phases.find((p) => p.id === phaseReview.phaseId);
    if (!phase) continue;

    out.push(
      proposal({
        kind: 'phase',
        title: worthRepeating ? `Run again: ${phase.title}` : `Try again: ${phase.title}`,
        detail: phaseReview.note,
        priority: 'normal',
        payload: {
          kind: 'phase',
          // A frozen copy with its coaching points reset, so tomorrow it is a one-tap re-run.
          phase: {
            ...phase,
            focusPlayerIds: [],
            sourceActionId: null,
            coachingPoints: phase.coachingPoints.map((point) => ({
              ...point,
              delivered: false,
              deliveredAt: null,
            })),
          },
          originalOrder: phase.order,
        },
        defaultSelected: false,
        trigger: 'phase:run-again',
      }),
    );
  }

  return out;
}

function undeliveredPointProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  if (input.session.status !== 'completed') return [];

  return input.session.phases
    .flatMap((phase) => phase.coachingPoints.map((point) => ({ phase, point })))
    .filter(({ point }) => !point.delivered)
    .map(({ phase, point }) =>
      proposal({
        kind: 'coaching_point',
        title: `Didn't get to: ${point.text}`,
        detail: `Planned for ${phase.title}`,
        priority: 'low',
        payload: {
          kind: 'coaching_point',
          text: point.text,
          playerIds: [...point.playerIds],
          preferredPhaseKind: phase.kind,
        },
        playerIds: [...point.playerIds],
        defaultSelected: false,
        trigger: 'coaching-point:undelivered',
      }),
    );
}

/**
 * The Challenge Point nudge: an ask missed three sessions running.
 *
 * Offered **unticked**, like the 4 Corner one, and for the same reason — it is a nudge, not
 * homework, and the coach may have excellent reasons for holding the ask where it is. What
 * the app can say is that the evidence has stopped being about the player.
 */
function challengePointProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  if (!input.challengeHistory) return [];

  return challengePointSignals(input.challengeHistory).map((signal) => {
    const name = playerLabel(input, signal.playerId);
    return proposal({
      kind: 'focus_player',
      title: `Change the ask for ${name}`,
      detail: describeChallengePoint(signal, name),
      priority: 'normal',
      payload: {
        kind: 'focus_player',
        playerId: signal.playerId,
        targetBehaviour: signal.text,
      },
      playerIds: [signal.playerId],
      defaultSelected: false,
      trigger: 'challenge:pitched-wrong',
    });
  });
}

function whatDidntProposals(input: DeriveCarryForwardInput): CarryForwardProposal[] {
  return input.review.whatDidnt.map((text) =>
    proposal({
      kind: 'reminder',
      title: text,
      priority: 'low',
      payload: { kind: 'reminder', text },
      defaultSelected: false,
      trigger: 'review:what-didnt',
    }),
  );
}

// ---------------------------------------------------------------------------

/**
 * Deduplication key. Deliberately deterministic rather than fuzzy — normalise = lowercase,
 * strip punctuation, collapse whitespace, and for a player-specific proposal include the
 * player. Fuzzy matching would occasionally merge two genuinely different coaching points,
 * which is worse than an occasional duplicate the coach can untick.
 */
export function proposalKey(kind: CarryForwardKind, title: string, playerId?: PlayerId): string {
  return [kind, playerId ?? '', normaliseCoachingPointText(title)].join('|');
}

function dedupe(proposals: readonly CarryForwardProposal[]): CarryForwardProposal[] {
  const seen = new Set<string>();
  const out: CarryForwardProposal[] = [];

  for (const candidate of proposals) {
    const key = proposalKey(candidate.kind, candidate.title, candidate.playerIds[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/**
 * Chaining.
 *
 * A proposal matching an open action does **not** create a duplicate. It becomes a successor
 * with `supersedesActionId` set, so `chainDepth` climbs — and at three the planner tells the
 * coach they have chased the same point for three sessions and should change the practice,
 * not the point.
 */
function chain(
  candidate: CarryForwardProposal,
  openActions: readonly CarryForwardAction[],
): CarryForwardProposal {
  const key = proposalKey(candidate.kind, candidate.title, candidate.playerIds[0]);

  const match = openActions.find((action) => {
    if (action.status !== 'open' || action.kind !== candidate.kind) return false;
    // A focus-player action is about the player, whatever words the coach used this time.
    if (
      action.kind === 'focus_player' &&
      candidate.playerIds[0] !== undefined &&
      action.playerIds.includes(candidate.playerIds[0])
    ) {
      return true;
    }
    return proposalKey(action.kind, action.title, action.playerIds[0]) === key;
  });

  return match ? { ...candidate, supersedesActionId: match.id } : candidate;
}

/** Priority for a proposal, exposed for the review screen's grouping. */
export function proposalPriority(proposal: CarryForwardProposal): Priority {
  return proposal.priority;
}
