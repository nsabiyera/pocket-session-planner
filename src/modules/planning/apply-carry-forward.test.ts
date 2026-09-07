import { describe, expect, it } from 'vitest';
import { applyCarryForwardActions } from './apply-carry-forward';
import { buildSessionFromMethodology } from '@/domain/session/build-from-methodology';
import { PLAY_PRACTICE_PLAY } from '@/domain/presets';
import { mainPracticePhase } from '@/domain/session/selectors';
import { totalPlannedPhaseMin, type Session } from '@/domain/session';
import { InterventionPlanSchema } from '@/domain/intervention';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { anAction, aPhase, aSquad, playerId, T0 } from '@/test/builders';
import type { CarryForwardAction } from '@/domain/carry-forward';

function draftFixture(over: Partial<Session> = {}): Session {
  const draft = buildSessionFromMethodology(PLAY_PRACTICE_PLAY, {
    squad: aSquad(),
    objective: {
      text: 'Original objective',
      successCriteria: [],
      sourceActionId: null,
      principleId: null,
    },
    now: T0,
    ids: new FakeIdGenerator('aaaa'),
  });
  return { ...draft, ...over };
}

const apply = (draft: Session, actions: readonly CarryForwardAction[]) =>
  applyCarryForwardActions(draft, actions, { ids: new FakeIdGenerator('bbbb'), now: T0 });

const objectiveAction = (label: string, over: Partial<CarryForwardAction> = {}) =>
  anAction(label, {
    kind: 'objective',
    title: 'Revisit: Playing out from the back',
    payload: {
      kind: 'objective',
      text: 'Playing out from the back',
      successCriteria: ['We beat the first press'],
      intent: 'revisit',
    },
    ...over,
  });

describe('objective actions', () => {
  it('sets the objective and records where it came from', () => {
    const action = objectiveAction('a1');
    const { session, applied } = apply(draftFixture(), [action]);

    expect(session.objective.text).toBe('Playing out from the back');
    expect(session.objective.successCriteria).toEqual(['We beat the first press']);
    expect(session.objective.sourceActionId).toBe(action.id);
    expect(applied).toEqual([action.id]);
    expect(session.seededFromActionIds).toEqual([action.id]);
  });

  it('highest priority then oldest wins; the rest fold in as success criteria', () => {
    const winner = objectiveAction('a1', { priority: 'high', createdAt: T0 });
    const runnerUp = objectiveAction('a2', {
      priority: 'normal',
      title: 'Revisit: Pressing',
      payload: {
        kind: 'objective',
        text: 'Pressing as a unit',
        successCriteria: [],
        intent: 'revisit',
      },
    });

    const { session, applied } = apply(draftFixture(), [runnerUp, winner]);

    expect(session.objective.text).toBe('Playing out from the back');
    expect(session.objective.successCriteria).toContain('Pressing as a unit');
    expect(applied).toEqual([winner.id, runnerUp.id]);
  });

  it('skips a further objective once the criteria cap is full', () => {
    const full = objectiveAction('a1', {
      payload: {
        kind: 'objective',
        text: 'Playing out',
        successCriteria: ['a', 'b', 'c', 'd', 'e'],
        intent: 'revisit',
      },
    });
    const extra = objectiveAction('a2', {
      payload: { kind: 'objective', text: 'Pressing', successCriteria: [], intent: 'revisit' },
    });

    const { session, skipped } = apply(draftFixture(), [full, extra]);
    expect(session.objective.successCriteria).toHaveLength(5);
    expect(skipped[0]).toMatchObject({
      id: extra.id,
      reason: expect.stringMatching(/five criteria/),
    });
  });
});

describe('focus player actions', () => {
  const focusAction = (label: string, player = playerId('kai')) =>
    anAction(label, {
      kind: 'focus_player',
      title: 'Keep focusing on Kai',
      playerIds: [player],
      payload: { kind: 'focus_player', playerId: player, targetBehaviour: 'Scan before receiving' },
    });

  it('appends the player with their target behaviour as the reason', () => {
    const action = focusAction('a1');
    const { session } = apply(draftFixture(), [action]);

    expect(session.focusPlayers).toEqual([
      {
        playerId: playerId('kai'),
        reason: 'Scan before receiving',
        sourceActionId: action.id,
      },
    ]);
  });

  it('skips a player who is already a focus', () => {
    const action = focusAction('a1');
    const draft = draftFixture({
      focusPlayers: [{ playerId: playerId('kai'), sourceActionId: null }],
    });

    const { applied, skipped } = apply(draft, [action]);
    expect(applied).toEqual([]);
    expect(skipped[0]?.reason).toBe('Already a focus player.');
  });
});

describe('coaching point actions', () => {
  const pointAction = (label: string, over: Partial<CarryForwardAction> = {}) =>
    anAction(label, {
      kind: 'coaching_point',
      title: 'Scan before receiving',
      payload: {
        kind: 'coaching_point',
        text: 'Scan before receiving',
        playerIds: [],
        preferredPhaseKind: null,
      },
      ...over,
    });

  it('lands in the main practice when no phase kind is preferred', () => {
    const draft = draftFixture();
    const { session } = apply(draft, [pointAction('a1')]);

    const practice = mainPracticePhase(session)!;
    expect(practice.coachingPoints.map((p) => p.text)).toContain('Scan before receiving');
    expect(practice.coachingPoints.at(-1)).toMatchObject({ source: 'carry_forward' });
  });

  it('lands in the preferred phase kind when there is one', () => {
    const draft = draftFixture();
    const { session } = apply(draft, [
      pointAction('a1', {
        payload: {
          kind: 'coaching_point',
          text: 'Let them play',
          playerIds: [],
          preferredPhaseKind: 'game',
        },
      }),
    ]);

    const game = session.phases.find((p) => p.kind === 'game')!;
    expect(game.coachingPoints.map((p) => p.text)).toContain('Let them play');
  });

  it('marks the point as carried, so Do mode can badge it', () => {
    const action = pointAction('a1');
    const { session } = apply(draftFixture(), [action]);
    const point = mainPracticePhase(session)!.coachingPoints.at(-1);

    expect(point?.source).toBe('carry_forward');
    expect(point?.sourceActionId).toBe(action.id);
    expect(point?.delivered).toBe(false);
  });

  it('drops player targeting for anyone who is not a focus of this session', () => {
    const action = pointAction('a1', {
      payload: {
        kind: 'coaching_point',
        text: 'Scan before receiving',
        playerIds: [playerId('kai'), playerId('maya')],
        preferredPhaseKind: null,
      },
    });
    const draft = draftFixture({
      focusPlayers: [{ playerId: playerId('kai'), sourceActionId: null }],
    });

    const { session } = apply(draft, [action]);
    expect(mainPracticePhase(session)!.coachingPoints.at(-1)?.playerIds).toEqual([playerId('kai')]);
  });

  it('skips a phase that is already at the ten-point cap', () => {
    const draft = draftFixture();
    const practice = mainPracticePhase(draft)!;
    const full = {
      ...draft,
      phases: draft.phases.map((phase) =>
        phase.id === practice.id
          ? {
              ...phase,
              coachingPoints: Array.from({ length: 10 }, (_, index) => ({
                ...practice.coachingPoints[0]!,
                id: `00000000-0000-4000-8000-00000000cc${index.toString().padStart(2, '0')}` as never,
                text: `Point ${index}`,
              })),
            }
          : phase,
      ),
    };

    const { skipped } = apply(full, [pointAction('a1')]);
    expect(skipped[0]?.reason).toMatch(/already has ten points/);
  });
});

describe('phase actions', () => {
  const phaseAction = (label: string, order: number) =>
    anAction(label, {
      kind: 'phase',
      title: 'Run again: Rondo',
      payload: {
        kind: 'phase',
        phase: aPhase('rondo', {
          order,
          kind: 'skill_practice',
          plannedDurationMin: 20,
          coachingPoints: [],
        }),
        originalOrder: order,
      },
    });

  it('inserts at the original ordinal with fresh ids and renumbers', () => {
    const draft = draftFixture();
    const { session } = apply(draft, [phaseAction('a1', 1)]);

    expect(session.phases).toHaveLength(draft.phases.length + 1);
    const ordered = [...session.phases].sort((a, b) => a.order - b.order);
    expect(ordered.map((p) => p.order)).toEqual([0, 1, 2, 3, 4]);
    expect(ordered[1]?.title).toBe('rondo');
    expect(ordered[1]?.id).not.toBe(aPhase('rondo').id);
  });

  it('clamps an out-of-range ordinal rather than failing', () => {
    const { session } = apply(draftFixture(), [phaseAction('a1', 99)]);
    const ordered = [...session.phases].sort((a, b) => a.order - b.order);
    expect(ordered.at(-1)?.title).toBe('rondo');
  });

  it('re-scales everything, so adding a practice does not make it an 80-minute session', () => {
    const draft = draftFixture();
    expect(totalPlannedPhaseMin(draft)).toBe(60);

    const { session } = apply(draft, [phaseAction('a1', 1)]);
    expect(session.plannedDurationMin).toBe(60);
    expect(totalPlannedPhaseMin(session)).toBe(60);
  });

  it('skips once the session already has twelve phases', () => {
    const draft = draftFixture();
    const twelve = {
      ...draft,
      phases: Array.from({ length: 12 }, (_, index) =>
        aPhase(`phase${index}`, { order: index, plannedDurationMin: 5 }),
      ),
    };
    const { skipped } = apply(twelve, [phaseAction('a1', 1)]);
    expect(skipped[0]?.reason).toMatch(/twelve phases/);
  });
});

describe('intervention actions', () => {
  const plan = InterventionPlanSchema.parse({
    method: 'observation_feedback',
    mechanic: 'in_flow',
    maxPerPhase: 2,
  });

  it('replaces the session plan and marks it touched', () => {
    const action = anAction('a1', {
      kind: 'intervention',
      title: 'Coach more in the flow',
      payload: { kind: 'intervention', plan, targetPhaseKind: null, rationale: '' },
    });

    const { session } = apply(draftFixture(), [action]);
    expect(session.intervention).toEqual(plan);
    // So the composer will not re-derive it from the methodology.
    expect(session.interventionTouched).toBe(true);
  });

  it('targets one phase kind when asked', () => {
    const action = anAction('a1', {
      kind: 'intervention',
      title: 'Say nothing in the game',
      payload: { kind: 'intervention', plan, targetPhaseKind: 'game', rationale: '' },
    });

    const { session } = apply(draftFixture(), [action]);
    expect(session.phases.find((p) => p.kind === 'game')?.intervention).toEqual(plan);
    expect(session.interventionTouched).toBe(false);
  });

  it('falls back to the main practice when the requested kind is absent', () => {
    const action = anAction('a1', {
      kind: 'intervention',
      title: 'Change the huddle',
      payload: { kind: 'intervention', plan, targetPhaseKind: 'huddle', rationale: '' },
    });

    const { session, applied } = apply(draftFixture(), [action]);
    expect(applied).toHaveLength(1);
    expect(mainPracticePhase(session)?.intervention).toEqual(plan);
  });
});

describe('reminder actions', () => {
  it('becomes a pre-session checklist line', () => {
    const action = anAction('a1', {
      kind: 'reminder',
      title: 'Bring the bibs',
      payload: { kind: 'reminder', text: 'Bring the bibs' },
    });

    const { session } = apply(draftFixture(), [action]);
    expect(session.reminders).toEqual(['Bring the bibs']);
  });

  it('stops at ten', () => {
    const draft = draftFixture({ reminders: Array.from({ length: 10 }, (_, i) => `Item ${i}`) });
    const action = anAction('a1', {
      kind: 'reminder',
      title: 'One more',
      payload: { kind: 'reminder', text: 'One more' },
    });

    const { skipped } = apply(draft, [action]);
    expect(skipped[0]?.reason).toMatch(/too many/);
  });
});

describe('the five-action cap', () => {
  it('applies five and leaves the rest open', () => {
    const actions = Array.from({ length: 8 }, (_, index) =>
      anAction(`a${index}`, {
        kind: 'reminder',
        title: `Reminder ${index}`,
        payload: { kind: 'reminder', text: `Reminder ${index}` },
      }),
    );

    const { session, applied, skipped } = apply(draftFixture(), actions);
    expect(applied).toHaveLength(5);
    expect(skipped).toHaveLength(3);
    expect(session.reminders).toHaveLength(5);
    expect(skipped[0]?.reason).toMatch(/five carried actions/);
  });

  it('spends the five on the highest priority first', () => {
    const low = Array.from({ length: 5 }, (_, index) =>
      anAction(`low${index}`, {
        kind: 'reminder',
        priority: 'low',
        title: `Low ${index}`,
        payload: { kind: 'reminder', text: `Low ${index}` },
      }),
    );
    const high = objectiveAction('high', { priority: 'high' });

    const { applied } = apply(draftFixture(), [...low, high]);
    expect(applied[0]).toBe(high.id);
  });
});

describe('the result', () => {
  it('is a valid session and does not mutate the draft', () => {
    const draft = draftFixture();
    const snapshot = JSON.parse(JSON.stringify(draft));

    const { session } = apply(draft, [objectiveAction('a1')]);
    expect(JSON.parse(JSON.stringify(draft))).toEqual(snapshot);
    expect(session.updatedAt).toBe(T0);
  });

  it('applying nothing is a clean no-op', () => {
    const draft = draftFixture();
    const { session, applied, skipped } = apply(draft, []);

    expect(applied).toEqual([]);
    expect(skipped).toEqual([]);
    expect(session.objective.text).toBe('Original objective');
  });
});
