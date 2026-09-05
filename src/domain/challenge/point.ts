import { normaliseCoachingPointText } from '../coaching-point';
import type { PlayerId } from '../ids';
import type { ChallengeStatus } from '../challenge';

/**
 * **The ask, not the player.**
 *
 * `chainDepth >= 3` already tells a coach they have chased the same *coaching point* for
 * three sessions. This is the same idea one level down, on the promise made to one player:
 * a challenge set and missed three weeks running is far more likely to be pitched wrong than
 * to be evidence about the child.
 *
 * That is the Challenge Point Framework's only genuinely actionable claim — task difficulty
 * has to sit where the learner can still succeed — and it is the one place this app can
 * evidence it, because the coach has already ruled on each attempt.
 *
 * **Three honesty rules, and they are the whole module:**
 *
 * 1. **Never say "optimal challenge point", "learning" or "retention".** Guadagnoli & Lee
 *    measured *performance* against calibrated task difficulty. This measures performance
 *    against a target the same coach invented last Tuesday. Those are not the same claim.
 * 2. **Always name the coach as a possible cause.** *"The ask may be pitched wrong"* puts the
 *    hypothesis where it belongs. The app has no standing to conclude anything about a
 *    ten-year-old from three ticked boxes.
 * 3. **Stay silent below the threshold.** One bad week is not a calibration.
 */

/** Three is a pattern; two is a fortnight. Matches `CHAIN_DEPTH_WARNING`, deliberately. */
export const MIN_MISSES_FOR_SIGNAL = 3;

/** One challenge, as it was settled in one session. Ordered oldest first by the caller. */
export interface SettledChallenge {
  readonly playerId: PlayerId;
  readonly text: string;
  /** The **effective** status — a counted challenge that hit its target reads as met. */
  readonly status: ChallengeStatus;
}

export interface ChallengePointSignal {
  readonly playerId: PlayerId;
  /** The challenge text as most recently written, shown verbatim in the nudge. */
  readonly text: string;
  /** Consecutive misses, counting back from the most recent settled attempt. */
  readonly streak: number;
  /** Every settled attempt at this ask, missed or not. */
  readonly attempts: number;
}

/**
 * Challenges one player has been set and missed, `MIN_MISSES_FOR_SIGNAL` times running.
 *
 * **Consecutive, not cumulative.** A player who missed three, then met it, has moved on, and
 * saying otherwise would make the app look like it holds a grudge. The streak resets the
 * moment the ask is met — even partly.
 *
 * `open` attempts are **skipped, not counted as misses**. A challenge the coach never ruled
 * on is a challenge with no evidence either way, and treating silence as failure is exactly
 * the kind of small lie that makes a coach stop trusting the screen.
 */
export function challengePointSignals(
  history: readonly SettledChallenge[],
): ChallengePointSignal[] {
  // Key on player + normalised text, so "Three forward passes" and "three forward passes."
  // are the same ask. Same normalisation the carry-forward dedupe uses.
  const byAsk = new Map<string, SettledChallenge[]>();

  for (const entry of history) {
    if (entry.status === 'open') continue;
    const key = `${entry.playerId}|${normaliseCoachingPointText(entry.text)}`;
    byAsk.set(key, [...(byAsk.get(key) ?? []), entry]);
  }

  const signals: ChallengePointSignal[] = [];

  for (const attempts of byAsk.values()) {
    let streak = 0;
    // Count back from the most recent, stopping at anything that was not a miss.
    for (let i = attempts.length - 1; i >= 0; i -= 1) {
      if (attempts[i]!.status !== 'missed') break;
      streak += 1;
    }

    if (streak < MIN_MISSES_FOR_SIGNAL) continue;

    const latest = attempts[attempts.length - 1]!;
    signals.push({
      playerId: latest.playerId,
      text: latest.text,
      streak,
      attempts: attempts.length,
    });
  }

  // Longest streak first: the ask that has been wrong longest is the one to change.
  return signals.sort((a, b) => b.streak - a.streak);
}

/**
 * *"Kai has missed 'three forward passes' three sessions running. The ask may be pitched
 * wrong, not the player."*
 *
 * The second sentence is the entire point of the first one. Never ship one without the other.
 */
export function describeChallengePoint(signal: ChallengePointSignal, name: string): string {
  return `${name} has missed “${signal.text}” ${signal.streak} sessions running. The ask may be pitched wrong, not the player.`;
}
