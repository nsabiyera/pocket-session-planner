import type { PhaseKind } from '../methodology';
import type { Observation } from '../observation';
import type { PhaseId } from '../ids';

/**
 * **Did the thing you isolated come back in the game?** (ADR 0011 §§6–7.)
 *
 * The last join TGfU asks for, and the one the model is named after: a session that strips a
 * problem out of the game and drills it has claimed nothing until the behaviour turns up in a
 * game again. The app can answer that from data it is already writing — every observation
 * carries a `phaseId` and the tags the coach tapped, and every phase carries a `kind`.
 *
 * ---
 *
 * **What it says, and what it must never say.**
 *
 * It reports **where a tag appeared**. Not that the skill transferred, not that anybody learned
 * anything, not that the practice worked. The wording rule is the one ADR 0009 phase 3 already
 * settled for the did-it-stick report, applied to a second join: *an absent observation is an
 * absence in the record*, because a coach coaching a point is a coach not logging. So the
 * sentences say *"nothing logged in a game"* and never *"it did not transfer"*.
 *
 * ---
 *
 * **Two narrowings, because the first cut of this report joined too much.**
 *
 * **It counts only what the session named.** The observation sheet's tag bank is wide, and most
 * of it is generic: six capabilities and the corner attributes are one tap away in every session
 * ever planned. Counting those made the report answer a question nobody asked — *did "running
 * with the ball" come back?* — when the practice had isolated something else entirely. So the
 * join is restricted to {@link transferSubject}: this session's coaching points, its predicted
 * misconception and the options its problem offers. Those are the tags a coach wrote down
 * *before* the session as the thing they were working on, which is exactly what makes an
 * appearance afterwards mean something. Everything else is still logged, still on the player's
 * timeline, still in the corner counts — it is simply not evidence about *this* practice.
 *
 * **A game before the practice is a diagnosis, not a return.** Whole-Part-Whole opens with a
 * WHOLE whose entire job is to find the problem, and Play-Practice-Play opens with a PLAY. Both
 * are games, and counting them as *"logged in a game"* let the report claim a behaviour came
 * back when it had only ever turned up on the way in. A game therefore counts only when it runs
 * **after** the first isolated phase — {@link phaseRoles}, which needs `order` and is why
 * {@link phaseRole} is no longer enough on its own. Whole-Part-Whole's `pairedWithPhaseId` gets
 * no separate branch: its second WHOLE is after the PART by construction, so ordering already
 * picks exactly the phase the pairing would have named.
 *
 * **The gate is structural rather than statistical.** Every other report in this app waits for
 * a sample — eight observations, twelve interventions, six sessions. This one waits for a
 * *shape*: an isolated practice **and** a game in the same session. Below that there is no
 * comparison to make at any sample size, and above it a single observation is a real record of
 * one thing appearing once. So there is no `MIN_` count here, deliberately, and
 * {@link hasEnoughForTransfer} is about the session rather than the evidence.
 *
 * **Below the gate it renders nothing** — not *"not enough evidence"*. That was the roadmap's
 * Phase 0 amendment 5, and it matters most here: a session with no isolated practice is most
 * sessions, so a line explaining its own absence would be the line a coach sees most often.
 */

/** Where a phase sits in the isolate-and-return arc. */
export type PhaseRole = 'isolated' | 'game' | 'neither';

/** The two kinds that take a problem out of the game to work on it. */
const ISOLATED_KINDS: ReadonlySet<PhaseKind> = new Set<PhaseKind>(['technical', 'skill_practice']);

/**
 * The kinds where the behaviour has to survive contact with a game.
 *
 * `phase_of_play` is in: it is opposed, directional and has a goal to attack, which is a game
 * form even though it is not a whole game. `custom` is out — a coach's own phase kind could be
 * anything, and guessing would file half the report under an assumption.
 */
const GAME_KINDS: ReadonlySet<PhaseKind> = new Set<PhaseKind>([
  'phase_of_play',
  'small_sided_game',
  'conditioned_game',
  'game',
]);

/**
 * The role a phase kind can play, before order is taken into account.
 *
 * On its own this is not enough to file an observation — a `game` here is any game form,
 * including the one that ran before the practice. {@link phaseRoles} is the one to call.
 */
export function phaseRole(kind: PhaseKind): PhaseRole {
  if (ISOLATED_KINDS.has(kind)) return 'isolated';
  return GAME_KINDS.has(kind) ? 'game' : 'neither';
}

/**
 * Every phase's role in this session, with the games before the practice demoted to `neither`.
 *
 * "Before the practice" is measured against the **first** isolated phase, not the nearest one: a
 * session that isolates twice is still one arc, and a game between the two blocks is a return
 * from the first of them. The module note explains why the pairing needs no branch here.
 */
export function phaseRoles(phases: readonly TransferPhase[]): Map<PhaseId, PhaseRole> {
  const isolated = phases.filter((phase) => ISOLATED_KINDS.has(phase.kind));
  const practiceAt = isolated.length > 0 ? Math.min(...isolated.map((p) => p.order)) : null;

  const roles = new Map<PhaseId, PhaseRole>();
  for (const phase of phases) {
    const byKind = phaseRole(phase.kind);
    const demoted = byKind === 'game' && (practiceAt === null || phase.order <= practiceAt);
    roles.set(phase.id, demoted ? 'neither' : byKind);
  }
  return roles;
}

export interface TagAppearance {
  /** In the plan's wording — a coaching point, the misconception, or one of the options. */
  readonly tag: string;
  readonly inPractice: number;
  readonly inGame: number;
}

export interface TransferRecord {
  readonly hasIsolatedPractice: boolean;
  /** A game **after** the practice. A session that only played on the way in has none. */
  readonly hasGame: boolean;
  /** Subject tags seen in an isolated practice or a later game, most-logged first. */
  readonly tags: readonly TagAppearance[];
}

/** `order` is load-bearing: it is what separates the diagnostic game from the return. */
export interface TransferPhase {
  readonly id: PhaseId;
  readonly kind: PhaseKind;
  readonly order: number;
}

export interface TransferInput {
  readonly phases: readonly TransferPhase[];
  /**
   * The tags this session named at plan time — the only ones counted. Usually
   * {@link transferSubject} of the session; taken as a parameter so the rule stays one
   * readable function rather than a lookup buried in the loop.
   */
  readonly subject: readonly string[];
  readonly observations: readonly Pick<Observation, 'phaseId' | 'tags'>[];
}

/** The shape {@link transferSubject} reads. Structural, so it fits a `Session` without importing one. */
export interface TransferSubjectInput {
  readonly objective: {
    readonly commonMisconception: string | null;
    readonly options: readonly string[];
  };
  readonly phases: readonly { readonly coachingPoints: readonly { readonly text: string }[] }[];
}

/**
 * **What this session set out to work on**, as the tags a coach can actually tap.
 *
 * Three sources, and each one is something written down before the whistle: every phase's
 * coaching points, the misconception the objective predicted, and the options its problem
 * offers. The tactical problem itself is not here — it is a pinned line in Do mode, never a
 * chip, so it can never be one of the tags on an observation.
 *
 * **Coaching points from every phase, not just the isolated one.** The practice and the game
 * carry different points, and the whole question is whether the practice's point turns up while
 * the coach is watching for the game's.
 *
 * Deduped case-insensitively, keeping the first wording, because that is the wording the report
 * will quote back.
 */
export function transferSubject(session: TransferSubjectInput): string[] {
  const texts = [
    ...session.phases.flatMap((phase) => phase.coachingPoints.map((point) => point.text)),
    session.objective.commonMisconception ?? '',
    ...session.objective.options,
  ];

  const byKey = new Map<string, string>();
  for (const raw of texts) {
    const text = raw.trim();
    if (text.length === 0) continue;
    const key = text.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, text);
  }
  return [...byKey.values()];
}

/**
 * Below this many lines the report is a list; above it, it is a page a coach scrolls past.
 *
 * Six was set when the join counted the whole tag bank. It stays at six now the join is
 * narrowed to {@link transferSubject}, because the subject is still wide enough to overflow it:
 * ten coaching points per phase, a misconception and up to four options.
 */
export const MAX_TRANSFER_LINES = 6;

export function transferRecord(input: TransferInput): TransferRecord {
  const roleByPhase = phaseRoles(input.phases);

  // Keyed case-insensitively and reported in the plan's wording: a coach who typed the same
  // point into two phases with different capitals meant one point, and the report says it once.
  const subjectByKey = new Map<string, string>();
  for (const raw of input.subject) {
    const text = raw.trim();
    if (text.length === 0) continue;
    const key = text.toLowerCase();
    if (!subjectByKey.has(key)) subjectByKey.set(key, text);
  }

  const counts = new Map<string, { inPractice: number; inGame: number }>();
  for (const observation of input.observations) {
    const role = roleByPhase.get(observation.phaseId);
    if (role === undefined || role === 'neither') continue;

    for (const raw of observation.tags) {
      const tag = subjectByKey.get(raw.trim().toLowerCase());
      // A capability chip or a corner attribute. Real, logged, and not about this practice.
      if (tag === undefined) continue;

      const entry = counts.get(tag) ?? { inPractice: 0, inGame: 0 };
      if (role === 'isolated') entry.inPractice += 1;
      else entry.inGame += 1;
      counts.set(tag, entry);
    }
  }

  const roles = [...roleByPhase.values()];

  return {
    hasIsolatedPractice: roles.includes('isolated'),
    hasGame: roles.includes('game'),
    // Most-logged first, then alphabetically so the order is stable between two renders of
    // the same review rather than depending on Map insertion.
    tags: [...counts.entries()]
      .map(([tag, entry]) => ({ tag, ...entry }))
      .sort(
        (a, b) => b.inPractice + b.inGame - (a.inPractice + a.inGame) || a.tag.localeCompare(b.tag),
      ),
  };
}

/**
 * Whether there is a comparison to make at all — a shape, not a sample. See the module note.
 */
export function hasEnoughForTransfer(record: TransferRecord): boolean {
  return record.hasIsolatedPractice && record.hasGame && record.tags.length > 0;
}

/**
 * *"4 things logged in the practice, 2 of them logged in a game as well."*
 *
 * A count of the record, twice over. There is no target ratio and the app never suggests one:
 * a session where nothing came back may be a session where the coach was busy coaching, and
 * the sentence says only what was logged.
 */
export function describeTransfer(record: TransferRecord): string {
  const practice = record.tags.filter((tag) => tag.inPractice > 0);
  const both = practice.filter((tag) => tag.inGame > 0).length;
  const gameOnly = record.tags.filter((tag) => tag.inPractice === 0).length;

  if (practice.length === 0) {
    // Nothing tagged in the isolated practice at all. The game tags are still worth naming,
    // because a behaviour that only turns up in the game is the interesting case.
    return `Nothing logged in the practice. ${count(gameOnly, 'thing')} logged in a game.`;
  }

  /*
    Four wordings rather than one template, because "0 of them" and "1 of them" both read as
    though a machine wrote them — and this is the headline of the report, so it is the sentence
    a coach judges the whole feature by.
  */
  let head: string;
  if (practice.length === 1) {
    head =
      both === 1
        ? '1 thing logged in the practice, and it was logged in a game as well.'
        : '1 thing logged in the practice, and nothing logged in a game.';
  } else if (both === 0) {
    head = `${practice.length} things logged in the practice, none of them logged in a game.`;
  } else {
    head = `${practice.length} things logged in the practice, ${both} of them logged in a game as well.`;
  }

  return gameOnly === 0
    ? head
    : `${head} ${count(gameOnly, 'other thing')} turned up only in a game.`;
}

/**
 * *"'Head up before you receive' — logged twice in the practice and once in a game."*
 *
 * And the two halves that are only ever statements about the record: *"nothing in a game"* and
 * *"nothing in the practice"*. Neither is a verdict, and the module note explains why the
 * second one is the more interesting of the two.
 */
export function describeAppearance(appearance: TagAppearance): string {
  const { tag, inPractice, inGame } = appearance;

  if (inPractice > 0 && inGame > 0) {
    return `“${tag}” — logged ${times(inPractice)} in the practice and ${times(inGame)} in a game.`;
  }
  if (inPractice > 0) {
    return `“${tag}” — logged ${times(inPractice)} in the practice, and nothing in a game.`;
  }
  return `“${tag}” — logged ${times(inGame)} in a game, and nothing in the practice.`;
}

/** `once`, `twice`, `3 times` — the counting every other report line in the app uses. */
function times(n: number): string {
  if (n === 1) return 'once';
  return n === 2 ? 'twice' : `${n} times`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
