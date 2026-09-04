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
  Segmented,
  Sheet,
  Stepper,
} from '../../_components/ui';
import { showToast } from '../../_components/toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import { addChallenge, removeChallenge, updateChallenge } from '@/modules/planning/challenges';
import {
  MAX_CHALLENGE_TARGET,
  MAX_CHALLENGES_PER_SESSION,
  type ChallengeMeasure,
  type PlayerChallenge,
} from '@/domain/challenge';
import { cornerShortLabel, cornerSlug, FOUR_CORNERS, type FourCorner } from '@/domain/four-corners';
import { comparePlayers, shortPlayerName, type Player } from '@/domain/player';
import { phasesInOrder, type Session } from '@/domain/session';
import type { ChallengeId, PhaseId } from '@/domain/ids';
import { isErr, type Result } from '@/lib/result';

/**
 * Player challenges — an **optional detour**, like `/plan/intervention`.
 *
 * A challenge is one thing *one player* is trying to do today: "Kai, three forward passes."
 * The screen is built around that sentence. Tap a player, type the ask, and the target is
 * already 3 with a stepper next to it, because typing a number on a phone is the slowest
 * thing a coach can be asked to do.
 *
 * Everything else — which phases it applies to, which corner it develops — is behind a
 * `<details>`. Most challenges want neither.
 */
export default function ChallengesPage() {
  const state = useAppState();
  const router = useRouter();
  const [editing, setEditing] = useState<PlayerChallenge | null>(null);
  const [addingFor, setAddingFor] = useState<Player | null>(null);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const session = state.activeSession;
  if (!session) {
    return (
      <Screen>
        <ScreenHead title="Nothing to challenge" />
        <Empty>Plan a session first.</Empty>
        <Link href="/plan" className="btn btn--primary btn--block">
          Plan a session
        </Link>
      </Screen>
    );
  }

  if (state.players.length === 0) {
    return (
      <Screen>
        <ScreenHead eyebrow="Challenges" title="No players yet" />
        <Empty>A challenge is for one player, so the squad has to exist first.</Empty>
        <Link href="/squad" className="btn btn--primary btn--block">
          Add players
        </Link>
      </Screen>
    );
  }

  const roster = [...state.players].sort(comparePlayers);
  const full = session.challenges.length >= MAX_CHALLENGES_PER_SESSION;

  const save = async <T, E>(run: () => Promise<Result<T, E>>): Promise<boolean> => {
    const result = await run();
    if (isErr(result)) {
      showToast('That did not save.', { tone: 'stop' });
      return false;
    }
    await refresh();
    return true;
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Challenges" title={session.objective.text} />

      <p className="card-meta">
        One thing each player is trying to do today. You tally them in Do mode with a single tap,
        and rule on them afterwards.
      </p>

      {full ? (
        <p className="banner banner--warn">
          That is {MAX_CHALLENGES_PER_SESSION} challenges — as many as anyone can watch at once.
        </p>
      ) : null}

      <section className="stack">
        <h2>Squad</h2>
        <ul className="stack stack--tight">
          {roster.map((player) => {
            const theirs = session.challenges.filter(
              (challenge) => challenge.playerId === player.id,
            );

            return (
              <li key={player.id} className="card challenge-row">
                <div className="row row--between">
                  <span className="card-title">{shortPlayerName(player, state.players)}</span>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={full}
                    onClick={() => setAddingFor(player)}
                  >
                    {theirs.length === 0 ? '＋ Challenge' : '＋ Another'}
                  </button>
                </div>

                {theirs.length === 0 ? (
                  <p className="card-meta">Nothing set.</p>
                ) : (
                  <ul className="stack stack--tight">
                    {theirs.map((challenge) => (
                      <li key={challenge.id}>
                        <button
                          type="button"
                          className="card card--sunk card--link challenge-chip"
                          onClick={() => setEditing(challenge)}
                          {...(challenge.corner
                            ? { 'data-corner': cornerSlug(challenge.corner) }
                            : {})}
                        >
                          <span className="challenge-text">{challenge.text}</span>
                          <span className="row row--wrap">
                            <span className="pill tabular">
                              {challenge.measure === 'judged'
                                ? 'Judged'
                                : `Target ${challenge.targetCount}`}
                            </span>
                            {challenge.corner ? (
                              <span className="pill" data-corner={cornerSlug(challenge.corner)}>
                                {cornerShortLabel(challenge.corner)}
                              </span>
                            ) : null}
                            {challenge.phaseIds.length > 0 ? (
                              <span className="pill">
                                {describePhaseScope(session, challenge.phaseIds)}
                              </span>
                            ) : null}
                            {challenge.source === 'carry_forward' ? <CarriedPill /> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        onClick={() => router.push('/plan/phases')}
      >
        Done
      </button>

      <ChallengeSheet
        title={addingFor ? `Challenge for ${addingFor.name}` : 'Edit challenge'}
        session={session}
        challenge={editing}
        open={addingFor !== null || editing !== null}
        onClose={() => {
          setAddingFor(null);
          setEditing(null);
        }}
        onSave={async (draft) => {
          const ctx = getServiceContext();
          const player = addingFor;

          const saved = await save(() =>
            player
              ? addChallenge(ctx, session.id, {
                  playerId: player.id,
                  text: draft.text,
                  measure: draft.measure,
                  targetCount: draft.targetCount,
                  phaseIds: draft.phaseIds,
                  corner: draft.corner,
                })
              : updateChallenge(ctx, session.id, (editing as PlayerChallenge).id, {
                  text: draft.text,
                  measure: draft.measure,
                  targetCount: draft.targetCount,
                  phaseIds: draft.phaseIds,
                  corner: draft.corner,
                }),
          );

          if (saved) {
            setAddingFor(null);
            setEditing(null);
          }
        }}
        onRemove={
          editing
            ? async (challengeId) => {
                await save(() => removeChallenge(getServiceContext(), session.id, challengeId));
                setEditing(null);
                showToast('Challenge removed');
              }
            : undefined
        }
      />
    </Screen>
  );
}

/** `Rondo` for one phase, `2 phases` beyond that — the name is only useful when singular. */
function describePhaseScope(session: Session, phaseIds: readonly PhaseId[]): string {
  if (phaseIds.length === 1) {
    const phase = session.phases.find((candidate) => candidate.id === phaseIds[0]);
    return phase ? phase.title : '1 phase';
  }
  return `${phaseIds.length} phases`;
}

interface ChallengeDraft {
  text: string;
  measure: ChallengeMeasure;
  targetCount: number | null;
  phaseIds: PhaseId[];
  corner: FourCorner | null;
}

const BLANK: ChallengeDraft = {
  text: '',
  measure: 'count',
  targetCount: 3,
  phaseIds: [],
  corner: null,
};

/**
 * The one sheet, used for both adding and editing.
 *
 * The measure control is the only real decision on it: *count it* or *judge it*. Everything
 * downstream — whether Do mode shows a `+1` button and a fraction, or a single verdict —
 * follows from that one tap.
 */
function ChallengeSheet({
  title,
  session,
  challenge,
  open,
  onClose,
  onSave,
  onRemove,
}: {
  title: string;
  session: Session;
  challenge: PlayerChallenge | null;
  open: boolean;
  onClose: () => void;
  onSave: (draft: ChallengeDraft) => Promise<void>;
  onRemove?: (challengeId: ChallengeId) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ChallengeDraft>(BLANK);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Re-seed when a different challenge is opened — or when the sheet switches to adding, in
  // which case the previous edit's text must not linger.
  const key = challenge?.id ?? (open ? 'new' : null);
  if (key !== seededFor) {
    setSeededFor(key);
    setDraft(
      challenge
        ? {
            text: challenge.text,
            measure: challenge.measure,
            targetCount: challenge.targetCount,
            phaseIds: [...challenge.phaseIds],
            corner: challenge.corner,
          }
        : BLANK,
    );
  }

  const phases = phasesInOrder(session);
  const valid = draft.text.trim().length > 0;

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="field">
        <label htmlFor="challenge-text">The challenge</label>
        <input
          id="challenge-text"
          type="text"
          value={draft.text}
          placeholder="Three forward passes"
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        />
      </div>

      <Segmented
        legend="How will you judge it?"
        value={draft.measure}
        options={[
          { value: 'count' as ChallengeMeasure, label: 'Count it' },
          { value: 'judged' as ChallengeMeasure, label: 'Judge it' },
        ]}
        onChange={(measure) =>
          setDraft({
            ...draft,
            measure,
            // A judged challenge carries no target; a counted one always needs one.
            targetCount: measure === 'judged' ? null : (draft.targetCount ?? 3),
          })
        }
      />

      {draft.measure === 'count' ? (
        <Stepper
          label="Target"
          value={draft.targetCount ?? 3}
          step={1}
          min={1}
          max={MAX_CHALLENGE_TARGET}
          suffix="times"
          onChange={(targetCount) => setDraft({ ...draft, targetCount })}
        />
      ) : (
        <p className="card-meta">
          No tally — you rule on it at the end. Best for the things you cannot count, like staying
          positive after a mistake.
        </p>
      )}

      <details className="card card--sunk">
        <summary>Narrow it down</summary>

        <p className="card-meta">
          By default the challenge is live all session and files under no corner. Both are usually
          right.
        </p>

        <fieldset className="field">
          <legend>Only in these phases</legend>
          <div className="row row--wrap">
            {phases.map((phase) => {
              const on = draft.phaseIds.includes(phase.id);
              return (
                <button
                  key={phase.id}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      phaseIds: on
                        ? draft.phaseIds.filter((id) => id !== phase.id)
                        : [...draft.phaseIds, phase.id],
                    })
                  }
                >
                  {phase.title}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Corner it develops</legend>
          <div className="row row--wrap">
            {FOUR_CORNERS.map((corner) => (
              <button
                key={corner}
                type="button"
                className="chip"
                data-corner={cornerSlug(corner)}
                aria-pressed={draft.corner === corner}
                onClick={() =>
                  setDraft({ ...draft, corner: draft.corner === corner ? null : corner })
                }
              >
                {cornerShortLabel(corner)}
              </button>
            ))}
          </div>
        </fieldset>
      </details>

      <button
        type="button"
        className="btn btn--primary btn--lg btn--block"
        disabled={!valid}
        onClick={() => void onSave({ ...draft, text: draft.text.trim() })}
      >
        {challenge ? 'Save challenge' : 'Set challenge'}
      </button>

      {challenge && onRemove ? (
        <button
          type="button"
          className="btn btn--danger btn--block"
          onClick={() => void onRemove(challenge.id)}
        >
          Remove challenge
        </button>
      ) : null}
    </Sheet>
  );
}
