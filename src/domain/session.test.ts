import { describe, expect, it } from 'vitest';
import {
  SessionSchema,
  phasesInOrder,
  findPhase,
  isFocusPlayer,
  totalPlannedPhaseMin,
} from './session';
import {
  aChallenge,
  aChallengeEvent,
  aPhase,
  aSession,
  phaseId,
  playerId,
  T0,
} from '@/test/builders';

const focus = (label: string) => ({ playerId: playerId(label), sourceActionId: null });

const runFor = (label: string) => ({
  startedAt: T0,
  endedAt: null,
  currentPhaseIndex: 0,
  phaseRuns: [
    { phaseId: phaseId(label), startedAt: T0, runningSince: T0, accumulatedMs: 0, endedAt: null },
  ],
  pauseReason: null,
  openInterventionId: null,
  lastHeartbeatAt: T0,
  interventionEvents: [],
});

describe('Session invariants', () => {
  it('accepts a well-formed draft', () => {
    expect(SessionSchema.safeParse(aSession()).success).toBe(true);
  });

  it('rejects a phase focusing a player the session is not focusing', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      focusPlayers: [focus('kai')],
      phases: [aPhase('warmup', { focusPlayerIds: [playerId('maya')] })],
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/not a focus player of the session/);
  });

  it('accepts a phase focusing a subset of the session focus players', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      focusPlayers: [focus('kai'), focus('maya')],
      phases: [aPhase('warmup', { focusPlayerIds: [playerId('kai')] })],
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate phase ids and duplicate phase orders', () => {
    const dupeId = SessionSchema.safeParse({
      ...aSession(),
      phases: [aPhase('warmup', { order: 0 }), aPhase('warmup', { order: 1 })],
    });
    expect(String(dupeId.error)).toMatch(/Phase ids must be unique/);

    const dupeOrder = SessionSchema.safeParse({
      ...aSession(),
      phases: [aPhase('warmup', { order: 0 }), aPhase('game', { order: 0 })],
    });
    expect(String(dupeOrder.error)).toMatch(/order` values must be unique/);
  });

  it('rejects the same player being a focus player twice', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      focusPlayers: [focus('kai'), focus('kai')],
    });
    expect(String(result.error)).toMatch(/only be a focus player once/);
  });

  it('requires a run when in_progress, and forbids one when draft or planned', () => {
    expect(String(SessionSchema.safeParse({ ...aSession(), status: 'in_progress' }).error)).toMatch(
      /must have a run/,
    );
    expect(
      String(
        SessionSchema.safeParse({ ...aSession(), status: 'draft', run: runFor('warmup') }).error,
      ),
    ).toMatch(/must not have a run/);
    expect(
      String(
        SessionSchema.safeParse({ ...aSession(), status: 'planned', run: runFor('warmup') }).error,
      ),
    ).toMatch(/must not have a run/);
  });

  it('requires a reason to abandon — otherwise the history says nothing useful', () => {
    expect(String(SessionSchema.safeParse({ ...aSession(), status: 'abandoned' }).error)).toMatch(
      /requires a reason/,
    );
    expect(
      SessionSchema.safeParse({
        ...aSession(),
        status: 'abandoned',
        abandonReason: 'Pitch flooded',
      }).success,
    ).toBe(true);
  });

  it('rejects a phase run pointing at a phase that no longer exists', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      status: 'in_progress',
      run: runFor('ghostphase'),
    });
    expect(String(result.error)).toMatch(/references unknown phase/);
  });

  it('rejects an out-of-range currentPhaseIndex', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      status: 'in_progress',
      run: { ...runFor('warmup'), currentPhaseIndex: 4 },
    });
    expect(String(result.error)).toMatch(/currentPhaseIndex is out of range/);
  });

  it('rejects an intervention event pointing at a phase that no longer exists', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      status: 'in_progress',
      run: {
        ...runFor('warmup'),
        interventionEvents: [
          {
            id: '00000000-0000-4000-8000-0000000000e1',
            phaseId: phaseId('ghostphase'),
            at: T0,
            phaseElapsedMs: 0,
            method: 'command',
            mechanic: 'play_stop_play',
            audience: 'team',
          },
        ],
      },
    });
    expect(String(result.error)).toMatch(/Intervention event references unknown phase/);
  });

  it('rejects duplicate challenge ids', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      challenges: [aChallenge('c1'), aChallenge('c1', { text: 'Something else' })],
    });
    expect(String(result.error)).toMatch(/Challenge ids must be unique/);
  });

  it('rejects a challenge scoped to a phase this session does not have', () => {
    // Scoped to no phase at all, it would be watched for in none — invisible and unjudgeable.
    const result = SessionSchema.safeParse({
      ...aSession(),
      challenges: [aChallenge('c1', { phaseIds: [phaseId('ghostphase')] })],
    });
    expect(String(result.error)).toMatch(/Challenge phase .* is not a phase of this session/);
  });

  it('accepts a challenge scoped to a phase the session does have, and an unscoped one', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      challenges: [aChallenge('c1', { phaseIds: [phaseId('warmup')] }), aChallenge('c2')],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a sighting logged against a challenge that has been deleted', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      status: 'in_progress',
      challenges: [],
      run: { ...runFor('warmup'), challengeEvents: [aChallengeEvent('e1')] },
    });
    expect(String(result.error)).toMatch(/Challenge event references unknown challenge/);
  });

  it('rejects a sighting logged against a phase that no longer exists', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      status: 'in_progress',
      challenges: [aChallenge('challenge1')],
      run: {
        ...runFor('warmup'),
        challengeEvents: [aChallengeEvent('e1', { phaseId: phaseId('ghostphase') })],
      },
    });
    expect(String(result.error)).toMatch(/Challenge event references unknown phase/);
  });

  it('accepts a run whose sightings resolve to a challenge and a phase it holds', () => {
    const result = SessionSchema.safeParse({
      ...aSession(),
      status: 'in_progress',
      challenges: [aChallenge('challenge1')],
      run: { ...runFor('warmup'), challengeEvents: [aChallengeEvent('e1')] },
    });
    expect(result.success).toBe(true);
  });

  it('caps the objective at five success criteria', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    const result = SessionSchema.safeParse({
      ...aSession(),
      objective: { text: 'Objective', successCriteria: six, sourceActionId: null },
    });
    expect(result.success).toBe(false);
  });
});

describe('Session selectors', () => {
  const session = aSession({
    focusPlayers: [focus('kai')],
    phases: [
      aPhase('game', { order: 2, plannedDurationMin: 25 }),
      aPhase('warmup', { order: 0, plannedDurationMin: 10 }),
      aPhase('practice', { order: 1, plannedDurationMin: 20 }),
    ],
  });

  it('phasesInOrder sorts by order, not by array position', () => {
    expect(phasesInOrder(session).map((p) => p.title)).toEqual(['warmup', 'practice', 'game']);
  });

  it('findPhase resolves by id and returns undefined for a stranger', () => {
    expect(findPhase(session, phaseId('practice'))?.title).toBe('practice');
    expect(findPhase(session, phaseId('nope'))).toBeUndefined();
  });

  it('isFocusPlayer answers from the session, not the phases', () => {
    expect(isFocusPlayer(session, playerId('kai'))).toBe(true);
    expect(isFocusPlayer(session, playerId('maya'))).toBe(false);
  });

  it('totalPlannedPhaseMin need not equal plannedDurationMin — that is a warning, not a block', () => {
    expect(totalPlannedPhaseMin(session)).toBe(55);
    expect(session.plannedDurationMin).toBe(60);
  });
});
