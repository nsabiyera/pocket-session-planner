import { z } from 'zod';
import { CORE_CAPABILITIES, CoreCapabilitySchema, type CoreCapability } from '../capabilities';
import { CapabilityScanIdSchema, PlayerIdSchema, SessionIdSchema, SquadIdSchema } from '../ids';
import { observationValue, type Observation } from '../observation';
import { IsoDateTimeSchema, optionalText, RatingSchema, RecordMetaSchema } from '../primitives';
import { capabilityOfObservation } from './coverage';

/**
 * One player, **under the microscope**, on one skill.
 *
 * > "A framework coaches can use to put players under the microscope … this helps them
 * > observe what their players can do – and what they need help with."
 * > — England Football Learning, *What are The FA's six core capabilities?*
 *
 * The capability *coverage* report is derived from observations and costs the coach nothing;
 * it answers "which part of the action was I watching". This is the other half of how the
 * framework is actually used: a deliberate judgement of **one player on one skill**, six
 * ratings, recorded so that the same question in three months has something to compare
 * against.
 *
 * Modelled on `PlayerAssessment`, and deliberately not folded into it. An assessment is a
 * periodic profile of the whole player across the four corners — one per point in time. A
 * scan is per *skill*, and a coach may take three in a term: turning, then pressing, then
 * finishing. Forcing them into one record would make `skill` meaningless for half the rows
 * and break "where is this player right now" for the other half.
 *
 * Deliberately cheap, for the same reason: six taps, notes optional. A profiling ritual that
 * takes twenty minutes per player is a ritual that happens once.
 */

/**
 * The skills the FA names for this: *"applying them to specific skills like intercepting,
 * pressing, passing, tackling, finishing, and turning"*.
 *
 * A closed set rather than free text, because the entire value of recording a scan is that
 * two scans of the same skill can be compared — and "turning" typed three ways is three
 * skills as far as any comparison is concerned. The article says "like", so this is a list of
 * examples rather than a canon; adding to it later is a one-line change and no migration,
 * since nothing derives meaning from the absence of a value.
 */
export const ObservedSkillSchema = z.enum([
  'intercepting',
  'pressing',
  'passing',
  'tackling',
  'finishing',
  'turning',
]);
export type ObservedSkill = z.infer<typeof ObservedSkillSchema>;

export const OBSERVED_SKILLS: readonly ObservedSkill[] = [
  'intercepting',
  'pressing',
  'passing',
  'tackling',
  'finishing',
  'turning',
];

const SKILL_LABELS: Record<ObservedSkill, string> = {
  intercepting: 'Intercepting',
  pressing: 'Pressing',
  passing: 'Passing',
  tackling: 'Tackling',
  finishing: 'Finishing',
  turning: 'Turning',
};

export const skillLabel = (skill: ObservedSkill): string => SKILL_LABELS[skill];

const CapabilityRatingsSchema = z.object({
  scanning: RatingSchema.nullable().default(null),
  timing: RatingSchema.nullable().default(null),
  movement: RatingSchema.nullable().default(null),
  positioning: RatingSchema.nullable().default(null),
  deception: RatingSchema.nullable().default(null),
  techniques: RatingSchema.nullable().default(null),
});
export type CapabilityRatings = z.infer<typeof CapabilityRatingsSchema>;

const CapabilityNotesSchema = z.object({
  scanning: optionalText(300).default(''),
  timing: optionalText(300).default(''),
  movement: optionalText(300).default(''),
  positioning: optionalText(300).default(''),
  deception: optionalText(300).default(''),
  techniques: optionalText(300).default(''),
});
export type CapabilityNotes = z.infer<typeof CapabilityNotesSchema>;

export const CapabilityScanSchema = RecordMetaSchema.extend({
  id: CapabilityScanIdSchema,
  playerId: PlayerIdSchema,
  squadId: SquadIdSchema,
  /** What they were doing. Two scans of the same skill are what makes a scan worth keeping. */
  skill: ObservedSkillSchema,
  scannedAt: IsoDateTimeSchema,
  ratings: CapabilityRatingsSchema,
  notes: CapabilityNotesSchema.default({}),
  /** Set when the scan was taken off the back of a session rather than standalone. */
  sessionId: SessionIdSchema.nullable().default(null),
  /**
   * The one capability the coach intends to work on next.
   *
   * The same role `focusCorner` plays on an assessment: it is the bit that turns a profile
   * into an intention. *"Kai, scanning before you receive"* is a challenge waiting to be set.
   */
  focusCapability: CoreCapabilitySchema.nullable().default(null),
});
export type CapabilityScan = z.infer<typeof CapabilityScanSchema>;
export type CapabilityScanInput = z.input<typeof CapabilityScanSchema>;

export const emptyCapabilityRatings = (): CapabilityRatings => ({
  scanning: null,
  timing: null,
  movement: null,
  positioning: null,
  deception: null,
  techniques: null,
});

export const emptyCapabilityNotes = (): CapabilityNotes => ({
  scanning: '',
  timing: '',
  movement: '',
  positioning: '',
  deception: '',
  techniques: '',
});

/**
 * The capabilities the coach actually rated.
 *
 * A half-finished scan is still worth keeping: a coach who could only see three of the six in
 * a nine-minute rondo has told the truth about three, and forcing all six would only teach
 * them to invent the other three.
 */
export function ratedCapabilities(scan: CapabilityScan): CoreCapability[] {
  return CORE_CAPABILITIES.filter((capability) => scan.ratings[capability] !== null);
}

export function isScanComplete(scan: CapabilityScan): boolean {
  return ratedCapabilities(scan).length === CORE_CAPABILITIES.length;
}

/** Mean across the rated capabilities. `null` when nothing was rated. */
export function scanOverallRating(scan: CapabilityScan): number | null {
  const rated = ratedCapabilities(scan);
  if (rated.length === 0) return null;
  const total = rated.reduce((sum, capability) => sum + (scan.ratings[capability] ?? 0), 0);
  return total / rated.length;
}

/**
 * The strongest and weakest of what was rated — *"strongest: techniques. Needs help:
 * scanning."* — which is the sentence the FA framework exists to produce.
 *
 * Ties break towards the FA's canonical order, so the answer is stable across renders rather
 * than depending on object key iteration.
 */
export function scanExtremes(
  scan: CapabilityScan,
): { strongest: CoreCapability; weakest: CoreCapability } | null {
  const rated = ratedCapabilities(scan);
  if (rated.length === 0) return null;

  const ratingOf = (capability: CoreCapability) => scan.ratings[capability] ?? 0;
  let strongest = rated[0] as CoreCapability;
  let weakest = rated[0] as CoreCapability;

  for (const capability of rated) {
    if (ratingOf(capability) > ratingOf(strongest)) strongest = capability;
    if (ratingOf(capability) < ratingOf(weakest)) weakest = capability;
  }

  return { strongest, weakest };
}

/**
 * What this player's logged observations already say about one capability.
 *
 * A scan screen that opens blank asks the coach to remember six things about a session they
 * finished twenty minutes ago. This is the app doing what it does everywhere else: put the
 * evidence next to the question, and let the coach confirm or overrule it. They are rating
 * their own judgement, not this arithmetic — so nothing here pre-fills a rating.
 */
export interface CapabilityEvidence {
  readonly count: number;
  /** Logged as `good` — what they can already do. */
  readonly strengths: number;
  /** Logged as `working` or `struggled` — what they need help with. */
  readonly needsWork: number;
  /** Mean 1-5 across the observations that carried a value. */
  readonly meanValue: number | null;
}

export function capabilityEvidence(
  observations: readonly Observation[],
): Record<CoreCapability, CapabilityEvidence> {
  const tally = new Map<
    CoreCapability,
    { count: number; strengths: number; needsWork: number; total: number; valued: number }
  >();

  for (const observation of observations) {
    const capability = capabilityOfObservation(observation);
    if (capability === undefined) continue;

    const bucket = tally.get(capability) ?? {
      count: 0,
      strengths: 0,
      needsWork: 0,
      total: 0,
      valued: 0,
    };
    bucket.count += 1;
    if (observation.kind === 'strength') bucket.strengths += 1;
    if (observation.kind === 'development') bucket.needsWork += 1;

    const value = observationValue(observation);
    if (value !== null) {
      bucket.total += value;
      bucket.valued += 1;
    }

    tally.set(capability, bucket);
  }

  const evidence = {} as Record<CoreCapability, CapabilityEvidence>;
  for (const capability of CORE_CAPABILITIES) {
    const bucket = tally.get(capability);
    evidence[capability] = {
      count: bucket?.count ?? 0,
      strengths: bucket?.strengths ?? 0,
      needsWork: bucket?.needsWork ?? 0,
      meanValue: bucket && bucket.valued > 0 ? bucket.total / bucket.valued : null,
    };
  }
  return evidence;
}

export interface CapabilityDelta {
  readonly capability: CoreCapability;
  readonly from: number;
  readonly to: number;
  readonly change: number;
}

/**
 * What moved between two scans of the same skill.
 *
 * Only capabilities rated in *both* appear — comparing a rated capability against an unrated
 * one would invent a change out of an omission, which is the kind of quiet lie that makes a
 * coach stop trusting a progress screen. Same rule as `cornerDeltas`.
 */
export function capabilityDeltas(
  previous: CapabilityScan,
  current: CapabilityScan,
): CapabilityDelta[] {
  return CORE_CAPABILITIES.flatMap((capability) => {
    const from = previous.ratings[capability];
    const to = current.ratings[capability];
    if (from === null || to === null) return [];
    return [{ capability, from, to, change: to - from }];
  });
}
