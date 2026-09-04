import { z } from 'zod';
import type { FourCorner } from './four-corners';

/**
 * The FA's **six core capabilities**.
 *
 * > "Recognise what each player does before, during and after they receive the ball."
 * > — England Football Learning, *What are The FA's six core capabilities?* (2023)
 * > https://learn.englandfootball.com/articles-and-resources/coaching/resources/2023/What-are-The-FAs-six-core-capabilities
 *
 * Where the 4 Corner Model asks *what kind of player am I developing*, this asks *what
 * happened in that moment* — it is the framework for putting one player "under the
 * microscope" on a single action. The two are complementary lenses on the same observation,
 * which is why this is a separate axis rather than more corner attributes.
 *
 * **The six names and their descriptions are the FA's.** The mapping from this app's corner
 * attributes onto them (further down) is *not*: the FA publishes the capabilities, not a
 * crosswalk to anybody's attribute list. That mapping is this app's curation and is
 * deliberately sparse — see the note on `CAPABILITY_BY_ATTRIBUTE`.
 */

export const CoreCapabilitySchema = z.enum([
  'scanning',
  'timing',
  'movement',
  'positioning',
  'deception',
  'techniques',
]);
export type CoreCapability = z.infer<typeof CoreCapabilitySchema>;

/** The FA's own order, kept verbatim so the app reads like the course the coach did. */
export const CORE_CAPABILITIES: readonly CoreCapability[] = [
  'scanning',
  'timing',
  'movement',
  'positioning',
  'deception',
  'techniques',
];

const CAPABILITY_LABELS: Record<CoreCapability, string> = {
  scanning: 'Scanning',
  timing: 'Timing',
  movement: 'Movement',
  positioning: 'Positioning',
  deception: 'Deception',
  techniques: 'Techniques',
};

/**
 * One line each, close to the FA's wording. These are what make the lens usable by a coach
 * who did the course eighteen months ago and remembers four of the six.
 */
const CAPABILITY_DESCRIPTIONS: Record<CoreCapability, string> = {
  scanning: 'Looking around: where the ball, the opponents, the teammates and the space are.',
  timing: 'Choosing the right moment to act.',
  movement: 'How they move their body, on and off the ball — shielding, late runs, evading.',
  positioning: 'Where they put themselves, and how their body is angled.',
  deception: 'Disguising their intentions — the no-look pass, the fake, the delayed cross.',
  techniques: 'The technical execution itself — pass weight, finishing, tackle mechanics.',
};

export const capabilityLabel = (capability: CoreCapability): string =>
  CAPABILITY_LABELS[capability];

export const capabilityDescription = (capability: CoreCapability): string =>
  CAPABILITY_DESCRIPTIONS[capability];

/**
 * **When** in the action the coach was watching.
 *
 * The FA framing is a window — *before, during and after they receive the ball* — not a
 * property of any one capability. The article is explicit about the window and says nothing
 * about which capabilities belong to which part of it, so this is a **second, independent
 * axis**: deriving one from the other would be inventing an FA taxonomy that does not exist.
 *
 * It is also the more useful model. "Kai's scanning before the ball arrives" and "Kai's
 * scanning after he has played it" are different observations about the same capability, and
 * a coach who only ever watches the moment of contact is missing two thirds of the action.
 */
export const ActionMomentSchema = z.enum(['before', 'during', 'after']);
export type ActionMoment = z.infer<typeof ActionMomentSchema>;

export const ACTION_MOMENTS: readonly ActionMoment[] = ['before', 'during', 'after'];

const MOMENT_LABELS: Record<ActionMoment, string> = {
  before: 'Before receiving',
  during: 'As they receive',
  after: 'After receiving',
};

/** Short enough for a chip on a 360px screen. */
const MOMENT_SHORT_LABELS: Record<ActionMoment, string> = {
  before: 'Before',
  during: 'Receiving',
  after: 'After',
};

/**
 * The same three, phrased to sit inside a sentence: *"5 as they receive, 1 after they
 * receive — nothing before the ball arrives."* The button labels do not read as prose, and a
 * report that says "nothing before receiving" is a report nobody parses at arm's length.
 */
const MOMENT_PHRASES: Record<ActionMoment, string> = {
  before: 'before the ball arrives',
  during: 'as they receive',
  after: 'after they receive',
};

export const momentLabel = (moment: ActionMoment): string => MOMENT_LABELS[moment];
export const momentShortLabel = (moment: ActionMoment): string => MOMENT_SHORT_LABELS[moment];
export const momentPhrase = (moment: ActionMoment): string => MOMENT_PHRASES[moment];

/**
 * Corner attribute id → capability, for the attributes where the two lenses genuinely name
 * the same thing.
 *
 * **Deliberately sparse, and deliberately not exhaustive.** Only entries where a coach would
 * agree the attribute *is* that capability are here. `defending`, `one_v_one` and
 * `game_understanding` are each several capabilities at once, so mapping them would put a
 * confident label on a guess — and a report built on guesses is worse than no report.
 *
 * The consequence is visible and intended: nothing in the attribute bank maps to
 * **Deception**, so the coverage report can say the lens cannot see it yet rather than
 * blaming a coach for a gap the app created. See `unreachableCapabilities`.
 */
const CAPABILITY_BY_ATTRIBUTE: Readonly<Record<string, CoreCapability>> = {
  scanning: 'scanning',
  decision_making: 'timing',
  movement: 'movement',
  positioning: 'positioning',
  first_touch: 'techniques',
  passing: 'techniques',
  finishing: 'techniques',
};

/** The capability a corner attribute speaks to, where the two lenses agree. */
export function capabilityForAttribute(attributeId: string): CoreCapability | undefined {
  return CAPABILITY_BY_ATTRIBUTE[attributeId];
}

/**
 * The six as tappable tags, in the FA's own words.
 *
 * The attribute bank can only reach four of the six by inference, and **Deception** not at
 * all — so a coach watching for the fake had nowhere to record it. These make all six one tap
 * away, and let a coach who thinks in the FA's language log in it rather than translating
 * "Timing" into "Decision making" in their head.
 */
export const CAPABILITY_TAGS: readonly string[] = CORE_CAPABILITIES.map(
  (capability) => CAPABILITY_LABELS[capability],
);

const CAPABILITY_BY_TAG = new Map(
  CORE_CAPABILITIES.map(
    (capability) => [CAPABILITY_LABELS[capability].toLowerCase(), capability] as const,
  ),
);

/**
 * Resolves one of the six capability tags back to its capability.
 *
 * Tags are stored as the label the coach tapped, not an id — the same decision, for the same
 * reason, as `attributeForTag`: it is what they saw on the button, and it still reads
 * correctly in three years when this list has moved on.
 */
export function capabilityForTag(tag: string): CoreCapability | undefined {
  return CAPABILITY_BY_TAG.get(tag.trim().toLowerCase());
}

/**
 * The corner a capability tag files under. **This app's decision, not the FA's.**
 *
 * All six describe what a player does with, or in order to get, the ball, which is the
 * technical/tactical corner as this app draws it. The distinction worth knowing: capability
 * *Movement* is football movement — shielding, the late run, evading a challenge — whereas
 * the physical corner's `Movement & running` attribute is the athletic kind. They are
 * different observations and stay in different corners.
 *
 * Without this a coach who logged with the FA's words would watch their corner coverage go
 * blank, which would teach them not to use the new tags.
 */
export const CAPABILITY_TAG_CORNER: FourCorner = 'technical_tactical';

/**
 * Capabilities no observation can be classified as, by either route.
 *
 * **Empty now that all six are tappable directly** — it was `['deception']` when inference
 * from the attribute bank was the only way in. Kept rather than deleted because it is the
 * guard that made that gap visible in the first place: if a tag is ever renamed or dropped,
 * the coverage report degrades into saying so out loud instead of quietly blaming the coach
 * for a silence the app caused.
 */
export function unreachableCapabilities(): CoreCapability[] {
  const reachable = new Set<CoreCapability>([
    ...Object.values(CAPABILITY_BY_ATTRIBUTE),
    ...CAPABILITY_BY_TAG.values(),
  ]);
  return CORE_CAPABILITIES.filter((capability) => !reachable.has(capability));
}
