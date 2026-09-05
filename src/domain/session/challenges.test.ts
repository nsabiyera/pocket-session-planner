import { describe, expect, it } from 'vitest';
import {
  challengeProgress,
  challengeSummary,
  challengesForPlayer,
  describeChallengeSummary,
  findChallenge,
  liveChallenges,
  sessionChallengeProgress,
  type ChallengeSummary,
} from './challenges';
import type { ChallengeEvent } from '../challenge';
import type { PhaseRun, SessionRunState } from '../session-run';
import { isoDateTime } from '../primitives';
import {
  aChallenge,
  aChallengeEvent,
  aPhase,
  aSession,
  challengeId,
  phaseId,
  playerId,
  T0,
} from '@/test/builders';

const T5 = isoDateTime('2026-08-31T18:05:00.000Z');
const T9 = isoDateTime('2026-08-31T18:09:00.000Z');

const phaseRun = (label: string): PhaseRun => ({
  phaseId: phaseId(label),
  startedAt: T0,
  runningSince: T0,
  accumulatedMs: 0,
  endedAt: null,
  skipped: false,
});

const runWith = (challengeEvents: ChallengeEvent[], currentPhaseIndex = 0): SessionRunState => ({
  startedAt: T0,
  endedAt: null,
  currentPhaseIndex,
  phaseRuns: [phaseRun('warmup'), phaseRun('rondo')],
  pauseReason: null,
  openInterventionId: null,
  lastHeartbeatAt: T0,
  interventionEvents: [],
  practiceAdjustments: [],
  challengeEvents,
});

const sighting = (label: string, over: Partial<ChallengeEvent> = {}) =>
  aChallengeEvent(label, { challengeId: challengeId('c1'), ...over });

/** Two phases, so phase scoping has something to be wrong about. */
const twoPhases = [
  aPhase('warmup', { order: 0, kind: 'warm_up', plannedDurationMin: 10 }),
  aPhase('rondo', { order: 1, plannedDurationMin: 20 }),
];

describe('challengeProgress', () => {
  const kaiCounts = aChallenge('c1', { targetCount: 3 });
  const otherCounts = aChallenge('c2', { targetCount: 2 });

  const session = aSession({
    status: 'in_progress',
    phases: twoPhases,
    challenges: [kaiCounts, otherCounts],
    run: runWith([
      sighting('e1', { phaseId: phaseId('warmup'), at: T0 }),
      sighting('e2', { challengeId: challengeId('c2'), phaseId: phaseId('warmup'), at: T5 }),
      sighting('e3', { phaseId: phaseId('rondo'), at: T9 }),
    ]),
  });

  it('counts only the sightings logged against this challenge', () => {
    expect(challengeProgress(session, kaiCounts).count).toBe(2);
    expect(challengeProgress(session, otherCounts).count).toBe(1);
  });

  it('separates the session tally from the tally in one phase', () => {
    const inRondo = challengeProgress(session, kaiCounts, phaseId('rondo'));
    expect(inRondo.count).toBe(2);
    expect(inRondo.countThisPhase).toBe(1);
  });

  it('scopes to the phase the run is in when no phase is named', () => {
    // currentPhaseIndex 0 is the warm-up: one of the two sightings happened there.
    expect(challengeProgress(session, kaiCounts).countThisPhase).toBe(1);
  });

  it('derives the label, target and hit-target flag from the tally', () => {
    const progress = challengeProgress(session, kaiCounts);
    expect(progress.label).toBe('2/3');
    expect(progress.target).toBe(3);
    expect(progress.hitTarget).toBe(false);
    expect(progress.status).toBe('open');
  });

  it('reads met once the sightings reach the target, with no ruling needed', () => {
    const met = aChallenge('c1', { targetCount: 2 });
    const progress = challengeProgress({ ...session, challenges: [met] }, met);

    expect(progress.hitTarget).toBe(true);
    expect(progress.status).toBe('met');
    expect(progress.label).toBe('2/2');
  });

  it('remembers when the last sighting was, so Review can place it', () => {
    expect(challengeProgress(session, kaiCounts).lastAt).toBe(T9);
    expect(challengeProgress(session, otherCounts).lastAt).toBe(T5);
  });

  it('reports a challenge with no sightings as zero rather than absent', () => {
    const untouched = aChallenge('c3', { targetCount: 4 });
    const progress = challengeProgress(session, untouched);

    expect(progress.count).toBe(0);
    expect(progress.countThisPhase).toBe(0);
    expect(progress.lastAt).toBeNull();
    expect(progress.label).toBe('0/4');
  });

  it('works on a session that has never been started', () => {
    const draft = aSession({ phases: twoPhases, challenges: [kaiCounts] });
    const progress = challengeProgress(draft, kaiCounts);

    expect(progress.count).toBe(0);
    expect(progress.lastAt).toBeNull();
    // No phase to be scoped against, so nothing is out of scope either.
    expect(progress.liveNow).toBe(true);
  });

  it('is live in the phase it names and not in the others', () => {
    const scoped = aChallenge('c1', { targetCount: 3, phaseIds: [phaseId('rondo')] });
    const scopedSession = { ...session, challenges: [scoped] };

    expect(challengeProgress(scopedSession, scoped, phaseId('rondo')).liveNow).toBe(true);
    expect(challengeProgress(scopedSession, scoped, phaseId('warmup')).liveNow).toBe(false);
  });

  it('counts a sighting logged outside the phases the challenge names', () => {
    // The coach saw it; scoping decides what is shown, not what happened.
    const scoped = aChallenge('c1', { targetCount: 3, phaseIds: [phaseId('rondo')] });
    const progress = challengeProgress({ ...session, challenges: [scoped] }, scoped);
    expect(progress.count).toBe(2);
  });
});

describe('findChallenge', () => {
  const session = aSession({ challenges: [aChallenge('c1'), aChallenge('c2')] });

  it('finds a challenge by id, and reports the absence of one it does not hold', () => {
    expect(findChallenge(session, challengeId('c2'))?.id).toBe(challengeId('c2'));
    expect(findChallenge(session, challengeId('ghost'))).toBeUndefined();
  });
});

describe('sessionChallengeProgress ordering', () => {
  const zero = aChallenge('zero', { targetCount: 3 });
  const twoOfThree = aChallenge('two', { targetCount: 3 });
  const settled = aChallenge('settled', { targetCount: 3, status: 'met', settledAt: T0 });

  const session = aSession({
    status: 'in_progress',
    phases: twoPhases,
    challenges: [settled, twoOfThree, zero],
    run: runWith([
      sighting('e1', { challengeId: challengeId('two'), at: T0 }),
      sighting('e2', { challengeId: challengeId('two'), at: T5 }),
    ]),
  });

  it('puts the challenges still needing a chance first, furthest from target leading', () => {
    expect(sessionChallengeProgress(session).map((p) => p.challenge.id)).toEqual([
      zero.id,
      twoOfThree.id,
      settled.id,
    ]);
  });

  it('drops a settled challenge to the bottom rather than hiding it', () => {
    const ids = sessionChallengeProgress(session).map((p) => p.challenge.id);
    expect(ids).toHaveLength(3);
    expect(ids[2]).toBe(settled.id);
  });

  it('keeps a judged challenge visible, alongside the counted ones a sighting short', () => {
    const judged = aChallenge('judged', { measure: 'judged', targetCount: null });
    const withJudged = { ...session, challenges: [zero, judged, twoOfThree] };

    expect(sessionChallengeProgress(withJudged).map((p) => p.challenge.id)).toEqual([
      zero.id,
      judged.id,
      twoOfThree.id,
    ]);
  });

  it('returns an empty list for a session with no challenges', () => {
    expect(sessionChallengeProgress(aSession())).toEqual([]);
  });
});

describe('liveChallenges', () => {
  const unscoped = aChallenge('unscoped', { targetCount: 3 });
  const rondoOnly = aChallenge('rondo-only', { targetCount: 3, phaseIds: [phaseId('rondo')] });
  const ruled = aChallenge('ruled', { targetCount: 3, status: 'missed', settledAt: T0 });

  const session = aSession({
    status: 'in_progress',
    phases: twoPhases,
    challenges: [unscoped, rondoOnly, ruled],
    run: runWith([]),
  });

  it('is what the coach is watching for right now: in this phase, not yet settled', () => {
    expect(liveChallenges(session, phaseId('warmup')).map((p) => p.challenge.id)).toEqual([
      unscoped.id,
    ]);
  });

  it('picks up a phase-scoped challenge once that phase is the one being run', () => {
    expect(liveChallenges(session, phaseId('rondo')).map((p) => p.challenge.id)).toEqual([
      unscoped.id,
      rondoOnly.id,
    ]);
  });

  it('drops a challenge whose tally has already met the target', () => {
    const met = aChallenge('met', { targetCount: 1 });
    const metSession = {
      ...session,
      challenges: [met],
      run: runWith([sighting('e1', { challengeId: challengeId('met') })]),
    };
    expect(liveChallenges(metSession, phaseId('warmup'))).toEqual([]);
  });
});

describe('challengesForPlayer', () => {
  const kaiOne = aChallenge('k1', { playerId: playerId('kai') });
  const kaiTwo = aChallenge('k2', { playerId: playerId('kai') });
  const mayas = aChallenge('m1', { playerId: playerId('maya') });
  const session = aSession({ challenges: [kaiOne, mayas, kaiTwo] });

  it('returns only that player’s challenges', () => {
    expect(challengesForPlayer(session, playerId('kai')).map((p) => p.challenge.id)).toEqual([
      kaiOne.id,
      kaiTwo.id,
    ]);
    expect(challengesForPlayer(session, playerId('maya')).map((p) => p.challenge.id)).toEqual([
      mayas.id,
    ]);
  });

  it('returns nothing for a player who was not given one', () => {
    expect(challengesForPlayer(session, playerId('sam'))).toEqual([]);
  });
});

describe('challengeSummary', () => {
  it('counts the verdicts and the evidence behind them', () => {
    const session = aSession({
      status: 'in_progress',
      phases: twoPhases,
      challenges: [
        aChallenge('met', { targetCount: 3, status: 'met', settledAt: T0 }),
        aChallenge('partly', { targetCount: 3, status: 'partly', settledAt: T0 }),
        aChallenge('missed', { targetCount: 3, status: 'missed', settledAt: T0 }),
        aChallenge('open', { targetCount: 3 }),
      ],
      run: runWith([
        sighting('e1', { challengeId: challengeId('open'), at: T0 }),
        sighting('e2', { challengeId: challengeId('partly'), at: T5 }),
      ]),
    });

    expect(challengeSummary(session)).toEqual({
      total: 4,
      met: 1,
      partly: 1,
      missed: 1,
      open: 1,
      sightings: 2,
    });
  });

  it('counts a challenge the tally settled as met, with no ruling recorded', () => {
    const session = aSession({
      status: 'in_progress',
      phases: twoPhases,
      challenges: [aChallenge('c1', { targetCount: 1 })],
      run: runWith([sighting('e1')]),
    });

    const summary = challengeSummary(session);
    expect(summary.met).toBe(1);
    expect(summary.open).toBe(0);
  });

  it('reports zeroes for a session with no challenges and no run', () => {
    expect(challengeSummary(aSession())).toEqual({
      total: 0,
      met: 0,
      partly: 0,
      missed: 0,
      open: 0,
      sightings: 0,
    });
  });
});

describe('describeChallengeSummary', () => {
  const summary = (over: Partial<ChallengeSummary>): ChallengeSummary => ({
    total: 0,
    met: 0,
    partly: 0,
    missed: 0,
    open: 0,
    sightings: 0,
    ...over,
  });

  it('says so plainly when none were set', () => {
    expect(describeChallengeSummary(summary({}))).toBe('No challenges set.');
  });

  it('stays quiet about the breakdown when everything landed', () => {
    expect(describeChallengeSummary(summary({ total: 2, met: 2 }))).toBe('2 of 2 challenges met.');
  });

  it('gets the singular right — one challenge, not one challenges', () => {
    expect(describeChallengeSummary(summary({ total: 1, met: 1 }))).toBe('1 of 1 challenge met.');
  });

  it('spells out what happened to the rest', () => {
    expect(describeChallengeSummary(summary({ total: 3, met: 1, missed: 1, open: 1 }))).toBe(
      '1 of 3 challenges met — 1 missed, 1 not judged.',
    );
  });

  it('names a partly outcome rather than rounding it to met or missed', () => {
    expect(describeChallengeSummary(summary({ total: 2, partly: 1, open: 1 }))).toBe(
      '0 of 2 challenges met — 1 partly, 1 not judged.',
    );
  });

  it('reports a fully judged session that did not go well', () => {
    expect(describeChallengeSummary(summary({ total: 2, met: 1, missed: 1 }))).toBe(
      '1 of 2 challenges met — 1 missed.',
    );
  });
});
