import { challengeStatusLabel, type ChallengeStatus } from './challenge';
import type { PlayerId } from './ids';
import type { Observation, ObservationRatingKind } from './observation';

/**
 * **The player card** (ADR 0009 §4) — the first artefact in this app intended for somebody
 * other than the coach.
 *
 * One player, one session, read out in the huddle. Hattie and Timperley's three questions in
 * their order, which is not a coincidence and is the reason the fields are in this order:
 *
 * | Their question | This card |
 * | --- | --- |
 * | Where am I going? | `ask` — the challenge you were set, or why you were a focus |
 * | How am I going? | `challenge` and `wentWell` — the tally or the verdict, and one thing that worked |
 * | Where to next? | `workOn` — one thing, quoted from what was logged |
 *
 * **The third question is not `FocusPlayerReview.nextStep`**, which is what the roadmap
 * proposed. That field is written on `/review`, twenty minutes after everyone has gone home,
 * and this card is read out on the pitch — so at huddle scale *"where to next"* is the one
 * thing to work on, tonight, in the words that were logged about it. Last week's next step
 * does reach the card, as `ask`: it is already carried verbatim into this session's focus-player
 * reason, which is exactly what *"where am I going"* means.
 *
 * ---
 *
 * **Four rules the shape enforces, so the coach cannot easily do it badly.**
 *
 * 1. **Quote, never summarise.** Every line is text somebody typed or tapped — a challenge as
 *    written, a tag as tapped, a focus reason as carried. *"Well done today"* cannot be
 *    produced by this type, because there is no field it could go in.
 * 2. **One thing forward.** `workOn` is one item, not a list. A player given three things has
 *    been given none, and the cap is structural rather than advisory.
 * 3. **Task, not person.** Nothing here is a rating, a count of observations, a corner, a
 *    capability score or a comparison with a teammate. The card describes what was done.
 * 4. **Silence over invention.** A player with nothing logged gets `isEmpty`, and the screen
 *    says so — the same omission `/review` already flags for focus players, made usable
 *    instead of merely reproachful.
 *
 * **Derived, never stored.** So it cannot drift from the evidence, and there is nothing to
 * migrate, export or leak. It is also not in the export: a stored card would be a document
 * about a child, and this is a view over facts that already exist.
 *
 * **One thing the roadmap asked for that cannot be done.** Rule 3 was meant to prefer
 * `ObservationKind.effort`, *"because effort is what a player can act on next week"*. Nothing
 * in the app has ever written an `effort` observation — the sheet derives `kind` from the
 * three tokens, and none of them maps to it. So the preference is implemented, because an
 * imported file could carry one, and it will simply never fire on data this app produced.
 * Naming the blind spot rather than papering over it, as usual.
 */

/** One line of evidence, as it was logged. Never summarised, never scored. */
export interface CardNote {
  /** The tag the coach tapped, verbatim. */
  readonly text: string;
  /** True when this came from an `effort` observation — attitude rather than ability. */
  readonly aboutEffort: boolean;
}

export interface CardChallenge {
  /** The ask, exactly as the coach wrote it. */
  readonly text: string;
  /** `2/3`, or an em dash for a judged challenge. */
  readonly label: string;
  readonly status: ChallengeStatus;
  /** `Met` / `Partly` / `Missed`, or null while it is still open. */
  readonly verdict: string | null;
  /**
   * **What the player said about it**, verbatim (ADR 0009 phase 7).
   *
   * The only line on this card that is not the coach's own words, which makes it the safest
   * thing on it: reading a player their own sentence back is a check, not a judgement. Empty
   * when they were not asked, and the card simply shows nothing.
   */
  readonly said: string;
}

export interface PlayerCard {
  readonly playerId: PlayerId;
  readonly name: string;
  /** *Where am I going* — the challenge, or the reason they were a focus player. */
  readonly ask: string | null;
  readonly challenge: CardChallenge | null;
  /** *How am I going* — one thing that worked. */
  readonly wentWell: CardNote | null;
  /** *Where to next* — one thing, and only one. */
  readonly workOn: CardNote | null;
  /** Nothing was logged and nothing was asked. The card says so rather than inventing. */
  readonly isEmpty: boolean;
}

export interface PlayerCardInput {
  readonly playerId: PlayerId;
  /** Short form, as Do mode already renders it. */
  readonly name: string;
  /** `FocusPlayerAssignment.reason` — usually last review's next step, carried verbatim. */
  readonly focusReason: string | null;
  /** This player's challenge for the session, with its derived tally. */
  readonly challenge: CardChallenge | null;
  /** This player's observations for this session, oldest first. */
  readonly observations: readonly Pick<Observation, 'ratingKind' | 'kind' | 'tags'>[];
  /**
   * `Objective.commonMisconception`. A `struggled` observation carrying this tag is the best
   * possible *work on* line, because it is the thing the coach predicted and can therefore
   * explain — which is the whole reason phase 2 exists.
   */
  readonly misconception: string | null;
}

/** The ratings that can supply a *went well* line, and the ones that supply a *work on*. */
const WELL: ObservationRatingKind = 'good';
const WORK_ON: readonly ObservationRatingKind[] = ['struggled', 'working'];

export function playerCard(input: PlayerCardInput): PlayerCard {
  const wentWell = pickWell(input.observations);
  const workOn = pickWorkOn(input.observations, input.misconception);

  // The challenge wins the `ask` line: it is what this player was actually asked to do
  // *today*, where the focus reason is why they were being watched at all.
  const ask = input.challenge?.text ?? emptyToNull(input.focusReason);

  return {
    playerId: input.playerId,
    name: input.name,
    ask,
    challenge: input.challenge,
    wentWell,
    workOn,
    isEmpty: ask === null && wentWell === null && workOn === null,
  };
}

/**
 * The most recent `good` observation that actually says something.
 *
 * **Tagged wins over untagged**, because an untagged `good` gives a player nothing to hold on
 * to — *"you were good"* is the person-level praise rule 3 exists to prevent. Most recent
 * within that, because the end of the session is what the huddle is about.
 */
function pickWell(
  observations: readonly Pick<Observation, 'ratingKind' | 'kind' | 'tags'>[],
): CardNote | null {
  const candidates = observations.filter(
    (observation) => observation.ratingKind === WELL && firstTag(observation) !== null,
  );
  return noteOf(preferEffort(candidates));
}

/**
 * The one thing to work on, in order of how much it gives the player:
 *
 * 1. a `struggled` observation tagged with the **predicted misconception** — the coach called
 *    this in advance, so they can explain it in one sentence;
 * 2. any other `struggled`;
 * 3. a `working`, which is a player already wrestling with it.
 *
 * Untagged observations are skipped throughout: *"you struggled"* is exactly the sentence this
 * card exists to make impossible.
 */
function pickWorkOn(
  observations: readonly Pick<Observation, 'ratingKind' | 'kind' | 'tags'>[],
  misconception: string | null,
): CardNote | null {
  const tagged = observations.filter((observation) => firstTag(observation) !== null);
  const predicted = misconception?.trim().toLowerCase() ?? '';

  if (predicted.length > 0) {
    const onThePrediction = tagged.filter(
      (observation) =>
        observation.ratingKind === 'struggled' &&
        observation.tags.some((tag) => tag.trim().toLowerCase() === predicted),
    );
    const pick = preferEffort(onThePrediction);
    if (pick) return noteOf(pick);
  }

  for (const rating of WORK_ON) {
    const pick = preferEffort(tagged.filter((observation) => observation.ratingKind === rating));
    if (pick) return noteOf(pick);
  }
  return null;
}

/**
 * Rule 3's preference, and the one thing the roadmap asked for that this app cannot feed.
 *
 * Effort is what a player can act on next week, so an `effort` observation beats an ability
 * one. Nothing has ever written one — see the note at the top — so in practice this always
 * falls through to the most recent, which is the honest behaviour rather than a pretence.
 */
function preferEffort<T extends Pick<Observation, 'kind'>>(candidates: readonly T[]): T | null {
  const effort = candidates.filter((candidate) => candidate.kind === 'effort');
  const pool = effort.length > 0 ? effort : candidates;
  return pool[pool.length - 1] ?? null;
}

function noteOf(
  observation: Pick<Observation, 'ratingKind' | 'kind' | 'tags'> | null,
): CardNote | null {
  if (!observation) return null;
  const text = firstTag(observation);
  if (text === null) return null;
  return { text, aboutEffort: observation.kind === 'effort' };
}

/**
 * **One tag, not all of them.** A coach can tap four tags on one observation; reading four
 * back at a player is rule 2 broken sideways. The first is the one they reached for first.
 */
function firstTag(observation: Pick<Observation, 'tags'>): string | null {
  for (const tag of observation.tags) {
    const trimmed = tag.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function emptyToNull(text: string | null): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** `Met` / `Partly` / `Missed`, or null while the coach has not ruled. */
export function challengeVerdict(status: ChallengeStatus): string | null {
  return status === 'open' ? null : challengeStatusLabel(status);
}

/**
 * *"Nothing logged for Kai today."*
 *
 * The empty card, said plainly. Not an apology and not a rebuke — a coach who spent the whole
 * session fixing a rondo logged nothing about anybody, and that is a fact about the record.
 */
export function describeEmptyCard(name: string): string {
  return `Nothing logged for ${name} today.`;
}

/**
 * Every card the huddle needs, in one pass over a session.
 *
 * **Who gets a card**: anyone the coach was watching — a focus player, or a player holding a
 * challenge. Not the whole squad, which is both the honest scope (Do mode can only log against
 * focus players) and the answer to the roadmap's *"twelve cards in two minutes"* worry: there
 * are two or three of these, not twelve.
 *
 * Ordered focus players first in their planned order, then challenge-only players, so the
 * sheet reads the same way twice running — muscle memory matters more than cleverness at 8:40
 * on a wet Tuesday.
 */
export interface PlayerCardsInput {
  readonly focusPlayers: readonly { readonly playerId: PlayerId; readonly reason?: string }[];
  /** One entry per player holding a challenge, already carrying its derived tally. */
  readonly challenges: readonly { readonly playerId: PlayerId; readonly card: CardChallenge }[];
  readonly observations: readonly Pick<Observation, 'playerId' | 'ratingKind' | 'kind' | 'tags'>[];
  readonly misconception: string | null;
  /** Short name, resolved by the caller — only the UI knows how to disambiguate two Kais. */
  readonly nameOf: (playerId: PlayerId) => string;
}

export function playerCards(input: PlayerCardsInput): PlayerCard[] {
  const order: PlayerId[] = [];
  const seen = new Set<PlayerId>();
  for (const focus of input.focusPlayers) {
    if (seen.has(focus.playerId)) continue;
    seen.add(focus.playerId);
    order.push(focus.playerId);
  }
  for (const entry of input.challenges) {
    if (seen.has(entry.playerId)) continue;
    seen.add(entry.playerId);
    order.push(entry.playerId);
  }

  return order.map((playerId) =>
    playerCard({
      playerId,
      name: input.nameOf(playerId),
      focusReason: input.focusPlayers.find((focus) => focus.playerId === playerId)?.reason ?? null,
      challenge: input.challenges.find((entry) => entry.playerId === playerId)?.card ?? null,
      observations: input.observations.filter((observation) => observation.playerId === playerId),
      misconception: input.misconception,
    }),
  );
}
