'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, formatLongDate } from '../../_components/ui';
import { Why } from '../../_components/why';
import { getServiceContext, useAppState } from '@/modules/app/app-store';
import { asSessionId } from '@/domain/ids';
import { describeInterventionPlan, resolvePhaseIntervention } from '@/domain/intervention';
import type { Observation } from '@/domain/observation';
import { phasesInOrder, type Session } from '@/domain/session';
import { describeInterventionSummary, interventionSummary } from '@/domain/session/selectors';
import { formatClock, phaseElapsedMs } from '@/domain/session/timer';
import type { SessionReview } from '@/domain/review';

/** A read-only past session: what was planned, what happened, and what the review said. */
export default function SessionDetailPage() {
  return (
    <Suspense
      fallback={
        <Screen>
          <Loading />
        </Screen>
      }
    >
      <SessionDetail />
    </Suspense>
  );
}

function SessionDetail() {
  const state = useAppState();
  const params = useSearchParams();
  const sessionId = params.get('s');

  const [session, setSession] = useState<Session | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [review, setReview] = useState<SessionReview | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!sessionId || state.status !== 'ready') return;
    let cancelled = false;
    const ctx = getServiceContext();
    const id = asSessionId(sessionId);

    void (async () => {
      const found = await ctx.store.sessions.get(id);
      if (cancelled) return;
      setSession(found ?? null);
      if (found) {
        setObservations(await ctx.store.observations.listBySession(id));
        setReview((await ctx.store.reviews.findBySession(id)) ?? null);
      }
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, state.status]);

  if (state.status !== 'ready' || !loaded) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <ScreenHead title="Session not found" />
        <Empty>It may have been deleted.</Empty>
        <Link href="/sessions" className="btn btn--primary btn--block">
          Back to history
        </Link>
      </Screen>
    );
  }

  const summary = interventionSummary(session, Date.parse(session.updatedAt));

  return (
    <Screen>
      <ScreenHead eyebrow={formatLongDate(session.scheduledFor)} title={session.objective.text} />

      <div className="card card--sunk">
        <span className="card-meta">
          {session.methodology.name} · {session.plannedDurationMin} min
        </span>
        <p>{describeInterventionPlan(session.intervention)}</p>
        {session.abandonReason ? (
          <p className="banner banner--warn">Abandoned: {session.abandonReason}</p>
        ) : null}
      </div>

      {session.run ? (
        <div className="banner banner--signal">
          {describeInterventionSummary(summary)}
          <Why id="report:intervention" />
        </div>
      ) : null}

      <section className="stack">
        <h2>Phases</h2>
        <ul className="stack stack--tight">
          {phasesInOrder(session).map((phase) => {
            const actualMs = (session.run?.phaseRuns ?? [])
              .filter((phaseRun) => phaseRun.phaseId === phase.id)
              .reduce(
                (total, phaseRun) =>
                  total + phaseElapsedMs(phaseRun, Date.parse(session.updatedAt)),
                0,
              );

            return (
              <li key={phase.id} className="card">
                <div className="row row--between">
                  <span className="card-title">{phase.title}</span>
                  <span className="card-meta tabular">
                    {session.run ? `${formatClock(actualMs)} / ` : ''}
                    {phase.plannedDurationMin} min
                  </span>
                </div>
                <span className="card-meta">
                  {describeInterventionPlan(resolvePhaseIntervention(session, phase))} ·{' '}
                  {summary.countByPhase.get(phase.id) ?? 0} logged
                </span>
                {phase.coachingPoints.length > 0 ? (
                  <ul className="stack stack--tight">
                    {phase.coachingPoints.map((point) => (
                      <li key={point.id} className="card-meta">
                        {point.delivered ? '✓' : '○'} {point.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {observations.length > 0 ? (
        <section className="stack">
          <h2>Observations</h2>
          <ul className="stack stack--tight">
            {observations.map((observation) => {
              const player = state.players.find(
                (candidate) => candidate.id === observation.playerId,
              );
              return (
                <li key={observation.id} className="card">
                  <span className="card-title">{player?.name ?? 'Team'}</span>
                  <span className="card-meta">
                    {observation.ratingKind ?? 'note'} · {formatClock(observation.phaseElapsedMs)}{' '}
                    into the phase
                  </span>
                  {observation.tags.length > 0 ? (
                    <span className="row row--wrap">
                      {observation.tags.map((tag) => (
                        <span key={tag} className="pill">
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {review ? (
        <section className="stack">
          <h2>Review</h2>
          <div className="card">
            <span className="card-title">
              Objective {review.objectiveOutcome.replace(/_/g, ' ')}
            </span>
            {review.sessionRating !== null ? (
              <span className="card-meta">Rated {review.sessionRating}/5</span>
            ) : null}
            {review.whatWorked.map((line) => (
              <p key={line}>✓ {line}</p>
            ))}
            {review.whatDidnt.map((line) => (
              <p key={line}>× {line}</p>
            ))}
          </div>
        </section>
      ) : null}
    </Screen>
  );
}
