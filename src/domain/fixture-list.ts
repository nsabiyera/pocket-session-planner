import { MATCH_VENUE_LABELS, type MatchVenue } from './match-day';

/**
 * Entering a run of fixtures.
 *
 * The gap the tactical periodization work left, and a structural one rather than a missing
 * screen: `startMatchDraft` replaces the squad's single draft (ADR 0003), so a coach could hold
 * exactly **one** upcoming match. Every screen that reasons about a week — the morphocycle, the
 * week review, the match brief — assumes a run of fixtures, and there was no way to enter one.
 *
 * A fixture is therefore a match committed straight to `planned` rather than left in the draft
 * slot. No schema change: `planned` sessions already accumulate freely, and only drafts are
 * singular.
 *
 * **A format, not prose.** ADR 0004 refused to parse prose — `ageBandOf` will not read an age
 * out of a squad *name* — and this keeps to that line. The accepted shape is a date, an optional
 * venue letter and an opponent, and anything else is **reported rather than guessed at**.
 *
 * That reporting is the one place this deliberately improves on `parseRosterLines`, which
 * silently drops a line it cannot read. Dropping one name out of fifteen is recoverable at a
 * glance; dropping three fixtures out of twenty from a pasted season is not, and a coach would
 * not find out until a week in March came up empty.
 */

export interface ParsedFixture {
  /** ISO instant. Time defaults to `DEFAULT_KICK_OFF` when the line gives none. */
  readonly kickOffAt: string;
  readonly venue: MatchVenue;
  readonly opponent: string;
}

export interface RejectedLine {
  readonly line: string;
  readonly reason: string;
}

export interface FixtureParse {
  readonly fixtures: readonly ParsedFixture[];
  /** Lines that did not parse, with why. Never silently dropped. */
  readonly rejected: readonly RejectedLine[];
}

/**
 * Kick-off when a line gives no time.
 *
 * The morphocycle counts **whole days** between a session and a match, so the hour only matters
 * at the boundary — a default of early afternoon keeps a Saturday game on Saturday whatever
 * time zone reads it back. Editable per fixture afterwards.
 */
export const DEFAULT_KICK_OFF = '14:00';

/** Shown next to the box, so the format is stated rather than discovered by failing. */
export const FIXTURE_LIST_EXAMPLE = [
  '2026-09-14 H Eastfield Rovers',
  '2026-09-21 A Northgate',
].join('\n');

export const MAX_FIXTURES_PER_PASTE = 60;

const VENUE_LETTERS: Record<string, MatchVenue> = {
  h: 'home',
  a: 'away',
  n: 'neutral',
};

/**
 * One fixture per line: `2026-09-14 H Eastfield Rovers`.
 *
 * The venue letter is optional and defaults to home, because a coach pasting a league fixture
 * list often has only dates and opponents — and home is the half they are more likely to be
 * able to correct from memory. `(H)` and `h` both work; anything else in that position is read
 * as part of the opponent's name rather than rejected, since "Athletic" should not fail for
 * starting with an A.
 */
export function parseFixtureLines(text: string): FixtureParse {
  const fixtures: ParsedFixture[] = [];
  const rejected: RejectedLine[] = [];

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (fixtures.length >= MAX_FIXTURES_PER_PASTE) {
      rejected.push({ line, reason: `More than ${MAX_FIXTURES_PER_PASTE} fixtures at once.` });
      continue;
    }

    const parsed = parseOne(line);
    if ('reason' in parsed) rejected.push({ line, reason: parsed.reason });
    else fixtures.push(parsed);
  }

  return { fixtures, rejected };
}

function parseOne(line: string): ParsedFixture | { reason: string } {
  // Date first, deliberately. A leading date is the one part of a fixture list that is
  // unambiguous, and anchoring on it means the opponent can contain anything at all.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?\s+(.+)$/.exec(line);
  if (!match) {
    return { reason: 'No date at the start. Expected 2026-09-14 first.' };
  }

  const [, year, month, day, hour, minute, rest] = match;
  const time = hour !== undefined && minute !== undefined ? `${hour}:${minute}` : DEFAULT_KICK_OFF;
  const kickOffAt = `${year}-${month}-${day}T${time}:00.000Z`;

  // Rejecting an impossible date rather than letting `Date` roll it forward: 2026-02-30
  // silently becoming 2 March is the kind of thing nobody notices until the week is wrong.
  const parsedDate = new Date(kickOffAt);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.getUTCDate() !== Number(day)) {
    return { reason: 'That is not a real date.' };
  }

  const { venue, opponent } = splitVenue((rest ?? '').trim());
  if (opponent.length === 0) return { reason: 'No opponent named.' };
  if (opponent.length > 60) return { reason: 'That opponent name is too long.' };

  return { kickOffAt, venue, opponent };
}

/**
 * Pulls a leading venue letter off the rest of the line.
 *
 * Only when it stands alone or is bracketed. A bare `A` followed by more words is a venue; a
 * word beginning with A is an opponent — so "Athletic Bilbao" survives and "A Northgate" does
 * not become a team called Northgate playing at a venue called A.
 */
function splitVenue(rest: string): { venue: MatchVenue; opponent: string } {
  const bracketed = /^\((h|a|n)\)\s*(.*)$/i.exec(rest);
  if (bracketed) {
    return {
      venue: VENUE_LETTERS[bracketed[1]!.toLowerCase()]!,
      opponent: (bracketed[2] ?? '').trim(),
    };
  }

  const bare = /^(h|a|n)\s+(.*)$/i.exec(rest);
  if (bare) {
    return { venue: VENUE_LETTERS[bare[1]!.toLowerCase()]!, opponent: (bare[2] ?? '').trim() };
  }

  return { venue: 'home', opponent: rest };
}

/** `Away to Eastfield Rovers · 14 Sep` — one parsed line, for the confirm list. */
export function describeParsedFixture(fixture: ParsedFixture): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(fixture.kickOffAt));
  return `${MATCH_VENUE_LABELS[fixture.venue]} · ${fixture.opponent} · ${date}`;
}
