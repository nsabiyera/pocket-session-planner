import { describe, expect, it } from 'vitest';
import { cloneMethodology } from './methodology-clone';
import { MethodologySchema, orderedTemplates, snapshotMethodology } from './methodology';
import { CONSTRAINTS_LED, PLAY_PRACTICE_PLAY } from './presets';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { T0 } from '@/test/builders';

const clone = (source = PLAY_PRACTICE_PLAY, name = 'My version') =>
  cloneMethodology(source, { name, now: T0, ids: new FakeIdGenerator('bbbb') });

describe('cloneMethodology', () => {
  it('produces a valid custom methodology', () => {
    const custom = clone();
    expect(MethodologySchema.safeParse(custom).success).toBe(true);
    expect(custom.origin.kind).toBe('custom');
    expect(custom.name).toBe('My version');
  });

  it('records what it was cloned from, and at which version', () => {
    const custom = clone(CONSTRAINTS_LED);
    expect(custom.origin).toEqual({
      kind: 'custom',
      clonedFrom: 'constraints-led',
      clonedFromVersion: 1,
    });
    // Its own version history starts at 1 — a preset improvement can never rewrite it.
    expect(custom.version).toBe(1);
  });

  it('gives every phase template a fresh id, so provenance stays unambiguous', () => {
    const custom = clone(CONSTRAINTS_LED);
    const sourceIds = CONSTRAINTS_LED.phaseTemplates.map((t) => t.id);

    expect(custom.phaseTemplates).toHaveLength(sourceIds.length);
    for (const template of custom.phaseTemplates) {
      expect(sourceIds).not.toContain(template.id);
    }
    expect(new Set(custom.phaseTemplates.map((t) => t.id)).size).toBe(sourceIds.length);
  });

  it('preserves the shape of the session: order, weights and interventions', () => {
    const custom = clone(CONSTRAINTS_LED);
    const before = orderedTemplates(CONSTRAINTS_LED);
    const after = orderedTemplates(custom);

    expect(after.map((t) => t.title)).toEqual(before.map((t) => t.title));
    expect(after.map((t) => t.durationWeight)).toEqual(before.map((t) => t.durationWeight));
    expect(after.map((t) => t.defaultIntervention)).toEqual(
      before.map((t) => t.defaultIntervention),
    );
    expect(custom.defaultIntervention).toEqual(CONSTRAINTS_LED.defaultIntervention);
  });

  it('deep-copies, so editing the clone can never reach back into the preset', () => {
    const custom = clone(CONSTRAINTS_LED);
    custom.phaseTemplates[0]!.coachPrompts.push('MUTATED');
    (custom.defaultIntervention as { maxPerPhase: number | null }).maxPerPhase = 99;

    expect(CONSTRAINTS_LED.phaseTemplates[0]?.coachPrompts).not.toContain('MUTATED');
    expect(CONSTRAINTS_LED.defaultIntervention.maxPerPhase).toBe(2);
  });

  it('carries the coach prompt through when the source has one', () => {
    expect(clone(CONSTRAINTS_LED).coachPrompt).toBe(
      'Design the constraint so the behaviour is the winning behaviour.',
    );
  });

  it('can itself be cloned again, and snapshots as custom', () => {
    const first = clone();
    const second = cloneMethodology(first, {
      name: 'Second generation',
      now: T0,
      ids: new FakeIdGenerator('cccc'),
    });

    expect(second.origin).toMatchObject({ kind: 'custom', clonedFrom: first.id });
    expect(snapshotMethodology(second, T0)).toMatchObject({
      originKind: 'custom',
      name: 'Second generation',
    });
  });
});
