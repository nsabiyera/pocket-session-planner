import { z } from 'zod';
import type { SquadLevel } from './squad';

/**
 * The morphocycle — the cycle between two matches (ADR 0007).
 *
 * **Derived from the fixture list, never from a fixed week.** A standard morphocycle is seven
 * days, and a two-game week compresses it to three; an international break stretches it. That
 * is the method's own behaviour rather than an approximation of it, which is why the app asks
 * "what sessions are there before this fixture" instead of rendering MD-4 through MD-1 slots
 * and hoping they get filled.
 *
 * **The pattern is the coach's.** There is no canonical day-to-quality table to ship: the
 * classical presentation, Barça Innovation Hub and the Tactical Periodisation site's own page
 * give three different answers, the last by declining to publish one. That is not a reason to
 * omit the pattern — in tactical periodization the morphocycle is derived from the club's own
 * game model, so a configurable pattern is the method's position rather than a hedge. The app
 * offers `CLASSICAL_PATTERN` as *one published reading*, labelled as such and editable.
 *
 * **No load numbers.** An effort quality is a label the coach assigns to a session and the app
 * reports back. There is no RPE capture, no intensity percentage, no session-load arithmetic
 * and no readiness score — the method's own position is that the physical is a consequence of
 * playing rather than a component to be dosed, and the app has no business inventing figures a
 * coach did not enter.
 */

/**
 * The sub-dynamics of football effort, plus the two days that are not about acquiring anything.
 *
 * `recovery` and `activation` are separated from the three qualities because the literature
 * agrees about them far more than it agrees about the rest: the day after a match dissipates
 * fatigue, and the day before it is short and sharp. Those two are the pattern's fixed points.
 */
export const EFFORT_QUALITIES = [
  'recovery',
  'tension',
  'duration',
  'velocity',
  'activation',
] as const;

export const EffortQualitySchema = z.enum(EFFORT_QUALITIES);
export type EffortQuality = z.infer<typeof EffortQualitySchema>;

export const EFFORT_QUALITY_LABELS: Record<EffortQuality, string> = {
  recovery: 'Recovery',
  tension: 'Tension',
  duration: 'Duration',
  velocity: 'Velocity',
  activation: 'Activation',
};

/** What each one means on the grass, in a coach's words rather than a physiologist's. */
export const EFFORT_QUALITY_HINTS: Record<EffortQuality, string> = {
  recovery: 'Dissipate the match. Low intensity, football-shaped.',
  tension: 'Short spaces, few players, many actions, full recovery between.',
  duration: 'Bigger spaces, more players, longer sequences.',
  velocity: 'Short, fast, long rests. Quality over volume.',
  activation: 'Brief and sharp. The opponent, and set pieces.',
};

/**
 * Acquisitive days carry the week's real demand; the others do not.
 *
 * This is the distinction the app leads with, because it is the one the sources broadly share —
 * unlike the mapping of qualities onto particular days, which they do not.
 */
export function isAcquisitive(quality: EffortQuality): boolean {
  return quality === 'tension' || quality === 'duration' || quality === 'velocity';
}

/**
 * One published reading of the classical pattern, keyed by days before the match.
 *
 * **Offered, not asserted.** This is the presentation most often attributed to Frade via
 * Oliveira and Tamarit; Barça Innovation Hub's microcycle article puts peak velocity on MD-3
 * with MD-2 as taper instead, and the Tactical Periodisation site declines to publish a
 * breakdown at all. A coach edits this, and the UI says where it comes from.
 */
export const CLASSICAL_PATTERN: Readonly<Record<number, EffortQuality>> = {
  4: 'tension',
  3: 'duration',
  2: 'velocity',
  1: 'activation',
};

/** The day after a match, whatever the fixture list looks like. */
export const AFTER_MATCH_QUALITY: EffortQuality = 'recovery';

export interface CycleSession {
  readonly id: string;
  readonly title: string;
  readonly scheduledFor: string;
  readonly kind: 'training' | 'match';
  /** The coach's own label, when they have given one. */
  readonly effortQuality: EffortQuality | null;
}

export interface CycleDay {
  readonly session: CycleSession;
  /**
   * Days before the next match. `4` reads as MD-4; `0` is the match itself; a negative number
   * is after the previous match and before this one has a countdown to speak of.
   */
  readonly daysToMatch: number;
  /** `MD-4`, `MD`, `MD+1`. The method's own naming, which this audience already uses. */
  readonly label: string;
  /** What the pattern would suggest, which the coach may have overridden or ignored. */
  readonly suggested: EffortQuality | null;
}

export interface Morphocycle {
  /** The match this cycle runs up to. */
  readonly fixture: CycleSession;
  /** Training sessions between the previous match and this one, in order. */
  readonly days: readonly CycleDay[];
  /** Days from the previous match to this one, or null when there was no previous match. */
  readonly spanDays: number | null;
  /**
   * False for a youth squad. Every effort-quality field is then meaningless and the UI must
   * show none of it — see `Squad.level` and ADR 0007.
   */
  readonly loadLabellingAllowed: boolean;
}

const DAY_MS = 86_400_000;

const wholeDaysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** `MD-4`, `MD`, `MD+2`. */
export function dayLabel(daysToMatch: number): string {
  if (daysToMatch === 0) return 'MD';
  return daysToMatch > 0 ? `MD-${daysToMatch}` : `MD+${Math.abs(daysToMatch)}`;
}

/**
 * Builds the cycle running up to one fixture.
 *
 * `sessions` is everything for the squad, in any order — the function finds the previous match
 * itself, because "the cycle" is defined by the two matches that bracket it and a caller should
 * not have to work that out.
 *
 * Sessions on the match day itself are excluded: a session the same day as the game is the
 * warm-up, not a training day, and counting it would put an `MD` training row in the list.
 */
export function morphocycleFor(
  fixture: CycleSession,
  sessions: readonly CycleSession[],
  options: { level: SquadLevel; pattern?: Readonly<Record<number, EffortQuality>> },
): Morphocycle {
  const pattern = options.pattern ?? CLASSICAL_PATTERN;

  const previousMatch = sessions
    .filter((session) => session.kind === 'match' && session.scheduledFor < fixture.scheduledFor)
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1))[0];

  const days: CycleDay[] = sessions
    .filter(
      (session) =>
        session.kind === 'training' &&
        session.scheduledFor < fixture.scheduledFor &&
        (previousMatch === undefined || session.scheduledFor > previousMatch.scheduledFor),
    )
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1))
    .map((session) => {
      const daysToMatch = wholeDaysBetween(session.scheduledFor, fixture.scheduledFor);
      return {
        session,
        daysToMatch,
        label: dayLabel(daysToMatch),
        suggested: suggestionFor(daysToMatch, previousMatch, session, pattern),
      };
    })
    .filter((day) => day.daysToMatch > 0);

  return {
    fixture,
    days,
    spanDays:
      previousMatch === undefined
        ? null
        : wholeDaysBetween(previousMatch.scheduledFor, fixture.scheduledFor),
    loadLabellingAllowed: options.level === 'senior',
  };
}

/**
 * What the pattern suggests for a day.
 *
 * The day immediately after the previous match is recovery whatever the pattern says, because
 * that is the one thing every source agrees on. Beyond the pattern's range — a six-day run-up,
 * or a compressed three-day week where MD-4 does not exist — it suggests nothing rather than
 * extrapolating a mapping the sources cannot even agree on inside its range.
 */
function suggestionFor(
  daysToMatch: number,
  previousMatch: CycleSession | undefined,
  session: CycleSession,
  pattern: Readonly<Record<number, EffortQuality>>,
): EffortQuality | null {
  if (previousMatch !== undefined) {
    const sincePrevious = wholeDaysBetween(previousMatch.scheduledFor, session.scheduledFor);
    if (sincePrevious <= 1) return AFTER_MATCH_QUALITY;
  }
  return pattern[daysToMatch] ?? null;
}

/**
 * Where the coach's labels and the pattern disagree.
 *
 * Reported, never corrected. A coach who put duration on MD-2 has either a reason or a
 * mis-tap, and the app is in no position to know which — least of all from a pattern whose own
 * sources disagree.
 */
export function departuresFromPattern(cycle: Morphocycle): CycleDay[] {
  if (!cycle.loadLabellingAllowed) return [];
  return cycle.days.filter(
    (day) =>
      day.session.effortQuality !== null &&
      day.suggested !== null &&
      day.session.effortQuality !== day.suggested,
  );
}

/**
 * Qualities worked twice running.
 *
 * Horizontal alternation's whole claim is that the same sub-dynamic is not hammered on
 * consecutive days. This is the fact that claim rests on, and it is the one thing in the
 * morphocycle the app can check rather than merely display.
 */
export function repeatedQualities(cycle: Morphocycle): EffortQuality[] {
  if (!cycle.loadLabellingAllowed) return [];

  const repeats: EffortQuality[] = [];
  for (let index = 1; index < cycle.days.length; index += 1) {
    const previous = cycle.days[index - 1]?.session.effortQuality;
    const current = cycle.days[index]?.session.effortQuality;
    if (
      current !== null &&
      current !== undefined &&
      current === previous &&
      isAcquisitive(current) &&
      !repeats.includes(current)
    ) {
      repeats.push(current);
    }
  }
  return repeats;
}

/**
 * One sentence about the cycle, or nothing.
 *
 * Nothing for a youth squad — not a refusal message, just silence, because a youth coach has
 * no reason to be told about a feature that does not apply to them.
 */
export function describeMorphocycle(cycle: Morphocycle): string | null {
  if (cycle.days.length === 0) return null;

  const count = `${cycle.days.length} session${cycle.days.length === 1 ? '' : 's'} before this game`;
  const span =
    cycle.spanDays === null
      ? ''
      : `, ${cycle.spanDays} day${cycle.spanDays === 1 ? '' : 's'} since the last one`;

  if (!cycle.loadLabellingAllowed) return `${count}${span}.`;

  const labelled = cycle.days.filter((day) => day.session.effortQuality !== null).length;
  const acquisitive = cycle.days.filter(
    (day) => day.session.effortQuality !== null && isAcquisitive(day.session.effortQuality),
  ).length;

  if (labelled === 0) return `${count}${span}. None labelled yet.`;

  const repeats = repeatedQualities(cycle);
  const alternation =
    repeats.length === 0
      ? ''
      : ` ${repeats.map((quality) => EFFORT_QUALITY_LABELS[quality]).join(' and ')} worked on consecutive days.`;

  return `${count}${span}. ${acquisitive} acquisitive.${alternation}`;
}
