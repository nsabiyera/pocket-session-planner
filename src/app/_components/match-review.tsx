'use client';

import { useState } from 'react';
import { Stepper } from './ui';
import { showToast } from './toast-host';
import { getServiceContext, refresh } from '@/modules/app/app-store';
import { setMatchResult, setUnitObjectiveStatus } from '@/modules/run/run-service';
import { CHALLENGE_STATUSES, challengeStatusLabel, type ChallengeStatus } from '@/domain/challenge';
import { MATCH_UNIT_LABELS, describeFixture, matchOutcome } from '@/domain/match-day';
import { isErr } from '@/lib/result';
import type { Session } from '@/domain/session';

/**
 * The match half of Review: the fixture, what each unit was asked to do, and the score.
 *
 * The unit verdicts use the same met / partly / missed as a player challenge, and the same
 * gesture — tapping the verdict already recorded clears it. A coach who has learned those
 * three words once should not have to learn a second set for a unit.
 *
 * The score sits **last and quietest**. It is recorded because a coach will want it, and
 * nothing in carry-forward reads it: a result is not evidence about a player.
 */
export function MatchReview({ session }: { session: Session }) {
  if (session.kind !== 'match' || session.match === null) return null;
  const match = session.match;

  return (
    <section className="stack">
      <h2>The match</h2>
      <p className="card-meta">
        {describeFixture(match)} · {match.format}
        {match.shapeName === null ? '' : ` · ${match.shapeName}`}
      </p>

      {match.unitObjectives.length > 0 ? (
        <div className="stack">
          <p className="eyebrow">Did the units do it?</p>
          {match.unitObjectives.map((objective) => (
            <UnitRow
              key={objective.unit}
              sessionId={session.id}
              unit={objective.unit}
              text={objective.text}
              status={objective.status}
            />
          ))}
        </div>
      ) : null}

      <ScoreRow session={session} />
    </section>
  );
}

function UnitRow({
  sessionId,
  unit,
  text,
  status,
}: {
  sessionId: Session['id'];
  unit: keyof typeof MATCH_UNIT_LABELS;
  text: string;
  status: ChallengeStatus;
}) {
  const [busy, setBusy] = useState(false);

  const rule = async (next: ChallengeStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await setUnitObjectiveStatus(
        getServiceContext(),
        sessionId,
        unit,
        // Same gesture both ways: re-tapping the recorded verdict clears it.
        status === next ? 'open' : next,
      );
      if (isErr(result)) {
        showToast('Could not save that ruling.', { tone: 'stop' });
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <span className="card-title">{MATCH_UNIT_LABELS[unit]}</span>
      <span className="card-meta">{text}</span>
      <div className="row row--wrap">
        {CHALLENGE_STATUSES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="chip"
            aria-pressed={status === candidate}
            disabled={busy}
            onClick={() => void rule(candidate)}
          >
            {challengeStatusLabel(candidate)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The score, behind a disclosure.
 *
 * Behind one on purpose: opening Review after a match should show you who did not get on
 * before it shows you whether you won. A coach who wants the score is one tap away and knows
 * where to look.
 */
function ScoreRow({ session }: { session: Session }) {
  const recorded = session.match?.result ?? null;
  const [goalsFor, setGoalsFor] = useState(recorded?.goalsFor ?? 0);
  const [goalsAgainst, setGoalsAgainst] = useState(recorded?.goalsAgainst ?? 0);
  const [busy, setBusy] = useState(false);

  const save = async (result: { goalsFor: number; goalsAgainst: number } | null) => {
    setBusy(true);
    try {
      const saved = await setMatchResult(getServiceContext(), session.id, result);
      if (isErr(saved)) {
        showToast('Could not save the score.', { tone: 'stop' });
        return;
      }
      await refresh();
      showToast(result === null ? 'Score cleared' : (matchOutcome(result) ?? 'Score saved'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="card card--sunk" open={recorded !== null}>
      <summary>{recorded === null ? 'Add the score' : matchOutcome(recorded)}</summary>
      <div className="stack">
        <Stepper label="Us" value={goalsFor} min={0} max={30} step={1} onChange={setGoalsFor} />
        <Stepper
          label="Them"
          value={goalsAgainst}
          min={0}
          max={30}
          step={1}
          onChange={setGoalsAgainst}
        />
        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void save({ goalsFor, goalsAgainst })}
          >
            Save the score
          </button>
          {recorded === null ? null : (
            <button
              type="button"
              className="btn btn--quiet"
              disabled={busy}
              onClick={() => void save(null)}
            >
              Clear
            </button>
          )}
        </div>
        <p className="card-meta">
          Recorded for you. Nothing in the app&apos;s carry-forward reads it — a result is not
          evidence about a player.
        </p>
      </div>
    </details>
  );
}
