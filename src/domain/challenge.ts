import { z } from 'zod';
import { FourCornerSchema } from './four-corners';
import {
  CarryForwardActionIdSchema,
  ChallengeEventIdSchema,
  ChallengeIdSchema,
  PhaseIdSchema,
  PlayerIdSchema,
  type PhaseId,
} from './ids';
import { IsoDateTimeSchema, nonEmptyText, optionalText } from './primitives';

/**
 * A **player challenge**: one thing this player, specifically, is trying to do today.
 *
 * A coaching point is what the coach is looking for across the practice; a challenge is what
 * *one player* has been asked to do, and it is the thing they will ask about at the end. The
 * two are deliberately separate types rather than a flag on `CoachingPoint`, because they
 * behave differently in every way that matters: a point is delivered once and ticked, a
 * challenge is counted repeatedly and then judged.
 *
 * Modelled on the same plan/run split as intervention (see `intervention.ts`):
 *
 *  - `PlayerChallenge` is **plan-time** — the ask, and how it will be measured.
 *  - `ChallengeEvent` is **run-time** — one sighting, timestamped inside a phase. The tally
 *    is derived by counting them, never stored, so `Undo` is a pop rather than a decrement
 *    that can drift below zero.
 *
 * The one exception to that split is `status`, which lives on the challenge itself and is
 * written during the run. That follows the precedent set by `CoachingPoint.delivered`: a
 * verdict on a plan item belongs with the plan item, and keeping it there is what lets a
 * finished session render without reconstructing anything.
 */

/**
 * `count` challenges are tallied against a target — *three forward passes*. `judged`
 * challenges are not countable and the coach simply rules on them at the end — *stay
 * positive when you lose it*. Both exist because both are things coaches actually say, and
 * forcing the second into a tally would produce a number nobody believes.
 */
export const ChallengeMeasureSchema = z.enum(['count', 'judged']);
export type ChallengeMeasure = z.infer<typeof ChallengeMeasureSchema>;

/**
 * `open` until the coach rules on it. `partly` exists because the honest answer to *did Kai
 * make three forward passes* is very often "he made one, and he was looking for them", and
 * an app that only offers met/missed turns that into a lie either way.
 */
export const ChallengeStatusSchema = z.enum(['open', 'met', 'partly', 'missed']);
export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>;

/** The three the coach can actually tap. `open` is a starting state, not a choice. */
export const CHALLENGE_STATUSES: readonly ChallengeStatus[] = ['met', 'partly', 'missed'];

const CHALLENGE_STATUS_LABELS: Record<ChallengeStatus, string> = {
  open: 'Open',
  met: 'Met',
  partly: 'Partly',
  missed: 'Missed',
};

export const challengeStatusLabel = (status: ChallengeStatus): string =>
  CHALLENGE_STATUS_LABELS[status];

/** Where the challenge came from. `carry_forward` earns the *carried* marker in Do mode. */
export const ChallengeSourceSchema = z.enum(['coach', 'carry_forward']);
export type ChallengeSource = z.infer<typeof ChallengeSourceSchema>;

/** A whole squad's worth would be unmonitorable on a phone; this is already generous. */
export const MAX_CHALLENGES_PER_SESSION = 20;

/** Above this, a tally is not something a coach can keep on a phone while coaching. */
export const MAX_CHALLENGE_TARGET = 20;

export const PlayerChallengeSchema = z
  .object({
    id: ChallengeIdSchema,
    /**
     * Deliberately **not** required to be a focus player. Giving a quiet player one thing to
     * do is often precisely how they stop needing to be a focus player, and a schema that
     * refused it would make the useful case the awkward one.
     */
    playerId: PlayerIdSchema,
    text: nonEmptyText(160),
    measure: ChallengeMeasureSchema.default('count'),
    /** Required for `count`, forbidden for `judged` — enforced by the refinement below. */
    targetCount: z.number().int().min(1).max(MAX_CHALLENGE_TARGET).nullable().default(null),
    /**
     * Empty means the challenge is live for the whole session. Naming phases scopes it to
     * them — *use your left foot in the rondo* is not a thing to judge during the warm-up.
     */
    phaseIds: z.array(PhaseIdSchema).max(12).default([]),
    /**
     * Which corner of the FA 4 Corner Model the ask develops.
     *
     * Nullable rather than omitted, for the same reason as `CoachingPoint.corner`: it is not
     * indexed, and "we never classified this one" is a meaningful state that should survive
     * the JSON export legibly.
     */
    corner: FourCornerSchema.nullable().default(null),
    status: ChallengeStatusSchema.default('open'),
    /** When the coach ruled on it. Null while `status` is `open`. */
    settledAt: IsoDateTimeSchema.nullable().default(null),
    /** The coach's word on how it went. Optional, and never asked for pitch-side. */
    note: optionalText(300).default(''),
    /**
     * **What the player said about it** — the only player-authored data in this app
     * (ADR 0009 phase 7).
     *
     * Every other fact the app holds is a behaviour a coach observed or a thing a coach did.
     * This is the player's own words, written down because they were said. It is what turns a
     * verdict into a conversation: *"missed"* is a judgement, *"missed, and he said he could
     * not see the far side"* is the next session's practice.
     *
     * **Distinct from `note`, and the distinction is the point.** `note` is the coach's word on
     * how it went. This is the player's. Merging them would destroy the only thing that makes
     * this field worth having.
     *
     * **A quote, and nothing else is ever done with it.** Never parsed, never scored, never
     * counted, never aggregated, and never turned into a sentiment or a wellbeing signal —
     * anything read *out* of it beyond the words would be exactly the fabricated evidence
     * `engagement.ts` refuses. It is displayed verbatim or not at all.
     */
    playerSaid: optionalText(300).default(''),
    source: ChallengeSourceSchema.default('coach'),
    sourceActionId: CarryForwardActionIdSchema.nullable().default(null),
  })
  .superRefine((challenge, ctx) => {
    if (challenge.measure === 'count' && challenge.targetCount === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCount'],
        message: 'A counted challenge needs a target.',
      });
    }
    if (challenge.measure === 'judged' && challenge.targetCount !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCount'],
        message: 'A judged challenge cannot have a target — it is not counted.',
      });
    }
    if (challenge.status === 'open' && challenge.settledAt !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settledAt'],
        message: 'An open challenge has not been settled.',
      });
    }
    if (new Set(challenge.phaseIds).size !== challenge.phaseIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phaseIds'],
        message: 'Phase ids must be unique.',
      });
    }
  });
export type PlayerChallenge = z.infer<typeof PlayerChallengeSchema>;
export type PlayerChallengeInput = z.input<typeof PlayerChallengeSchema>;

/**
 * One sighting. **The tally is the event count, never a stored counter.**
 *
 * That is the same reasoning as the timer: a derived number cannot drift, cannot go negative
 * from a double-tapped Undo, and cannot disagree with the evidence it is meant to summarise.
 * It also means Review can say *when* the three forward passes happened, which a counter
 * throws away.
 */
export const ChallengeEventSchema = z.object({
  id: ChallengeEventIdSchema,
  challengeId: ChallengeIdSchema,
  /** Which phase it happened in — a challenge met in the warm-up is a different fact. */
  phaseId: PhaseIdSchema,
  at: IsoDateTimeSchema,
  /** Elapsed time within the phase, so Review can place it inside the practice. */
  phaseElapsedMs: z.number().int().min(0).default(0),
});
export type ChallengeEvent = z.infer<typeof ChallengeEventSchema>;
export type ChallengeEventInput = z.input<typeof ChallengeEventSchema>;

/** Is this challenge being watched for in the given phase? Empty `phaseIds` means always. */
export function isChallengeLiveInPhase(challenge: PlayerChallenge, phaseId: PhaseId): boolean {
  return challenge.phaseIds.length === 0 || challenge.phaseIds.includes(phaseId);
}

/**
 * `2/3` for a counted challenge, an em dash for a judged one.
 *
 * A judged challenge shows no fraction on purpose: a tally against a target that does not
 * exist is the kind of small lie that makes a coach stop trusting the rest of the screen.
 */
export function describeChallengeProgress(challenge: PlayerChallenge, count: number): string {
  return challenge.measure === 'judged' ? '—' : `${count}/${challenge.targetCount ?? 0}`;
}

/** Has the tally reached the target? Always false for a judged challenge — nothing to reach. */
export function hasHitTarget(challenge: PlayerChallenge, count: number): boolean {
  if (challenge.measure === 'judged' || challenge.targetCount === null) return false;
  return count >= challenge.targetCount;
}

/**
 * The status to *show*, which is not always the status stored.
 *
 * A counted challenge that has hit its target reads as `met` the moment it does, without
 * waiting for the coach to rule — the tally has already answered the question, and making
 * them confirm it would be asking twice. An explicit ruling always wins, including a coach
 * who taps `missed` on something the tally says was met, because they were there and it
 * wasn't.
 */
export function effectiveChallengeStatus(
  challenge: PlayerChallenge,
  count: number,
): ChallengeStatus {
  if (challenge.status !== 'open') return challenge.status;
  return hasHitTarget(challenge, count) ? 'met' : 'open';
}
