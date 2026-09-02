import { describe, expect, it } from 'vitest';
import {
  ALL_CORNER_ATTRIBUTES,
  attributeForTag,
  CORNER_ATTRIBUTES,
  CornerAttributeIdSchema,
  cornerForTag,
  cornerLabel,
  cornerShortLabel,
  cornerSlug,
  cornerToken,
  findAttribute,
  FOUR_CORNERS,
  FourCornerSchema,
} from './four-corners';

describe('the four corners', () => {
  it('is exactly the FA four, in a stable display order', () => {
    expect(FOUR_CORNERS).toEqual(['technical_tactical', 'physical', 'psychological', 'social']);
    expect(FourCornerSchema.options).toEqual([...FOUR_CORNERS]);
  });

  it('rejects anything that is not one of them', () => {
    expect(FourCornerSchema.safeParse('technical').success).toBe(false);
    expect(FourCornerSchema.safeParse('emotional').success).toBe(false);
  });

  it('labels every corner, long and short', () => {
    for (const corner of FOUR_CORNERS) {
      expect(cornerLabel(corner).length).toBeGreaterThan(0);
      // Short labels have to fit a tab on a 360px screen.
      expect(cornerShortLabel(corner).length).toBeLessThanOrEqual(10);
      expect(cornerToken(corner)).toBe(`var(--corner-${cornerSlug(corner)})`);
    }
  });
});

describe('the attribute bank', () => {
  it('gives every corner a scannable number of attributes', () => {
    for (const corner of FOUR_CORNERS) {
      const attributes = CORNER_ATTRIBUTES[corner];
      // Enough to say something specific, few enough to scan without scrolling a sheet.
      expect(attributes.length).toBeGreaterThanOrEqual(8);
      expect(attributes.length).toBeLessThanOrEqual(9);
    }
  });

  it('files every attribute under the corner it claims', () => {
    for (const corner of FOUR_CORNERS) {
      for (const attribute of CORNER_ATTRIBUTES[corner]) {
        expect(attribute.corner).toBe(corner);
      }
    }
  });

  it('uses unique ids and unique labels across all four corners', () => {
    const ids = ALL_CORNER_ATTRIBUTES.map((a) => a.id);
    const labels = ALL_CORNER_ATTRIBUTES.map((a) => a.label.toLowerCase());

    expect(new Set(ids).size).toBe(ids.length);
    // Labels must be unique too: tags are stored as labels, so a duplicate would make a
    // logged observation ambiguous about which corner it belongs to.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('resolves an attribute by id and rejects a stranger at the schema boundary', () => {
    expect(findAttribute('scanning')?.corner).toBe('technical_tactical');
    expect(findAttribute('nope')).toBeUndefined();

    expect(CornerAttributeIdSchema.safeParse('confidence').success).toBe(true);
    expect(CornerAttributeIdSchema.safeParse('vibes').success).toBe(false);
  });
});

describe('resolving a tag back to a corner', () => {
  it('classifies a tag the coach tapped, which is what keeps logging at two taps', () => {
    expect(cornerForTag('Communication')).toBe('social');
    expect(cornerForTag('Balance')).toBe('physical');
    expect(cornerForTag('Confidence')).toBe('psychological');
    expect(cornerForTag('First touch')).toBe('technical_tactical');
  });

  it('is case- and whitespace-insensitive, because tags come from a UI', () => {
    expect(cornerForTag('  first TOUCH ')).toBe('technical_tactical');
    expect(attributeForTag('TEAMWORK')?.id).toBe('teamwork');
  });

  it('returns undefined for free text rather than guessing', () => {
    // A coach's own words are not silently filed under a corner they did not choose.
    expect(cornerForTag('Split the centre-backs wide of the box')).toBeUndefined();
    expect(cornerForTag('')).toBeUndefined();
  });
});
