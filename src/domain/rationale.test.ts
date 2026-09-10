import { describe, expect, it } from 'vitest';
import { CARRY_FORWARD_TRIGGERS } from '@/modules/review/derive-carry-forward';
import {
  findRationale,
  MAX_RATIONALE_WHY,
  RATIONALE_IDS,
  rationaleFor,
  type RationaleId,
} from './rationale';

/**
 * Same guard style as the `capabilityForAttribute` bank test: the registry is prose, and
 * prose rots silently. A rule added to `derive-carry-forward.ts` with no entry here is a
 * chip whose `?` has nothing behind it, and nothing else in the build would notice.
 */
describe('the rationale registry', () => {
  it('explains every trigger the review derivation can produce', () => {
    // Guard the guard: an empty list would make this test vacuous.
    expect(CARRY_FORWARD_TRIGGERS.length).toBeGreaterThan(5);

    for (const trigger of CARRY_FORWARD_TRIGGERS) {
      expect(findRationale(trigger), `no rationale for trigger "${trigger}"`).not.toBeNull();
    }
  });

  it('keeps every explanation short enough to read on a wet phone', () => {
    for (const id of RATIONALE_IDS) {
      const rationale = rationaleFor(id);
      expect(
        rationale.why.length,
        `"${id}" is ${rationale.why.length} characters`,
      ).toBeLessThanOrEqual(MAX_RATIONALE_WHY);
      // Two sentences, not two words. A one-liner here helps nobody.
      expect(rationale.why.length, `"${id}" is too thin to be worth a tap`).toBeGreaterThan(60);
    }
  });

  it('names a framework for every entry', () => {
    for (const id of RATIONALE_IDS) {
      expect(rationaleFor(id).framework.length).toBeGreaterThan(0);
    }
  });

  /**
   * ADR 0009 §1, enforced rather than remembered. The app records that a check was made; it
   * never claims a player understood anything, and the `?` disclosures are the easiest place
   * for that word to creep back in.
   */
  it('never tells a coach the app knows what a player understood', () => {
    for (const id of RATIONALE_IDS) {
      const { why } = rationaleFor(id);
      // "understood" is only allowed as part of saying the app cannot see it.
      if (/understood|understand|comprehen|grasped/i.test(why)) {
        expect(why, `"${id}" claims understanding`).toMatch(/\bnot\b|\bnever\b|\bno\b|cannot/i);
      }
    }
  });

  it('keeps academic jargon out of the coach-facing text', () => {
    // Rule 6 of the roadmap, enforced rather than remembered. "Practice spectrum" and "STEP"
    // are fine; these are the phrases a coach never met on their course.
    const banned = [
      'contextual interference',
      'self-determination',
      'ecological dynamics',
      'representative learning design',
      'normalised shannon',
      'entropy',
    ];

    for (const id of RATIONALE_IDS) {
      const text = `${rationaleFor(id).framework} ${rationaleFor(id).why}`.toLowerCase();
      for (const phrase of banned) {
        expect(text, `"${id}" uses "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it('points anything with a source at a real URL', () => {
    for (const id of RATIONALE_IDS) {
      const { source } = rationaleFor(id);
      if (source === undefined) continue;
      expect(() => new URL(source)).not.toThrow();
      expect(source.startsWith('https://')).toBe(true);
    }
  });

  it('reports its own id back, so a caller can key off what it got', () => {
    for (const id of RATIONALE_IDS) {
      expect(rationaleFor(id).id).toBe(id);
    }
  });

  it('returns null for a trigger it has never heard of, rather than throwing', () => {
    // An action stored by an older build can carry anything. A missing `?` is the right
    // failure; a crashed review screen is not.
    expect(findRationale('some:trigger-from-2025')).toBeNull();
    expect(findRationale('')).toBeNull();
    // And not a prototype property masquerading as an entry.
    expect(findRationale('toString')).toBeNull();
    expect(findRationale('constructor')).toBeNull();
  });

  it('covers the derived report lines as well as the proposals', () => {
    const reportIds: RationaleId[] = [
      'report:challenge-summary',
      'report:intervention',
      'report:corner-coverage',
      'report:capability-coverage',
      'report:moment-coverage',
      'report:corner-balance',
      'report:neglected-corner',
      'report:coaching-points-checked',
      'carry-forward:chain-stuck',
    ];

    for (const id of reportIds) {
      expect(RATIONALE_IDS).toContain(id);
    }
  });
});
