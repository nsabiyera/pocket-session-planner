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
  logChallengeProgress,
  logIntervention,
  logObservation,
  observationTagGroups,
  setChallengeStatus,
  undoChallengeProgress,
  undoObservation,
  type ObservationTagGroup,
} from '@/modules/run/run-service';
import { CHALLENGE_STATUSES, challengeStatusLabel, type ChallengeStatus } from '@/domain/challenge';
import { sessionChallengeProgress, type ChallengeProgress } from '@/domain/session/challenges';
import { ACTION_MOMENTS, momentShortLabel, type ActionMoment } from '@/domain/capabilities';
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
import type { ChallengeId, PhaseId } from '@/domain/ids';
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
  const [challengeSheet, setChallengeSheet] = useState<ChallengeId | null>(null);
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

  // Every challenge live in *this* phase, settled ones sorted last rather than hidden: a
  // coach who has just hit 3/3 wants to see it, and wants Undo to still be reachable.
  const challenges = sessionChallengeProgress(session, phase.id).filter(
    (progress) => progress.liveNow,
  );

  const challengePlayerName = (progress: ChallengeProgress): string => {
    const player = state.players.find((candidate) => candidate.id === progress.challenge.playerId);
    return player ? shortPlayerName(player, state.players) : 'Unknown';
  };

  /**
   * `+1` — one tap, no confirmation, with the tally in the toast so the coach gets the
   * feedback without looking back at the row they just hit.
   */
  const countChallenge = async (progress: ChallengeProgress) => {
    const result = await logChallengeProgress(
      getServiceContext(),
      session.id,
      progress.challenge.id,
    );
    if (isErr(result)) return;

    patchActiveSession(result.value);
    haptic('confirm');

    const next = sessionChallengeProgress(result.value, phase.id).find(
      (candidate) => candidate.challenge.id === progress.challenge.id,
    );
    const name = challengePlayerName(progress);
    setAnnouncement(`${name}: ${next?.label ?? ''}`);

    showToast(`${name} · ${next?.label ?? ''}`, {
      action: {
        label: 'Undo',
        run: async () => {
          const undone = await undoChallengeProgress(
            getServiceContext(),
            session.id,
            progress.challenge.id,
          );
          if (!isErr(undone)) patchActiveSession(undone.value);
        },
      },
    });
  };

  const rule = async (challengeId: ChallengeId, status: ChallengeStatus) => {
    setChallengeSheet(null);
    const result = await setChallengeStatus(getServiceContext(), session.id, challengeId, status);
    if (isErr(result)) return;

    patchActiveSession(result.value);
    haptic('confirm');
    setAnnouncement(`Marked ${challengeStatusLabel(status).toLowerCase()}`);

    showToast(`Marked ${challengeStatusLabel(status).toLowerCase()}`, {
      action: {
        label: 'Undo',
        run: async () => {
          const undone = await setChallengeStatus(
            getServiceContext(),
            session.id,
            challengeId,
            'open',
          );
          if (!isErr(undone)) patchActiveSession(undone.value);
        },
      },
    });
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

      <section className="run-points" aria-label="Challenges and coaching points">
        {/*
          Challenges come first. A coaching point is something the coach is carrying in their
          head anyway; a promise made to one player is the thing that gets forgotten at 7:40
          on a wet Tuesday, and the tally only means anything if it is in the way.
        */}
        {challenges.length > 0 ? (
          <div className="run-challenges">
            <h3 className="eyebrow">Challenges</h3>
            <ul className="stack stack--tight">
              {challenges.map((progress) => (
                <ChallengeRow
                  key={progress.challenge.id}
                  progress={progress}
                  name={challengePlayerName(progress)}
                  onCount={() => void countChallenge(progress)}
                  onOpenRuling={() => setChallengeSheet(progress.challenge.id)}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {challenges.length > 0 && phase.coachingPoints.length > 0 ? (
          <h3 className="eyebrow">Coaching points</h3>
        ) : null}

        {phase.coachingPoints.length === 0 ? (
          challenges.length === 0 ? (
            <p className="card-meta">No coaching points for this phase.</p>
          ) : null
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
        onLog={async (ratingKind, tags, moment) => {
          const player = sheetPlayer;
          if (!player) return;
          setSheetPlayer(null);

          const result = await logObservation(getServiceContext(), {
            sessionId: session.id,
            playerId: player.id,
            ratingKind,
            tags,
            ...(moment !== null ? { actionMoment: moment } : {}),
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

      <ChallengeRulingSheet
        progress={
          challengeSheet === null
            ? null
            : (sessionChallengeProgress(session).find(
                (candidate) => candidate.challenge.id === challengeSheet,
              ) ?? null)
        }
        nameOf={challengePlayerName}
        onClose={() => setChallengeSheet(null)}
        onRule={rule}
        onCount={countChallenge}
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
 * One challenge, monitored.
 *
 * A **counted** challenge makes the whole row the `+1` target — the biggest thing on the
 * strip, because it is tapped mid-drill with cold thumbs and a trailing `⌄` is what opens
 * the ruling. A **judged** challenge has nothing to count, so the row itself opens the
 * ruling instead of pretending there is a tally to add to.
 *
 * A settled challenge stays on the strip rather than vanishing: the coach who just hit 3/3
 * wants to see it, and Undo has to stay reachable.
 */
function ChallengeRow({
  progress,
  name,
  onCount,
  onOpenRuling,
}: {
  progress: ChallengeProgress;
  name: string;
  onCount: () => void;
  onOpenRuling: () => void;
}) {
  const { challenge, label, status, hitTarget } = progress;
  const counted = challenge.measure === 'count';

  return (
    <li
      className="challenge-live"
      data-status={status}
      {...(challenge.corner ? { 'data-corner': cornerSlug(challenge.corner) } : {})}
    >
      <button
        type="button"
        className="challenge-live-main"
        onClick={counted ? onCount : onOpenRuling}
        aria-label={
          counted
            ? `Log progress for ${name}: ${challenge.text}. ${label}.`
            : `Rule on ${name}: ${challenge.text}.`
        }
      >
        <span className="challenge-live-who">{name}</span>
        <span className="challenge-live-text">{challenge.text}</span>
      </button>

      <span className="challenge-live-state">
        {counted ? (
          <span className="challenge-live-tally tabular" aria-hidden="true">
            {label}
          </span>
        ) : null}
        {status === 'open' ? (
          counted && hitTarget ? (
            <span className="pill pill--met">✓</span>
          ) : null
        ) : (
          <span className={`pill pill--${status}`}>{challengeStatusLabel(status)}</span>
        )}
      </span>

      {counted ? (
        <button
          type="button"
          className="challenge-live-rule"
          onClick={onOpenRuling}
          aria-label={`Rule on ${name}: ${challenge.text}`}
        >
          ⌄
        </button>
      ) : null}
    </li>
  );
}

/**
 * The ruling sheet: met, partly, missed — plus `+1` and `Undo` for a counted challenge, so
 * a coach who has lost count can fix it here rather than tapping the row four more times.
 */
function ChallengeRulingSheet({
  progress,
  nameOf,
  onClose,
  onRule,
  onCount,
}: {
  progress: ChallengeProgress | null;
  nameOf: (progress: ChallengeProgress) => string;
  onClose: () => void;
  onRule: (challengeId: ChallengeId, status: ChallengeStatus) => Promise<void>;
  onCount: (progress: ChallengeProgress) => Promise<void>;
}) {
  const name = progress ? nameOf(progress) : '';

  return (
    <Sheet
      open={progress !== null}
      title={progress ? `${name} · ${progress.challenge.text}` : 'Challenge'}
      onClose={onClose}
    >
      {progress ? (
        <>
          {progress.challenge.measure === 'count' ? (
            <div className="row row--between">
              <span className="card-meta tabular">
                {progress.label} · {progress.countThisPhase} this phase
              </span>
              <button
                type="button"
                className="btn btn--accent"
                onClick={() => void onCount(progress)}
              >
                ＋1
              </button>
            </div>
          ) : (
            <p className="card-meta">Judged, not counted.</p>
          )}

          <div className="observation-tokens">
            {CHALLENGE_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className={`btn btn--lg challenge-token challenge-token--${status}`}
                aria-pressed={progress.challenge.status === status}
                onClick={() => void onRule(progress.challenge.id, status)}
              >
                {challengeStatusLabel(status)}
              </button>
            ))}
          </div>

          {progress.challenge.status !== 'open' ? (
            <button
              type="button"
              className="btn btn--quiet btn--block"
              onClick={() => void onRule(progress.challenge.id, 'open')}
            >
              Clear the ruling
            </button>
          ) : null}
        </>
      ) : null}
    </Sheet>
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
  onLog: (
    rating: ObservationRatingKind,
    tags: string[],
    moment: ActionMoment | null,
  ) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [moment, setMoment] = useState<ActionMoment | null>(null);
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
        setMoment(null);
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
              const when = moment;
              setSelected([]);
              setMoment(null);
              await onLog(token.kind, chosen, when);
            }}
          >
            {token.label}
          </button>
        ))}
      </div>

      {/*
        When in the action, if the coach wants to say. A **pre-selection**, like the tags:
        the rating tokens above still commit, so this costs a tap only when it is used and
        logging stays at two. Nothing here can be inferred — only the coach knows whether
        they were watching the scan or the touch.
      */}
      <section className="corner-group" data-corner="phase">
        <h3 className="eyebrow">When in the action</h3>
        <div className="row row--wrap">
          {ACTION_MOMENTS.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={moment === option}
              // Tap the chosen one again to take it back, rather than being stuck with a
              // moment tapped by accident.
              onClick={() => setMoment((current) => (current === option ? null : option))}
            >
              {momentShortLabel(option)}
            </button>
          ))}
        </div>
      </section>

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
