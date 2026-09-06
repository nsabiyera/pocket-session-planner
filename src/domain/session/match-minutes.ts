import type { PlayerId } from '../ids';
import { minutesPlayed } from '../match-day';
import type { Session } from '../session';
import { periodsOf } from './build-match';
import { phaseElapsedMs } from './timer';

/**
 * Minutes played, and who did not get any.
 *
 * This is the report match day exists for. Equal playing time is a duty of care in youth
 * football — the FA's own guidance is that everyone gets a meaningful game — and it is exactly
 * the arithmetic a coach cannot do from memory while managing rolling substitutions in the
 * rain. The score is recorded elsewhere and deliberately is not the headline.
 *
 * **It describes and does not prescribe.** There is no threshold in here, no warning colour,
 * no "you should have played Kai more". The app reports what the record says and lets the
 * coach be the one who knows that Kai arrived twenty minutes late.
 *
 * **Its resolution is a period, and it says so.** Minutes come from period presence rather
 * than a running clock per player, so a player who came on halfway through a half is credited
 * with the whole half. Anything finer would be a precision nobody actually entered.
 */

export interface PlayerMinutes {
  readonly playerId: PlayerId;
  readonly minutes: number;
  /** Of the minutes actually available in this match, 0-1. */
  readonly share: number;
  readonly periodsPlayed: number;
}

export interface MinutesReport {
  /** True once presence has been recorded for at least one period. */
  readonly recorded: boolean;
  /** Minutes the match actually ran, from the wall clock rather than the plan. */
  readonly availableMinutes: number;
  readonly periodCount: number;
  /**
   * **Least played first.** The whole reason to open this report is to find the player who
   * barely got on, and putting them at the bottom of a sorted-by-most list is the one
   * ordering that hides the answer.
   */
  readonly rows: readonly PlayerMinutes[];
  /** The gap between the most and least played, in minutes. Null when nobody played. */
  readonly spreadMinutes: number | null;
}

/**
 * What each period actually ran, keyed by phase id.
 *
 * Derived from the run's wall-clock anchors, so a half the referee stretched reports the
 * minutes it really lasted rather than the minutes it was planned to. A coach who went back
 * to a period leaves two `PhaseRun`s for it; both count.
 */
export function periodMinutes(session: Session, nowMs = Date.now()): Map<string, number> {
  const minutes = new Map<string, number>();
  if (session.run === null) return minutes;

  const periodIds = new Set(periodsOf(session).map((period) => period.id));

  for (const run of session.run.phaseRuns) {
    if (!periodIds.has(run.phaseId)) continue;
    if (run.skipped) continue;
    const elapsed = phaseElapsedMs(run, nowMs) / 60_000;
    minutes.set(run.phaseId, (minutes.get(run.phaseId) ?? 0) + elapsed);
  }

  // Rounded once, at the end, so two halves of 22.5 report 45 rather than 44.
  for (const [phaseId, value] of minutes) minutes.set(phaseId, Math.round(value));
  return minutes;
}

/**
 * The report. `playerIds` is the squad, so a player who never came on appears with zero
 * rather than being silently absent from a list about who played.
 *
 * A player with no presence record at all still shows — that is the point. `minutesPlayed`
 * distinguishes absent from benched at the data layer; here, on a report about *this* match,
 * both read as zero minutes and the coach knows which is which.
 */
export function matchMinutes(
  session: Session,
  playerIds: readonly PlayerId[],
  nowMs = Date.now(),
): MinutesReport | null {
  if (session.kind !== 'match' || session.match === null) return null;

  const byPeriod = periodMinutes(session, nowMs);
  const availableMinutes = [...byPeriod.values()].reduce((total, value) => total + value, 0);
  const totals = minutesPlayed(session.match, byPeriod);

  const periodsFor = new Map<string, number>();
  for (const period of session.match.presence) {
    for (const playerId of period.playerIds) {
      periodsFor.set(playerId, (periodsFor.get(playerId) ?? 0) + 1);
    }
  }

  const rows: PlayerMinutes[] = playerIds.map((playerId) => {
    const minutes = totals.get(playerId) ?? 0;
    return {
      playerId,
      minutes,
      share: availableMinutes === 0 ? 0 : minutes / availableMinutes,
      periodsPlayed: periodsFor.get(playerId) ?? 0,
    };
  });

  // Least first, then by name-stable player id so the order does not shuffle between renders.
  rows.sort((a, b) => a.minutes - b.minutes || a.playerId.localeCompare(b.playerId));

  const played = rows.filter((row) => row.minutes > 0).map((row) => row.minutes);
  const spreadMinutes = played.length === 0 ? null : Math.max(...played) - Math.min(...played);

  return {
    recorded: session.match.presence.length > 0,
    availableMinutes,
    periodCount: session.match.periodCount,
    rows,
    spreadMinutes,
  };
}

/**
 * One sentence, or nothing.
 *
 * Nothing is the right answer when presence was not recorded: a report that says "0 minutes
 * for everyone" would be an accusation built out of a coach not having ticked a box.
 */
export function describeMinutes(report: MinutesReport | null): string | null {
  if (report === null || !report.recorded || report.availableMinutes === 0) return null;

  const played = report.rows.filter((row) => row.minutes > 0);
  if (played.length === 0) return null;

  const unused = report.rows.length - played.length;
  const low = played[0]!.minutes;
  const high = played[played.length - 1]!.minutes;

  const span =
    low === high
      ? `${played.length} played, ${low} minutes each`
      : `${played.length} played, between ${low} and ${high} minutes`;

  const bench = unused === 0 ? '' : ` ${unused} did not get on.`;
  return `${span} of ${report.availableMinutes}.${bench} To the nearest ${report.periodCount === 2 ? 'half' : 'quarter'}.`;
}
