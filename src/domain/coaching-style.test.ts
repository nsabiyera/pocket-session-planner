import { describe, expect, it } from 'vitest';
import {
  coachingStyle,
  describeCoachingStyle,
  describeStyleEvidence,
  hasEnoughForStyle,
  MIN_INTERVENTIONS_FOR_STYLE,
  type CoachingStyleInput,
} from './coaching-style';
import {
  INTERVENTION_METHODS,
  type InterventionEvent,
  type InterventionMethod,
} from './intervention';
import { asInterventionEventId } from './ids';
import { phaseId, T0 } from '@/test/builders';

let seq = 0;
const anEvent = (over: Partial<InterventionEvent> = {}): InterventionEvent => ({
  id: asInterventionEventId(`00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`),
  phaseId: phaseId('rondo'),
  at: T0,
  phaseElapsedMs: 0,
  method: 'command',
  mechanic: 'in_flow',
  audience: 'team',
  durationMs: 0,
  playerIds: [],
  coachingPointId: null,
  overBudget: false,
  styleChosen: false,
  ...over,
});

const of = (over: Partial<CoachingStyleInput> = {}) =>
  coachingStyle({ sessions: 4, events: [], ballRollingMs: 74, elapsedMs: 100, ...over });

const method = (m: InterventionMethod, count: number, styleChosen = false) =>
  Array.from({ length: count }, () => anEvent({ method: m, styleChosen }));

describe('coachingStyle', () => {
  it('counts each of the five pillars', () => {
    const style = of({ events: [...method('command', 3), ...method('question_and_answer', 2)] });
    expect(style.countByMethod.command).toBe(3);
    expect(style.countByMethod.question_and_answer).toBe(2);
    expect(style.interventions).toBe(5);
  });

  it('names the pillars that never came up', () => {
    expect(of({ events: method('command', 3) }).untouchedMethods).toEqual([
      'question_and_answer',
      'observation_feedback',
      'guided_discovery',
      'trial_and_error',
    ]);
  });

  it('names a dominant method only above half', () => {
    expect(
      of({ events: [...method('command', 3), ...method('question_and_answer', 2)] }).dominantMethod,
    ).toBe('command');
    // Exactly half is not a habit.
    expect(
      of({ events: [...method('command', 2), ...method('question_and_answer', 2)] }).dominantMethod,
    ).toBeNull();
  });

  it('keeps chosen and inherited apart', () => {
    const style = of({
      events: [...method('command', 6), ...method('guided_discovery', 2, true)],
    });
    expect(style.interventions).toBe(8);
    expect(style.chosen).toBe(2);
  });

  it('sums the measured clock rather than averaging sessions', () => {
    // A 90-minute session and a 45-minute one must not get an equal vote.
    expect(of({ ballRollingMs: 150, elapsedMs: 200 }).ballRollingRatio).toBeCloseTo(0.75);
  });

  it('reports a full ratio when nothing ran, rather than dividing by zero', () => {
    expect(of({ ballRollingMs: 0, elapsedMs: 0 }).ballRollingRatio).toBe(1);
    expect(of({ sessions: 0 }).perSession).toBe(0);
  });

  it('stays quiet until there is a term to look at', () => {
    expect(
      hasEnoughForStyle(of({ events: method('command', MIN_INTERVENTIONS_FOR_STYLE - 1) })),
    ).toBe(false);
    expect(hasEnoughForStyle(of({ events: method('command', MIN_INTERVENTIONS_FOR_STYLE) }))).toBe(
      true,
    );
    expect(MIN_INTERVENTIONS_FOR_STYLE).toBe(12);
  });
});

describe('describeCoachingStyle', () => {
  it('leads with the counts and ends with the measured number', () => {
    const line = describeCoachingStyle(
      of({ sessions: 8, events: [...method('command', 30), ...method('question_and_answer', 18)] }),
    );
    expect(line).toContain('48 interventions across 8 sessions — 6.0 a session.');
    expect(line).toContain('Mostly Command');
    expect(line).toContain('Ball rolling time 74%.');
  });

  it('treats never intervening as a style rather than a failure', () => {
    expect(describeCoachingStyle(of({ sessions: 5, events: [] }))).toBe(
      '5 sessions, and you never stopped to coach. That is a style too.',
    );
  });

  it('says nothing at all with no sessions', () => {
    expect(describeCoachingStyle(of({ sessions: 0, events: [] }))).toBe(
      'No sessions to look at yet.',
    );
  });

  it('never steers the coach towards a different pillar', () => {
    // The Five Pillars are five tools, not a ranking. Which one a session needed is not a
    // judgement this app is in any position to make.
    const banned = /should|try|ought|vary|more |less |too |better|enough|consider|balance/i;
    for (const m of INTERVENTION_METHODS) {
      expect(describeCoachingStyle(of({ events: method(m, 20) }))).not.toMatch(banned);
    }
    expect(describeCoachingStyle(of({ sessions: 5, events: [] }))).not.toMatch(banned);
  });
});

describe('describeStyleEvidence', () => {
  it('splits what was chosen from what was inherited', () => {
    const style = of({
      events: [...method('command', 39), ...method('guided_discovery', 9, true)],
    });
    expect(describeStyleEvidence(style)).toBe(
      '9 of 48 were a style you picked in the moment; the other 39 followed your plan.',
    );
  });

  it('says so plainly when none of it is evidence', () => {
    // The whole line above is then a readback of the coach's own plan, and must say so.
    const line = describeStyleEvidence(of({ events: method('command', 20) }))!;
    expect(line).toContain('took the style from your plan');
    expect(line).toContain('tap and hold');
  });

  it('stays silent only when every event was chosen', () => {
    expect(describeStyleEvidence(of({ events: method('command', 20, true) }))).toBeNull();
  });

  it('has nothing to qualify with no interventions', () => {
    expect(describeStyleEvidence(of({ events: [] }))).toBeNull();
  });
});
