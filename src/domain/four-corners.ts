import { z } from 'zod';

/**
 * The FA 4 Corner Model.
 *
 * > "Each of these 'corners' is equally important, and no one corner works in isolation."
 * > — England Football Learning
 *
 * The model exists to stop a coach developing a *quarter* of a player. That framing is what
 * this module is for: the corners are not four boxes to tick, they are a lens that makes an
 * invisible bias visible — and the bias is only visible if observations carry a corner.
 *
 * **On the attribute lists below.** The FA publishes the four corners and the principle, but
 * not a canonical enumeration of attributes. What follows is therefore *this app's* curated
 * grassroots list, chosen to be tappable on a phone in the rain rather than exhaustive. It is
 * grounded in the model but should not be quoted as an official FA taxonomy.
 */

export const FourCornerSchema = z.enum([
  'technical_tactical',
  'physical',
  'psychological',
  'social',
]);
export type FourCorner = z.infer<typeof FourCornerSchema>;

/** Canonical display order. Technical first only because it is where coaches already look. */
export const FOUR_CORNERS: readonly FourCorner[] = [
  'technical_tactical',
  'physical',
  'psychological',
  'social',
];

const CORNER_LABELS: Record<FourCorner, string> = {
  technical_tactical: 'Technical / Tactical',
  physical: 'Physical',
  psychological: 'Psychological',
  social: 'Social',
};

/** Short enough for a tab or a chip on a 360px screen. */
const CORNER_SHORT_LABELS: Record<FourCorner, string> = {
  technical_tactical: 'Technical',
  physical: 'Physical',
  psychological: 'Psych',
  social: 'Social',
};

export const cornerLabel = (corner: FourCorner): string => CORNER_LABELS[corner];
export const cornerShortLabel = (corner: FourCorner): string => CORNER_SHORT_LABELS[corner];

/** Maps to the `--corner-*` CSS custom properties. */
export const cornerToken = (corner: FourCorner): string => `var(--corner-${cornerSlug(corner)})`;
export const cornerSlug = (corner: FourCorner): string =>
  ({
    technical_tactical: 'technical',
    physical: 'physical',
    psychological: 'psychological',
    social: 'social',
  })[corner];

export interface CornerAttribute {
  readonly id: string;
  readonly corner: FourCorner;
  readonly label: string;
}

const attribute = (corner: FourCorner, id: string, label: string): CornerAttribute => ({
  id,
  corner,
  label,
});

/**
 * The tappable attribute bank, grouped by corner.
 *
 * Eight or nine per corner: enough to say something specific, few enough to scan in a bottom
 * sheet without scrolling. Every one of them is phrased as something a coach can *see* in a
 * session, because an attribute nobody can observe is an attribute nobody will log.
 */
export const CORNER_ATTRIBUTES: Record<FourCorner, readonly CornerAttribute[]> = {
  technical_tactical: [
    attribute('technical_tactical', 'first_touch', 'First touch'),
    attribute('technical_tactical', 'passing', 'Passing & receiving'),
    attribute('technical_tactical', 'one_v_one', '1v1'),
    attribute('technical_tactical', 'finishing', 'Finishing'),
    attribute('technical_tactical', 'defending', 'Defending'),
    attribute('technical_tactical', 'scanning', 'Scanning & awareness'),
    attribute('technical_tactical', 'decision_making', 'Decision making'),
    attribute('technical_tactical', 'positioning', 'Positioning'),
    attribute('technical_tactical', 'game_understanding', 'Game understanding'),
  ],
  physical: [
    // The ABCs — agility, balance, coordination — are the foundation of FA youth physical work.
    attribute('physical', 'agility', 'Agility'),
    attribute('physical', 'balance', 'Balance'),
    attribute('physical', 'coordination', 'Coordination'),
    attribute('physical', 'speed', 'Speed'),
    attribute('physical', 'strength', 'Strength'),
    attribute('physical', 'endurance', 'Endurance'),
    attribute('physical', 'movement', 'Movement & running'),
    attribute('physical', 'recovery', 'Recovery between efforts'),
  ],
  psychological: [
    attribute('psychological', 'confidence', 'Confidence'),
    attribute('psychological', 'concentration', 'Concentration'),
    attribute('psychological', 'resilience', 'Bouncing back'),
    attribute('psychological', 'motivation', 'Motivation'),
    attribute('psychological', 'composure', 'Composure under pressure'),
    attribute('psychological', 'determination', 'Determination'),
    attribute('psychological', 'coachability', 'Response to feedback'),
    attribute('psychological', 'risk_taking', 'Willing to try things'),
  ],
  social: [
    attribute('social', 'communication', 'Communication'),
    attribute('social', 'teamwork', 'Teamwork'),
    attribute('social', 'leadership', 'Leadership'),
    attribute('social', 'respect', 'Respect'),
    attribute('social', 'inclusion', 'Including others'),
    attribute('social', 'responsibility', 'Responsibility'),
    attribute('social', 'relationships', 'Relationships with teammates'),
    attribute('social', 'fair_play', 'Fair play'),
  ],
};

export const ALL_CORNER_ATTRIBUTES: readonly CornerAttribute[] = FOUR_CORNERS.flatMap(
  (corner) => CORNER_ATTRIBUTES[corner],
);

const ATTRIBUTE_BY_ID = new Map(ALL_CORNER_ATTRIBUTES.map((a) => [a.id, a]));
const ATTRIBUTE_BY_LABEL = new Map(
  ALL_CORNER_ATTRIBUTES.map((a) => [a.label.toLowerCase(), a] as const),
);

export const CornerAttributeIdSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((id) => ATTRIBUTE_BY_ID.has(id), { message: 'Unknown corner attribute.' });

export function findAttribute(id: string): CornerAttribute | undefined {
  return ATTRIBUTE_BY_ID.get(id);
}

/**
 * Resolves a free-text tag back to an attribute.
 *
 * Do mode logs tags as *labels*, because that is what the coach tapped and what should still
 * read correctly in three years when this list has changed. This lets the balance report
 * classify them without storing an id the UI would then have to resolve back to a word.
 */
export function attributeForTag(tag: string): CornerAttribute | undefined {
  return ATTRIBUTE_BY_LABEL.get(tag.trim().toLowerCase());
}

/** The corner a tag belongs to, if it is one of ours. */
export function cornerForTag(tag: string): FourCorner | undefined {
  return attributeForTag(tag)?.corner;
}
