import { describe, expect, it } from 'vitest';
import {
  capabilityCoverage,
  capabilityOfObservation,
  describeCapabilityCoverage,
  hasEnoughForCapabilityView,
  MIN_OBSERVATIONS_FOR_CAPABILITY_VIEW,
  type CapabilityCoverage,
} from './coverage';
import type { Observation } from '../observation';
import { anObservation } from '@/test/builders';

/** An observation carrying the tag a coach would have tapped. */
const tagged = (label: string, ...tags: string[]): Observation => anObservation(label, { tags });

const coverageOf = (...observations: Observation[]) => capabilityCoverage(observations);

describe('capabilityOfObservation', () => {
  it('infers the capability from the tag the coach tapped', () => {
    expect(capabilityOfObservation(tagged('o1', 'Scanning & awareness'))).toBe('scanning');
    expect(capabilityOfObservation(tagged('o2', 'Decision making'))).toBe('timing');
    expect(capabilityOfObservation(tagged('o3', 'Movement & running'))).toBe('movement');
    expect(capabilityOfObservation(tagged('o4', 'Positioning'))).toBe('positioning');
    expect(capabilityOfObservation(tagged('o5', 'First touch'))).toBe('techniques');
  });

  it('prefers the attribute it was filed under over its tags', () => {
    const observation = anObservation('o1', {
      attribute: 'scanning',
      tags: ['First touch'],
    });
    expect(capabilityOfObservation(observation)).toBe('scanning');
  });

  it('falls back to the tags when the filed attribute maps to nothing', () => {
    const observation = anObservation('o1', {
      attribute: 'defending',
      tags: ['Positioning'],
    });
    expect(capabilityOfObservation(observation)).toBe('positioning');
  });

  it('takes the first tag that maps, ignoring ones that do not', () => {
    expect(capabilityOfObservation(tagged('o1', 'Head up before you receive', 'Finishing'))).toBe(
      'techniques',
    );
  });

  it('reads the capability tags directly, deception included', () => {
    expect(capabilityOfObservation(tagged('o1', 'Deception'))).toBe('deception');
    expect(capabilityOfObservation(tagged('o2', 'Timing'))).toBe('timing');
    expect(capabilityOfObservation(tagged('o3', 'Techniques'))).toBe('techniques');
  });

  it('respects the order the coach tapped, whichever route each tag takes', () => {
    // Tag order is the coach's priority; neither route gets to jump the queue.
    expect(capabilityOfObservation(tagged('o1', 'Deception', 'First touch'))).toBe('deception');
    expect(capabilityOfObservation(tagged('o2', 'First touch', 'Deception'))).toBe('techniques');
  });

  it('agrees with itself on Positioning, which is both a tag and an attribute', () => {
    expect(capabilityOfObservation(tagged('o1', 'Positioning'))).toBe('positioning');
  });

  it('is undefined for an observation this lens cannot classify', () => {
    expect(capabilityOfObservation(tagged('o1'))).toBeUndefined();
    expect(capabilityOfObservation(tagged('o2', 'Teamwork'))).toBeUndefined();
    expect(capabilityOfObservation(tagged('o3', 'Something the coach typed'))).toBeUndefined();
  });
});

describe('capabilityCoverage', () => {
  it('counts what the coach actually looked at', () => {
    const coverage = coverageOf(
      tagged('o1', 'First touch'),
      tagged('o2', 'Passing & receiving'),
      tagged('o3', 'Finishing'),
      tagged('o4', 'Scanning & awareness'),
    );

    expect(coverage.countByCapability.techniques).toBe(3);
    expect(coverage.countByCapability.scanning).toBe(1);
    expect(coverage.total).toBe(4);
    expect(coverage.classified).toBe(4);
    expect(coverage.unclassified).toBe(0);
  });

  it('counts the observations it cannot classify without hiding them', () => {
    const coverage = coverageOf(
      tagged('o1', 'First touch'),
      tagged('o2', 'Teamwork'),
      tagged('o3'),
    );

    expect(coverage.total).toBe(3);
    expect(coverage.classified).toBe(1);
    expect(coverage.unclassified).toBe(2);
  });

  it('names every blind spot, deception included now that it can be logged', () => {
    const coverage = coverageOf(tagged('o1', 'First touch'));

    expect(coverage.neglected).toEqual([
      'scanning',
      'timing',
      'movement',
      'positioning',
      'deception',
    ]);
    // Nothing is the app's fault any more: all six have a tag.
    expect(coverage.unreachable).toEqual([]);
  });

  it('reports nothing neglected once all six have been looked at', () => {
    const coverage = coverageOf(
      tagged('o1', 'Scanning & awareness'),
      tagged('o2', 'Decision making'),
      tagged('o3', 'Movement & running'),
      tagged('o4', 'Positioning'),
      tagged('o5', 'First touch'),
      tagged('o6', 'Deception'),
    );

    expect(coverage.neglected).toEqual([]);
    expect(coverage.unreachable).toEqual([]);
  });

  it('flags a capability holding more than half of everything', () => {
    const coverage = coverageOf(
      tagged('o1', 'First touch'),
      tagged('o2', 'Passing & receiving'),
      tagged('o3', 'Finishing'),
      tagged('o4', 'Scanning & awareness'),
    );
    expect(coverage.dominant).toBe('techniques');
  });

  it('flags nothing as dominant on an even spread, or on nothing at all', () => {
    const even = coverageOf(tagged('o1', 'First touch'), tagged('o2', 'Scanning & awareness'));
    expect(even.dominant).toBeNull();
    expect(capabilityCoverage([]).dominant).toBeNull();
  });

  it('reports zeroes for no observations at all', () => {
    const coverage = capabilityCoverage([]);
    expect(coverage.total).toBe(0);
    expect(coverage.classified).toBe(0);
    expect(coverage.countByCapability.techniques).toBe(0);
  });
});

describe('hasEnoughForCapabilityView', () => {
  const withClassified = (count: number): CapabilityCoverage =>
    capabilityCoverage(
      Array.from({ length: count }, (_, index) => tagged(`o${index}`, 'First touch')),
    );

  it('stays quiet until there is enough to be worth saying', () => {
    expect(
      hasEnoughForCapabilityView(withClassified(MIN_OBSERVATIONS_FOR_CAPABILITY_VIEW - 1)),
    ).toBe(false);
    expect(hasEnoughForCapabilityView(withClassified(MIN_OBSERVATIONS_FOR_CAPABILITY_VIEW))).toBe(
      true,
    );
  });

  it('counts only what it could classify, not the raw total', () => {
    const mostlyUnclassifiable = capabilityCoverage(
      Array.from({ length: 20 }, (_, index) => tagged(`o${index}`, 'Teamwork')),
    );
    expect(mostlyUnclassifiable.total).toBe(20);
    expect(hasEnoughForCapabilityView(mostlyUnclassifiable)).toBe(false);
  });
});

describe('describeCapabilityCoverage', () => {
  it('says so plainly when nothing has been logged', () => {
    expect(describeCapabilityCoverage(capabilityCoverage([]), 'Kai')).toBe(
      'Nothing logged for Kai yet.',
    );
  });

  it('distinguishes "nothing logged" from "nothing this lens can read"', () => {
    const coverage = coverageOf(tagged('o1', 'Teamwork'), tagged('o2', 'Leadership'));
    expect(describeCapabilityCoverage(coverage, 'Kai')).toBe(
      '2 observations for Kai, none tied to a core capability yet.',
    );
  });

  it('names what was watched, what was missed, and what the app cannot see', () => {
    const coverage = coverageOf(
      tagged('o1', 'First touch'),
      tagged('o2', 'Passing & receiving'),
      tagged('o3', 'Positioning'),
    );

    expect(describeCapabilityCoverage(coverage, 'this session')).toBe(
      '3 observations for this session: 1 positioning, 2 techniques — nothing on scanning, timing, movement or deception.',
    );
  });

  it('gets the singular right', () => {
    expect(
      describeCapabilityCoverage(coverageOf(tagged('o1', 'Scanning & awareness')), 'Kai'),
    ).toBe(
      '1 observation for Kai: 1 scanning — nothing on timing, movement, positioning, deception or techniques.',
    );
  });

  it('drops the blind-spot clause once all six have been watched', () => {
    const coverage = coverageOf(
      tagged('o1', 'Scanning & awareness'),
      tagged('o2', 'Decision making'),
      tagged('o3', 'Movement & running'),
      tagged('o4', 'Positioning'),
      tagged('o5', 'Deception'),
      tagged('o6', 'First touch'),
    );

    expect(describeCapabilityCoverage(coverage, 'Kai')).toBe(
      '6 observations for Kai: 1 scanning, 1 timing, 1 movement, 1 positioning, 1 deception, 1 techniques.',
    );
  });

  it('still owns the app share of a silence, if a capability ever loses its tag', () => {
    // Nothing can produce this today — every capability has a tag. Asserted on a synthetic
    // coverage so the graceful-degradation path cannot rot unnoticed.
    const stranded: CapabilityCoverage = {
      countByCapability: {
        scanning: 3,
        timing: 0,
        movement: 0,
        positioning: 0,
        deception: 0,
        techniques: 0,
      },
      total: 3,
      classified: 3,
      unclassified: 0,
      neglected: ['timing', 'movement', 'positioning', 'techniques'],
      unreachable: ['deception'],
      dominant: 'scanning',
    };

    expect(describeCapabilityCoverage(stranded, 'Kai')).toBe(
      "3 observations for Kai: 3 scanning — nothing on timing, movement, positioning or techniques. Deception isn't taggable yet.",
    );
  });
});
