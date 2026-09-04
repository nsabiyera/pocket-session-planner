'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, Loading, Rating, Screen, ScreenHead, formatShortDate } from '../_components/ui';
import { showToast } from '../_components/toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import {
  loadReviewData,
  proposeCarryForward,
  saveReview,
  type ReviewDraftData,
} from '@/modules/review/review-service';
import { setChallengeStatus } from '@/modules/run/run-service';
import type { CarryForwardProposal } from '@/domain/carry-forward';
import { CHALLENGE_STATUSES, challengeStatusLabel, type ChallengeStatus } from '@/domain/challenge';
import { describeChallengeSummary } from '@/domain/session/challenges';
import {
  SessionReviewSchema,
  type FocusPlayerProgress,
  type ObjectiveOutcome,
} from '@/domain/review';
import { describeCornerBalance } from '@/domain/four-corners/balance';
import {
  describeCapabilityCoverage,
  hasEnoughForCapabilityView,
} from '@/domain/capabilities/coverage';
import { describeInterventionSummary } from '@/domain/session/selectors';
import { formatClock } from '@/domain/session/timer';
import { shortPlayerName } from '@/domain/player';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { asReviewId } from '@/domain/ids';
import { isErr } from '@/lib/result';
import type { ChallengeId, PlayerId } from '@/domain/ids';

/**
 * `/review` — **five taps and zero required typing.**
 *
 * The objective restated verbatim, then Yes / Partly / No at 72px, a five-circle rating, and
 * then a block of things the app worked out on its own that the coach only confirms. The
 * intervention report sits deliberately **before** the carry-forward chips: seeing the number
 * is what makes the proposed fix land. Free text is at the very bottom, keyboard optional.
 */

const OUTCOMES: Array<{ value: ObjectiveOutcome; label: string }> = [
  { value: 'met', label: 'Yes' },
  { value: 'partially_met', label: 'Partly' },
  { value: 'not_met', label: 'No' },
];

const PROGRESS: Array<{ value: FocusPlayerProgress; label: string }> = [
  { value: 'progressed', label: 'Moved on' },
  { value: 'no_change', label: 'Same' },
  { value: 'regressed', label: 'Went back' },
];

export default function ReviewPage() {
  const state = useAppState();
  const router = useRouter();

  const [data, setData] = useState<ReviewDraftData | null>(null);
  const [outcome, setOutcome] = useState<ObjectiveOutcome | null>(null);
  const [metCriteria, setMetCriteria] = useState<Set<number>>(new Set());
  const [rating, setRating] = useState<number | null>(null);
  const [progress, setProgress] = useState<Map<PlayerId, FocusPlayerProgress>>(new Map());
  const [nextSteps, setNextSteps] = useState<Map<PlayerId, string>>(new Map());
  const [seededDone, setSeededDone] = useState<Set<string>>(new Set());
  const [proposals, setProposals] = useState<CarryForwardProposal[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [whatWorked, setWhatWorked] = useState('');
  const [whatDidnt, setWhatDidnt] = useState('');
  const [busy, setBusy] = useState(false);
  const [rulingOn, setRulingOn] = useState<ChallengeId | null>(null);

  const session = state.reviewSession;

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void loadReviewData(getServiceContext(), session.id).then((result) => {
      if (!cancelled && !isErr(result)) setData(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.id, session]);

  // Regenerate the chips whenever the answers that feed them change. They are proposals, so
  // recomputing costs nothing — **nothing is written until Save review**.
  useEffect(() => {
    if (!session || outcome === null) return;
    let cancelled = false;

    const draftReview = SessionReviewSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: session.updatedAt,
      updatedAt: session.updatedAt,
      id: asReviewId('00000000-0000-4000-8000-000000000000'),
      sessionId: session.id,
      squadId: session.squadId,
      completedAt: session.updatedAt,
      objectiveOutcome: outcome,
      metCriteria: [...metCriteria],
      sessionRating: rating,
      focusPlayerReviews: session.focusPlayers.map((focus) => ({
        playerId: focus.playerId,
        progress: progress.get(focus.playerId) ?? 'no_change',
        nextStep: nextSteps.get(focus.playerId) ?? '',
        note: '',
      })),
      whatDidnt: splitLines(whatDidnt),
    });

    void proposeCarryForward(getServiceContext(), session.id, draftReview).then((result) => {
      if (cancelled || isErr(result)) return;
      setProposals(result.value);
      setAccepted(
        new Set(result.value.filter((proposal) => proposal.defaultSelected).map(proposalKeyOf)),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [session, outcome, metCriteria, rating, progress, nextSteps, whatDidnt]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <ScreenHead title="Nothing to review" />
        <Empty>Finish a session and it will appear here.</Empty>
        <Link href="/" className="btn btn--primary btn--block">
          Back to today
        </Link>
      </Screen>
    );
  }

  const playerName = (playerId: PlayerId): string => {
    const player = state.players.find((candidate) => candidate.id === playerId);
    return player ? shortPlayerName(player, state.players) : 'Someone';
  };

  /**
   * The ruling the challenge has been waiting for.
   *
   * Written straight through to the session rather than held in page state until `Save
   * review`: the verdict on a promise made to a player is not a draft, and a coach who taps
   * `Met` and then closes the app has said what they meant. The carry-forward chips read the
   * session, so they pick it up on the next render.
   *
   * Tapping the verdict already recorded clears it back to open — the same gesture both
   * ways, because *"I shouldn't have ruled that yet"* is as common as ruling it.
   */
  const ruleChallenge = async (
    challengeId: ChallengeId,
    status: ChallengeStatus,
    recorded: ChallengeStatus,
  ) => {
    if (!session || rulingOn !== null) return;
    setRulingOn(challengeId);
    try {
      const result = await setChallengeStatus(
        getServiceContext(),
        session.id,
        challengeId,
        recorded === status ? 'open' : status,
      );
      if (isErr(result)) {
        showToast('Could not save that ruling.', { tone: 'stop' });
        return;
      }

      // Both reads at once. They are independent, and every millisecond here is one where
      // the verdict buttons sit disabled — a coach ruling three challenges in a row should
      // not be tapping into dead time.
      const [reloaded] = await Promise.all([
        loadReviewData(getServiceContext(), session.id),
        refresh(),
      ]);
      if (!isErr(reloaded)) setData(reloaded.value);
    } finally {
      setRulingOn(null);
    }
  };

  const save = async () => {
    if (outcome === null || busy) return;
    setBusy(true);
    try {
      const result = await saveReview(getServiceContext(), {
        sessionId: session.id,
        objectiveOutcome: outcome,
        metCriteria: [...metCriteria],
        sessionRating: rating,
        focusPlayerReviews: session.focusPlayers.map((focus) => ({
          playerId: focus.playerId,
          progress: progress.get(focus.playerId) ?? 'no_change',
          nextStep: nextSteps.get(focus.playerId) ?? '',
          note: '',
        })),
        seededActionOutcomes: (data?.seededActions ?? []).map((action) => ({
          actionId: action.id,
          outcome: seededDone.has(action.id) ? ('done' as const) : ('still_open' as const),
          note: '',
        })),
        whatWorked: splitLines(whatWorked),
        whatDidnt: splitLines(whatDidnt),
        acceptedProposals: proposals.filter((proposal) => accepted.has(proposalKeyOf(proposal))),
      });

      if (isErr(result)) {
        showToast('Could not save the review.', { tone: 'stop' });
        return;
      }

      await refresh();
      showToast(
        result.value.createdActions.length > 0
          ? `${result.value.createdActions.length} carried into next session`
          : 'Review saved',
      );
      router.push('/');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHead
        eyebrow={`Review · ${formatShortDate(session.scheduledFor)}`}
        title="How did it go?"
      />

      {/* The objective, restated verbatim. The coach should not have to remember it. */}
      <section className="stack">
        <p className="card card--sunk">{session.objective.text}</p>
        <div className="observation-tokens">
          {OUTCOMES.map((option) => (
            <button
              key={option.value}
              type="button"
              className="btn btn--lg"
              aria-pressed={outcome === option.value}
              onClick={() => setOutcome(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {session.objective.successCriteria.length > 0 ? (
        <section className="stack">
          <h2>Which of these did you get?</h2>
          <ul className="stack stack--tight">
            {session.objective.successCriteria.map((criterion, index) => (
              <li key={criterion}>
                <button
                  type="button"
                  className="card card--link"
                  aria-pressed={metCriteria.has(index)}
                  onClick={() =>
                    setMetCriteria((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                >
                  <span className="row">
                    <span className="check" aria-hidden="true">
                      {metCriteria.has(index) ? '✓' : ''}
                    </span>
                    {criterion}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Rating label="How was the session?" value={rating} onChange={setRating} />

      {/* Everything the app worked out on its own, for the coach to confirm. */}
      {data ? (
        <section className="stack">
          <h2>What the app noticed</h2>

          {data.overruns.map((overrun) => (
            <p key={overrun.phase.id} className="card card--sunk">
              {overrun.phase.title} ran {formatClock(overrun.overrunMs)} over.
            </p>
          ))}

          {data.unobservedFocusPlayerIds.length > 0 ? (
            <p className="card card--sunk">
              {data.unobservedFocusPlayerIds.map(playerName).join(' and ')}: no observations logged.
            </p>
          ) : null}

          {/*
            The challenge headline. Sits with the other worked-out lines, and before the
            rows below it: it is what tells the coach whether there is anything left to rule
            on at all.
          */}
          {data.challengeSummary.total > 0 ? (
            <p className="banner banner--signal">
              {describeChallengeSummary(data.challengeSummary)}
            </p>
          ) : null}

          {/*
            The intervention report. Placed *before* the carry-forward chips on purpose —
            seeing the number is what makes the proposed fix land.
          */}
          <p className="banner banner--signal">{describeInterventionSummary(data.interventions)}</p>

          {/*
            The FA 4 Corner coverage for this session. Sits with the intervention report
            because they answer the same kind of question: not "how did the players do" but
            "what did *you* actually look at".
          */}
          <p className="banner banner--signal">
            {describeCornerBalance(data.cornerCoverage, 'this session')}
          </p>

          {/*
            The six core capabilities — the same question one level down: which part of the
            action was the coach watching? Gated on having enough to say, unlike the corner
            line, because "you never look at scanning" after three observations is how a
            coach learns to ignore the app.
          */}
          {hasEnoughForCapabilityView(data.capabilityCoverage) ? (
            <p className="banner banner--signal">
              {describeCapabilityCoverage(data.capabilityCoverage, 'this session')}
            </p>
          ) : null}
        </section>
      ) : null}

      {data && data.seededActions.length > 0 ? (
        <section className="stack">
          <h2>Last time you said…</h2>
          {data.seededActions.map((action) => (
            <div key={action.id} className="card">
              <span className="card-title">{action.title}</span>
              <div className="row">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={seededDone.has(action.id)}
                  onClick={() =>
                    setSeededDone((current) => {
                      const next = new Set(current);
                      if (next.has(action.id)) next.delete(action.id);
                      else next.add(action.id);
                      return next;
                    })
                  }
                >
                  Done
                </button>
                <span className="card-meta">
                  {seededDone.has(action.id) ? 'Closed out' : 'Stays open and chains forward'}
                </span>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {session.focusPlayers.length > 0 ? (
        <section className="stack">
          <h2>Focus players</h2>
          {session.focusPlayers.map((focus) => {
            const player = state.players.find((candidate) => candidate.id === focus.playerId);
            if (!player) return null;

            return (
              <div key={focus.playerId} className="card">
                <span className="card-title">{shortPlayerName(player, state.players)}</span>
                {focus.reason ? <span className="card-meta">{focus.reason}</span> : null}

                <div className="row row--wrap">
                  {PROGRESS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="chip"
                      aria-pressed={progress.get(focus.playerId) === option.value}
                      onClick={() =>
                        setProgress((current) => new Map(current).set(focus.playerId, option.value))
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="field">
                  <label htmlFor={`next-${focus.playerId}`}>Next step</label>
                  <input
                    id={`next-${focus.playerId}`}
                    type="text"
                    value={nextSteps.get(focus.playerId) ?? ''}
                    placeholder="Scan before receiving"
                    onChange={(event) =>
                      setNextSteps((current) =>
                        new Map(current).set(focus.playerId, event.target.value),
                      )
                    }
                  />
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {/*
        The challenges, and the last chance to rule on them.

        Placed after the focus players and *before* the carry-forward chips, for the same
        reason the intervention report is: these are the answers, and the chips are what the
        app proposes doing about them. A judged challenge has no tally to speak for it, so
        this screen is the only place it can ever be settled — Do mode is gone by now.
      */}
      {data && data.challenges.length > 0 ? (
        <section className="stack">
          <h2>Challenges</h2>
          <p className="card-meta">
            One thing each player was asked to do. Tap a verdict to settle it; tap it again to take
            it back.
          </p>
          <ul className="stack stack--tight">
            {data.challenges.map(({ challenge, label, status, count }) => (
              <li key={challenge.id} className="card challenge-row">
                <div className="row row--between">
                  <span className="card-title">{playerName(challenge.playerId)}</span>
                  {status === 'open' ? (
                    <span className="pill">Not judged</span>
                  ) : (
                    <span className={`pill pill--${status}`}>{challengeStatusLabel(status)}</span>
                  )}
                </div>

                <span className="challenge-text">{challenge.text}</span>

                <span className="card-meta tabular">
                  {challenge.measure === 'judged'
                    ? 'Judged, not counted'
                    : `${label} · ${count === 1 ? '1 sighting' : `${count} sightings`}`}
                </span>

                <div className="observation-tokens">
                  {CHALLENGE_STATUSES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`btn challenge-token challenge-token--${option}`}
                      // The *recorded* status drives this, not the effective one: a tally
                      // that reached its target reads as met without anyone having said so,
                      // and pre-pressing a button the coach never tapped would put words in
                      // their mouth.
                      aria-pressed={challenge.status === option}
                      disabled={rulingOn !== null}
                      onClick={() => void ruleChallenge(challenge.id, option, challenge.status)}
                    >
                      {challengeStatusLabel(option)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {proposals.length > 0 ? (
        <section className="stack">
          <h2>Carry into next session</h2>
          <p className="card-meta">
            Untick anything you do not want. Nothing is saved until you do.
          </p>
          <ul className="stack stack--tight">
            {proposals.map((proposal) => {
              const key = proposalKeyOf(proposal);
              const on = accepted.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="card card--link"
                    aria-pressed={on}
                    onClick={() =>
                      setAccepted((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    <span className="row">
                      <span className="check" aria-hidden="true">
                        {on ? '✓' : ''}
                      </span>
                      <span className="stack stack--tight">
                        <span className="card-title">{proposal.title}</span>
                        {proposal.detail ? (
                          <span className="card-meta">{proposal.detail}</span>
                        ) : null}
                        {proposal.supersedesActionId ? (
                          <span className="pill pill--carried">continues an open point</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Free text last, keyboard only if wanted. */}
      <details className="card card--sunk">
        <summary>Add notes</summary>
        <div className="field">
          <label htmlFor="what-worked">What worked</label>
          <textarea
            id="what-worked"
            value={whatWorked}
            placeholder="One per line"
            onChange={(event) => setWhatWorked(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="what-didnt">What didn&apos;t</label>
          <textarea
            id="what-didnt"
            value={whatDidnt}
            placeholder="One per line"
            onChange={(event) => setWhatDidnt(event.target.value)}
          />
        </div>
      </details>

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        disabled={busy || outcome === null}
        onClick={save}
      >
        Save review
      </button>
    </Screen>
  );
}

/** Proposals have no id until they are saved, so the checklist keys on their content. */
function proposalKeyOf(proposal: CarryForwardProposal): string {
  return `${proposal.trigger}|${proposal.title}|${proposal.playerIds.join(',')}`;
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}
