'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, formatShortDate } from '../../_components/ui';
import { showToast } from '../../_components/toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import { setEffortQuality } from '@/modules/run/run-service';
import {
  EFFORT_QUALITIES,
  EFFORT_QUALITY_HINTS,
  EFFORT_QUALITY_LABELS,
  describeMorphocycle,
  isAcquisitive,
  morphocycleFor,
  type CycleSession,
  type EffortQuality,
  type Morphocycle,
} from '@/domain/morphocycle';
import { describeFixture } from '@/domain/match-day';
import { getGameModel } from '@/modules/planning/game-model-service';
import {
  describeMomentsInWeek,
  describeWeekReview,
  reviewWeek,
} from '@/domain/game-model/week-review';
import type { GameModel } from '@/domain/game-model';
import { isErr } from '@/lib/result';
import type { Session } from '@/domain/session';
import type { SessionId } from '@/domain/ids';

/**
 * The week — the morphocycle running up to the next fixture.
 *
 * **Derived from the fixture list, not a fixed week.** A two-game week compresses to three
 * days, a break stretches it, and neither costs the coach a re-plan. That is the method's own
 * behaviour, and it is also why this screen never renders empty MD-n slots: a coach with two
 * sessions before a game sees two rows, not four blanks telling them they are doing it wrong.
 *
 * **Effort labelling is gated on `Squad.level` being senior** (ADR 0007). A youth squad still
 * gets the week — the sessions before a game are just facts — and gets no word about tension,
 * duration or velocity, because those are adult load concepts and a professional club runs an
 * academy on this same app.
 */
export default function WeekPage() {
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

  if (state.status !== 'ready' || sessions === null) {
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
  const cycleSessions: CycleSession[] = sessions.map(toCycleSession);

  // The next fixture, or the most recent one if there is nothing ahead — a coach looking at
  // this on Sunday wants the game they just played, not an empty screen.
  const fixtures = cycleSessions
    .filter((session) => session.kind === 'match')
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1));
  const nowIso = new Date().toISOString();
  const fixture = fixtures.find((f) => f.scheduledFor >= nowIso) ?? fixtures[fixtures.length - 1];

  if (!fixture) {
    return (
      <Screen>
        <ScreenHead eyebrow="The week" title={squad.name} />
        <Empty>
          No fixture yet. The week is the cycle between two games, so plan a match and the sessions
          before it appear here.
        </Empty>
        <Link href="/plan/match" className="btn btn--primary btn--block">
          Plan a match
        </Link>
      </Screen>
    );
  }

  const cycle = morphocycleFor(fixture, cycleSessions, { level: squad.level });
  const match = sessions.find((session) => session.id === fixture.id);

  return (
    <Screen>
      <ScreenHead eyebrow="The week" title={squad.name} />

      <div className="card">
        <span className="card-title">
          {match?.match ? describeFixture(match.match) : fixture.title}
        </span>
        <span className="card-meta">{formatShortDate(fixture.scheduledFor)}</span>
      </div>

      {describeMorphocycle(cycle) === null ? null : (
        <p className="banner banner--signal">{describeMorphocycle(cycle)}</p>
      )}

      {cycle.days.length === 0 ? (
        <Empty>
          No training sessions between the last game and this one yet. Plan one and it appears here
          with its day named.
        </Empty>
      ) : (
        <section className="stack">
          {cycle.days.map((day) => (
            <div className="card" key={day.session.id}>
              <div className="row row--between">
                <span className="card-title">{day.label}</span>
                <span className="card-meta">{formatShortDate(day.session.scheduledFor)}</span>
              </div>
              <span className="card-meta">{day.session.title}</span>

              {cycle.loadLabellingAllowed ? (
                <QualityRow
                  sessionId={day.session.id as SessionId}
                  current={day.session.effortQuality}
                  suggested={day.suggested}
                  onChanged={reload}
                />
              ) : null}
            </div>
          ))}
        </section>
      )}

      <WeekReviewPanel cycle={cycle} model={model} sessions={sessions} />

      {/* The week is the training; the brief is the game. Separate screens, one link. */}
      <Link href="/plan/prepare" className="btn btn--block">
        Match brief
      </Link>

      <PatternNote cycle={cycle} level={squad.level} />
    </Screen>
  );
}

/**
 * Did the week contain the game model?
 *
 * The report the whole feature builds toward, and the only part of it that can falsify a
 * coach's own week rather than display it.
 *
 * **It does not flag a week concentrated on one moment.** In tactical periodization a
 * morphocycle has a theme, and working one macro principle across the days at descending levels
 * is the normal shape of an acquisition week — see the note at the top of `week-review.ts`.
 */
function WeekReviewPanel({
  cycle,
  model,
  sessions,
}: {
  cycle: Morphocycle;
  model: GameModel | null;
  sessions: readonly Session[];
}) {
  if (model === null) return null;

  const principleIdOf = (sessionId: string) =>
    sessions.find((session) => session.id === sessionId)?.objective.principleId ?? null;

  const review = reviewWeek(cycle, model, principleIdOf);
  const sentence = describeWeekReview(review, model);
  if (sentence === null) return null;

  const moments = describeMomentsInWeek(review);

  return (
    <section className="stack">
      <h2>The week against your model</h2>
      <p className="banner banner--signal">{sentence}</p>
      {moments === null ? null : <p className="card-meta">Moments touched: {moments}.</p>}
      <p className="card-meta">
        Reported, not scored. A week on one macro principle is the normal shape of an acquisition
        week, so it is not flagged.
      </p>
    </section>
  );
}

function QualityRow({
  sessionId,
  current,
  suggested,
  onChanged,
}: {
  sessionId: SessionId;
  current: EffortQuality | null;
  suggested: EffortQuality | null;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const set = async (quality: EffortQuality | null) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await setEffortQuality(getServiceContext(), sessionId, quality);
      if (isErr(result)) {
        showToast(
          result.error.kind === 'not_allowed'
            ? 'Effort labels are for senior squads.'
            : 'Could not save that.',
          { tone: 'stop' },
        );
        return;
      }
      await refresh();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack stack--tight">
      <div className="chip-grid">
        {EFFORT_QUALITIES.map((quality) => (
          <button
            key={quality}
            type="button"
            className="chip"
            aria-pressed={quality === current}
            disabled={busy}
            // Re-tapping clears it, the same gesture the challenge and unit verdicts use.
            onClick={() => void set(quality === current ? null : quality)}
          >
            {EFFORT_QUALITY_LABELS[quality]}
            {quality === suggested && quality !== current ? (
              <span className="chip-count">·</span>
            ) : null}
          </button>
        ))}
      </div>
      {current === null ? (
        suggested === null ? null : (
          <p className="card-meta">
            The pattern suggests {EFFORT_QUALITY_LABELS[suggested].toLowerCase()} —{' '}
            {EFFORT_QUALITY_HINTS[suggested].toLowerCase()}
          </p>
        )
      ) : (
        <p className="card-meta">
          {EFFORT_QUALITY_HINTS[current]}
          {isAcquisitive(current) ? '' : ' Not an acquisitive day.'}
        </p>
      )}
    </div>
  );
}

/**
 * Where the pattern comes from, and what the app is not doing.
 *
 * ADR 0007 makes naming the omission a requirement rather than a nicety: a coach who knows the
 * methodology must be able to see that no load is being prescribed here, instead of inferring
 * it from the absence of numbers.
 */
function PatternNote({ cycle, level }: { cycle: Morphocycle; level: 'youth' | 'senior' }) {
  return (
    <details className="card card--sunk">
      <summary>Where these days come from</summary>
      {level === 'senior' ? (
        <>
          <p className="card-meta">
            The suggested day is <strong>one published reading</strong> of the classical pattern —
            tension at MD-4, duration at MD-3, velocity at MD-2. Other sources map them differently,
            and the Tactical Periodisation school does not publish a breakdown at all, so treat the
            suggestion as a starting point and label the day yourself.
          </p>
          <p className="card-meta">
            <strong>The app prescribes no load.</strong> A quality here is a label you assigned;
            there is no RPE, no intensity percentage and no readiness score, because the
            method&apos;s own position is that the physical is a consequence of playing rather than
            something to be dosed.
          </p>
        </>
      ) : (
        <p className="card-meta">
          This squad is set to <strong>youth</strong>, so the week shows the sessions and no effort
          labelling. Tension, duration and velocity are adult load concepts. Change it in{' '}
          <Link href="/squad">Squad</Link> if this is a senior team.
        </p>
      )}
      <p className="card-meta">
        A morphocycle is the span between two games, so this compresses in a two-game week and
        stretches across a break on its own.
        {cycle.spanDays === null ? '' : ` This one runs ${cycle.spanDays} days.`}
      </p>
    </details>
  );
}

/** The session fields the morphocycle needs, and nothing else. */
function toCycleSession(session: Session): CycleSession {
  return {
    id: session.id,
    title: session.objective.text,
    scheduledFor: session.scheduledFor,
    kind: session.kind,
    effortQuality: session.effortQuality,
  };
}
