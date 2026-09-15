import { spectrumLabel, targetsLabel, type PhaseConstraint } from '../practice';
import type { SessionPhase } from '../session';

/**
 * **Did the second game stay the same game?** (ADR 0011 §3.)
 *
 * Whole-Part-Whole's entire claim is that its two WHOLE games are the same game, played either
 * side of an isolated block, so that a change between them is about the players rather than
 * about the practice. Its own coach prompt has always said so — *"Phase 4 must be the SAME
 * game as phase 2, or you cannot claim transfer"* — and nothing in the app enforced it,
 * compared it, or recorded that it was ever asked.
 *
 * This compares the two, out of fields both phases already carry. No frozen snapshot, and no
 * new practice-design data: the pairing itself is one `PhaseId`, resolved at build time.
 *
 * ---
 *
 * **Three rules.**
 *
 * 1. **It never blocks the edit.** A coach shrinking the pitch because half the squad did not
 *    turn up has done nothing wrong, and an app that refused the change would be an app they
 *    stop using in the rain. It says what can no longer be compared and keeps both records.
 * 2. **It compares only what both phases recorded.** A grid on one and nothing on the other is
 *    not a difference, it is a gap — so it is passed over in silence rather than reported as a
 *    change. This is why the no-difference sentence says *everything recorded* and not
 *    *everything*.
 * 3. **It describes the practice, never the players.** *"Transfer is no longer a like-for-like
 *    comparison"* is a statement about two records. Whether anybody learned anything is not
 *    visible here and is never claimed — ADR 0009 §1, as it binds every line in this feature.
 */

export interface PairedPhases {
  /** The phase being matched against — always the lower `order` of the two. */
  readonly earlier: SessionPhase;
  /** The phase carrying `pairedWithPhaseId`. */
  readonly later: SessionPhase;
}

/**
 * Every pair in this session, in the order the later halves run.
 *
 * Reads `pairedWithPhaseId` only, so a session from a methodology with no pairing returns an
 * empty array and every caller renders nothing. The schema has already guaranteed the target
 * exists and comes earlier, so a pair that does not resolve here means the session was built
 * by an older release — and is skipped rather than defended against.
 */
export function pairedPhases(session: {
  readonly phases: readonly SessionPhase[];
}): PairedPhases[] {
  const byId = new Map(session.phases.map((phase) => [phase.id, phase]));

  return [...session.phases]
    .sort((a, b) => a.order - b.order)
    .flatMap((later) => {
      if (later.pairedWithPhaseId === null) return [];
      const earlier = byId.get(later.pairedWithPhaseId);
      return earlier ? [{ earlier, later }] : [];
    });
}

export interface PairComparison {
  readonly earlierTitle: string;
  readonly laterTitle: string;
  /**
   * What differs, each phrased to complete *"The second game …"*. Empty means nothing that
   * both phases recorded has changed.
   */
  readonly differences: readonly string[];
}

/** `people`, `task` and the rest, plus the coach's own words — the identity of a condition. */
const constraintKey = (constraint: PhaseConstraint): string =>
  `${constraint.letter}|${constraint.text.trim().toLowerCase()}`;

/**
 * The two phases, dimension by dimension.
 *
 * Deliberately five comparisons and no more: the grid, the numbers, how game-like, what they
 * played towards, and the conditions. `organisation` is prose and is not compared — ADR 0004
 * kept it unstructured precisely so nothing would try, and a diff of two paragraphs would be
 * noise a coach cannot act on.
 */
export function comparePair(pair: PairedPhases): PairComparison {
  const { earlier, later } = pair;
  const differences: string[] = [];

  if (earlier.area && later.area) {
    const longer = later.area.lengthM - earlier.area.lengthM;
    const wider = later.area.widthM - earlier.area.widthM;
    if (longer !== 0) {
      differences.push(`is ${Math.abs(longer)} m ${longer > 0 ? 'longer' : 'shorter'}`);
    }
    if (wider !== 0) {
      differences.push(`is ${Math.abs(wider)} m ${wider > 0 ? 'wider' : 'narrower'}`);
    }
  }

  if (
    earlier.groupSize !== null &&
    later.groupSize !== null &&
    earlier.groupSize !== later.groupSize
  ) {
    const more = later.groupSize - earlier.groupSize;
    const count = Math.abs(more);
    differences.push(`has ${count} ${more > 0 ? 'more' : 'fewer'} player${count === 1 ? '' : 's'}`);
  }

  if (earlier.spectrum !== null && later.spectrum !== null && earlier.spectrum !== later.spectrum) {
    differences.push(
      `is ${spectrumLabel(later.spectrum).toLowerCase()} rather than ${spectrumLabel(
        earlier.spectrum,
      ).toLowerCase()}`,
    );
  }

  if (earlier.targets !== null && later.targets !== null && earlier.targets !== later.targets) {
    differences.push(
      `plays to ${targetsLabel(later.targets).toLowerCase()} rather than ${targetsLabel(
        earlier.targets,
      ).toLowerCase()}`,
    );
  }

  // Conditions are always comparable: both games shipping with none is a real comparison, and
  // it is the one Whole-Part-Whole's two WHOLEs are supposed to make.
  const before = new Set(earlier.constraints.map(constraintKey));
  const after = new Set(later.constraints.map(constraintKey));
  const added = [...after].filter((key) => !before.has(key)).length;
  const dropped = [...before].filter((key) => !after.has(key)).length;

  if (added > 0) {
    differences.push(`has ${added} condition${added === 1 ? '' : 's'} the first did not`);
  }
  if (dropped > 0) {
    // Parallel with the added clause, and it has to be: "missing 1 of the first game's
    // condition" is not English, and pluralising the noun there reads as though the coach
    // dropped a whole set rather than one rule.
    differences.push(`drops ${dropped} condition${dropped === 1 ? '' : 's'} the first had`);
  }

  return { earlierTitle: earlier.title, laterTitle: later.title, differences };
}

/**
 * *"The second game is 5 m narrower and has 1 condition the first did not. Transfer is no
 * longer a like-for-like comparison."*
 *
 * And the case that confirms the method was followed, which is the one a Whole-Part-Whole
 * coach wants to see: *"Both games match on everything recorded, so the comparison holds."*
 *
 * **"Everything recorded" is doing real work.** A coach who set nothing on either phase gets
 * that sentence off one comparison — the conditions — and the qualifier is what stops it
 * reading as a guarantee. Rule 2 of the module note.
 */
export function describePair(comparison: PairComparison): string {
  if (comparison.differences.length === 0) {
    return 'Both games match on everything recorded, so the comparison holds.';
  }

  return `The second game ${listPhrases(comparison.differences)}. Transfer is no longer a like-for-like comparison.`;
}

/** `a, b and c` — *and* rather than the *or* every gap-naming line uses, because these all hold. */
function listPhrases(phrases: readonly string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? '';
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}
