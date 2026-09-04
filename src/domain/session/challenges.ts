import {
  describeChallengeProgress,
  effectiveChallengeStatus,
  hasHitTarget,
  isChallengeLiveInPhase,
  type ChallengeEvent,
  type ChallengeStatus,
  type PlayerChallenge,
} from '../challenge';
import type { ChallengeId, PhaseId, PlayerId } from '../ids';
import type { IsoDateTime } from '../primitives';
import type { Session } from '../session';
import { currentPhase } from './selectors';

/**
 * Challenge monitoring, derived.
 *
 * Nothing here is stored: every tally is a count of `run.challengeEvents`, which is what
 * makes `Undo` a pop rather than a decrement, and what makes it impossible for the number on
 * the screen to disagree with the evidence behind it. Same reasoning as the timer.
 */

export interface ChallengeProgress {
  readonly challenge: PlayerChallenge;
  /** Sightings logged across the whole session. */
  readonly count: number;
  /** Sightings logged in the phase this is being viewed from, when one was given. */
  readonly countThisPhase: number;
  readonly target: number | null;
  readonly hitTarget: boolean;
  /** What to render: an explicit ruling, else `met` once the tally says so, else `open`. */
  readonly status: ChallengeStatus;
  /** `2/3`, or an em dash for a judged challenge. */
  readonly label: string;
  readonly lastAt: IsoDateTime | null;
  /** Live in the phase this was derived against. True when no phase was given. */
  readonly liveNow: boolean;
}

function eventsFor(session: Session, challengeId: ChallengeId): ChallengeEvent[] {
  return (session.run?.challengeEvents ?? []).filter(
    (event) => event.challengeId === challengeId,
  );
}

/** One challenge's derived state. `phaseId` defaults to the phase the run is in. */
export function challengeProgress(
  session: Session,
  challenge: PlayerChallenge,
  phaseId?: PhaseId,
): ChallengeProgress {
  const events = eventsFor(session, challenge.id);
  const scope = phaseId ?? currentPhase(session)?.id;
  const count = events.length;

  return {
    challenge,
    count,
    countThisPhase:
      scope === undefined ? count : events.filter((event) => event.phaseId === scope).length,
    target: challenge.targetCount,
    hitTarget: hasHitTarget(challenge, count),
    status: effectiveChallengeStatus(challenge, count),
    label: describeChallengeProgress(challenge, count),
    // Events are appended in order, so the last one is the most recent.
    lastAt: events[events.length - 1]?.at ?? null,
    liveNow: scope === undefined ? true : isChallengeLiveInPhase(challenge, scope),
  };
}

export function findChallenge(
  session: Session,
  challengeId: ChallengeId,
): PlayerChallenge | undefined {
  return session.challenges.find((challenge) => challenge.id === challengeId);
}

/**
 * Every challenge with its derived state, in a stable order.
 *
 * Ordered **still-open first, then by how far off target they are**, because that is the
 * question the coach is actually asking when they glance at the screen with four minutes
 * left: who still needs a chance? A settled challenge drops to the bottom — it has nothing
 * left to say.
 */
export function sessionChallengeProgress(
  session: Session,
  phaseId?: PhaseId,
): ChallengeProgress[] {
  return session.challenges
    .map((challenge) => challengeProgress(session, challenge, phaseId))
    .sort((a, b) => {
      const settled = Number(a.status !== 'open') - Number(b.status !== 'open');
      if (settled !== 0) return settled;
      return remaining(a) - remaining(b);
    });
}

/**
 * How many sightings short of target, descending urgency. A judged challenge has no number,
 * so it sorts alongside a counted one that is a single sighting away — close enough to keep
 * it visible without pretending it has a tally.
 */
function remaining(progress: ChallengeProgress): number {
  if (progress.target === null) return -1;
  return progress.count - progress.target;
}

/** The challenges being watched for right now: live in this phase and not yet settled. */
export function liveChallenges(session: Session, phaseId?: PhaseId): ChallengeProgress[] {
  return sessionChallengeProgress(session, phaseId).filter(
    (progress) => progress.liveNow && progress.status === 'open',
  );
}

/** Challenges belonging to one player, newest ruling last. Drives the player chip badge. */
export function challengesForPlayer(session: Session, playerId: PlayerId): ChallengeProgress[] {
  return sessionChallengeProgress(session).filter(
    (progress) => progress.challenge.playerId === playerId,
  );
}

export interface ChallengeSummary {
  readonly total: number;
  readonly met: number;
  readonly partly: number;
  readonly missed: number;
  readonly open: number;
  /** Total sightings logged across every challenge. */
  readonly sightings: number;
}

export function challengeSummary(session: Session): ChallengeSummary {
  const all = sessionChallengeProgress(session);
  const count = (status: ChallengeStatus) =>
    all.filter((progress) => progress.status === status).length;

  return {
    total: all.length,
    met: count('met'),
    partly: count('partly'),
    missed: count('missed'),
    open: count('open'),
    sightings: session.run?.challengeEvents.length ?? 0,
  };
}

/**
 * *"3 of 4 challenges met."* — the one line Review needs.
 *
 * Stays quiet about the breakdown when everything landed, because "4 of 4 challenges met"
 * followed by a list of zeroes is noise.
 */
export function describeChallengeSummary(summary: ChallengeSummary): string {
  if (summary.total === 0) return 'No challenges set.';

  const settled = summary.met + summary.partly + summary.missed;
  const head = `${summary.met} of ${summary.total} challenge${summary.total === 1 ? '' : 's'} met`;
  if (settled === summary.total && summary.met === summary.total) return `${head}.`;

  const parts: string[] = [];
  if (summary.partly > 0) parts.push(`${summary.partly} partly`);
  if (summary.missed > 0) parts.push(`${summary.missed} missed`);
  if (summary.open > 0) parts.push(`${summary.open} not judged`);

  return parts.length === 0 ? `${head}.` : `${head} — ${parts.join(', ')}.`;
}
