import { describe, expect, it } from 'vitest';
import {
  describeInterventionPlan,
  hasPhaseOverride,
  InterventionEventSchema,
  InterventionPlanSchema,
  interventionBudget,
  mechanicStopsPlay,
  resolvePhaseIntervention,
  wouldExceedBudget,
  type InterventionMechanic,
} from './intervention';
import { asInterventionEventId, asPhaseId } from './ids';
import { isoDateTime } from './primitives';

const plan = (over: Partial<Parameters<typeof InterventionPlanSchema.parse>[0]> = {}) =>
  InterventionPlanSchema.parse({
    method: 'observation_feedback',
    mechanic: 'in_flow',
    ...(over as object),
  });

describe('InterventionPlanSchema', () => {
  it('defaults audience to team and both budgets to null', () => {
    const parsed = plan();
    expect(parsed.audience).toBe('team');
    expect(parsed.maxPerPhase).toBeNull();
    expect(parsed.maxDurationSec).toBeNull();
  });

  it('accepts a zero budget — "let them play" is a real plan, not a missing one', () => {
    expect(plan({ maxPerPhase: 0 }).maxPerPhase).toBe(0);
  });

  it('rejects an out-of-range budget', () => {
    expect(() => plan({ maxPerPhase: 21 })).toThrow();
    expect(() => plan({ maxPerPhase: -1 })).toThrow();
    expect(() => plan({ maxDurationSec: 4 })).toThrow();
    expect(() => plan({ maxDurationSec: 301 })).toThrow();
  });

  it('rejects an unknown method or mechanic', () => {
    expect(() => plan({ method: 'shouting' as never })).toThrow();
    expect(() => plan({ mechanic: 'vibes' as never })).toThrow();
  });
});

describe('resolvePhaseIntervention', () => {
  it('returns the session plan when the phase has no override', () => {
    const session = { intervention: plan({ method: 'guided_discovery' }) };
    expect(resolvePhaseIntervention(session, { intervention: null })).toBe(session.intervention);
  });

  it('prefers the phase override — "question them, then say nothing"', () => {
    const session = { intervention: plan({ method: 'question_and_answer' }) };
    const override = plan({ method: 'trial_and_error', mechanic: 'none', maxPerPhase: 0 });
    const resolved = resolvePhaseIntervention(session, { intervention: override });

    expect(resolved).toBe(override);
    expect(resolved.method).toBe('trial_and_error');
    expect(resolved.maxPerPhase).toBe(0);
  });

  it('an override of maxPerPhase 0 is not mistaken for "no override"', () => {
    const session = { intervention: plan({ maxPerPhase: 5 }) };
    const override = plan({ maxPerPhase: 0 });
    expect(resolvePhaseIntervention(session, { intervention: override }).maxPerPhase).toBe(0);
  });

  it('hasPhaseOverride reports whether the phase carries its own plan', () => {
    expect(hasPhaseOverride({ intervention: null })).toBe(false);
    expect(hasPhaseOverride({ intervention: plan() })).toBe(true);
  });
});

describe('mechanicStopsPlay', () => {
  const stopping: InterventionMechanic[] = [
    'play_freeze_play',
    'play_stop_play',
    'stop_some_play_on',
    'natural_break',
  ];
  const flowing: InterventionMechanic[] = [
    'in_flow',
    'constraint_change',
    'none',
    'individual_aside',
  ];

  it.each(stopping)('%s stops the phase clock', (m) => {
    expect(mechanicStopsPlay(m)).toBe(true);
  });

  it.each(flowing)('%s leaves the ball rolling', (m) => {
    expect(mechanicStopsPlay(m)).toBe(false);
  });
});

describe('interventionBudget', () => {
  it('reports no counter at all when no budget is set', () => {
    const budget = interventionBudget(plan(), 7);
    expect(budget).toEqual({
      max: null,
      used: 7,
      remaining: null,
      isOverBudget: false,
      isSilentPhase: false,
    });
  });

  it('counts down and then clamps at zero rather than going negative', () => {
    const p = plan({ maxPerPhase: 2 });
    expect(interventionBudget(p, 0).remaining).toBe(2);
    expect(interventionBudget(p, 1).remaining).toBe(1);
    expect(interventionBudget(p, 2).remaining).toBe(0);
    expect(interventionBudget(p, 5).remaining).toBe(0);
  });

  it('flags over budget only once the max is genuinely exceeded', () => {
    const p = plan({ maxPerPhase: 2 });
    expect(interventionBudget(p, 2).isOverBudget).toBe(false);
    expect(interventionBudget(p, 3).isOverBudget).toBe(true);
  });

  it('a zero budget is a silent phase, and the first intervention is already over', () => {
    const p = plan({ maxPerPhase: 0 });
    expect(interventionBudget(p, 0)).toMatchObject({ isSilentPhase: true, isOverBudget: false });
    expect(interventionBudget(p, 1).isOverBudget).toBe(true);
  });
});

describe('wouldExceedBudget', () => {
  it('is false forever when no budget is set', () => {
    expect(wouldExceedBudget(plan(), 99)).toBe(false);
  });

  it('is true for the intervention that crosses the line, not the one that reaches it', () => {
    const p = plan({ maxPerPhase: 2 });
    expect(wouldExceedBudget(p, 0)).toBe(false);
    expect(wouldExceedBudget(p, 1)).toBe(false);
    expect(wouldExceedBudget(p, 2)).toBe(true);
  });

  it('a maxPerPhase of 0 makes the very first intervention over budget', () => {
    expect(wouldExceedBudget(plan({ maxPerPhase: 0 }), 0)).toBe(true);
  });
});

describe('describeInterventionPlan', () => {
  it('reads as a coaching instruction, not a field dump', () => {
    expect(
      describeInterventionPlan(
        plan({ method: 'question_and_answer', mechanic: 'in_flow', maxPerPhase: 2 }),
      ),
    ).toBe('In the flow · Q&A · max 2 per phase');
  });

  it('says "let them play" rather than "max 0 per phase"', () => {
    expect(
      describeInterventionPlan(
        plan({ method: 'trial_and_error', mechanic: 'none', maxPerPhase: 0 }),
      ),
    ).toBe('Say nothing · Trial & error · let them play');
  });

  it('mentions the audience only when it is not the whole team', () => {
    expect(describeInterventionPlan(plan({ audience: 'team' }))).not.toMatch(/team/);
    expect(describeInterventionPlan(plan({ audience: 'individual' }))).toMatch(/individual/);
  });
});

describe('InterventionEventSchema', () => {
  const base = {
    id: asInterventionEventId('00000000-0000-4000-8000-000000000001'),
    phaseId: asPhaseId('00000000-0000-4000-8000-0000000000a1'),
    at: isoDateTime('2026-08-31T18:12:00.000Z'),
    phaseElapsedMs: 120_000,
    method: 'command' as const,
    mechanic: 'play_stop_play' as const,
    audience: 'team' as const,
  };

  it('defaults the open-intervention fields so a one-tap log is a complete record', () => {
    const parsed = InterventionEventSchema.parse(base);
    expect(parsed.durationMs).toBeNull();
    expect(parsed.playerIds).toEqual([]);
    expect(parsed.coachingPointId).toBeNull();
    expect(parsed.overBudget).toBe(false);
  });

  it('rejects a negative elapsed or duration', () => {
    expect(() => InterventionEventSchema.parse({ ...base, phaseElapsedMs: -1 })).toThrow();
    expect(() => InterventionEventSchema.parse({ ...base, durationMs: -1 })).toThrow();
  });
});
