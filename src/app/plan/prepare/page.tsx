'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, formatShortDate } from '../../_components/ui';
import { showToast } from '../../_components/toast-host';
import { PeriodizationOff } from '../../_components/periodization-off';
import {
  getServiceContext,
  periodizationEnabled,
  refresh,
  useAppState,
} from '@/modules/app/app-store';
import { getGameModel } from '@/modules/planning/game-model-service';
import { setUnitObjective } from '@/modules/run/run-service';
import { reviewWeek } from '@/domain/game-model/week-review';
import {
  describeCandidate,
  describePreparation,
  prepareMatch,
  type BriefedUnit,
  type MatchPreparation,
} from '@/domain/game-model/match-prep';
import { morphocycleFor, type CycleSession } from '@/domain/morphocycle';
import { describeFixture } from '@/domain/match-day';
import { isErr } from '@/lib/result';
import type { GameModel, Principle } from '@/domain/game-model';
import type { Session } from '@/domain/session';
import type { SessionId } from '@/domain/ids';

/**
 * Match preparation — what the week trained, turned into what you say to each unit.
 *
 * The screen the original request described, and the last phase because it is mostly a view
 * over everything before it. The one new thing it does is close the loop the whole feature
 * exists for: **a principle worked three times on the training pitch and briefed to nobody on
 * Saturday is the gap between a game model and a game.**
 *
 * It offers the week's principles as candidate wording and lets the coach pick the unit,
 * because a principle belongs to a *moment* and a moment is not a unit — "build from the back"
 * concerns the keeper, the defence and the midfield at once. Deriving one from the other would
 * be inventing a fact, so the app turns typing into tapping and stops there.
 */
export default function PreparePage() {
  const state = useAppState();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [model, setModel] = useState<GameModel | null>(null);

  const squadId = state.squad?.id;

  const reload = useCallback(async () => {
    if (!squadId) return;
    const ctx = getServiceContext();
    const [rows, found] = await Promise.all([
      ctx.store.sessions.listBySquad(squadId, { limit: 60 }),
      getGameModel(ctx, squadId),
    ]);
    setSessions(rows);
    setModel(found ?? null);
  }, [squadId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!periodizationEnabled(state)) return <PeriodizationOff title="Match brief" />;

  if (sessions === null) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!state.squad) {
    return (
      <Screen>
        <ScreenHead title="No squad yet" />
        <Link href="/" className="btn btn--primary btn--block">
          Create a squad first
        </Link>
      </Screen>
    );
  }

  const squad = state.squad;

  // The next fixture, or the most recent — a coach opening this on Sunday wants the game they
  // just played rather than an empty screen.
  const nowIso = new Date().toISOString();
  const matches = sessions
    .filter((session) => session.kind === 'match' && session.match !== null)
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1));
  const fixture = matches.find((m) => m.scheduledFor >= nowIso) ?? matches[matches.length - 1];

  if (!fixture?.match) {
    return (
      <Screen>
        <ScreenHead eyebrow="Match brief" title={squad.name} />
        <Empty>No fixture to prepare for yet.</Empty>
        <Link href="/plan/fixtures" className="btn btn--primary btn--block">
          Add your fixtures
        </Link>
      </Screen>
    );
  }

  const cycle = morphocycleFor(toCycleSession(fixture), sessions.map(toCycleSession), {
    level: squad.level,
  });
  const review = reviewWeek(
    cycle,
    model,
    (sessionId) => sessions.find((s) => s.id === sessionId)?.objective.principleId ?? null,
  );
  const prep = prepareMatch(fixture.match, review);
  const summary = describePreparation(prep);

  return (
    <Screen>
      <ScreenHead eyebrow="Match brief" title={describeFixture(fixture.match)} />

      <div className="card">
        <span className="card-title">{formatShortDate(fixture.scheduledFor)}</span>
        <span className="card-meta">
          {fixture.match.format}
          {fixture.match.shapeName === null ? '' : ` · ${fixture.match.shapeName}`} ·{' '}
          {fixture.objective.text}
        </span>
      </div>

      {summary === null ? null : <p className="banner banner--signal">{summary}</p>}

      {prep.unbriefed.length > 0 ? (
        <section className="stack">
          <h2>Trained this week, briefed to nobody</h2>
          <ul className="stack stack--tight">
            {prep.unbriefed.map((principle) => (
              <li key={principle.id} className="card-meta">
                {principle.text} — {describeCandidate(principle)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack">
        <h2>The brief</h2>
        {prep.units.map((unit) => (
          <UnitBrief
            key={unit.unit}
            sessionId={fixture.id}
            unit={unit}
            candidates={prep.candidates}
            onChanged={reload}
          />
        ))}
      </section>

      <PrepNote prep={prep} hasModel={model !== null} />
    </Screen>
  );
}

function UnitBrief({
  sessionId,
  unit,
  candidates,
  onChanged,
}: {
  sessionId: SessionId;
  unit: BriefedUnit;
  candidates: readonly Principle[];
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState(unit.objective?.text ?? '');
  const [busy, setBusy] = useState(false);

  // Keep the field in step when a reload brings different wording — a coach editing on a
  // second device should not have their box overwritten mid-type, so this tracks the unit only.
  useEffect(() => {
    setText(unit.objective?.text ?? '');
  }, [unit.objective?.text]);

  const save = async (value: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await setUnitObjective(getServiceContext(), sessionId, unit.unit, value);
      if (isErr(result)) {
        showToast('Could not save that.', { tone: 'stop' });
        return;
      }
      await refresh();
      await onChanged();
      showToast(value.trim() === '' ? `${unit.label} cleared` : `${unit.label} briefed`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <span className="card-title">{unit.label}</span>

      <div className="field">
        <label htmlFor={`brief-${unit.unit}`}>What are they being asked to do?</label>
        <input
          id={`brief-${unit.unit}`}
          type="text"
          value={text}
          maxLength={140}
          placeholder="One thing they can hold in their head"
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      {/*
        The week's principles as wording, not as an assignment. The coach picks the unit,
        because a moment is not a unit and the app cannot know which.
      */}
      {candidates.length > 0 ? (
        <div className="chip-grid">
          {candidates.map((principle) => (
            <button
              key={principle.id}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => setText(principle.text)}
            >
              {principle.text}
            </button>
          ))}
        </div>
      ) : null}

      <div className="row row--wrap">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || text.trim() === (unit.objective?.text ?? '')}
          onClick={() => void save(text)}
        >
          Save
        </button>
        {unit.objective === null ? null : (
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy}
            onClick={() => void save('')}
          >
            Clear
          </button>
        )}
      </div>

      {unit.objective !== null && unit.objective.status !== 'open' ? (
        <span className="card-meta">Ruled {unit.objective.status} at review.</span>
      ) : null}
    </div>
  );
}

function PrepNote({ prep, hasModel }: { prep: MatchPreparation; hasModel: boolean }) {
  return (
    <details className="card card--sunk">
      <summary>Where the suggestions come from</summary>
      {hasModel ? (
        <p className="card-meta">
          The chips are the principles your sessions this week actually named — not a template. They
          are offered as <strong>wording</strong>, and you choose the unit: a principle belongs to a
          moment of the game, and a moment is not a unit. &quot;Build from the back&quot; concerns
          the keeper, the defence and the midfield at once, so the app does not pretend to know
          which one you mean.
        </p>
      ) : (
        <p className="card-meta">
          No game model yet, so there is nothing to suggest. You can still brief each unit here.{' '}
          <Link href="/squad/game-model">Game model</Link> is where the principles live.
        </p>
      )}
      <p className="card-meta">
        Nothing here models the opponent. The app knows what you trained and what you have asked of
        each unit, and nothing about the team you are playing.
      </p>
      {prep.candidates.length === 0 && hasModel ? (
        <p className="card-meta">
          No session this week named a principle, so there is nothing to carry across. The principle
          picker is on <Link href="/plan">Plan</Link>.
        </p>
      ) : null}
    </details>
  );
}

function toCycleSession(session: Session): CycleSession {
  return {
    id: session.id,
    title: session.objective.text,
    scheduledFor: session.scheduledFor,
    kind: session.kind,
    effortQuality: session.effortQuality,
  };
}
