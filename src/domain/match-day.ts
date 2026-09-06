import { z } from 'zod';
import { PhaseIdSchema, PlayerIdSchema } from './ids';
import { ChallengeStatusSchema } from './challenge';
import { nonEmptyText, optionalText } from './primitives';
import { matchReference, type AgeBand } from './practice/match';

/**
 * Match day: the shape you play, the units you talk to, and who was on the pitch.
 *
 * A match is **not a new aggregate**. It is a `Session` with `kind: 'match'` and this object
 * hanging off it, because almost everything a match needs already exists and is already
 * tested: periods are phases (`PhaseKind` already has `game` and `huddle`), the wall-clock
 * timer that survives a lock and a force-quit is the same timer, player challenges are the
 * same challenges, observations file under the same four corners, and Review already turns
 * all of that into next week's plan.
 *
 * ADR 0001 is explicit that only *new aggregates* pay the store tax. Everything here rides
 * `nullable().default()` on a document that is not indexed on any of it, which is the same
 * free-migration path `SessionPhase`'s practice-design fields took — a session written before
 * match day shipped parses unchanged, with `kind` defaulting to `training`.
 *
 * What a match does **not** inherit is the pretence that it is a practice. `spectrum`, STEP
 * constraints and group size stay null on a match period, because a game is not a designed
 * practice — it is the thing practices are representative *of*.
 */

/**
 * The formats England Football plays, smallest first.
 *
 * Taken from the same FutureFit table `practice/match.ts` already uses for pitch sizes, so a
 * squad's age group answers this without a tap.
 */
export const MATCH_FORMATS = ['3v3', '5v5', '7v7', '9v9', '11v11'] as const;
export type MatchFormat = (typeof MATCH_FORMATS)[number];

export function isMatchFormat(value: string): value is MatchFormat {
  return (MATCH_FORMATS as readonly string[]).includes(value);
}

/** The format an age band plays, or null where the table has no opinion. */
export function matchFormatOf(band: AgeBand): MatchFormat | null {
  const { format } = matchReference(band);
  return isMatchFormat(format) ? format : null;
}

/** One team's players, goalkeeper included. `matchReference` counts both teams. */
export function teamSizeOf(format: MatchFormat): number {
  return Number(format.split('v')[0]);
}

/**
 * **The FA's 3v3 is played without goalkeepers.** Every other format has one.
 *
 * This is the sort of detail that makes an app either credible or obviously written by
 * somebody who has not stood on a u7 touchline, so it is a rule rather than an assumption.
 */
export function hasGoalkeeper(format: MatchFormat): boolean {
  return format !== '3v3';
}

export const MATCH_UNITS = ['goalkeeper', 'defence', 'midfield', 'attack'] as const;
export type MatchUnit = (typeof MATCH_UNITS)[number];

export const MATCH_UNIT_LABELS: Record<MatchUnit, string> = {
  goalkeeper: 'Goalkeeper',
  defence: 'Defence',
  midfield: 'Midfield',
  attack: 'Attack',
};

/**
 * A shape, written the way a coach says it: outfield lines from the back.
 *
 * `lines` rather than three unit counts, because `4-2-3-1` has two midfield bands and
 * flattening it at rest would lose the name a coach actually uses. Units are *derived* —
 * first line is the defence, last is the attack, everything between is midfield — which
 * handles every shape below without a special case.
 */
export interface TeamShape {
  /** `4-2-3-1`. This is the id as well as the label; shapes are named by their numbers. */
  readonly name: string;
  readonly lines: readonly number[];
}

/**
 * Shapes that are legal at each format.
 *
 * Keyed by format rather than offered as one flat list, because offering a u9 coach a 4-3-3
 * would be the app being confidently wrong in public. The list is deliberately short: these
 * are the shapes grassroots teams actually play, not every arrangement that sums correctly.
 */
export const SHAPES_BY_FORMAT: Record<MatchFormat, readonly TeamShape[]> = {
  // No goalkeeper, so the lines are the whole team.
  '3v3': [
    { name: '1-1-1', lines: [1, 1, 1] },
    { name: '2-1', lines: [2, 1] },
    { name: '1-2', lines: [1, 2] },
  ],
  '5v5': [
    { name: '1-2-1', lines: [1, 2, 1] },
    { name: '2-2', lines: [2, 2] },
    { name: '2-1-1', lines: [2, 1, 1] },
    { name: '1-1-2', lines: [1, 1, 2] },
  ],
  '7v7': [
    { name: '2-3-1', lines: [2, 3, 1] },
    { name: '3-2-1', lines: [3, 2, 1] },
    { name: '2-1-2-1', lines: [2, 1, 2, 1] },
    { name: '3-1-2', lines: [3, 1, 2] },
  ],
  '9v9': [
    { name: '3-2-3', lines: [3, 2, 3] },
    { name: '3-3-2', lines: [3, 3, 2] },
    { name: '2-4-2', lines: [2, 4, 2] },
    { name: '3-4-1', lines: [3, 4, 1] },
  ],
  '11v11': [
    { name: '4-3-3', lines: [4, 3, 3] },
    { name: '4-4-2', lines: [4, 4, 2] },
    { name: '4-2-3-1', lines: [4, 2, 3, 1] },
    { name: '3-5-2', lines: [3, 5, 2] },
    { name: '3-4-3', lines: [3, 4, 3] },
  ],
};

export function shapesFor(format: MatchFormat): readonly TeamShape[] {
  return SHAPES_BY_FORMAT[format];
}

export function findShape(format: MatchFormat, name: string): TeamShape | undefined {
  return SHAPES_BY_FORMAT[format].find((shape) => shape.name === name);
}

/**
 * How many players the shape puts in each unit.
 *
 * A two-line shape (`2-1`) has no midfield rather than a midfield of zero-or-one guessed from
 * position — the middle of nothing is nothing, and `describeShape` says so.
 */
export function unitCountsOf(shape: TeamShape, format: MatchFormat): Record<MatchUnit, number> {
  const lines = shape.lines;
  const defence = lines[0] ?? 0;
  const attack = lines.length > 1 ? (lines[lines.length - 1] ?? 0) : 0;
  const midfield = lines.slice(1, -1).reduce((total, line) => total + line, 0);

  return {
    goalkeeper: hasGoalkeeper(format) ? 1 : 0,
    defence,
    midfield,
    attack,
  };
}

/** The units this shape actually fields, in back-to-front order. Empty units are dropped. */
export function unitsOf(shape: TeamShape, format: MatchFormat): MatchUnit[] {
  const counts = unitCountsOf(shape, format);
  return MATCH_UNITS.filter((unit) => counts[unit] > 0);
}

/** `2-3-1 — a back two, three in midfield, one up top.` */
export function describeShape(shape: TeamShape, format: MatchFormat): string {
  const counts = unitCountsOf(shape, format);
  const parts: string[] = [];
  if (counts.defence > 0) parts.push(`a back ${numberWord(counts.defence)}`);
  if (counts.midfield > 0) parts.push(`${numberWord(counts.midfield)} in midfield`);
  if (counts.attack > 0) parts.push(`${numberWord(counts.attack)} up top`);
  return `${shape.name} — ${parts.join(', ')}.`;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'] as const;
const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/**
 * Halves or quarters.
 *
 * Youth football commonly plays quarters, and an app that assumed two halves would be wrong
 * for a large share of the grassroots game. Both are just periods; the count is the choice.
 */
export const PERIOD_COUNTS = [2, 4] as const;
export type PeriodCount = (typeof PERIOD_COUNTS)[number];

export const periodCountLabel = (count: PeriodCount): string =>
  count === 2 ? 'Two halves' : 'Four quarters';

/** `First half`, `Third quarter`. Named so Do mode reads like a touchline, not an array. */
export function periodName(index: number, count: PeriodCount): string {
  const ordinals = ['First', 'Second', 'Third', 'Fourth'] as const;
  const ordinal = ordinals[index] ?? `Period ${index + 1}`;
  return count === 2 ? `${ordinal} half` : `${ordinal} quarter`;
}

export const MatchVenueSchema = z.enum(['home', 'away', 'neutral']);
export type MatchVenue = z.infer<typeof MatchVenueSchema>;

export const MATCH_VENUE_LABELS: Record<MatchVenue, string> = {
  home: 'Home',
  away: 'Away',
  neutral: 'Neutral',
};

export const FixtureTypeSchema = z.enum(['league', 'cup', 'friendly', 'tournament']);
export type FixtureType = z.infer<typeof FixtureTypeSchema>;

export const FIXTURE_TYPE_LABELS: Record<FixtureType, string> = {
  league: 'League',
  cup: 'Cup',
  friendly: 'Friendly',
  tournament: 'Tournament',
};

/**
 * An objective for a unit rather than a player or the team.
 *
 * This is the level with no equivalent anywhere else in the app, and the one coaches actually
 * speak in at half time — *"midfield, screen in front of the back three"*. The whole-team
 * objective is the session's own `objective`; individual ones are the existing challenges.
 */
export const UnitObjectiveSchema = z.object({
  unit: z.enum(MATCH_UNITS),
  text: nonEmptyText(140),
  /**
   * The coach's verdict, ruled at review.
   *
   * Reuses `ChallengeStatus` rather than inventing a parallel vocabulary: it is the same
   * question one level up, and a coach who has learned met / partly / missed on a player
   * challenge should not have to learn a second set of words for a unit.
   */
  status: ChallengeStatusSchema.default('open'),
});
export type UnitObjective = z.infer<typeof UnitObjectiveSchema>;

/** Where one player started. Substitutes are simply absent from the lineup. */
export const LineupSlotSchema = z.object({
  playerId: PlayerIdSchema,
  unit: z.enum(MATCH_UNITS),
});
export type LineupSlot = z.infer<typeof LineupSlotSchema>;

/**
 * Who was on the pitch for a period.
 *
 * **Period presence, not a running clock per player.** A coach managing rolling substitutions
 * in a 7v7 game has both hands full, and asking them to stamp every change would produce
 * precise numbers nobody actually entered. Ticking a period is one interaction per period, and
 * it is honest about its own resolution — `minutesPlayed` reports whole periods, and the
 * review says so rather than implying a stopwatch.
 */
export const PeriodPresenceSchema = z.object({
  phaseId: PhaseIdSchema,
  playerIds: z.array(PlayerIdSchema).max(30).default([]),
});
export type PeriodPresence = z.infer<typeof PeriodPresenceSchema>;

/** The score. Recorded, deliberately not the headline — see `matchOutcome`. */
export const MatchResultSchema = z.object({
  goalsFor: z.number().int().min(0).max(99),
  goalsAgainst: z.number().int().min(0).max(99),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;

export const MAX_UNIT_OBJECTIVES = 4;

export const MatchDetailsSchema = z.object({
  opponent: nonEmptyText(60),
  venue: MatchVenueSchema,
  fixtureType: FixtureTypeSchema,
  format: z.enum(MATCH_FORMATS),
  /** The shape's own name (`2-3-1`), validated against the format by `refineMatchDetails`. */
  shapeName: nonEmptyText(12).nullable().default(null),
  periodCount: z.union([z.literal(2), z.literal(4)]),
  unitObjectives: z.array(UnitObjectiveSchema).max(MAX_UNIT_OBJECTIVES).default([]),
  lineup: z.array(LineupSlotSchema).max(30).default([]),
  presence: z.array(PeriodPresenceSchema).max(8).default([]),
  result: MatchResultSchema.nullable().default(null),
  /** Pitch, weather, a referee who let too much go — the part no schema should structure. */
  conditions: optionalText(300).default(''),
});
export type MatchDetails = z.infer<typeof MatchDetailsSchema>;
export type MatchDetailsInput = z.input<typeof MatchDetailsSchema>;

/**
 * Cross-field rules for the match block, called from `Session`'s own `superRefine`.
 *
 * Kept here rather than in `session.ts` so the rules sit beside the vocabulary they police.
 */
export function refineMatchDetails(
  match: MatchDetails,
  addIssue: (path: (string | number)[], message: string) => void,
): void {
  if (match.shapeName !== null && findShape(match.format, match.shapeName) === undefined) {
    addIssue(['shapeName'], `${match.shapeName} is not a shape played at ${match.format}.`);
  }

  const seen = new Set<string>();
  match.unitObjectives.forEach((objective, index) => {
    if (seen.has(objective.unit)) {
      addIssue(['unitObjectives', index, 'unit'], `Two objectives for the ${objective.unit}.`);
    }
    seen.add(objective.unit);
  });

  const lineupPlayers = new Set(match.lineup.map((slot) => slot.playerId));
  if (lineupPlayers.size !== match.lineup.length) {
    addIssue(['lineup'], 'A player can only start in one place.');
  }

  // More starters than the format has shirts is a mis-tap the coach should see immediately,
  // not a number that quietly skews every minutes-played figure for the rest of the season.
  const teamSize = teamSizeOf(match.format);
  if (match.lineup.length > teamSize) {
    addIssue(['lineup'], `${match.format} starts ${teamSize} players, not ${match.lineup.length}.`);
  }

  const periods = new Set<string>();
  match.presence.forEach((period, index) => {
    if (periods.has(period.phaseId)) {
      addIssue(['presence', index, 'phaseId'], 'Two presence records for one period.');
    }
    periods.add(period.phaseId);
  });
}

/**
 * Minutes on the pitch, per player, from period presence.
 *
 * `periodMinutes` is what each period actually ran, so this reflects a game that kicked off
 * late or a half the referee stretched. Players who never appear return nothing rather than
 * zero — a squad member who was not at the game is absent, not benched, and the difference
 * matters to the only question this feature exists to answer.
 */
export function minutesPlayed(
  match: MatchDetails,
  periodMinutes: ReadonlyMap<string, number>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const period of match.presence) {
    const minutes = periodMinutes.get(period.phaseId) ?? 0;
    for (const playerId of period.playerIds) {
      totals.set(playerId, (totals.get(playerId) ?? 0) + minutes);
    }
  }
  return totals;
}

/**
 * `Won 3–1`, `Drew 2–2`, `Lost 0–4` — or null when nobody recorded it.
 *
 * The app records the score because a coach will want it, and then declines to lead with it.
 * Nothing in carry-forward reads this: a result is not evidence about a player.
 */
export function matchOutcome(result: MatchResult | null): string | null {
  if (result === null) return null;
  const score = `${result.goalsFor}–${result.goalsAgainst}`;
  if (result.goalsFor > result.goalsAgainst) return `Won ${score}`;
  if (result.goalsFor < result.goalsAgainst) return `Lost ${score}`;
  return `Drew ${score}`;
}

/** `Away to Eastfield Rovers` — the title a coach would write for themselves. */
export function describeFixture(match: MatchDetails): string {
  const preposition =
    match.venue === 'home' ? 'at home to' : match.venue === 'away' ? 'away to' : 'against';
  return `${preposition.charAt(0).toUpperCase()}${preposition.slice(1)} ${match.opponent}`;
}
