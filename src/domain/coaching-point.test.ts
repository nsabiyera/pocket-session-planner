import { describe, expect, it } from 'vitest';
import {
  coachingPointChecks,
  coachingPointGlyph,
  CoachingPointSchema,
  coachingPointsMatch,
  coachingPointState,
  coachingPointStateLabel,
  COACHING_POINT_STATES,
  describeCoachingPointChecks,
  hasEnoughForCheckLine,
  nextCoachingPointState,
  normaliseCoachingPointText,
  type CoachingPointState,
} from './coaching-point';
import { testId } from '@/test/builders';

const aPoint = (over: Record<string, unknown> = {}) =>
  CoachingPointSchema.parse({
    id: testId('point'),
    text: 'Head up before you receive',
    source: 'methodology',
    ...over,
  });

describe('the coaching point schema', () => {
  it('reads a point written before checking existed as unchecked', () => {
    // The honest value for an old session: nobody can now say whether it was checked. Same
    // reasoning `InterventionEvent.styleChosen` records for its own default.
    const point = aPoint({ delivered: true, deliveredAt: '2026-03-14T18:30:00.000Z' });
    expect(point.checked).toBe(false);
    expect(point.checkedAt).toBeNull();
  });

  it('refuses a point checked without having been delivered', () => {
    // Unreachable through the chip, which can only get to `checked` via `said` — so this only
    // fires on a hand-edited import, which is exactly when it earns its keep.
    expect(() => aPoint({ checked: true })).toThrow();
    expect(() => aPoint({ delivered: true, checked: true })).not.toThrow();
  });
});

describe('the three states of the chip', () => {
  it('reads the state off the two booleans', () => {
    expect(coachingPointState({ delivered: false, checked: false })).toBe('planned');
    expect(coachingPointState({ delivered: true, checked: false })).toBe('said');
    expect(coachingPointState({ delivered: true, checked: true })).toBe('checked');
  });

  it('cycles forward and wraps, so a mis-tap costs one more tap', () => {
    expect(nextCoachingPointState('planned')).toBe('said');
    expect(nextCoachingPointState('said')).toBe('checked');
    expect(nextCoachingPointState('planned')).toBe('said');

    // Three taps from any state and you are back where you started — which is what makes the
    // cycle safe to mis-tap in the rain.
    for (const state of COACHING_POINT_STATES) {
      const round = nextCoachingPointState(
        nextCoachingPointState(nextCoachingPointState(state)),
      ) satisfies CoachingPointState;
      expect(round).toBe(state);
    }
  });

  it('gives every state a glyph and words for a screen reader', () => {
    for (const state of COACHING_POINT_STATES) {
      expect(coachingPointGlyph(state).length).toBeGreaterThan(0);
      expect(coachingPointStateLabel(state).length).toBeGreaterThan(0);
    }
    // ADR 0009 §1: the vocabulary never claims anybody understood anything.
    const words = COACHING_POINT_STATES.map((state) => coachingPointStateLabel(state)).join(' ');
    expect(words).not.toMatch(/understood|understand|comprehen|learned|grasped/i);
  });
});

describe('counting what was said and what was checked', () => {
  it('counts both across a list of points', () => {
    const checks = coachingPointChecks([
      { delivered: true, checked: true },
      { delivered: true, checked: false },
      { delivered: true, checked: false },
      { delivered: false, checked: false },
    ]);
    expect(checks).toEqual({ total: 4, delivered: 3, checked: 1 });
  });

  it('is empty for a session with no points at all', () => {
    expect(coachingPointChecks([])).toEqual({ total: 0, delivered: 0, checked: 0 });
  });

  it('reports the two counts and nothing else', () => {
    expect(describeCoachingPointChecks({ total: 7, delivered: 5, checked: 1 })).toBe(
      '5 coaching points delivered. 1 checked.',
    );
    // The undelivered two are not mentioned: they already have their own carry-forward
    // proposal, and saying it twice would read as a telling-off rather than a count.
    expect(describeCoachingPointChecks({ total: 7, delivered: 5, checked: 1 })).not.toContain('7');
  });

  it('says "none marked checked" rather than passing judgement', () => {
    const line = describeCoachingPointChecks({ total: 5, delivered: 5, checked: 0 });
    expect(line).toBe('5 coaching points delivered. None marked checked.');
    // The `engagement.ts` zero-case rule: the chip defaults to unticked, so zero means
    // nothing was *recorded* at least as often as it means nothing was checked.
    expect(line).not.toMatch(/never|failed|should/i);
  });

  it('gets the singular right, because a coach reads this line', () => {
    expect(describeCoachingPointChecks({ total: 1, delivered: 1, checked: 1 })).toBe(
      '1 coaching point delivered. 1 checked.',
    );
  });

  it('offers no target and no ratio', () => {
    for (const checked of [0, 1, 3, 5]) {
      const line = describeCoachingPointChecks({ total: 5, delivered: 5, checked });
      expect(line).not.toContain('%');
      expect(line).not.toMatch(/of 5|out of|target|should/i);
    }
  });

  it('stays silent until something was recorded as said', () => {
    expect(hasEnoughForCheckLine({ total: 5, delivered: 0, checked: 0 })).toBe(false);
    expect(hasEnoughForCheckLine({ total: 0, delivered: 0, checked: 0 })).toBe(false);
    expect(hasEnoughForCheckLine({ total: 5, delivered: 1, checked: 0 })).toBe(true);
  });
});

describe('text normalisation for dedupe', () => {
  it('treats punctuation and case as noise', () => {
    expect(normaliseCoachingPointText('  Scan   before receiving! ')).toBe('scan before receiving');
    expect(coachingPointsMatch('Head up before you receive', 'head up before you receive.')).toBe(
      true,
    );
    expect(coachingPointsMatch('Head up', 'Head down')).toBe(false);
  });
});
