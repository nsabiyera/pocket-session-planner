import { describe, expect, it } from 'vitest';
import { scalePhaseDurations, scaledTotal } from './phase-scaling';
import { MethodologyPhaseTemplateSchema, type MethodologyPhaseTemplate } from '../methodology';

const template = (
  id: string,
  durationWeight: number,
  over: Partial<MethodologyPhaseTemplate> = {},
): MethodologyPhaseTemplate =>
  MethodologyPhaseTemplateSchema.parse({
    id,
    order: 0,
    kind: 'skill_practice',
    title: id,
    durationWeight,
    intent: `Intent for ${id}`,
    ...over,
  });

const minutesFor = (templates: readonly MethodologyPhaseTemplate[], total: number, step?: number) =>
  templates.map((t) => scalePhaseDurations(templates, total, step).get(t.id));

describe('scalePhaseDurations', () => {
  it('hits the target total exactly for an even split', () => {
    const templates = [template('a', 0.5, { order: 0 }), template('b', 0.5, { order: 1 })];
    expect(minutesFor(templates, 60)).toEqual([30, 30]);
  });

  it('rounds to the step rather than producing a 13-minute practice', () => {
    const templates = [
      template('a', 0.22, { order: 0 }),
      template('b', 0.31, { order: 1 }),
      template('c', 0.47, { order: 2 }),
    ];
    const minutes = minutesFor(templates, 60);
    for (const value of minutes) expect((value ?? 0) % 5).toBe(0);
    expect(minutes.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(60);
  });

  it('honours a non-default step', () => {
    const templates = [template('a', 0.5, { order: 0 }), template('b', 0.5, { order: 1 })];
    expect(minutesFor(templates, 60, 10)).toEqual([30, 30]);
    // The odd step goes to the later phase, per the tie-break rule.
    expect(minutesFor(templates, 50, 10)).toEqual([20, 30]);
  });

  it('keeps zero-weight phases at their default and out of the scaled pool', () => {
    const templates = [
      template('play', 0.5, { order: 0 }),
      template('water', 0, { order: 1, defaultDurationMin: 5, kind: 'water_break' }),
      template('game', 0.5, { order: 2 }),
    ];
    expect(minutesFor(templates, 65)).toEqual([30, 5, 30]);
    // Shortening the session shortens the *scaled* phases, never the water break.
    expect(minutesFor(templates, 45)).toEqual([20, 5, 20]);
  });

  it('gives the closing phase the benefit of a tie', () => {
    // Equal weights, odd number of steps: the later phase takes the spare one, because the
    // last game is what a coach most regrets cutting short.
    const templates = [
      template('first', 1 / 3, { order: 0 }),
      template('second', 1 / 3, { order: 1 }),
      template('third', 1 / 3, { order: 2 }),
    ];
    expect(minutesFor(templates, 55)).toEqual([15, 20, 20]);
  });

  it('pushes a sub-step residual onto the heaviest phase so the total is still exact', () => {
    // 57 minutes is not a whole number of 5-minute steps, so 2 minutes are left over after
    // the apportionment. They go to the heaviest phase rather than being quietly lost.
    const templates = [
      template('first', 0.5, { order: 0 }),
      template('second', 0.3, { order: 1 }),
      template('third', 0.2, { order: 2 }),
    ];
    const minutes = minutesFor(templates, 57);

    expect(minutes.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(57);
    expect((minutes[0] ?? 0) % 5).not.toBe(0);
    expect(minutes[0]).toBeGreaterThan(minutes[1] ?? 0);
  });

  it('absorbs a negative residual on the heaviest phase, earliest breaking a tie', () => {
    // 58 rounds up to twelve 5-minute steps (60 minutes), so the residual is *negative*.
    // The heaviest phase gives the two minutes back rather than the session overshooting.
    const templates = [template('first', 0.5, { order: 0 }), template('second', 0.5, { order: 1 })];
    expect(minutesFor(templates, 58)).toEqual([28, 30]);
  });

  it('never lets a weighted phase round away to nothing', () => {
    const templates = [template('tiny', 0.02, { order: 0 }), template('big', 0.98, { order: 1 })];
    const minutes = minutesFor(templates, 60);
    expect(minutes[0]).toBeGreaterThan(0);
    expect(minutes.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(60);
  });

  it('falls back to whole minutes when the step is too coarse for the phase count', () => {
    const templates = [
      template('a', 0.4, { order: 0 }),
      template('b', 0.3, { order: 1 }),
      template('c', 0.3, { order: 2 }),
    ];
    // Eight minutes across three phases: a five-minute step cannot give each one a step.
    const minutes = minutesFor(templates, 8);
    expect(minutes.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(8);
    for (const value of minutes) expect(value).toBeGreaterThanOrEqual(1);
  });

  it('floors at one minute each when the total is below the phase count', () => {
    const templates = [
      template('a', 0.25, { order: 0 }),
      template('b', 0.25, { order: 1 }),
      template('c', 0.25, { order: 2 }),
      template('d', 0.25, { order: 3 }),
    ];
    // A three-minute session with four phases cannot be exact. One minute each is the only
    // sane answer; overshooting beats a zero-length phase.
    expect(minutesFor(templates, 3)).toEqual([1, 1, 1, 1]);
  });

  it('survives fixed phases that alone exceed the requested total', () => {
    const templates = [
      template('water', 0, { order: 0, defaultDurationMin: 10, kind: 'water_break' }),
      template('play', 1, { order: 1 }),
    ];
    const durations = scalePhaseDurations(templates, 8);
    expect(durations.get('water' as never)).toBe(10);
    expect(durations.get('play' as never)).toBe(1);
  });

  it('handles a methodology of nothing but fixed phases', () => {
    const templates = [
      template('water', 0, { order: 0, defaultDurationMin: 5, kind: 'water_break' }),
    ];
    expect(scaledTotal(scalePhaseDurations(templates, 60))).toBe(5);
  });

  it('renormalises weights that do not quite sum to 1', () => {
    // A hand-edited import file may be worse than the schema tolerance. The total must still
    // come out right rather than silently short.
    const templates = [template('a', 0.4, { order: 0 }), template('b', 0.4, { order: 1 })];
    expect(scaledTotal(scalePhaseDurations(templates, 60))).toBe(60);
  });

  it('is deterministic — the same input always produces the same plan', () => {
    const templates = [
      template('a', 0.13, { order: 0 }),
      template('b', 0.27, { order: 1 }),
      template('c', 0.07, { order: 2 }),
      template('d', 0.27, { order: 3 }),
      template('e', 0.26, { order: 4 }),
    ];
    const first = minutesFor(templates, 75);
    for (let i = 0; i < 5; i += 1) expect(minutesFor(templates, 75)).toEqual(first);
  });

  it.each([20, 30, 45, 60, 75, 90, 105, 120])('is exact at %i minutes', (total) => {
    const templates = [
      template('a', 0.15, { order: 0 }),
      template('b', 0.22, { order: 1 }),
      template('c', 0.3, { order: 2 }),
      template('d', 0.28, { order: 3 }),
      template('e', 0.05, { order: 4 }),
    ];
    expect(scaledTotal(scalePhaseDurations(templates, total))).toBe(total);
  });

  it('an empty template list produces an empty plan rather than throwing', () => {
    expect(scalePhaseDurations([], 60).size).toBe(0);
  });
});
