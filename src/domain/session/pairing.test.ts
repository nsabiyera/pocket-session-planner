import { describe, expect, it } from 'vitest';
import { comparePair, describePair, pairedPhases } from './pairing';
import { aPhase, aSession } from '@/test/builders';
import { asPhaseId } from '../ids';
import type { SessionPhase } from '../session';

const FIRST = asPhaseId('00000000-0000-4000-8000-0000000000a1');
const SECOND = asPhaseId('00000000-0000-4000-8000-0000000000a2');

/** Two WHOLE games either side of a PART, as Whole-Part-Whole builds them. */
const wholes = (
  earlierOver: Partial<SessionPhase> = {},
  laterOver: Partial<SessionPhase> = {},
): { earlier: SessionPhase; later: SessionPhase } => {
  const earlier = aPhase('whole-1', {
    id: FIRST,
    order: 0,
    kind: 'small_sided_game',
    title: 'WHOLE — play, and find the problem',
    spectrum: 'matched_up',
    targets: 'two_goals',
    ...earlierOver,
  });
  const later = aPhase('whole-2', {
    id: SECOND,
    order: 1,
    kind: 'small_sided_game',
    title: 'WHOLE — the same game, look for the change',
    spectrum: 'matched_up',
    targets: 'two_goals',
    pairedWithPhaseId: FIRST,
    ...laterOver,
  });
  return { earlier, later };
};

describe('pairedPhases', () => {
  it('finds the pair, later half carrying the pointer', () => {
    const { earlier, later } = wholes();
    const pairs = pairedPhases(aSession({ phases: [earlier, later] }));

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.earlier.id).toBe(FIRST);
    expect(pairs[0]!.later.id).toBe(SECOND);
  });

  it('returns nothing for a methodology that pairs nothing', () => {
    // Four of the five presets. Every caller renders nothing off this, rather than explaining
    // that this session had no pair to compare.
    expect(pairedPhases(aSession())).toEqual([]);
  });

  it('skips a pointer that does not resolve, rather than throwing', () => {
    // Unreachable through the schema, which rejects it — so this is only a session written by
    // an older release, and losing the comparison is the right outcome for one.
    const { later } = wholes();
    expect(pairedPhases({ phases: [later] })).toEqual([]);
  });
});

describe('comparePair', () => {
  it('finds nothing to report when the second game is the same game', () => {
    const comparison = comparePair(wholes());
    expect(comparison.differences).toEqual([]);
    expect(describePair(comparison)).toBe(
      'Both games match on everything recorded, so the comparison holds.',
    );
  });

  it('names a grid that shrank, on both axes', () => {
    const comparison = comparePair(
      wholes({ area: { lengthM: 40, widthM: 30 } }, { area: { lengthM: 30, widthM: 25 } }),
    );

    expect(comparison.differences).toEqual(['is 10 m shorter', 'is 5 m narrower']);
    expect(describePair(comparison)).toBe(
      'The second game is 10 m shorter and is 5 m narrower. ' +
        'Transfer is no longer a like-for-like comparison.',
    );
  });

  it('names the numbers, with the singular right', () => {
    expect(comparePair(wholes({ groupSize: 8 }, { groupSize: 9 })).differences).toEqual([
      'has 1 more player',
    ]);
    expect(comparePair(wholes({ groupSize: 10 }, { groupSize: 8 })).differences).toEqual([
      'has 2 fewer players',
    ]);
  });

  it('names a practice that stopped being the same kind', () => {
    expect(comparePair(wholes({}, { spectrum: 'overloaded' })).differences).toEqual([
      'is overloaded rather than matched-up',
    ]);
  });

  it('names a change of direction', () => {
    expect(comparePair(wholes({}, { targets: 'one_goal' })).differences).toEqual([
      'plays to one goal rather than two goals',
    ]);
  });

  it('counts conditions added and conditions dropped, separately', () => {
    const comparison = comparePair(
      wholes(
        { constraints: [{ letter: 'people', text: 'Keepers play out' }] },
        { constraints: [{ letter: 'task', text: 'Two touches maximum' }] },
      ),
    );

    expect(comparison.differences).toEqual([
      'has 1 condition the first did not',
      'drops 1 condition the first had',
    ]);
  });

  it('reads a reworded condition as a change, and an identical one as no change', () => {
    const same = comparePair(
      wholes(
        { constraints: [{ letter: 'task', text: 'Two touches maximum' }] },
        { constraints: [{ letter: 'task', text: '  two touches MAXIMUM  ' }] },
      ),
    );
    expect(same.differences).toEqual([]);

    const letterChanged = comparePair(
      wholes(
        { constraints: [{ letter: 'task', text: 'Two touches maximum' }] },
        { constraints: [{ letter: 'space', text: 'Two touches maximum' }] },
      ),
    );
    expect(letterChanged.differences).toHaveLength(2);
  });

  it('passes over a dimension only one side recorded', () => {
    // A gap is not a difference. Reporting it as one would tell a coach the practice changed
    // when all that happened is they filled in a field once.
    expect(comparePair(wholes({ groupSize: 8 }, { groupSize: null })).differences).toEqual([]);
    expect(comparePair(wholes({ area: { lengthM: 40, widthM: 30 } }, {})).differences).toEqual([]);
    expect(comparePair(wholes({}, { spectrum: null })).differences).toEqual([]);
    expect(comparePair(wholes({}, { targets: null })).differences).toEqual([]);
  });

  it('never compares the organisation prose', () => {
    // ADR 0004 left it unstructured so nothing would try. A paragraph diff is noise.
    const comparison = comparePair(
      wholes({ organisation: 'two neutrals' }, { organisation: 'no neutrals, keeper joins in' }),
    );
    expect(comparison.differences).toEqual([]);
  });

  it('carries both titles, so a report can name which game it means', () => {
    const comparison = comparePair(wholes());
    expect(comparison.earlierTitle).toContain('find the problem');
    expect(comparison.laterTitle).toContain('look for the change');
  });

  it('says nothing about players, in any wording it can produce', () => {
    // ADR 0009 §1. The sentence is about two records, and a coach must never be able to read
    // it as a verdict on whether anybody learned anything.
    const sentences = [
      describePair(comparePair(wholes())),
      describePair(comparePair(wholes({}, { spectrum: 'overloaded', groupSize: 6 }))),
    ];

    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/learn|understood|improv|better|worse|failed/i);
    }
  });
});
