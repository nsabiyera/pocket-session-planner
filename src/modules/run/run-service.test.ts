import { beforeEach, describe, expect, it } from 'vitest';
import {
  dispatch,
  heartbeat,
  loadRunSnapshot,
  logChallengeProgress,
  logIntervention,
  logObservation,
  observationTagGroups,
  observationTagsFor,
  setChallengeStatus,
  undoChallengeProgress,
  undoObservation,
} from './run-service';
import { commitAndStart, startDraft } from '../planning/planning-service';
import { addChallenge } from '../planning/challenges';
import { addPlayer, createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asSessionId, type PlayerId, type SquadId } from '@/domain/ids';
import { interventionSummary } from '@/domain/session/selectors';
import { phaseElapsedMs } from '@/domain/session/timer';
import { readResumeMirror, mirrorRemainingMs } from '@/lib/resume-mirror';
import { challengeId, T0, testId } from '@/test/builders';
import type { Session } from '@/domain/session';
import type { ServiceContext } from '../context';

let ctx: ServiceContext;
let squadId: SquadId;
let kai: PlayerId;
let maya: PlayerId;
let session: Session;

const clock = () => ctx.clock as FakeClock;

beforeEach(async () => {
  localStorage.clear();
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });

  const squad = await createSquad(ctx, { name: 'U12 Reds' });
  squadId = squad.id;
  kai = (await addPlayer(ctx, { squadId, name: 'Kai' })).id;
  maya = (await addPlayer(ctx, { squadId, name: 'Maya' })).id;

  const draft = unwrap(
    await startDraft(ctx, {
      squadId,
      objectiveText: 'Playing out from the back',
      objectiveTemplateId: 'playing-out-from-the-back',
      focusPlayerIds: [kai, maya],
    }),
  );
  session = unwrap(await commitAndStart(ctx, draft.id));
});

describe('dispatch', () => {
  it('persists write-through, so a crash on the next frame loses nothing', async () => {
    clock().advanceMinutes(4);
    const paused = unwrap(await dispatch(ctx, session.id, { kind: 'pausePhase' }));

    // Read back from the store rather than trusting the return value.
    const stored = await ctx.store.sessions.get(session.id);
    expect(stored?.run?.phaseRuns[0]?.runningSince).toBeNull();
    expect(stored?.run?.phaseRuns[0]?.accumulatedMs).toBe(4 * 60_000);
    expect(stored?.updatedAt).toBe(paused.updatedAt);
  });

  it('reports an illegal transition without writing anything', async () => {
    const before = await ctx.store.sessions.get(session.id);
    const result = await dispatch(ctx, session.id, { kind: 'commitPlan' });

    expect(isErr(result) && result.error.kind).toBe('transition');
    expect(await ctx.store.sessions.get(session.id)).toEqual(before);
  });

  it('reports a session that does not exist', async () => {
    const result = await dispatch(ctx, asSessionId(testId('ghost')), { kind: 'pausePhase' });
    expect(isErr(result) && result.error.kind).toBe('session_not_found');
  });

  it('refreshes the synchronous resume mirror on every command', async () => {
    clock().advanceMinutes(3);
    await dispatch(ctx, session.id, { kind: 'heartbeat' });

    const mirror = readResumeMirror();
    expect(mirror?.activeSessionId).toBe(session.id);
    expect(mirror?.sessionTitle).toBe('Playing out from the back · 31 Aug');
    expect(mirror?.phaseTitle).toMatch(/^PLAY/);
    expect(mirror?.status).toBe('in_progress');

    // The mirror stores derivation inputs, so the home screen computes the same number the
    // real timer would.
    const phase = session.phases[0]!;
    expect(mirrorRemainingMs(mirror!, clock().now())).toBe(
      phase.plannedDurationMin * 60_000 - 3 * 60_000,
    );
  });

  it('clears the mirror and the active pointer when the session finishes', async () => {
    clock().advanceMinutes(50);
    await dispatch(ctx, session.id, { kind: 'finish' });

    expect(readResumeMirror()).toBeNull();
    expect((await ctx.store.meta.get())?.activeSessionId).toBeNull();
  });
});

describe('logIntervention', () => {
  it('is one call with no arguments, pre-filled from the phase plan', async () => {
    clock().advanceMinutes(2);
    const updated = unwrap(await logIntervention(ctx, session.id));
    const event = updated.run?.interventionEvents[0];

    expect(event).toMatchObject({
      method: 'observation_feedback',
      mechanic: 'in_flow',
      audience: 'team',
    });
    expect(event?.phaseElapsedMs).toBe(2 * 60_000);
  });

  it('accepts overrides from the long-press sheet', async () => {
    const updated = unwrap(
      await logIntervention(ctx, session.id, {
        method: 'command',
        mechanic: 'play_stop_play',
        audience: 'individual',
        playerIds: [kai],
        note: 'Body shape when receiving',
      }),
    );

    expect(updated.run?.interventionEvents[0]).toMatchObject({
      method: 'command',
      mechanic: 'play_stop_play',
      audience: 'individual',
      playerIds: [kai],
      note: 'Body shape when receiving',
    });
  });

  it('pauses the phase clock for a stop-play mechanic, and measures the stoppage', async () => {
    clock().advanceMinutes(5);
    const stopped = unwrap(await logIntervention(ctx, session.id, { mechanic: 'play_stop_play' }));
    expect(stopped.run?.pauseReason).toBe('intervention');

    clock().advanceSeconds(40);
    const resumed = unwrap(await dispatch(ctx, session.id, { kind: 'closeIntervention' }));

    expect(resumed.run?.interventionEvents[0]?.durationMs).toBe(40_000);
    expect(phaseElapsedMs(resumed.run!.phaseRuns[0]!, clock().now())).toBe(5 * 60_000);
    expect(interventionSummary(resumed, clock().now()).stoppageMs).toBe(40_000);
  });

  it('survives a reload taken mid-intervention with the clock still stopped', async () => {
    clock().advanceMinutes(5);
    await logIntervention(ctx, session.id, { mechanic: 'play_freeze_play' });
    clock().advanceMinutes(3);

    // A force-quit and reopen is exactly a fresh read of the stored document.
    const reloaded = await ctx.store.sessions.get(session.id);
    expect(reloaded?.run?.openInterventionId).toBeTruthy();
    expect(phaseElapsedMs(reloaded!.run!.phaseRuns[0]!, clock().now())).toBe(5 * 60_000);

    const resumed = unwrap(await dispatch(ctx, session.id, { kind: 'resumePhase' }));
    expect(resumed.run?.interventionEvents[0]?.durationMs).toBe(3 * 60_000);
  });
});

describe('logObservation', () => {
  it('is two taps and lands immediately', async () => {
    clock().advanceMinutes(6);
    const observation = unwrap(
      await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'good' }),
    );

    expect(observation).toMatchObject({
      playerId: kai,
      kind: 'strength',
      ratingKind: 'good',
      rating: 5,
      phaseElapsedMs: 6 * 60_000,
    });
    expect(await ctx.store.observations.listBySession(session.id)).toHaveLength(1);
  });

  it('maps struggled and working to development work', async () => {
    const struggled = unwrap(
      await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'struggled' }),
    );
    expect(struggled).toMatchObject({ kind: 'development', rating: 2 });

    const working = unwrap(
      await logObservation(ctx, { sessionId: session.id, playerId: maya, ratingKind: 'working' }),
    );
    expect(working).toMatchObject({ kind: 'development', rating: 3 });
  });

  it('omits playerId entirely for a team-wide note, keeping it out of by-player-at', async () => {
    const note = unwrap(
      await logObservation(ctx, { sessionId: session.id, text: 'Whole team switched off' }),
    );

    expect('playerId' in note).toBe(false);
    expect(note.kind).toBe('note');
    expect(await ctx.store.observations.listByPlayer(kai)).toHaveLength(0);
  });

  it('stamps the phase it was logged in', async () => {
    const advanced = unwrap(await dispatch(ctx, session.id, { kind: 'nextPhase' }));
    const observation = unwrap(
      await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'good' }),
    );

    expect(observation.phaseId).toBe(advanced.phases[1]?.id);
  });

  it('carries tag chips through', async () => {
    const observation = unwrap(
      await logObservation(ctx, {
        sessionId: session.id,
        playerId: kai,
        ratingKind: 'struggled',
        tags: ['Head up before you receive'],
      }),
    );
    expect(observation.tags).toEqual(['Head up before you receive']);
  });

  it('undo removes it outright, so the chip count is right again', async () => {
    const observation = unwrap(
      await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'good' }),
    );
    await undoObservation(ctx, observation.id);
    expect(await ctx.store.observations.listBySession(session.id)).toHaveLength(0);
  });

  it('reports a missing session or phase rather than throwing', async () => {
    const noSession = await logObservation({ ...ctx }, { sessionId: asSessionId(testId('ghost')) });
    expect(isErr(noSession) && noSession.error.kind).toBe('session_not_found');

    await ctx.store.sessions.put({ ...session, status: 'completed', run: null });
    const noPhase = await logObservation(ctx, { sessionId: session.id });
    expect(isErr(noPhase) && noPhase.error.kind).toBe('no_current_phase');
  });
});

describe('loadRunSnapshot', () => {
  it('returns the session plus per-player counts for the current phase only', async () => {
    await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'good' });
    await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'working' });
    await dispatch(ctx, session.id, { kind: 'nextPhase' });
    await logObservation(ctx, { sessionId: session.id, playerId: maya, ratingKind: 'good' });

    const snapshot = unwrap(await loadRunSnapshot(ctx, session.id));

    expect(snapshot.observations).toHaveLength(3);
    // Only the current phase counts, because the chip dimming is about *this* drill.
    expect(snapshot.phaseCountsByPlayer.get(kai)).toBeUndefined();
    expect(snapshot.phaseCountsByPlayer.get(maya)).toBe(1);
  });

  it('ignores team-wide observations in the per-player counts', async () => {
    await logObservation(ctx, { sessionId: session.id, text: 'Team note' });
    const snapshot = unwrap(await loadRunSnapshot(ctx, session.id));
    expect(snapshot.phaseCountsByPlayer.size).toBe(0);
  });

  it('reports a session that does not exist', async () => {
    const result = await loadRunSnapshot(ctx, asSessionId(testId('ghost')));
    expect(isErr(result) && result.error.kind).toBe('session_not_found');
  });
});

describe('challenges in Do mode', () => {
  /** Adds a challenge to the running session and hands back the one it added. */
  const challengeFor = async (
    playerId: PlayerId,
    text: string,
    over: Partial<Parameters<typeof addChallenge>[2]> = {},
  ) => {
    const updated = unwrap(await addChallenge(ctx, session.id, { playerId, text, ...over }));
    const challenge = updated.challenges[updated.challenges.length - 1];
    if (!challenge) throw new Error('addChallenge returned a session with no challenges');
    return challenge;
  };

  it('counts a sighting write-through, stamped with the phase clock', async () => {
    const challenge = await challengeFor(kai, 'Three forward passes', { targetCount: 3 });
    clock().advanceMinutes(2);
    const after = unwrap(await logChallengeProgress(ctx, session.id, challenge.id));

    expect(after.run?.challengeEvents).toHaveLength(1);

    const stored = await ctx.store.sessions.get(session.id);
    expect(stored?.run?.challengeEvents[0]?.challengeId).toBe(challenge.id);
    expect(stored?.run?.challengeEvents[0]?.phaseElapsedMs).toBe(2 * 60_000);
  });

  it('gives every sighting its own id, so three taps are three events', async () => {
    const challenge = await challengeFor(kai, 'Forward passes', { targetCount: 3 });
    await logChallengeProgress(ctx, session.id, challenge.id);
    const after = unwrap(await logChallengeProgress(ctx, session.id, challenge.id));

    const ids = after.run?.challengeEvents.map((event) => event.id) ?? [];
    expect(new Set(ids).size).toBe(2);
  });

  it('pops the most recent sighting on undo', async () => {
    const challenge = await challengeFor(kai, 'Forward passes', { targetCount: 3 });
    await logChallengeProgress(ctx, session.id, challenge.id);
    await logChallengeProgress(ctx, session.id, challenge.id);

    const undone = unwrap(await undoChallengeProgress(ctx, session.id, challenge.id));
    expect(undone.run?.challengeEvents).toHaveLength(1);
    expect((await ctx.store.sessions.get(session.id))?.run?.challengeEvents).toHaveLength(1);
  });

  it('reports that there is nothing to undo', async () => {
    const challenge = await challengeFor(kai, 'Forward passes', { targetCount: 3 });
    const result = await undoChallengeProgress(ctx, session.id, challenge.id);
    expect(isErr(result) && result.error.kind).toBe('transition');
  });

  it('records the coach’s ruling, with the note they typed', async () => {
    const challenge = await challengeFor(kai, 'Forward passes', { targetCount: 3 });
    const ruled = unwrap(
      await setChallengeStatus(ctx, session.id, challenge.id, 'partly', 'One, and looking'),
    );

    expect(ruled.challenges[0]?.status).toBe('partly');
    expect(ruled.challenges[0]?.note).toBe('One, and looking');
    expect(ruled.challenges[0]?.settledAt).toBe(T0);
  });

  it('rules on a challenge after the session is finished — that is where Review is', async () => {
    const challenge = await challengeFor(kai, 'Forward passes', { targetCount: 3 });
    unwrap(await dispatch(ctx, session.id, { kind: 'finish' }));

    const ruled = unwrap(await setChallengeStatus(ctx, session.id, challenge.id, 'met'));
    expect(ruled.status).toBe('completed');
    expect(ruled.challenges[0]?.status).toBe('met');
  });

  it('reports a challenge this session does not hold', async () => {
    const result = await logChallengeProgress(ctx, session.id, challengeId('ghost'));
    expect(isErr(result) && result.error.kind).toBe('transition');
  });

  it('hands /run its challenges scoped to the current phase, and a summary', async () => {
    const unscoped = await challengeFor(kai, 'Forward passes', { targetCount: 3 });
    const later = session.phases[1];
    const scoped = await challengeFor(maya, 'Left foot only', {
      targetCount: 2,
      phaseIds: later ? [later.id] : [],
    });
    unwrap(await logChallengeProgress(ctx, session.id, unscoped.id));

    const snapshot = unwrap(await loadRunSnapshot(ctx, session.id));

    expect(snapshot.challenges).toHaveLength(2);
    const progress = snapshot.challenges.find((p) => p.challenge.id === unscoped.id);
    expect(progress?.count).toBe(1);
    expect(progress?.countThisPhase).toBe(1);
    expect(progress?.label).toBe('1/3');
    expect(progress?.liveNow).toBe(true);
    // Scoped to the next phase, so it is not being watched for yet.
    expect(snapshot.challenges.find((p) => p.challenge.id === scoped.id)?.liveNow).toBe(false);

    expect(snapshot.challengeSummary).toEqual({
      total: 2,
      met: 0,
      partly: 0,
      missed: 0,
      open: 2,
      sightings: 1,
    });
  });

  it('reports an empty challenge list and a zeroed summary when none were set', async () => {
    const snapshot = unwrap(await loadRunSnapshot(ctx, session.id));
    expect(snapshot.challenges).toEqual([]);
    expect(snapshot.challengeSummary.total).toBe(0);
    expect(snapshot.challengeSummary.sightings).toBe(0);
  });
});

describe('the corner-grouped tag bank', () => {
  it('leads with this phase own coaching points, then the four corners', () => {
    const withPoints = session.phases.find((p) => p.coachingPoints.length > 0)!;
    const groups = observationTagGroups(session, withPoints.id);

    expect(groups[0]).toMatchObject({ corner: null, label: 'This phase' });
    expect(groups.slice(1).map((group) => group.corner)).toEqual([
      'technical_tactical',
      'physical',
      'psychological',
      'social',
    ]);
  });

  it('offers all four corners even when the phase has no coaching points', () => {
    const bare = { ...session, phases: session.phases.map((p) => ({ ...p, coachingPoints: [] })) };
    const groups = observationTagGroups(bare);

    // No "This phase" group, but every corner is still one tap away — which is the point:
    // the empty corner is visible at the moment of logging, not just in the report.
    expect(groups).toHaveLength(4);
    expect(groups.flatMap((g) => g.tags)).toContain('Communication');
    expect(groups.flatMap((g) => g.tags)).toContain('Balance');
  });

  it('does not repeat a coaching point that is already an attribute label', () => {
    const withDuplicate = {
      ...session,
      phases: session.phases.map((p, index) =>
        index === 0
          ? {
              ...p,
              coachingPoints: [{ ...p.coachingPoints[0]!, text: 'Communication' }],
            }
          : p,
      ),
    };
    const tags = observationTagsFor(withDuplicate);
    expect(tags.filter((tag) => tag === 'Communication')).toHaveLength(1);
  });
});

describe('corner inference — the reason logging stays at two taps', () => {
  it('files the observation under the corner of the tag the coach tapped', async () => {
    const observation = unwrap(
      await logObservation(ctx, {
        sessionId: session.id,
        playerId: kai,
        ratingKind: 'good',
        tags: ['Communication'],
      }),
    );

    expect(observation.corner).toBe('social');
    expect(observation.attribute).toBe('communication');
  });

  it('uses the first tag it recognises, ignoring the coach own words', async () => {
    const observation = unwrap(
      await logObservation(ctx, {
        sessionId: session.id,
        playerId: kai,
        ratingKind: 'working',
        tags: ['Head up before you receive', 'Agility'],
      }),
    );
    expect(observation.corner).toBe('physical');
  });

  it('leaves an untagged note unclassified rather than guessing', async () => {
    const observation = unwrap(
      await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'good' }),
    );

    // Absent, not null — `corner` is indexed, so an unclassified row must stay out of it.
    expect('corner' in observation).toBe(false);
    expect(await ctx.store.observations.listByPlayerCorner(kai, 'social')).toHaveLength(0);
  });

  it('lets the caller override the inference explicitly', async () => {
    const observation = unwrap(
      await logObservation(ctx, {
        sessionId: session.id,
        playerId: kai,
        ratingKind: 'good',
        tags: ['Communication'],
        corner: 'psychological',
      }),
    );
    expect(observation.corner).toBe('psychological');
  });

  it('inherits the corner of the coaching point it was logged against', async () => {
    const phase = session.phases.find((p) => p.coachingPoints.length > 0)!;
    const point = phase.coachingPoints[0]!;
    await ctx.store.sessions.put({
      ...session,
      phases: session.phases.map((p) =>
        p.id === phase.id
          ? {
              ...p,
              coachingPoints: p.coachingPoints.map((candidate) =>
                candidate.id === point.id
                  ? { ...candidate, corner: 'psychological' as const }
                  : candidate,
              ),
            }
          : p,
      ),
    });

    const observation = unwrap(
      await logObservation(ctx, {
        sessionId: session.id,
        playerId: kai,
        phaseId: phase.id,
        ratingKind: 'struggled',
        coachingPointId: point.id,
      }),
    );
    expect(observation.corner).toBe('psychological');
    expect(observation.coachingPointId).toBe(point.id);
  });

  it('makes the corner query work end to end', async () => {
    await logObservation(ctx, {
      sessionId: session.id,
      playerId: kai,
      ratingKind: 'good',
      tags: ['Leadership'],
    });
    await logObservation(ctx, {
      sessionId: session.id,
      playerId: kai,
      ratingKind: 'working',
      tags: ['First touch'],
    });

    expect(await ctx.store.observations.listByPlayerCorner(kai, 'social')).toHaveLength(1);
    expect(await ctx.store.observations.listByPlayerCorner(kai, 'technical_tactical')).toHaveLength(
      1,
    );
  });
});

describe('heartbeat', () => {
  it('records activity without disturbing the run', async () => {
    clock().advanceSeconds(30);
    const beaten = unwrap(await heartbeat(ctx, session.id));

    expect(beaten.run?.lastHeartbeatAt).toBe(clock().nowIso());
    expect(beaten.run?.phaseRuns).toEqual(session.run?.phaseRuns);
  });
});
