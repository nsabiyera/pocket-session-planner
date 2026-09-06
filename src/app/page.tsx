'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, formatShortDate } from './_components/ui';
import { useNow } from './_components/use-now';
import { useVisibilityRefresh } from './_components/use-visibility-refresh';
import { showToast } from './_components/toast-host';
import { CarryForwardChips } from './_components/carry-forward-chips';
import { InstallBar } from './_components/install-prompt';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import { repeatSession } from '@/modules/planning/planning-service';
import { createSquad } from '@/modules/squad/squad-service';
import { currentPhase, currentPhaseRun } from '@/domain/session/selectors';
import { describePhaseClock, phaseClock } from '@/domain/session/timer';
import { mirrorRemainingMs } from '@/lib/resume-mirror';
import { isErr } from '@/lib/result';
import type { Session } from '@/domain/session';

/**
 * Today.
 *
 * One hero action that changes shape by state — `Resume`, then `Review last session`, then
 * `New session` — because at any moment there is exactly one thing the coach is most likely
 * to want, and making them choose between four buttons is making them think.
 */
export default function TodayPage() {
  const state = useAppState();
  const now = useNow(1000);
  const router = useRouter();

  useVisibilityRefresh(useCallback(() => refresh(), []));

  if (state.status === 'error') {
    return (
      <Screen>
        <ScreenHead title="Something went wrong" />
        <div className="banner banner--stop">{state.error}</div>
      </Screen>
    );
  }

  // The synchronous mirror paints the resume line before IndexedDB has finished opening.
  if (state.status !== 'ready') {
    return (
      <Screen>
        <ScreenHead eyebrow="Today" title="Pocket Session Planner" />
        {state.mirror?.status === 'in_progress' ? (
          <Link href="/run" className="btn btn--primary btn--xl btn--block">
            <span>
              Resume
              <span className="btn-sub">
                {state.mirror.phaseTitle} ·{' '}
                {formatMirrorRemaining(mirrorRemainingMs(state.mirror, now))}
              </span>
            </span>
          </Link>
        ) : (
          <Loading label="Opening your sessions…" />
        )}
      </Screen>
    );
  }

  if (!state.squad) return <FirstRun />;

  return (
    <Screen>
      <ScreenHead eyebrow="Today" title={state.squad.name} />

      <Hero session={state.activeSession} reviewSession={state.reviewSession} now={now} />

      {/*
        Match day sits under the hero rather than beside it. Most weeks are training weeks, so
        the hero stays the one big target — but a Saturday should never cost a coach a hunt
        through Settings to find.
      */}
      {state.activeSession === null ? (
        <Link href="/plan/match" className="btn btn--block">
          Match day instead
        </Link>
      ) : null}

      {/* One dismissible bar, and only after a second completed session. */}
      <InstallBar
        completedSessions={state.meta?.completedSessionCount ?? state.recentSessions.length}
      />

      <CarryForwardChips actions={state.openActions} />

      {state.recentSessions.length > 0 ? (
        <section className="stack">
          <h2>Last session</h2>
          <LastSessionCard
            session={state.recentSessions[0]!}
            onRepeat={async () => {
              const result = await repeatSession(getServiceContext(), state.recentSessions[0]!.id);
              if (isErr(result)) {
                showToast('Could not repeat that session.', { tone: 'stop' });
                return;
              }
              await refresh();
              router.push('/plan/phases');
            }}
          />
        </section>
      ) : null}

      {state.recentSessions.length > 1 ? (
        <section className="stack">
          <h2>Recent</h2>
          <ul className="stack stack--tight">
            {state.recentSessions.slice(1, 5).map((session) => (
              <li key={session.id}>
                <Link href={`/sessions/detail/?s=${session.id}`} className="card card--link">
                  <span className="card-title">{session.objective.text}</span>
                  <span className="card-meta">
                    {formatShortDate(session.scheduledFor)} · {session.methodology.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Screen>
  );
}

function formatMirrorRemaining(ms: number | null): string {
  if (ms === null) return 'in progress';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')} left`;
}

/**
 * The hero. Precedence is deliberate: a running session beats an unreviewed one, which beats
 * a half-finished draft, which beats starting fresh.
 */
function Hero({
  session,
  reviewSession,
  now,
}: {
  session: Session | null;
  reviewSession: Session | null;
  now: number;
}) {
  if (session?.status === 'in_progress') {
    const phase = currentPhase(session);
    const run = currentPhaseRun(session);
    const clock = phase && run ? phaseClock(phase, run, now) : null;

    return (
      <Link href="/run" className="btn btn--primary btn--xl btn--block">
        <span>
          Resume
          <span className="btn-sub">
            {phase?.title}
            {clock ? ` · ${describePhaseClock(clock)}` : ''}
          </span>
        </span>
      </Link>
    );
  }

  if (reviewSession) {
    return (
      <Link href="/review" className="btn btn--accent btn--xl btn--block">
        <span>
          Review last session
          <span className="btn-sub">{reviewSession.objective.text}</span>
        </span>
      </Link>
    );
  }

  if (session) {
    return (
      <Link href="/plan/phases" className="btn btn--primary btn--xl btn--block">
        <span>
          Carry on planning
          <span className="btn-sub">{session.objective.text}</span>
        </span>
      </Link>
    );
  }

  return (
    <Link href="/plan" className="btn btn--primary btn--xl btn--block">
      New session
    </Link>
  );
}

/** The two-tap path: **Repeat** clones straight into a draft and skips the composer. */
function LastSessionCard({
  session,
  onRepeat,
}: {
  session: Session;
  onRepeat: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="card">
      <span className="card-title">{session.objective.text}</span>
      <span className="card-meta">
        {formatShortDate(session.scheduledFor)} · {session.methodology.name} ·{' '}
        {session.plannedDurationMin} min
      </span>
      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRepeat();
            } finally {
              setBusy(false);
            }
          }}
        >
          Repeat
        </button>
        <Link href={`/sessions/detail/?s=${session.id}`} className="btn btn--quiet">
          View
        </Link>
      </div>
    </div>
  );
}

/** No squad yet. One field, one button — and the moment we ask for persistent storage. */
function FirstRun() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <ScreenHead eyebrow="Welcome" title="Name your squad" />
      <Empty>
        Everything stays on this device. No account, no signal needed — and nothing leaves the phone
        unless you export it.
      </Empty>

      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (name.trim().length === 0 || busy) return;
          setBusy(true);
          try {
            await createSquad(getServiceContext(), { name: name.trim() });
            await refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="squad-name">Squad name</label>
          <input
            id="squad-name"
            type="text"
            value={name}
            autoComplete="off"
            placeholder="U12 Reds"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn--primary btn--xl btn--block"
          disabled={busy || name.trim().length === 0}
        >
          Create squad
        </button>
      </form>
    </Screen>
  );
}
