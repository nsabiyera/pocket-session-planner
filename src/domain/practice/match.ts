import {
  relativePlayingArea,
  spectrumLabel,
  type PracticeArea,
  type PracticeSpectrum,
} from '../practice';

/**
 * **Did the practice look like the game?**
 *
 * The FA's own practice-design question, and the one this app could not ask until phases 2–4
 * gave it a spectrum, an area and a group size. It is the applied end of *representative
 * learning design* (https://journals.sagepub.com/doi/10.1177/17479541221138680): the claim
 * that a practice transfers in proportion to how much of the game's information it preserves.
 *
 * ---
 *
 * **What is sourced, and what is not.** This matters more here than anywhere else in the app,
 * because a match comparison is the one number a coach would take at face value.
 *
 * **Solid — the pitch size for each format.** Cross-checked between two FA publications that
 * agree exactly once units are reconciled:
 *
 * | Format | FA guide (yards) | England Football FutureFit (metres) |
 * | --- | --- | --- |
 * | 5v5 | 40 × 30 | 37 × 27 |
 * | 7v7 | 60 × 40 | 55 × 37 |
 * | 9v9 | 80 × 50 | 73 × 46 |
 * | 11v11 | 90 × 55 | 82 × 50 (U14) |
 *
 * Metres are used because that is what FutureFit publishes and what `PracticeArea` stores —
 * so nothing is converted, which was the standing rule from ADR 0004.
 *
 * **Soft — which age plays which format.** The two sources disagree by a year at every
 * boundary: the older FA guide pairs U7/U8 at 5v5 and U9/U10 at 7v7, while FutureFit puts U8
 * and U9 at 5v5 and U10 and U11 at 7v7. Leagues vary too. So the app **shows its working** —
 * the format and the pitch it assumed are printed in the sentence — and a coach whose league
 * plays differently can see instantly that the comparison does not apply to them. Same
 * instinct as printing back the grid it parsed.
 *
 * **The recommended size, not the range.** The FA publishes a minimum and a maximum as well;
 * the sentence says "recommended" so the number is never mistaken for the only legal pitch.
 */

/** Single years, because that is how FutureFit publishes and how a coach names their squad. */
export const AGE_BANDS = [
  'u7',
  'u8',
  'u9',
  'u10',
  'u11',
  'u12',
  'u13',
  'u14',
  'u15',
  'u16',
] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface MatchReference {
  /** `9v9`, shown so a coach in a different league can spot the mismatch. */
  readonly format: string;
  /** Both teams, goalkeepers included — the same denominator a training grid uses. */
  readonly players: number;
  /** The FA's *recommended* size, in metres. */
  readonly area: PracticeArea;
}

/**
 * England Football's recommended match sizes, in metres.
 *
 * https://futurefit.englandfootball.com/futurefit/faqs/what-are-pitch-and-goal-sizes-for-the-different-age-groups/
 */
const MATCH_BY_AGE: Record<AgeBand, MatchReference> = {
  u7: { format: '3v3', players: 6, area: { lengthM: 15, widthM: 10 } },
  u8: { format: '5v5', players: 10, area: { lengthM: 37, widthM: 27 } },
  u9: { format: '5v5', players: 10, area: { lengthM: 37, widthM: 27 } },
  u10: { format: '7v7', players: 14, area: { lengthM: 55, widthM: 37 } },
  u11: { format: '7v7', players: 14, area: { lengthM: 55, widthM: 37 } },
  u12: { format: '9v9', players: 18, area: { lengthM: 73, widthM: 46 } },
  u13: { format: '9v9', players: 18, area: { lengthM: 73, widthM: 46 } },
  u14: { format: '11v11', players: 22, area: { lengthM: 82, widthM: 50 } },
  u15: { format: '11v11', players: 22, area: { lengthM: 91, widthM: 55 } },
  u16: { format: '11v11', players: 22, area: { lengthM: 91, widthM: 55 } },
};

export const matchReference = (band: AgeBand): MatchReference => MATCH_BY_AGE[band];

/**
 * The age band from `Squad.ageGroup`, which is free text.
 *
 * Accepts `U12`, `u12`, `U 12`, `U12s`, `Under 12`, `Under 12s` — the same token with or
 * without the plural everyone writes. Returns null for anything else, *"U12 Reds"* included:
 * a squad name is not an age group, and pulling an age out of a name is the prose-parsing
 * ADR 0004 refused. A null band means the match comparison simply does not appear, which is
 * the right failure — a wrong band would be a confidently wrong number.
 */
export function ageBandOf(ageGroup: string | undefined): AgeBand | null {
  if (!ageGroup) return null;
  const match = /^\s*(?:u|under)\s*(\d{1,2})\s*s?\s*$/i.exec(ageGroup);
  if (!match) return null;
  const band = `u${Number(match[1])}` as AgeBand;
  return AGE_BANDS.includes(band) ? band : null;
}

/** m² per player in a match at this age — the yardstick, computed from the FA's own numbers. */
export function matchRelativeArea(band: AgeBand): number {
  const reference = MATCH_BY_AGE[band];
  return relativePlayingArea(reference.area, reference.players)!;
}

export interface Representativeness {
  /** The last practice of the session — what the players finished on. */
  readonly spectrum: PracticeSpectrum | null;
  /** m² per player in that practice, when the coach recorded both halves. */
  readonly practiceArea: number | null;
  readonly band: AgeBand | null;
}

/**
 * *"You finished on an overloaded practice at 38 m² a player. A U12 match is 9v9 on a
 * recommended 73 × 46 m — about 187 m² a player."*
 *
 * **Two facts side by side, and no verdict.** There is no target ratio and the app never says
 * a practice was too tight or not game-like enough: a session that deliberately ends on a
 * tight technical block is a legitimate choice, and the FA poses this as a *question* for the
 * coach rather than a standard to be met. The comparison is the whole contribution.
 *
 * Null when there is nothing honest to compare — no final practice, or no age band.
 */
export function describeRepresentativeness(input: Representativeness): string | null {
  const { spectrum, practiceArea, band } = input;
  if (spectrum === null && practiceArea === null) return null;

  const parts: string[] = [];

  if (spectrum !== null && practiceArea !== null) {
    parts.push(
      `You finished on ${article(spectrum)} ${spectrumLabel(spectrum).toLowerCase()} practice at ${Math.round(practiceArea)} m² a player.`,
    );
  } else if (spectrum !== null) {
    parts.push(
      `You finished on ${article(spectrum)} ${spectrumLabel(spectrum).toLowerCase()} practice.`,
    );
  } else {
    parts.push(`Your last practice ran at ${Math.round(practiceArea!)} m² a player.`);
  }

  if (band !== null) {
    const reference = MATCH_BY_AGE[band];
    const matchRpa = Math.round(matchRelativeArea(band));
    parts.push(
      `A ${band.toUpperCase()} match is ${reference.format} on a recommended ${reference.area.lengthM} × ${reference.area.widthM} m — about ${matchRpa} m² a player.`,
    );
  } else if (practiceArea !== null) {
    // Owning the limit, rather than quietly dropping half the sentence.
    parts.push('Set the squad’s age group to compare it with a match.');
  }

  return parts.join(' ');
}

/** `an unopposed`, `an overloaded`, `a matched-up`. Three of the four take "an". */
function article(spectrum: PracticeSpectrum): string {
  return /^[aeiou]/.test(spectrumLabel(spectrum).toLowerCase()) ? 'an' : 'a';
}

/**
 * The FA's three-word reflection prompt: **realism, relevance, repetition**.
 *
 * Deliberately questions and not measurements. The app can count metres and players; it
 * cannot see whether a practice mattered to the players in it, and the honest way to cover
 * that is to ask the coach rather than to score it.
 */
export const REFLECTION_PROMPTS: readonly { readonly word: string; readonly question: string }[] = [
  { word: 'Realism', question: 'Did it look and feel like the game?' },
  { word: 'Relevance', question: 'Did it matter to the players in it?' },
  { word: 'Repetition', question: 'Did the thing you wanted happen often enough to learn from?' },
];
