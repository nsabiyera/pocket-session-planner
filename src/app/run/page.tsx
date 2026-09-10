'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Loading, Screen, Segmented, Sheet } from '../_components/ui';
import { TimerDial } from '../_components/timer-dial';
import { PeriodPresenceBar } from '../_components/period-presence';
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
  logPracticeAdjustment,
  observationTagGroups,
  setChallengeStatus,
  setPeriodPresence,
  undoChallengeProgress,
  undoObservation,
  undoPracticeAdjustment,
  type ObservationTagGroup,
} from '@/modules/run/run-service';
import { CHALLENGE_STATUSES, challengeStatusLabel, type ChallengeStatus } from '@/domain/challenge';
import {
  coachingPointGlyph,
  coachingPointState,
  coachingPointStateLabel,
  nextCoachingPointState,
} from '@/domain/coaching-point';
import { regressionOffer, REGRESSION_OFFER_MESSAGE } from '@/domain/checking';
import { challengeVerdict, playerCards } from '@/domain/player-card';
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
  interventionAudienceLabel,
  interventionBudget,
  interventionMechanicLabel,
  interventionMethodLabel,
  INTERVENTION_AUDIENCES,
  INTERVENTION_MECHANICS,
  INTERVENTION_METHODS,
  mechanicStopsPlay,
  resolvePhaseIntervention,
  type InterventionAudience,
  type InterventionMechanic,
  type InterventionMethod,
} from '@/domain/intervention';
import { cornerSlug } from '@/domain/four-corners';
import {
  adjustmentLabel,
  adjustmentPlanLabel,
  stepInitial,
  stepLabel,
  type AdjustmentDirection,
  type StepLetter,
} from '@/domain/practice';
import type { SessionPhase } from '@/domain/session';
import { HuddleSheet } from '../_components/huddle-sheet';
import { PhaseImageStrip } from '../_components/phase-images';
import { loadPhaseImages } from '@/modules/planning/phase-image-service';
import type { PhaseImage } from '@/domain/phase-image';
import { shortPlayerName, type Player } from '@/domain/player';
import { haptic } from '@/lib/haptics';
import { isErr } from '@/lib/result';
import type { ChallengeId, PhaseId, PlayerId } from '@/domain/ids';
import type { Session } from '@/domain/session';
import type { SessionCommand } from '@/domain/session/state-machine';

/**
 * What the long-press sheet hands back. **Every field optional on purpose**: an axis the coach
 * left alone keeps the plan's value and does not count as a style they picked, which is the
 * distinction `InterventionEvent.styleChosen` exists to record.
 */
interface InterventionOverride {
  method?: InterventionMethod;
  mechanic?: InterventionMechanic;
  audience?: InterventionAudience;
  playerIds?: readonly PlayerId[];
  note?: string;
}

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
  const [huddleOpen, setHuddleOpen] = useState(false);
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

  /*
    The huddle cards. Derived on every render and stored nowhere, so they cannot drift from
    the evidence — and cheap, because Do mode only logs against focus players, so this is two
    or three cards over a list of observations already in memory.
  */
  const cards = playerCards({
    focusPlayers: session.focusPlayers.map((focus) => ({
      playerId: focus.playerId,
      ...(focus.reason !== undefined ? { reason: focus.reason } : {}),
    })),
    challenges: sessionChallengeProgress(session).map((progress) => ({
      playerId: progress.challenge.playerId,
      card: {
        text: progress.challenge.text,
        label: progress.label,
        status: progress.status,
        verdict: challengeVerdict(progress.status),
      },
    })),
    observations,
    misconception: session.objective.commonMisconception,
    nameOf: (playerId) => {
      const player = state.players.find((candidate) => candidate.id === playerId);
      return player ? shortPlayerName(player, state.players) : 'Unknown';
    },
  });

  // Null almost always, which is the point — see `domain/checking.ts`.
  const offer = regressionOffer({
    phaseId: phase.id,
    misconception: session.objective.commonMisconception,
    regressions: phase.regressions,
    observations,
    adjustments: session.run.practiceAdjustments,
  });

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

  /**
   * *"Made it harder"* / *"Made it easier"* — one tap on a progression the coach already
   * wrote down, or on the bare direction when they changed something off-plan.
   *
   * Does **not** close the sheet. A coach who takes a defender out and immediately shrinks
   * the grid has made two adjustments, and re-opening the sheet between them would lose the
   * second one.
   */
  const adjust = async (direction: AdjustmentDirection, text: string, step?: StepLetter) => {
    const result = await logPracticeAdjustment(
      getServiceContext(),
      session.id,
      direction,
      text,
      step,
    );
    if (isErr(result)) return;

    patchActiveSession(result.value.session);
    haptic('confirm');

    const label = adjustmentLabel(direction);
    setAnnouncement(text ? `${label}: ${text}` : label);

    showToast(text ? `${label} — ${text}` : label, {
      action: {
        label: 'Undo',
        run: async () => {
          const undone = await undoPracticeAdjustment(
            getServiceContext(),
            session.id,
            result.value.id,
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

        {/*
          **What you expected to go wrong** (ADR 0009), pinned where you will meet it at the
          moment it matters — the same argument as the intervention plan line directly above.
          Writing a prediction down at a desk on Sunday is worth nothing if you cannot see it
          at 7:40 on a wet Tuesday.

          Absent, not explained, when the coach typed their own objective: an invented
          prediction would be worse than none.
        */}
        {session.objective.commonMisconception ? (
          <p className="run-misconception">
            <span className="eyebrow">Expect</span>
            <span className="run-misconception-text">{session.objective.commonMisconception}</span>
          </p>
        ) : null}
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
            {phase.coachingPoints.map((point) => {
              /*
                Three states, not two: **said it → checked it** (ADR 0009). `delivered`
                records that the coach said it; the second tap records that they asked
                somebody to say it back. It is a count of what the coach did — nothing here
                claims anybody understood anything.

                No `aria-pressed`, which can only carry two states. The glyph is decorative
                and the state is announced in words instead.
              */
              const state = coachingPointState(point);
              return (
                <li key={point.id}>
                  <button
                    type="button"
                    className="point"
                    data-state={state}
                    onClick={() =>
                      void send({
                        kind: 'setCoachingPointState',
                        pointId: point.id,
                        state: nextCoachingPointState(state),
                      })
                    }
                  >
                    <span className="point-check" aria-hidden="true">
                      {coachingPointGlyph(state)}
                    </span>
                    <span>{point.text}</span>
                    <span className="visually-hidden">— {coachingPointStateLabel(state)}</span>
                    {point.source === 'carry_forward' ? (
                      <span className="pill pill--carried">carried</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        Match periods only. A training phase has no notion of who is on the pitch, and a
        break is not a period — the state machine refuses presence against both.
      */}
      {session.kind === 'match' && phase.kind === 'game' ? (
        <section className="stack" aria-label="Who is on the pitch">
          <PeriodPresenceBar
            session={session}
            phase={phase}
            players={state.players}
            onSave={async (playerIds) => {
              const result = await setPeriodPresence(
                getServiceContext(),
                session.id,
                phase.id,
                playerIds,
              );
              if (isErr(result)) {
                showToast('Could not save who was on.', { tone: 'stop' });
                return;
              }
              await refresh();
              showToast(`${playerIds.length} on for ${phase.title.toLowerCase()}`);
            }}
          />
        </section>
      ) : null}

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

          {/*
            **What to tell them** — the player cards (ADR 0009 §4).

            Trailing the focus chips rather than joining the four big actions: it is a huddle
            action, not a mid-drill one, and the action row is the part of Do mode that must
            never grow. No flag gates it — the chip is simply absent when there is nobody it
            could be about, which is this app's usual answer to "should this be here".
          */}
          {cards.length > 0 ? (
            <button
              type="button"
              className="chip chip--lg chip--huddle"
              onClick={() => setHuddleOpen(true)}
            >
              💬 Tell them
            </button>
          ) : null}
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

      {/*
        **The response half** (ADR 0009 §3). The coach predicted the mistake, logged it
        happening, and wrote down a way to make the practice easier — this puts the third
        thing one tap from the second.

        A bar rather than a toast on purpose: a toast that expires while the coach is watching
        the drill is a response they never got, and the whole point of this phase is that it
        arrives while the session is still running. It clears the moment they make the
        practice easier by *any* route, and at the phase change regardless.
      */}
      {offer ? (
        <button
          type="button"
          className="btn btn--lg btn--block regression-bar"
          onClick={() => void adjust('regressed', offer.text)}
        >
          <span className="regression-bar-said">{REGRESSION_OFFER_MESSAGE}</span>
          <span className="regression-bar-fix">Make it easier: {offer.text}</span>
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
          players={state.players}
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

      <HuddleSheet open={huddleOpen} cards={cards} onClose={() => setHuddleOpen(false)} />

      <PhaseSheet
        open={phaseSheetOpen}
        session={session}
        onAdjust={adjust}
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
 * to change method, mechanic or audience, name who it went to, or attach a note.
 *
 * **The sheet is the whole point of two reports, and it was missing.** `styleChosen` is set
 * only when a command carries an axis, and `playerIds` only when a command carries players —
 * and until this sheet had those controls, neither could ever be true. So `coaching-style.ts`
 * reported every event as "your plan read back at you", and told the coach to tap and hold a
 * button whose sheet offered nothing but a note. See `docs/known-issues.md` 1 and 2.
 *
 * The one-tap path is untouched, because the overwhelmingly common case is a coach doing what
 * they said they would and that must not cost a form.
 */
function InterveneButton({
  session,
  players,
  onLog,
}: {
  session: Session;
  players: readonly Player[];
  onLog: (override?: InterventionOverride) => Promise<void>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<InterventionMethod | null>(null);
  const [mechanic, setMechanic] = useState<InterventionMechanic | null>(null);
  const [audience, setAudience] = useState<InterventionAudience | null>(null);
  const [playerIds, setPlayerIds] = useState<readonly PlayerId[]>([]);

  const phase = currentPhase(session);
  const plan = phase ? resolvePhaseIntervention(session, phase) : null;

  const close = () => {
    setSheetOpen(false);
    setNote('');
    setMethod(null);
    setMechanic(null);
    setAudience(null);
    setPlayerIds([]);
  };

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

      <Sheet open={sheetOpen} title="Log an intervention" onClose={close}>
        {/*
          The plan, so the coach can see what they are overriding — and so leaving a control
          alone is a visible choice rather than an accident. An axis left untouched keeps the
          plan's value, and `styleChosen` stays false for it, which is the honest record: they
          did not pick it, they inherited it.
        */}
        {plan ? <p className="card-meta">{describeInterventionPlan(plan)}</p> : null}

        <Segmented
          legend="What you did"
          options={INTERVENTION_METHODS.map((option) => ({
            value: option,
            label: interventionMethodLabel(option),
          }))}
          value={method ?? plan?.method ?? 'command'}
          onChange={setMethod}
        />

        <Segmented
          legend="How you stopped it"
          options={INTERVENTION_MECHANICS.map((option) => ({
            value: option,
            label: interventionMechanicLabel(option),
          }))}
          value={mechanic ?? plan?.mechanic ?? 'in_flow'}
          onChange={setMechanic}
        />

        <Segmented
          legend="Who it landed on"
          options={INTERVENTION_AUDIENCES.map((option) => ({
            value: option,
            label: interventionAudienceLabel(option),
          }))}
          value={audience ?? plan?.audience ?? 'team'}
          onChange={setAudience}
        />

        {/*
          **Who it went to** — the field the questioning report is built on, and the reason
          *"seven players were never asked anything"* can be said at all. Optional, like every
          other control here: an intervention with nobody named is a normal intervention, and
          the report is careful to say it covers only the ones that name somebody.
        */}
        <div className="field">
          <label id="intervention-players-label">Who you spoke to</label>
          <div className="row row--wrap" role="group" aria-labelledby="intervention-players-label">
            {players.map((player) => (
              <button
                key={player.id}
                type="button"
                className="chip chip--lg"
                aria-pressed={playerIds.includes(player.id)}
                onClick={() =>
                  setPlayerIds((current) =>
                    current.includes(player.id)
                      ? current.filter((candidate) => candidate !== player.id)
                      : [...current, player.id],
                  )
                }
              >
                {shortPlayerName(player, players)}
              </button>
            ))}
          </div>
        </div>

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
            const trimmed = note.trim();
            await onLog({
              ...(method !== null ? { method } : {}),
              ...(mechanic !== null ? { mechanic } : {}),
              ...(audience !== null ? { audience } : {}),
              ...(playerIds.length > 0 ? { playerIds } : {}),
              ...(trimmed.length > 0 ? { note: trimmed } : {}),
            });
            close();
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
  onAdjust,
  onClose,
  onJump,
  onExtend,
  onAbandon,
}: {
  open: boolean;
  session: Session;
  onAdjust: (direction: AdjustmentDirection, text: string, step?: StepLetter) => Promise<void>;
  onClose: () => void;
  onJump: (phaseId: PhaseId) => Promise<void>;
  onExtend: (minutes: number) => Promise<void>;
  onAbandon: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [phaseImages, setPhaseImages] = useState<PhaseImage[]>([]);

  const phase = currentPhase(session);
  const imageIds = phase?.imageIds;

  /**
   * Loaded when the sheet opens, not with the run.
   *
   * Do mode rewrites the session document on every timer command, and dragging a few hundred
   * kilobytes of blob through that path would be the exact mistake the separate store exists
   * to avoid. The sheet is a deliberate tap, so a read there is free.
   */
  useEffect(() => {
    if (!open || !imageIds || imageIds.length === 0) {
      setPhaseImages([]);
      return;
    }
    let cancelled = false;
    void loadPhaseImages(getServiceContext(), imageIds).then((rows) => {
      if (!cancelled) setPhaseImages(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, imageIds]);

  return (
    <Sheet open={open} title="Phase options" onClose={onClose}>
      {/*
        First, above even the time control. A coach opens this sheet mid-practice because
        something is not working, and the drawing they made at the kitchen table is the
        fastest answer to "which way round were the gates?". It costs nothing when the phase
        has no picture: the strip renders null.
      */}
      <PhaseImageStrip images={phaseImages} />

      <div className="row">
        <button type="button" className="btn" onClick={() => void onExtend(-5)}>
          −5 min
        </button>
        <button type="button" className="btn" onClick={() => void onExtend(5)}>
          +5 min
        </button>
      </div>

      {/*
        Second, under the one-row time control and **above** jump-to-phase and Abandon.
        This is the other thing a coach opens this sheet for mid-practice — the rondo is
        falling apart, or it is far too easy — and the fix they already wrote down is here.
        Not first, because a phase with five progressions and five regressions would push
        the ±5 min row a screen and a half down from where it has always been.
      */}
      <AdjustPractice phase={currentPhase(session)} onAdjust={onAdjust} />

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

/**
 * The Challenge Point Framework at 7:40 on a wet Tuesday.
 *
 * Each planned progression is its own full-width button, because reading a list and then
 * choosing a direction is two decisions and the coach has time for none. Tapping the
 * *practice* records the direction with it.
 *
 * The two bare buttons at the bottom cover the off-plan case, which the app must not treat
 * as a lesser one: a coach who takes a defender out without having written it down has still
 * changed the challenge, and refusing to record that would be the app preferring its own plan
 * to what actually happened.
 */
function AdjustPractice({
  phase,
  onAdjust,
}: {
  phase: SessionPhase | undefined;
  onAdjust: (direction: AdjustmentDirection, text: string, step?: StepLetter) => Promise<void>;
}) {
  if (!phase) return null;

  const rows: Array<{ direction: AdjustmentDirection; items: readonly string[] }> = [
    { direction: 'progressed', items: phase.progressions },
    { direction: 'regressed', items: phase.regressions },
  ];

  return (
    <section className="stack stack--tight">
      <h3>Change the practice</h3>

      {/*
        The written constraints, each with its letter and both directions on the row. One tap
        records the letter, the direction and the words together — which is the only reason
        the STEP report can exist without costing the coach a second decision mid-practice.
      */}
      {phase.constraints.length > 0 ? (
        <div className="stack stack--tight">
          <p className="eyebrow">Constraints</p>
          {phase.constraints.map((constraint, index) => (
            <div
              key={`${constraint.letter}-${index}`}
              className="card card--sunk stack stack--tight"
            >
              <span className="row row--top">
                <span className="pill" aria-label={stepLabel(constraint.letter)}>
                  {stepInitial(constraint.letter)}
                </span>
                <span className="card-title">{constraint.text}</span>
              </span>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void onAdjust('progressed', constraint.text, constraint.letter)}
                >
                  Harder
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void onAdjust('regressed', constraint.text, constraint.letter)}
                >
                  Easier
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {rows.map(({ direction, items }) =>
        items.length === 0 ? null : (
          <div key={direction} className="stack stack--tight">
            <p className="eyebrow">{adjustmentPlanLabel(direction)}</p>
            {items.map((text, index) => (
              <button
                key={`${direction}-${index}`}
                type="button"
                className="btn btn--lg btn--block"
                onClick={() => void onAdjust(direction, text)}
              >
                {text}
              </button>
            ))}
          </div>
        ),
      )}

      <p className="card-meta">Or record a change you did not plan:</p>
      <div className="row">
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => void onAdjust('progressed', '')}
        >
          {adjustmentLabel('progressed')}
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => void onAdjust('regressed', '')}
        >
          {adjustmentLabel('regressed')}
        </button>
      </div>
    </section>
  );
}
