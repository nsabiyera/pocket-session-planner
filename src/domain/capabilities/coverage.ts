import {
  ACTION_MOMENTS,
  capabilityForAttribute,
  capabilityForTag,
  capabilityLabel,
  CORE_CAPABILITIES,
  momentPhrase,
  unreachableCapabilities,
  type ActionMoment,
  type CoreCapability,
} from '../capabilities';
import { attributeForTag } from '../four-corners';
import type { Observation } from '../observation';

/**
 * Which of the six core capabilities the coach actually looked at.
 *
 * The same shape, and the same argument, as corner balance: no extra tracking, no extra
 * taps, one honest number derived from what the coach was already logging. The difference is
 * what it makes visible. Corner balance catches a coach developing a quarter of a player;
 * this catches one who only ever watches the moment of contact — every observation about the
 * technique, none about the scan that made it possible.
 */

export interface CapabilityCoverage {
  readonly countByCapability: Record<CoreCapability, number>;
  /** Every observation considered, classified or not. */
  readonly total: number;
  readonly classified: number;
  /** Logged with no attribute this lens recognises — real, but invisible to the model. */
  readonly unclassified: number;
  /**
   * Capabilities with nothing against them **that the tag bank can express**. A real blind
   * spot, and the point of the report.
   */
  readonly neglected: CoreCapability[];
  /**
   * Capabilities no tag maps to, so the silence is the app's fault rather than the coach's.
   * Kept separate from `neglected` for exactly that reason.
   */
  readonly unreachable: CoreCapability[];
  /** A capability holding more than half of everything classified, if there is one. */
  readonly dominant: CoreCapability | null;
}

const zeroCounts = (): Record<CoreCapability, number> => ({
  scanning: 0,
  timing: 0,
  movement: 0,
  positioning: 0,
  deception: 0,
  techniques: 0,
});

/** More than this share in one capability and the app says so out loud. */
export const DOMINANT_CAPABILITY_THRESHOLD = 0.5;

/**
 * Below this many classified observations the report stays quiet — the same restraint corner
 * balance shows. Two observations that both happen to be about technique is not a blind spot,
 * it is two observations.
 */
export const MIN_OBSERVATIONS_FOR_CAPABILITY_VIEW = 8;

export function capabilityCoverage(observations: readonly Observation[]): CapabilityCoverage {
  const countByCapability = zeroCounts();
  let classified = 0;

  for (const observation of observations) {
    const capability = capabilityOfObservation(observation);
    if (capability === undefined) continue;
    countByCapability[capability] += 1;
    classified += 1;
  }

  const unreachable = unreachableCapabilities();
  const unreachableSet = new Set(unreachable);

  const dominant =
    CORE_CAPABILITIES.find(
      (capability) =>
        classified > 0 &&
        countByCapability[capability] / classified > DOMINANT_CAPABILITY_THRESHOLD,
    ) ?? null;

  return {
    countByCapability,
    total: observations.length,
    classified,
    unclassified: observations.length - classified,
    neglected: CORE_CAPABILITIES.filter(
      (capability) => countByCapability[capability] === 0 && !unreachableSet.has(capability),
    ),
    unreachable,
    dominant,
  };
}

/**
 * An observation's capability: from the attribute it was filed under, else the first of its
 * tags that maps to one.
 *
 * Inferred rather than asked for, which is the whole reason this can exist without touching
 * Do mode. The coach taps the tag that says what they saw; the capability comes along for
 * free, exactly as the corner already does.
 */
export function capabilityOfObservation(observation: Observation): CoreCapability | undefined {
  if (observation.attribute !== undefined) {
    const fromAttribute = capabilityForAttribute(observation.attribute);
    if (fromAttribute !== undefined) return fromAttribute;
  }

  // One pass over the tags in the order they were tapped, trying both routes on each: the
  // capability's own name first, then the attribute crosswalk. Tag order is the coach's
  // priority, so it must beat any preference between the two routes.
  for (const tag of observation.tags) {
    const named = capabilityForTag(tag);
    if (named !== undefined) return named;

    const attribute = attributeForTag(tag);
    if (attribute === undefined) continue;
    const capability = capabilityForAttribute(attribute.id);
    if (capability !== undefined) return capability;
  }

  return undefined;
}

/** Whether there is enough evidence for the report to be worth showing at all. */
export function hasEnoughForCapabilityView(coverage: CapabilityCoverage): boolean {
  return coverage.classified >= MIN_OBSERVATIONS_FOR_CAPABILITY_VIEW;
}

/**
 * *"9 observations of Kai: 7 techniques, 2 positioning — nothing on scanning, timing or
 * movement. Deception isn't taggable yet."*
 *
 * Names the gap without scolding, and owns the app's own share of the silence rather than
 * letting the coach read it as their failing.
 */
export function describeCapabilityCoverage(coverage: CapabilityCoverage, subject: string): string {
  if (coverage.classified === 0) {
    return coverage.total === 0
      ? `Nothing logged for ${subject} yet.`
      : `${coverage.total} observation${plural(coverage.total)} for ${subject}, none tied to a core capability yet.`;
  }

  const present = CORE_CAPABILITIES.filter(
    (capability) => coverage.countByCapability[capability] > 0,
  ).map((capability) => `${coverage.countByCapability[capability]} ${lower(capability)}`);

  let sentence = `${coverage.classified} observation${plural(coverage.classified)} for ${subject}: ${present.join(', ')}`;
  sentence +=
    coverage.neglected.length === 0
      ? '.'
      : ` — nothing on ${formatList(coverage.neglected.map(lower))}.`;

  if (coverage.unreachable.length > 0) {
    const names = formatList(coverage.unreachable.map(capabilityLabel));
    sentence += ` ${names} ${coverage.unreachable.length === 1 ? "isn't" : "aren't"} taggable yet.`;
  }

  return sentence;
}

/**
 * The other axis: **when** in the action the coach was watching.
 *
 * Unlike the capability, the moment cannot be inferred from anything the coach taps — only
 * they know whether they were watching the scan or the touch. So this counts an *opt-in*
 * field, and the report exists to answer one question a coach cannot answer about themselves:
 * *am I only ever watching the moment of contact?*
 */
export interface MomentCoverage {
  readonly countByMoment: Record<ActionMoment, number>;
  /** Every observation considered, moment or not. */
  readonly total: number;
  /** Those the coach actually recorded a moment against. */
  readonly recorded: number;
  /** Moments never once recorded — the part of the action going unwatched. */
  readonly missing: ActionMoment[];
  readonly dominant: ActionMoment | null;
}

/**
 * Four is enough to be a habit worth naming.
 *
 * Lower than the capability threshold on purpose: the moment is opt-in, so a coach who has
 * bothered to record it four times has told the app something deliberate, and making them
 * reach eight before it says anything back would waste the effort.
 */
export const MIN_OBSERVATIONS_FOR_MOMENT_VIEW = 4;

export function momentCoverage(observations: readonly Observation[]): MomentCoverage {
  const countByMoment: Record<ActionMoment, number> = { before: 0, during: 0, after: 0 };
  let recorded = 0;

  for (const observation of observations) {
    if (observation.actionMoment === undefined) continue;
    countByMoment[observation.actionMoment] += 1;
    recorded += 1;
  }

  return {
    countByMoment,
    total: observations.length,
    recorded,
    missing: ACTION_MOMENTS.filter((moment) => countByMoment[moment] === 0),
    dominant:
      ACTION_MOMENTS.find(
        (moment) =>
          recorded > 0 && countByMoment[moment] / recorded > DOMINANT_CAPABILITY_THRESHOLD,
      ) ?? null,
  };
}

export function hasEnoughForMomentView(coverage: MomentCoverage): boolean {
  return coverage.recorded >= MIN_OBSERVATIONS_FOR_MOMENT_VIEW;
}

/**
 * *"6 moments recorded for this session: 5 as they receive, 1 after they receive — nothing
 * before the ball arrives."*
 *
 * The last clause is the whole report. A coach who never watches the scan cannot see that
 * about themselves, and no amount of observation volume reveals it on its own.
 */
export function describeMomentCoverage(coverage: MomentCoverage, subject: string): string {
  if (coverage.recorded === 0) return `No moments recorded for ${subject} yet.`;

  const present = ACTION_MOMENTS.filter((moment) => coverage.countByMoment[moment] > 0).map(
    (moment) => `${coverage.countByMoment[moment]} ${momentPhrase(moment)}`,
  );

  const head = `${coverage.recorded} moment${plural(coverage.recorded)} recorded for ${subject}: ${present.join(', ')}`;
  if (coverage.missing.length === 0) return `${head}.`;

  return `${head} — nothing ${formatList(coverage.missing.map(momentPhrase))}.`;
}

const lower = (capability: CoreCapability): string => capabilityLabel(capability).toLowerCase();

function plural(count: number): string {
  return count === 1 ? '' : 's';
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
