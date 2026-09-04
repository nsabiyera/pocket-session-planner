'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CarriedPill,
  Empty,
  Loading,
  Screen,
  ScreenHead,
  Sheet,
  Stepper,
  formatShortDate,
} from '../../_components/ui';
import { showToast } from '../../_components/toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import {
  commitAndStart,
  discardDraft,
  reorderPhases,
  updateDraft,
  updatePhase,
} from '@/modules/planning/planning-service';
import { describeInterventionPlan, resolvePhaseIntervention } from '@/domain/intervention';
import { phaseKindLabel } from '@/domain/methodology';
import {
  phasesInOrder,
  totalPlannedPhaseMin,
  type Session,
  type SessionPhase,
} from '@/domain/session';
import { shortPlayerName, type Player } from '@/domain/player';
import { isErr } from '@/lib/result';

/**
 * The phase editor, landed on in **accept posture**: the plan is already built and the coach
 * is expected to glance at it and hit `Start session ▸`. Everything editable is one tap
 * deeper, so nobody has to fight a form to get onto the pitch.
 */
export default function PhaseEditorPage() {
  const state = useAppState();
  const router = useRouter();
  const [editing, setEditing] = useState<SessionPhase | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const session = state.activeSession;
  if (!session || session.status === 'in_progress') {
    return (
      <Screen>
        <ScreenHead title="No session in progress" />
        <Empty>Nothing is being planned right now.</Empty>
        <Link href="/plan" className="btn btn--primary btn--block">
          Plan a session
        </Link>
      </Screen>
    );
  }

  const phases = phasesInOrder(session);
  const phaseTotal = totalPlannedPhaseMin(session);
  const mismatch = phaseTotal !== session.plannedDurationMin;

  const start = async () => {
    setBusy(true);
    try {
      const result = await commitAndStart(getServiceContext(), session.id);
      if (isErr(result)) {
        showToast(
          result.error.kind === 'transition'
            ? result.error.error.message
            : 'Could not start the session.',
          { tone: 'stop' },
        );
        return;
      }
      await refresh();
      router.push('/run');
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, delta: number) => {
    const next = [...phases];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    await reorderPhases(
      getServiceContext(),
      session.id,
      next.map((phase) => phase.id),
    );
    await refresh();
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Plan" title={session.objective.text} />

      <div className="card card--sunk">
        <div className="row row--between">
          <span className="card-meta">
            {session.methodology.name} · {formatShortDate(session.scheduledFor)}
          </span>
          <Link href="/plan/intervention" className="btn btn--quiet">
            Intervention
          </Link>
        </div>
        <p>{describeInterventionPlan(session.intervention)}</p>
        {session.objective.sourceActionId ? <CarriedPill /> : null}
      </div>

      {/*
        Challenges cost **zero taps** on the default path: one summary line and a link into
        the detour, exactly like intervention. A session with none says so in a single word.
      */}
      <div className="card card--sunk">
        <div className="row row--between">
          <span className="eyebrow">Player challenges</span>
          <Link href="/plan/challenges" className="btn btn--quiet">
            {session.challenges.length === 0 ? 'Set' : 'Edit'}
          </Link>
        </div>
        <p>{describeChallengePlan(session, state.players)}</p>
      </div>

      <Stepper
        label="Session length"
        value={session.plannedDurationMin}
        min={20}
        max={150}
        onChange={async (value) => {
          await updateDraft(getServiceContext(), session.id, { totalMin: value });
          await refresh();
        }}
      />

      {/* A phase total that does not match is a **warning, not a block** — slack is fine. */}
      {mismatch ? (
        <p className="banner banner--warn">
          Phases add up to {phaseTotal} min, session is {session.plannedDurationMin} min.
        </p>
      ) : null}

      {session.reminders.length > 0 ? (
        <section className="stack">
          <h2>Before you go</h2>
          <ul className="stack stack--tight">
            {session.reminders.map((reminder) => (
              <li key={reminder} className="card card--sunk">
                {reminder}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack">
        <h2>Phases</h2>
        <ul className="stack stack--tight">
          {phases.map((phase, index) => (
            <li key={phase.id} className="card">
              <div className="row row--between">
                <span className="card-title">{phase.title}</span>
                <span className="tabular card-meta">{phase.plannedDurationMin} min</span>
              </div>
              <span className="card-meta">
                {phaseKindLabel(phase.kind)} ·{' '}
                {describeInterventionPlan(resolvePhaseIntervention(session, phase))}
              </span>

              {phase.coachingPoints.length > 0 ? (
                <ul className="stack stack--tight">
                  {phase.coachingPoints.map((point) => (
                    <li key={point.id} className="row">
                      <span>{point.text}</span>
                      {point.source === 'carry_forward' ? <CarriedPill /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {phase.focusPlayerIds.length > 0 ? (
                <span className="row row--wrap">
                  {phase.focusPlayerIds.map((playerId) => {
                    const player = state.players.find((candidate) => candidate.id === playerId);
                    return player ? (
                      <span key={playerId} className="pill">
                        {shortPlayerName(player, state.players)}
                      </span>
                    ) : null;
                  })}
                </span>
              ) : null}

              <div className="row">
                <button type="button" className="btn btn--quiet" onClick={() => setEditing(phase)}>
                  Edit
                </button>
                <span className="spacer" />
                {/* Reorder is always paired with buttons — never drag-only (WCAG 2.5.7). */}
                <button
                  type="button"
                  className="btn btn--quiet"
                  aria-label={`Move ${phase.title} earlier`}
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  aria-label={`Move ${phase.title} later`}
                  disabled={index === phases.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        disabled={busy}
        onClick={start}
      >
        Start session ▸
      </button>

      {/* Destructive action, far from the primary one and recoverable by re-planning. */}
      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={async () => {
          await discardDraft(getServiceContext(), session.squadId);
          await refresh();
          showToast('Draft discarded');
          router.push('/');
        }}
      >
        Discard this plan
      </button>

      <PhaseSheet
        phase={editing}
        onClose={() => setEditing(null)}
        onSave={async (next) => {
          await updatePhase(getServiceContext(), session.id, next);
          await refresh();
          setEditing(null);
        }}
      />
    </Screen>
  );
}

/**
 * *"Kai · three forward passes, and 2 others"* — the one line the plan editor shows.
 *
 * Names the first player rather than counting them, because "3 challenges" tells the coach
 * nothing they can check and a name tells them whether they set the one they meant to.
 */
function describeChallengePlan(session: Session, roster: readonly Player[]): string {
  const [first] = session.challenges;
  if (!first) return 'None set.';

  const player = roster.find((candidate) => candidate.id === first.playerId);
  const who = player ? shortPlayerName(player, roster) : 'Someone';
  const rest = session.challenges.length - 1;

  const head = `${who} · ${first.text}`;
  return rest === 0 ? `${head}.` : `${head}, and ${rest} other${rest === 1 ? '' : 's'}.`;
}

function PhaseSheet({
  phase,
  onClose,
  onSave,
}: {
  phase: SessionPhase | null;
  onClose: () => void;
  onSave: (phase: SessionPhase) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SessionPhase | null>(phase);

  // Re-seed when a different phase is opened.
  if (phase && draft?.id !== phase.id) setDraft(phase);

  if (!draft) {
    return (
      <Sheet open={false} title="Edit phase" onClose={onClose}>
        {null}
      </Sheet>
    );
  }

  return (
    <Sheet open={phase !== null} title="Edit phase" onClose={onClose}>
      <div className="field">
        <label htmlFor="phase-title">Title</label>
        <input
          id="phase-title"
          type="text"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </div>

      <Stepper
        label="Length"
        value={draft.plannedDurationMin}
        min={1}
        max={90}
        onChange={(value) => setDraft({ ...draft, plannedDurationMin: value })}
      />

      <div className="field">
        <label htmlFor="phase-organisation">Organisation</label>
        <textarea
          id="phase-organisation"
          value={draft.organisation}
          placeholder="4v2 rondo, 15x15, two neutrals"
          onChange={(event) => setDraft({ ...draft, organisation: event.target.value })}
        />
      </div>

      <button
        type="button"
        className="btn btn--primary btn--lg btn--block"
        onClick={() => void onSave(draft)}
      >
        Save phase
      </button>
    </Sheet>
  );
}
