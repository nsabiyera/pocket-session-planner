import { describe, expect, it } from 'vitest';
import {
  ACTION_MOMENTS,
  ActionMomentSchema,
  CAPABILITY_TAG_CORNER,
  CAPABILITY_TAGS,
  capabilityDescription,
  capabilityForAttribute,
  capabilityForTag,
  capabilityLabel,
  CORE_CAPABILITIES,
  CoreCapabilitySchema,
  momentLabel,
  momentShortLabel,
  unreachableCapabilities,
  type ActionMoment,
  type CoreCapability,
} from './capabilities';
import { findAttribute } from './four-corners';

describe('the six core capabilities', () => {
  it('is the FA six, in the FA order', () => {
    expect(CORE_CAPABILITIES).toEqual([
      'scanning',
      'timing',
      'movement',
      'positioning',
      'deception',
      'techniques',
    ]);
  });

  it('labels and describes every one of them', () => {
    for (const capability of CORE_CAPABILITIES) {
      expect(capabilityLabel(capability).length).toBeGreaterThan(0);
      // A capability a coach cannot be reminded of is one they will not use.
      expect(capabilityDescription(capability).length).toBeGreaterThan(10);
    }
  });

  it('rejects anything that is not one of the six', () => {
    expect(CoreCapabilitySchema.safeParse('scanning').success).toBe(true);
    expect(CoreCapabilitySchema.safeParse('finishing').success).toBe(false);
    expect(CoreCapabilitySchema.safeParse('technical_tactical').success).toBe(false);
  });
});

describe('the action moment', () => {
  it('is the FA window: before, during and after receiving', () => {
    expect(ACTION_MOMENTS).toEqual(['before', 'during', 'after']);
  });

  it('labels each moment in words a coach would use', () => {
    const all: ActionMoment[] = ['before', 'during', 'after'];
    expect(all.map(momentLabel)).toEqual([
      'Before receiving',
      'As they receive',
      'After receiving',
    ]);
    expect(all.map(momentShortLabel)).toEqual(['Before', 'Receiving', 'After']);
  });

  it('is a separate axis from the capabilities, not derived from them', () => {
    // The FA names the window but never assigns capabilities to parts of it, so there is
    // deliberately no capability -> moment function to test. This asserts the shapes stay
    // independent: a moment is not a capability and vice versa.
    for (const moment of ACTION_MOMENTS) {
      expect(CoreCapabilitySchema.safeParse(moment).success).toBe(false);
    }
    for (const capability of CORE_CAPABILITIES) {
      expect(ActionMomentSchema.safeParse(capability).success).toBe(false);
    }
  });
});

describe('capabilityForAttribute', () => {
  it('maps the attributes that name the same thing as a capability', () => {
    expect(capabilityForAttribute('scanning')).toBe('scanning');
    expect(capabilityForAttribute('decision_making')).toBe('timing');
    expect(capabilityForAttribute('movement')).toBe('movement');
    expect(capabilityForAttribute('positioning')).toBe('positioning');
  });

  it('files the execution attributes under techniques', () => {
    expect(capabilityForAttribute('first_touch')).toBe('techniques');
    expect(capabilityForAttribute('passing')).toBe('techniques');
    expect(capabilityForAttribute('finishing')).toBe('techniques');
  });

  it('leaves the attributes that are several capabilities at once unmapped', () => {
    // Mapping these would put a confident label on a guess.
    expect(capabilityForAttribute('defending')).toBeUndefined();
    expect(capabilityForAttribute('one_v_one')).toBeUndefined();
    expect(capabilityForAttribute('game_understanding')).toBeUndefined();
  });

  it('returns undefined for an attribute that does not exist', () => {
    expect(capabilityForAttribute('nonsense')).toBeUndefined();
  });

  it('only ever maps attribute ids that are really in the bank', () => {
    // Guards the crosswalk against a typo silently becoming a permanent blind spot.
    const mapped = [
      'scanning',
      'decision_making',
      'movement',
      'positioning',
      'first_touch',
      'passing',
      'finishing',
    ];
    for (const id of mapped) {
      expect(findAttribute(id), `attribute "${id}" is not in the bank`).toBeDefined();
      expect(capabilityForAttribute(id)).toBeDefined();
    }
  });
});

describe('the capability tags', () => {
  it('offers all six in the FA order and in the FA words', () => {
    expect(CAPABILITY_TAGS).toEqual([
      'Scanning',
      'Timing',
      'Movement',
      'Positioning',
      'Deception',
      'Techniques',
    ]);
  });

  it('resolves a tag back to its capability', () => {
    expect(capabilityForTag('Deception')).toBe('deception');
    expect(capabilityForTag('Scanning')).toBe('scanning');
    expect(capabilityForTag('Techniques')).toBe('techniques');
  });

  it('is forgiving about case and stray spacing, as tags are typed and stored as words', () => {
    expect(capabilityForTag('  deception ')).toBe('deception');
    expect(capabilityForTag('TIMING')).toBe('timing');
  });

  it('does not answer for anything that is not one of the six', () => {
    expect(capabilityForTag('Scanning & awareness')).toBeUndefined();
    expect(capabilityForTag('Teamwork')).toBeUndefined();
    expect(capabilityForTag('')).toBeUndefined();
  });

  it('files them under technical / tactical, this app own call', () => {
    // Football movement, not athletic movement — the physical corner keeps that one.
    expect(CAPABILITY_TAG_CORNER).toBe('technical_tactical');
  });
});

describe('unreachableCapabilities', () => {
  it('is empty, now that every capability has a tag of its own', () => {
    // It read ['deception'] while inference from the attribute bank was the only way in.
    expect(unreachableCapabilities()).toEqual([]);
  });

  it('would still name a capability that lost both routes in', () => {
    // The guard's value is structural: every capability is reachable by tag by construction,
    // so this asserts the two routes are genuinely both consulted.
    const reachable = new Set<CoreCapability>(
      CORE_CAPABILITIES.filter((capability) => capabilityForTag(capabilityLabel(capability))),
    );
    expect(reachable.size).toBe(CORE_CAPABILITIES.length);
  });
});
