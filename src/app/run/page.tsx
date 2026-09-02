'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Loading, Screen, Sheet } from '../_components/ui';
import { TimerDial } from '../_components/timer-dial';
import { showToast } from '../_components/toast-host';
import { useNow } from '../_components/use-now';
import { useVisibilityRefresh } from '../_components/use-visibility-refresh';
import { useWakeLock } from '../_components/use-wake-lock';
import {
  getServiceContext,
  patchActiveSession,
  refresh,
  useAppState,
} from '@/modules/app/app-store';
import {
  dispatch,
  logIntervention,
  logObservation,
  observationTagGroups,
  undoObservation,
  type ObservationTagGroup,
} from '@/modules/run/run-service';
import type { Observation, ObservationRatingKind } from '@/domain/observation';
import {
  currentPhase,
  currentPhaseRun,
  interventionSummary,
  nextPhase as nextPhaseOf,
  phasePosition,
} from '@/domain/session/selectors';
import { formatClock, phaseClock, sessionClock } from '@/domain/session/timer';
import { HEARTBEAT_INTERVAL_MS, isRunStale } from '@/domain/session-run';
import {
  describeInterventionPlan,
  interventionBudget,
  mechanicStopsPlay,
  resolvePhaseIntervention,
} from '@/domain/intervention';
import { cornerSlug } from '@/domain/four-corners';
import { shortPlayerName, type Player } from '@/domain/player';
import { haptic } from '@/lib/haptics';
import { isErr } from '@/lib/result';
import type { PhaseId } from '@/domain/ids';
import type { Session } from '@/domain/session';
import type { SessionCommand } from '@/domain/session/state-machine';

/** `19:42` — the wall-clock time the reconciliation sheet offers to end the session at. */
function formatTimeOfDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/**
 * **Do mode.** A mode, not a page: no bottom nav, no navigation chrome, nothing to mis-tap.
 *
 * The layout has to fit 667px with zero scrolling — phase name, objective, timer, coaching
 * points (the only internally scrollable region), focus chips, then the two 96px actions.
 */
export default function RunPage() {
  const state = useAppState();
  const router = useRouter();
  const now = useNow(250);

  const [observations, setObservations] = useState<readonly Observation[]>([]);
  const [sheetPlayer, setSheetPlayer] = useState<Player | null>(null);
  const [phaseSheetOpen, setPhaseSheetOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const session = state.activeSession;
  const running = session?.status === 'in_progress';

  useWakeLock(running === true);

  const reload = useCallback(async () => {
    // Never trust in-memory state after a background stint — re-read and re-derive.
    await refresh();
  }, []);
  useVisibilityRefresh(reload);

  // Load this session's observations once, then keep them in step locally.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void getServiceContext()
      .store.observations.listBySession(session.id)
      .then((rows) => {
        if (!cancelled) setObservations(rows);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.id, session]);

  // A heartbeat every ~30s is all that stands between a forgotten session and a history
  // entry claiming a five-hour drill.
  useEffect(() => {
    if (!running || !session) return;
    const id = setInterval(() => {
      void dispatch(getServiceContext(), session.id, { kind: 'heartbeat' }).then((result) => {
        if (!isErr(result)) patchActiveSession(result.value);
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running, session?.id, session]);

  if (state.status !== 'ready') {
    return (
      <Screen mode>
        <Loading label="Opening the session…" />
      </Screen>
    );
  }

  if (!session || !running) {
    return (
      <Screen mode>
        <Empty>No session is running.</Empty>
        <Link href="/" className="btn btn--primary btn--block">
          Back to today
        </Link>
      </Screen>
    );
  }

  const phase = currentPhase(session);
  const run = currentPhaseRun(session);
  if (!phase || !run || !session.run) {
    return (
      <Screen mode>
        <Empty>This session has no current phase.</Empty>
      </Screen>
    );
  }

  const clock = phaseClock(phase, run, now);
  const overall = sessionClock(session, now);
  const position = phasePosition(session);
  const upcoming = nextPhaseOf(session);
  const plan = resolvePhaseIntervention(session, phase);
  const summary = interventionSummary(session, now);
  const budget = interventionBudget(plan, summary.countByPhase.get(phase.id) ?? 0);
  const openIntervention =
    session.run.openInterventionId === null
      ? null
      : (session.run.interventionEvents.find(
          (event) => event.id === session.run?.openInterventionId,
        ) ?? null);
  const paused = run.runningSince === null;

  const send = async (command: SessionCommand) => {
    const result = await dispatch(getServiceContext(), session.id, command);
    if (isErr(result)) {
      showToast(
        result.error.kind === 'transition' ? result.error.error.message : 'That did not work.',
        { tone: 'stop' },
      );
      return null;
    }
    patchActiveSession(result.value);
    return result.value;
  };

  // The stale-run reconciliation sheet, offered rather than assumed.
  const stale = isRunStale(session.run, now);

  return (
    <Screen mode>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {stale ? (
        <div className="banner banner--warn">
          This session has been open a while.{' '}
          <button
            type="button"
            className="btn btn--quiet"
            onClick={async () => {
              await send({ kind: 'reconcileToLastActivity' });
              await refresh();
              router.push('/review');
            }}
          >
            End at last activity ({formatTimeOfDay(session.run.lastHeartbeatAt)})
          </button>
        </div>
      ) : null}

      <header className="run-head">
        <button
          type="button"
          className="run-phase-title"
          onClick={() => setPhaseSheetOpen(true)}
          aria-label="Phase options"
        >
          <span className="card-title">{phase.title}</span>
          <span className="card-meta tabular">
            {position.number}/{position.count} · {formatClock(overall?.elapsedMs ?? 0)}/
            {formatClock(overall?.plannedMs ?? 0)} ⌄
          </span>
        </button>

        {/* The whole point of planning an intervention is being reminded of it here. */}
        <p className="run-intervention">
          {describeInterventionPlan(plan)}
          {budget.max !== null ? (
            <span className={budget.isOverBudget ? 'pill pill--over' : 'pill'}>
              {budget.isSilentPhase
                ? 'Let them play'
                : budget.isOverBudget
                  ? 'over'
                  : `${budget.remaining} left`}
            </span>
          ) : null}
        </p>

        <p className="run-objective">{session.objective.text}</p>
      </header>

      <TimerDial clock={clock} paused={paused} nextPhaseTitle={upcoming?.title} />

      <section className="run-points" aria-label="Coaching points">
        {phase.coachingPoints.length === 0 ? (
          <p className="card-meta">No coaching points for this phase.</p>
        ) : (
          <ul className="stack stack--tight">
            {phase.coachingPoints.map((point) => (
              <li key={point.id}>
                <button
                  type="button"
                  className="point"
                  aria-pressed={point.delivered}
                  onClick={() =>
                    void send({
                      kind: 'setCoachingPointDelivered',
                      pointId: point.id,
                      delivered: !point.delivered,
                    })
                  }
                >
                  <span className="point-check" aria-hidden="true">
                    {point.delivered ? '✓' : '○'}
                  </span>
                  <span>{point.text}</span>
                  {point.source === 'carry_forward' ? (
                    <span className="pill pill--carried">carried</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="run-focus" aria-label="Focus players">
        <div className="row row--wrap">
          {session.focusPlayers.map((focus) => {
            const player = state.players.find((candidate) => candidate.id === focus.playerId);
            if (!player) return null;
            const count = observations.filter(
              (observation) =>
                observation.playerId === focus.playerId && observation.phaseId === phase.id,
            ).length;

            return (
              <button
                key={focus.playerId}
                type="button"
                className={`chip chip--lg ${count === 0 ? 'chip--neglected' : ''}`}
                onClick={() => setSheetPlayer(player)}
              >
                {shortPlayerName(player, state.players)}
                <span className="chip-count tabular">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {openIntervention ? (
        <button
          type="button"
          className="btn btn--warn btn--lg btn--block intervention-bar"
          onClick={async () => {
            await send({ kind: 'closeIntervention' });
            haptic('confirm');
            setAnnouncement('Play resumed');
          }}
        >
          ⏱ Coaching · {formatClock(now - Date.parse(openIntervention.at))} · Resume play
        </button>
      ) : null}

      <div className="run-actions">
        <button
          type="button"
          className="btn btn--xl"
          onClick={async () => {
            await send({ kind: paused ? 'resumePhase' : 'pausePhase' });
            haptic('pause');
            setAnnouncement(paused ? 'Resumed' : 'Paused');
          }}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>

        <button
          type="button"
          className="btn btn--primary btn--xl"
          onClick={async () => {
            const next = await send({ kind: 'nextPhase' });
            if (!next) {
              // Already at the last phase — offer the end instead of failing silently.
              showToast('That was the last phase.', {
                action: {
                  label: 'End session',
                  run: async () => {
                    await send({ kind: 'finish' });
                    await refresh();
                    router.push('/review');
                  },
                },
              });
              return;
            }
            setAnnouncement(`Now: ${currentPhase(next)?.title ?? ''}`);
            showToast('Phase advanced', {
              action: {
                label: 'Undo',
                run: async () => {
                  const undone = await send({ kind: 'undoNextPhase' });
                  if (undone) setAnnouncement(`Back to ${currentPhase(undone)?.title ?? ''}`);
                },
              },
              durationMs: 8000,
            });
          }}
        >
          Next phase ▸
        </button>
      </div>

      <div className="run-actions run-actions--secondary">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const observation = await logObservation(getServiceContext(), {
              sessionId: session.id,
              text: '',
            });
            if (!isErr(observation)) {
              setObservations((current) => [...current, observation.value]);
              showToast('Team note logged');
            }
          }}
        >
          ＋ Note
        </button>

        <InterveneButton
          session={session}
          onLog={async (override) => {
            const result = await logIntervention(getServiceContext(), session.id, override ?? {});
            if (isErr(result)) return;
            patchActiveSession(result.value);
            haptic(mechanicStopsPlay(plan.mechanic) ? 'pause' : 'tap');
            setAnnouncement('Intervention logged');
          }}
        />

        {/* Destructive, and therefore far-right — the hardest region to reach by accident. */}
        <button
          type="button"
          className="btn btn--danger"
          onClick={async () => {
            await send({ kind: 'finish' });
            await refresh();
            router.push('/review');
          }}
        >
          End
        </button>
      </div>

      <ObservationSheet
        player={sheetPlayer}
        groups={observationTagGroups(session, phase.id)}
        onClose={() => setSheetPlayer(null)}
        onLog={async (ratingKind, tags) => {
          const player = sheetPlayer;
          if (!player) return;
          setSheetPlayer(null);

          const result = await logObservation(getServiceContext(), {
            sessionId: session.id,
            playerId: player.id,
            ratingKind,
            tags,
          });
          if (isErr(result)) return;

          setObservations((current) => [...current, result.value]);
          haptic('confirm');
          showToast(`Logged for ${shortPlayerName(player, state.players)}`, {
            action: {
              label: 'Undo',
              run: async () => {
                await undoObservation(getServiceContext(), result.value.id);
                setObservations((current) =>
                  current.filter((observation) => observation.id !== result.value.id),
                );
              },
            },
          });
        }}
      />

      <PhaseSheet
        open={phaseSheetOpen}
        session={session}
        onClose={() => setPhaseSheetOpen(false)}
        onJump={async (phaseId) => {
          setPhaseSheetOpen(false);
          await send({ kind: 'jumpToPhase', phaseId });
        }}
        onExtend={async (minutes) => {
          await send({ kind: 'extendPhase', minutes });
        }}
        onAbandon={async (reason) => {
          setPhaseSheetOpen(false);
          await send({ kind: 'abandon', reason });
          await refresh();
          router.push('/');
        }}
      />
    </Screen>
  );
}

/**
 * `✋ Intervene`. **One tap**, pre-filled from the phase plan; a long press opens the sheet
 * to change method, mechanic, audience or attach a note.
 */
function InterveneButton({
  session,
  onLog,
}: {
  session: Session;
  onLog: (override?: { note?: string }) => Promise<void>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState('');
  const phase = currentPhase(session);
  const plan = phase ? resolvePhaseIntervention(session, phase) : null;

  return (
    <>
      <button
        type="button"
        className="btn btn--accent"
        onClick={() => void onLog()}
        onContextMenu={(event) => {
          event.preventDefault();
          setSheetOpen(true);
        }}
      >
        ✋ Intervene
      </button>

      <Sheet open={sheetOpen} title="Log an intervention" onClose={() => setSheetOpen(false)}>
        {plan ? <p className="card-meta">{describeInterventionPlan(plan)}</p> : null}
        <div className="field">
          <label htmlFor="intervention-note">Note</label>
          <input
            id="intervention-note"
            type="text"
            value={note}
            placeholder="What did you say?"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          onClick={async () => {
            setSheetOpen(false);
            await onLog(note.trim().length > 0 ? { note: note.trim() } : undefined);
            setNote('');
          }}
        >
          Log it
        </button>
      </Sheet>
    </>
  );
}

/**
 * Two taps: a chip, then one of three 72px tokens. Tags are optional, never required.
 *
 * The tags are **grouped by FA 4 Corner**, which is the whole mechanism behind corner
 * tracking: the coach taps a tag because it says what they saw, the corner is captured as a
 * side effect, and — the part that actually changes behaviour — the empty corner is visible
 * right here at the moment of logging rather than only in the report afterwards.
 */
function ObservationSheet({
  player,
  groups,
  onClose,
  onLog,
}: {
  player: Player | null;
  groups: readonly ObservationTagGroup[];
  onClose: () => void;
  onLog: (rating: ObservationRatingKind, tags: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const tokens: Array<{ kind: ObservationRatingKind; label: string }> = useMemo(
    () => [
      { kind: 'good', label: 'Good' },
      { kind: 'working', label: 'Working' },
      { kind: 'struggled', label: 'Struggled' },
    ],
    [],
  );

  return (
    <Sheet
      open={player !== null}
      title={player ? player.name : 'Observation'}
      onClose={() => {
        setSelected([]);
        onClose();
      }}
    >
      <div className="observation-tokens">
        {tokens.map((token) => (
          <button
            key={token.kind}
            type="button"
            className={`btn btn--lg observation-token observation-token--${token.kind}`}
            onClick={async () => {
              const chosen = selected;
              setSelected([]);
              await onLog(token.kind, chosen);
            }}
          >
            {token.label}
          </button>
        ))}
      </div>

      {groups.map((group) => (
        <section
          key={group.label}
          className="corner-group"
          data-corner={group.corner ? cornerSlug(group.corner) : 'phase'}
        >
          <h3 className="eyebrow">{group.label}</h3>
          <div className="row row--wrap">
            {group.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip"
                aria-pressed={selected.includes(tag)}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(tag)
                      ? current.filter((candidate) => candidate !== tag)
                      : [...current, tag],
                  )
                }
              >
                {tag}
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  );
}

/**
 * Previous-phase and jump-to-phase live in here, behind the `⌄` header tap — never on the
 * main surface, where they are far too easy to mis-tap with gloves on.
 */
function PhaseSheet({
  open,
  session,
  onClose,
  onJump,
  onExtend,
  onAbandon,
}: {
  open: boolean;
  session: Session;
  onClose: () => void;
  onJump: (phaseId: PhaseId) => Promise<void>;
  onExtend: (minutes: number) => Promise<void>;
  onAbandon: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');

  return (
    <Sheet open={open} title="Phase options" onClose={onClose}>
      <div className="row">
        <button type="button" className="btn" onClick={() => void onExtend(-5)}>
          −5 min
        </button>
        <button type="button" className="btn" onClick={() => void onExtend(5)}>
          +5 min
        </button>
      </div>

      <div className="stack stack--tight">
        <h3>Jump to</h3>
        {[...session.phases]
          .sort((a, b) => a.order - b.order)
          .map((phase) => (
            <button
              key={phase.id}
              type="button"
              className="card card--link"
              onClick={() => void onJump(phase.id)}
            >
              <span className="card-title">{phase.title}</span>
              <span className="card-meta tabular">{phase.plannedDurationMin} min</span>
            </button>
          ))}
      </div>

      <details className="card card--sunk">
        <summary>Abandon this session</summary>
        <p className="card-meta">
          Everything logged so far is kept — twenty minutes of evidence is still evidence.
        </p>
        <div className="field">
          <label htmlFor="abandon-reason">Why?</label>
          <input
            id="abandon-reason"
            type="text"
            value={reason}
            placeholder="Pitch flooded"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn--danger btn--block"
          disabled={reason.trim().length === 0}
          onClick={() => void onAbandon(reason.trim())}
        >
          Abandon session
        </button>
      </details>
    </Sheet>
  );
}
