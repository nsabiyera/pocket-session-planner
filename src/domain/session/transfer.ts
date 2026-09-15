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

export function phaseRole(kind: PhaseKind): PhaseRole {
  if (ISOLATED_KINDS.has(kind)) return 'isolated';
  return GAME_KINDS.has(kind) ? 'game' : 'neither';
}

export interface TagAppearance {
  /** The tag as the coach tapped it — a coaching point, an option, a capability, verbatim. */
  readonly tag: string;
  readonly inPractice: number;
  readonly inGame: number;
}

export interface TransferRecord {
  readonly hasIsolatedPractice: boolean;
  readonly hasGame: boolean;
  /** Tags seen in an isolated practice or a game, most-logged first. */
  readonly tags: readonly TagAppearance[];
}

export interface TransferInput {
  readonly phases: readonly { readonly id: PhaseId; readonly kind: PhaseKind }[];
  readonly observations: readonly Pick<Observation, 'phaseId' | 'tags'>[];
}

/**
 * Below this many lines the report is a list; above it, it is a page a coach scrolls past.
 *
 * Six because the tag bank is wide — this phase's coaching points, the misconception, the
 * options, six capabilities and the corner attributes are all one tap away, so a busy session
 * can carry a dozen distinct tags and the long tail is all singletons.
 */
export const MAX_TRANSFER_LINES = 6;

export function transferRecord(input: TransferInput): TransferRecord {
  const roleByPhase = new Map(input.phases.map((phase) => [phase.id, phaseRole(phase.kind)]));

  const counts = new Map<string, { inPractice: number; inGame: number }>();
  for (const observation of input.observations) {
    const role = roleByPhase.get(observation.phaseId);
    if (role === undefined || role === 'neither') continue;

    for (const raw of observation.tags) {
      const tag = raw.trim();
      if (tag.length === 0) continue;

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
