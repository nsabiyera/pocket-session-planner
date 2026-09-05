/**
 * **Player engagement** — the fourth area of the FA's coach planning and reflective model,
 * and the one this app modelled at all until now.
 *
 * The theory with the best evidence behind it in youth football is self-determination theory:
 * coach *autonomy support* predicts motivation and commitment
 * (https://pmc.ncbi.nlm.nih.gov/articles/PMC8394926/). SDT names three needs — autonomy,
 * competence, relatedness — and this module is deliberately honest about which of the three
 * this app can see.
 *
 * | Need | What the app has |
 * | --- | --- |
 * | Autonomy | **A fact, not a feeling.** One toggle: did the players choose something here? |
 * | Competence | **Already derivable**, from challenge verdicts (`challengePointSignals`) and scan deltas (`capabilityDeltas`). Not re-measured here. |
 * | Relatedness | **Nothing.** See below. |
 *
 * ---
 *
 * **Three rules, and the first one is the important one.**
 *
 * 1. **A checkbox cannot measure autonomy.** SDT is about the player's *experience* of
 *    volition. This records a coach's intention, in the coach's own app, on their own say-so.
 *    Those are different things, so every sentence here says *"players chose something"* and
 *    the words *autonomy*, *motivation* and *commitment* never reach the screen.
 * 2. **Relatedness is not modelled and not proxied.** Whether a player feels they belong is
 *    not visible from a session plan, and a stand-in built from attendance or observation
 *    counts would be a number that looks like evidence and is not. Same precedent as
 *    *"Deception isn't taggable yet."* — name the blind spot, do not paper over it.
 * 3. **Never scold a run of noes.** An untouched toggle reads as *"no player choices
 *    recorded"* — a statement about the record — and never as *"players chose nothing"*, which
 *    would be a verdict on a session drawn from a box nobody tapped. The zero case is a
 *    count like any other, with no suggestion attached.
 *
 * **Designed for a player-facing view later.** `playerChoice` is a fact about the *phase*, not
 * a rating of the coach, so a read-only summary shared with a player or a parent can include
 * it without anything here needing a rewrite.
 */

export interface ChoiceSummary {
  /** Phases where the coach recorded that the players chose something. */
  readonly phasesWithChoice: number;
  /**
   * Phases where a choice could have been offered — everything but a water break, which is
   * not a coaching moment at all. Huddles count: *"leave with one agreed adjustment"* is a
   * choice, and Guided Discovery's whole method turns on it.
   */
  readonly phasesConsidered: number;
}

/**
 * *"Players chose something in 1 phase of 5."*
 *
 * A count of what the coach recorded, and nothing else. No target, no share, no trend — see
 * rule 1 above for why this stops at the number.
 */
export function describeChoice(summary: ChoiceSummary): string {
  if (summary.phasesConsidered === 0) return 'No phases to look at.';

  // **Not** "players chose nothing". The toggle defaults to off, so zero means *nothing was
  // recorded* at least as often as it means *nothing was offered* — and a line that reads as
  // a verdict on the players, from a box the coach simply never tapped, is a small lie.
  if (summary.phasesWithChoice === 0) {
    return `No player choices recorded, across ${summary.phasesConsidered} phase${
      summary.phasesConsidered === 1 ? '' : 's'
    }.`;
  }

  return `Players chose something in ${summary.phasesWithChoice} phase${
    summary.phasesWithChoice === 1 ? '' : 's'
  } of ${summary.phasesConsidered}.`;
}

/**
 * Whether the line is worth showing at all.
 *
 * A session with one phase has nothing to compare, and the report would be restating the
 * toggle back at the coach.
 */
export function hasEnoughForChoice(summary: ChoiceSummary): boolean {
  return summary.phasesConsidered >= 2;
}
