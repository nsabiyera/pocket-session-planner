'use client';

import { describeMinutes, matchMinutes } from '@/domain/session/match-minutes';
import { matchOutcome } from '@/domain/match-day';
import { shortPlayerName, type Player } from '@/domain/player';
import type { Session } from '@/domain/session';

/**
 * Minutes played, least first.
 *
 * The report match day exists for. Equal playing time is a duty of care in youth football and
 * it is the arithmetic a coach cannot do from memory on a touchline — so the app does it, and
 * then says nothing about what the numbers mean.
 *
 * **No threshold, no warning colour, no advice.** A short bar is a fact, not an accusation:
 * the coach is the one who knows the player arrived twenty minutes late, or asked to come off,
 * or is managing an injury. Describing and declining to prescribe is the same stance the
 * practice-mix and relative-playing-area reports already take.
 */
export function MinutesReport({
  session,
  players,
  nowMs,
}: {
  session: Session;
  players: readonly Player[];
  nowMs?: number;
}) {
  const report = matchMinutes(
    session,
    players.map((player) => player.id),
    nowMs,
  );
  const sentence = describeMinutes(report);

  if (report === null) return null;

  // Nothing ticked means nothing to say. A grid of zeroes would be an accusation assembled
  // out of a coach not having opened a sheet.
  if (!report.recorded || sentence === null) {
    return (
      <div className="card card--sunk">
        <span className="card-title">Minutes</span>
        <p className="card-meta">
          Nobody was ticked on for a period, so there are no minutes to report. You can still record
          it — open the session and tick each period.
        </p>
      </div>
    );
  }

  const nameOf = (id: string) => {
    const player = players.find((candidate) => candidate.id === id);
    return player ? shortPlayerName(player, players) : 'Unknown';
  };

  const outcome = matchOutcome(session.match?.result ?? null);

  return (
    <section className="stack">
      <h2>Minutes</h2>

      <div className="banner banner--signal">{sentence}</div>

      <ul className="stack stack--tight">
        {report.rows.map((row) => (
          <li key={row.playerId} className="minutes-row">
            <span className="minutes-row__name">{nameOf(row.playerId)}</span>
            {/*
              The bar is the scan; the number is the answer. `aria-hidden` on the bar because
              the figure beside it already says the same thing to a screen reader.
            */}
            <span className="minutes-row__track" aria-hidden="true">
              <span
                className="minutes-row__fill"
                style={{ width: `${Math.round(row.share * 100)}%` }}
              />
            </span>
            <span className="minutes-row__value tabular">
              {row.minutes === 0 ? 'none' : `${row.minutes}′`}
            </span>
          </li>
        ))}
      </ul>

      {outcome ? <p className="card-meta">{outcome}.</p> : null}
    </section>
  );
}
