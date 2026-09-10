'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, formatShortDate } from '../_components/ui';
import { getServiceContext, useAppState } from '@/modules/app/app-store';
import { coachingStyleInput, sessionStage } from '@/domain/session/selectors';
import { coachingStyle } from '@/domain/coaching-style';
import { questioningSummary } from '@/domain/questioning';
import { describeFixture } from '@/domain/match-day';
import { CoachingStylePanel } from '../_components/coaching-style';
import type { Session } from '@/domain/session';

/** History. A cold screen — no timer, no urgency, so it can afford to be a plain list. */
export default function SessionsPage() {
  const state = useAppState();
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (state.status !== 'ready' || !state.squad) return;
    let cancelled = false;
    void getServiceContext()
      .store.sessions.listBySquad(state.squad.id, { limit: 100 })
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      });
    return () => {
      cancelled = true;
    };
  }, [state.status, state.squad]);

  const styleInput = coachingStyleInput(sessions);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHead eyebrow="History" title={state.squad?.name ?? 'Sessions'} />

      {/*
        The coach's own style across the term, above the list of the sessions it came from.
        History is the right home: this is a summary *of* these sessions, and the screen has
        already loaded them. Renders nothing below twelve interventions.
      */}
      <CoachingStylePanel
        style={coachingStyle(styleInput)}
        questioning={questioningSummary({
          // The same events the bars are built from, asked a different question.
          events: styleInput.events,
          rosterIds: state.players.map((player) => player.id),
        })}
      />

      {sessions.length === 0 ? (
        <Empty>No sessions yet.</Empty>
      ) : (
        <ul className="stack stack--tight">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link href={`/sessions/detail/?s=${session.id}`} className="card card--link">
                <div className="row row--between">
                  <span className="card-title">{session.objective.text}</span>
                  <span className="card-meta">{formatShortDate(session.scheduledFor)}</span>
                </div>
                {/*
                  A fixture reads as a fixture. Scanning a term of history, "away to Eastfield
                  Rovers" is what tells a coach which of these Saturdays they are looking at —
                  the objective alone makes a match indistinguishable from the Tuesday before it.
                */}
                {session.kind === 'match' && session.match !== null ? (
                  <span className="card-meta">{describeFixture(session.match)}</span>
                ) : null}
                <span className="row row--wrap">
                  {session.kind === 'match' ? (
                    <span className="pill pill--match">Match</span>
                  ) : null}
                  <span className="pill">{session.methodology.name}</span>
                  <span className="pill">{stageLabel(session)}</span>
                  {session.status === 'abandoned' ? (
                    <span className="pill pill--over">abandoned</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function stageLabel(session: Session): string {
  return {
    plan: 'planning',
    do: 'running',
    review: 'needs review',
    archived: 'done',
  }[sessionStage(session)];
}
