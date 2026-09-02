import { describe, expect, it } from 'vitest';
import {
  cornerBalance,
  cornerOfObservation,
  describeCornerBalance,
  DOMINANT_CORNER_THRESHOLD,
  hasEnoughForBalance,
  MIN_OBSERVATIONS_FOR_BALANCE,
  suggestNeglectedCorner,
} from './balance';
import type { FourCorner } from '../four-corners';
import { anObservation } from '@/test/builders';
import type { Observation } from '../observation';

/** `n` observations in one corner, tagged the way Do mode tags them. */
const inCorner = (corner: FourCorner, count: number, tagged = false): Observation[] =>
  Array.from({ length: count }, (_, index) =>
    anObservation(`${corner}-${index}`, tagged ? { tags: [tagFor(corner)] } : { corner }),
  );

const tagFor = (corner: FourCorner): string =>
  ({
    technical_tactical: 'First touch',
    physical: 'Balance',
    psychological: 'Confidence',
    social: 'Communication',
  })[corner];

describe('cornerOfObservation', () => {
  it('prefers the corner the observation was explicitly filed under', () => {
    const observation = anObservation('o1', { corner: 'social', tags: ['First touch'] });
    expect(cornerOfObservation(observation)).toBe('social');
  });

  it('falls back to the first tag that maps to an attribute', () => {
    // This fallback is what keeps logging at two taps: the coach taps a tag because it says
    // what they saw, and the corner comes along for free.
    expect(cornerOfObservation(anObservation('o1', { tags: ['Teamwork'] }))).toBe('social');
  });

  it('skips free text and uses the first tag it recognises', () => {
    const observation = anObservation('o1', { tags: ['Something I made up', 'Agility'] });
    expect(cornerOfObservation(observation)).toBe('physical');
  });

  it('is undefined for an untagged note rather than guessing a corner', () => {
    expect(cornerOfObservation(anObservation('o1'))).toBeUndefined();
    expect(cornerOfObservation(anObservation('o1', { tags: ['Made up'] }))).toBeUndefined();
  });
});

describe('cornerBalance', () => {
  it('reports an empty sheet for a player with nothing logged', () => {
    const balance = cornerBalance([]);
    expect(balance).toMatchObject({ total: 0, classified: 0, unclassified: 0, evenness: 0 });
    expect(balance.neglected).toEqual([
      'technical_tactical',
      'physical',
      'psychological',
      'social',
    ]);
  });

  it('counts by corner and reports shares of what was classified', () => {
    const balance = cornerBalance([
      ...inCorner('technical_tactical', 6),
      ...inCorner('physical', 2),
    ]);

    expect(balance.countByCorner).toEqual({
      technical_tactical: 6,
      physical: 2,
      psychological: 0,
      social: 0,
    });
    expect(balance.shareByCorner.technical_tactical).toBeCloseTo(0.75, 5);
    expect(balance.classified).toBe(8);
  });

  it('counts tagged observations the same as explicitly filed ones', () => {
    const tagged = cornerBalance(inCorner('social', 4, true));
    expect(tagged.countByCorner.social).toBe(4);
    expect(tagged.classified).toBe(4);
  });

  it('separates unclassified observations rather than dropping or miscounting them', () => {
    const balance = cornerBalance([
      ...inCorner('social', 3),
      anObservation('note1'),
      anObservation('note2'),
    ]);

    expect(balance.total).toBe(5);
    expect(balance.classified).toBe(3);
    expect(balance.unclassified).toBe(2);
    // Shares are of what was classified — otherwise untagged notes would silently deflate
    // every corner and make the report look worse than the coaching was.
    expect(balance.shareByCorner.social).toBe(1);
  });

  it('names the corners with literally nothing against them', () => {
    const balance = cornerBalance([
      ...inCorner('technical_tactical', 29),
      ...inCorner('physical', 5),
    ]);
    expect(balance.neglected).toEqual(['psychological', 'social']);
  });

  it('flags a dominant corner only past the threshold', () => {
    const even = cornerBalance([...inCorner('technical_tactical', 5), ...inCorner('physical', 5)]);
    expect(even.shareByCorner.technical_tactical).toBe(DOMINANT_CORNER_THRESHOLD);
    expect(even.dominant).toBeNull();

    const lopsided = cornerBalance([
      ...inCorner('technical_tactical', 6),
      ...inCorner('physical', 4),
    ]);
    expect(lopsided.dominant).toBe('technical_tactical');
  });

  it('scores evenness 1 for a perfect spread and lower as it skews', () => {
    const perfect = cornerBalance([
      ...inCorner('technical_tactical', 3),
      ...inCorner('physical', 3),
      ...inCorner('psychological', 3),
      ...inCorner('social', 3),
    ]);
    expect(perfect.evenness).toBeCloseTo(1, 5);

    const skewed = cornerBalance([
      ...inCorner('technical_tactical', 9),
      ...inCorner('physical', 1),
      ...inCorner('psychological', 1),
      ...inCorner('social', 1),
    ]);
    expect(skewed.evenness).toBeLessThan(perfect.evenness);
    expect(skewed.evenness).toBeGreaterThan(0);
  });

  it('scores a single-corner coach zero, however many observations they logged', () => {
    expect(cornerBalance(inCorner('technical_tactical', 50)).evenness).toBe(0);
  });
});

describe('hasEnoughForBalance', () => {
  it('stays quiet until there is enough evidence to call it a bias', () => {
    // Three observations spread 2/1/0/0 is not a development bias, it is a Tuesday.
    expect(hasEnoughForBalance(cornerBalance(inCorner('social', 3)))).toBe(false);
    expect(
      hasEnoughForBalance(cornerBalance(inCorner('social', MIN_OBSERVATIONS_FOR_BALANCE))),
    ).toBe(true);
  });
});

describe('describeCornerBalance', () => {
  it('is the sentence the whole feature exists to produce', () => {
    const balance = cornerBalance([
      ...inCorner('technical_tactical', 29),
      ...inCorner('physical', 5),
    ]);
    expect(describeCornerBalance(balance, 'Kai')).toBe(
      '34 observations for Kai: 29 technical, 5 physical — nothing psych or social.',
    );
  });

  it('says nothing is missing when all four are covered', () => {
    const balance = cornerBalance([
      ...inCorner('technical_tactical', 2),
      ...inCorner('physical', 2),
      ...inCorner('psychological', 2),
      ...inCorner('social', 2),
    ]);
    expect(describeCornerBalance(balance, 'Kai')).toBe(
      '8 observations for Kai: 2 technical, 2 physical, 2 psych, 2 social.',
    );
  });

  it('gets the singular right', () => {
    expect(describeCornerBalance(cornerBalance(inCorner('social', 1)), 'Kai')).toMatch(
      /^1 observation for Kai:/,
    );
  });

  it('distinguishes "nothing logged" from "nothing tagged"', () => {
    expect(describeCornerBalance(cornerBalance([]), 'Kai')).toBe('Nothing logged for Kai yet.');
    expect(describeCornerBalance(cornerBalance([anObservation('n1')]), 'Kai')).toBe(
      '1 observation for Kai, none tagged to a corner yet.',
    );
  });
});

describe('suggestNeglectedCorner', () => {
  it('suggests nothing until there is enough evidence', () => {
    expect(suggestNeglectedCorner(cornerBalance(inCorner('technical_tactical', 4)))).toBeNull();
  });

  it('suggests an empty corner first', () => {
    const balance = cornerBalance([
      ...inCorner('technical_tactical', 8),
      ...inCorner('physical', 2),
      ...inCorner('social', 1),
    ]);
    expect(suggestNeglectedCorner(balance)).toBe('psychological');
  });

  it('suggests the thinnest corner when all four are covered but lopsided', () => {
    const balance = cornerBalance([
      ...inCorner('technical_tactical', 20),
      ...inCorner('physical', 3),
      ...inCorner('psychological', 1),
      ...inCorner('social', 2),
    ]);
    expect(suggestNeglectedCorner(balance)).toBe('psychological');
  });

  it('suggests nothing when the spread is already reasonable', () => {
    const balance = cornerBalance([
      ...inCorner('technical_tactical', 3),
      ...inCorner('physical', 3),
      ...inCorner('psychological', 3),
      ...inCorner('social', 3),
    ]);
    expect(balance.dominant).toBeNull();
    expect(suggestNeglectedCorner(balance)).toBeNull();
  });
});
