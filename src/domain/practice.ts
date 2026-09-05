import { z } from 'zod';
import { PhaseIdSchema, PracticeAdjustmentIdSchema } from './ids';
import { IsoDateTimeSchema, nonEmptyText, optionalText } from './primitives';

/**
 * **Practice design** — the thinnest of the four areas in the FA's coach planning and
 * reflective model, and the one this app modelled as `kind + title + minutes + a free-text
 * box`.
 *
 * The argument for structuring it is the placeholder on that box: `"4v2 rondo, 15x15, two
 * neutrals"`. Space, players and task are already in the coach's head and already being
 * typed. Three typed fields make a large amount of coaching insight derivable for no extra
 * taps — and `organisation` stays exactly where it is, because the detail a schema should
 * not chase has to go somewhere. See `docs/adr/0004-structured-practice-design.md`.
 *
 * A **leaf module**: `zod`, `ids` and `primitives` only, exactly like `intervention.ts` and
 * `challenge.ts`. `methodology.ts` imports it for the template default and is itself imported
 * by half the domain, so anything heavier in here would be a cycle waiting to happen.
 */

/**
 * The FA's **practice spectrum**, in the FA's own order.
 *
 * > "unopposed · unopposed with interference · overloaded · matched-up"
 * > — England Football Learning, *How to design football practices* (2024)
 * > https://learn.englandfootball.com/articles-and-resources/coaching/resources/2024/How-to-design-football-practices
 *
 * Four values and no `custom`. The point of the spectrum is that it is ordered — it is the
 * one axis on which "how game-like was tonight?" has an answer — and an escape hatch would
 * destroy the ordering that makes {@link describeSessionShape} possible.
 */
export const PracticeSpectrumSchema = z.enum([
  'unopposed',
  'interference',
  'overloaded',
  'matched_up',
]);
export type PracticeSpectrum = z.infer<typeof PracticeSpectrumSchema>;

/** The FA's order, least game-like first. Also the rank used to describe a session's shape. */
export const PRACTICE_SPECTRUM: readonly PracticeSpectrum[] = [
  'unopposed',
  'interference',
  'overloaded',
  'matched_up',
];

/** The FA's wording, kept verbatim so the app reads like the course the coach did. */
const SPECTRUM_LABELS: Record<PracticeSpectrum, string> = {
  unopposed: 'Unopposed',
  interference: 'Unopposed with interference',
  overloaded: 'Overloaded',
  matched_up: 'Matched-up',
};

/** For a four-across chip row on a 375px screen, where the full label will not fit. */
const SPECTRUM_SHORT_LABELS: Record<PracticeSpectrum, string> = {
  unopposed: 'Unopposed',
  interference: 'Interference',
  overloaded: 'Overloaded',
  matched_up: 'Matched-up',
};

/**
 * One line each, for the coach who did the course eighteen months ago. Same job as
 * `capabilityDescription` — a lens nobody can remember is a lens nobody uses.
 */
const SPECTRUM_DESCRIPTIONS: Record<PracticeSpectrum, string> = {
  unopposed: 'No defender at all. Ball mastery, passing patterns, striking the ball.',
  interference: 'Something in the way, but it is not really trying — a mannequin, a passive body.',
  overloaded: 'Uneven numbers on purpose, so one side has it easier. 4v2, 3v1, 6v4.',
  matched_up: 'Even numbers. The game, or as close to it as the space allows.',
};

export const spectrumLabel = (spectrum: PracticeSpectrum): string => SPECTRUM_LABELS[spectrum];

export const spectrumShortLabel = (spectrum: PracticeSpectrum): string =>
  SPECTRUM_SHORT_LABELS[spectrum];

export const spectrumDescription = (spectrum: PracticeSpectrum): string =>
  SPECTRUM_DESCRIPTIONS[spectrum];

/** How game-like, as a number. Only ever used to compare two phases of the same session. */
export const spectrumRank = (spectrum: PracticeSpectrum): number =>
  PRACTICE_SPECTRUM.indexOf(spectrum);

/**
 * The grid, as a coach paces it out.
 *
 * Metres, and the app says so in the UI rather than converting: a grassroots coach in England
 * is as likely to mean yards, and a silent conversion would put a number in a season report
 * that nobody could reproduce with a tape measure.
 *
 * The bounds are generous on purpose — 3m is a tight ladder drill and 120m is a full pitch —
 * because the schema's job here is to catch a fat-thumbed `155` on a `15`, not to have an
 * opinion about practice design.
 */
export const PracticeAreaSchema = z.object({
  lengthM: z.number().int().min(3).max(120),
  widthM: z.number().int().min(3).max(90),
});
export type PracticeArea = z.infer<typeof PracticeAreaSchema>;

/** How many players are in one practice. Not the squad, and not the focus players. */
export const MIN_GROUP_SIZE = 1;
export const MAX_GROUP_SIZE = 30;

export const practiceAreaM2 = (area: PracticeArea): number => area.lengthM * area.widthM;

/**
 * **Relative playing area** — m² per player, the FA's own practice-design measure.
 *
 * Returns the bare number. Deliberately no `'small' | 'medium' | 'large'` band, and this is
 * the most important decision in the module:
 *
 * - The FA's *How to design football practices* names RPA but publishes **no figures** — it
 *   links out to a separate resource, and the banding there is tabulated by age group.
 * - The literature does not agree with itself. A bio-banding study uses small = 36 m²/player
 *   and large = 109; small-sided-game load research treats 120 m²/player as small-sided and
 *   270 as large. Those two are a factor of three apart on the same word.
 *
 * Any adjective this app attached would therefore be its own invention wearing the FA's
 * clothes. The number is honest and the coach can judge it; a band would be neither.
 */
export function relativePlayingArea(area: PracticeArea, groupSize: number): number | null {
  if (groupSize < MIN_GROUP_SIZE) return null;
  return practiceAreaM2(area) / groupSize;
}

/**
 * *"15 × 15 m for 6 players — 38 m² each."*
 *
 * Null when either half is missing. Silence beats a guess: the app cannot know the group size
 * from anything it already stores, so a phase with an area and no group size gets the
 * dimensions read back and nothing else.
 */
export function describePracticeArea(
  area: PracticeArea | null,
  groupSize: number | null,
): string | null {
  if (!area) return null;

  const grid = `${area.lengthM} × ${area.widthM} m`;
  if (groupSize === null) return `${grid} — set the group size for m² per player.`;

  const rpa = relativePlayingArea(area, groupSize);
  if (rpa === null) return grid;

  return `${grid} for ${groupSize} player${groupSize === 1 ? '' : 's'} — ${Math.round(rpa)} m² each.`;
}

/**
 * *"Unopposed → overloaded → matched-up. The practice got more game-like as it went."*
 *
 * Or the opposite, which is the useful case — a session that ends less game-like than it
 * started is one a coach almost never notices from inside it.
 *
 * **Describes; never prescribes.** There is no right shape. A technical block deliberately
 * placed after the game is a legitimate choice, and the app has no standing to call it wrong,
 * so the second sentence reports the direction and stops.
 */
export function describeSessionShape(spectrums: readonly PracticeSpectrum[]): string | null {
  // One practice is not a shape, it is a practice.
  if (spectrums.length < 2) return null;

  const path = spectrums.map((s) => spectrumLabel(s).toLowerCase()).join(' → ');
  const sentence = `${path.charAt(0).toUpperCase()}${path.slice(1)}.`;

  const ranks = spectrums.map(spectrumRank);
  const rose = ranks.some((rank, i) => i > 0 && rank > ranks[i - 1]!);
  const fell = ranks.some((rank, i) => i > 0 && rank < ranks[i - 1]!);

  if (rose && !fell) return `${sentence} The practice got more game-like as it went.`;
  if (fell && !rose) return `${sentence} The practice got less game-like as it went.`;
  if (rose && fell) return `${sentence} The practice moved back and forth.`;
  return `${sentence} Every practice was the same distance from the game.`;
}

// ---------------------------------------------------------------------------
// STEP
// ---------------------------------------------------------------------------

/**
 * **STEP** — Space, Task, Equipment, People.
 *
 * > "Make coaching personal with the STEP framework"
 * > — England Football Learning (2022)
 * > https://learn.englandfootball.com/articles-and-resources/coaching/resources/2022/make-coaching-personal-with-the-step-framework
 *
 * The FA's own framework for adapting a practice, and four letters most coaches can already
 * recite. The app stores the **letter only**: the condition itself stays the coach's own
 * words, because the space of football conditions has no closed enumeration — *"only score
 * once everyone has crossed halfway"* fits no enum anyone would write twice.
 *
 * That split is the whole design. Structuring the letter is a four-way tap with a preset
 * default, and it makes one honest sentence possible: *"Every constraint you changed tonight
 * was Task. You have not touched Space once."* Structuring the condition would be a form with
 * twelve fields, most of them blank, that dates the first time a coach invents a rule.
 *
 * `people` rather than `players` — the FA's own P, and it covers the opposition and the
 * goalkeeper as well as the squad.
 */
export const StepLetterSchema = z.enum(['space', 'task', 'equipment', 'people']);
export type StepLetter = z.infer<typeof StepLetterSchema>;

/** S, T, E, P — in the order that makes the mnemonic work. */
export const STEP_LETTERS: readonly StepLetter[] = ['space', 'task', 'equipment', 'people'];

const STEP_LABELS: Record<StepLetter, string> = {
  space: 'Space',
  task: 'Task',
  equipment: 'Equipment',
  people: 'People',
};

/** The single capital, for a badge on a row too narrow for the word. */
const STEP_INITIALS: Record<StepLetter, string> = {
  space: 'S',
  task: 'T',
  equipment: 'E',
  people: 'P',
};

/** Close to the FA's wording, for the coach who did the course a while ago. */
const STEP_DESCRIPTIONS: Record<StepLetter, string> = {
  space: 'The area — bigger, smaller, longer, narrower. Zones, channels, target areas.',
  task: 'The rules and the challenge — touches, time, how you score, what counts.',
  equipment: 'Balls, goals, bibs, cones, markers — size, number and type.',
  people: 'Who plays, how many, and on which side. Overloads, neutrals, pairings.',
};

export const stepLabel = (letter: StepLetter): string => STEP_LABELS[letter];
export const stepInitial = (letter: StepLetter): string => STEP_INITIALS[letter];
export const stepDescription = (letter: StepLetter): string => STEP_DESCRIPTIONS[letter];

/**
 * One condition on a practice, as the coach wrote it.
 *
 * The letter is tapped, never inferred. Deriving it from the text would mean keyword-matching
 * free prose, which is the exact thing ADR 0004 rejected when it refused to parse `"4v2 rondo,
 * 15x15"` out of `organisation` — a silently wrong letter in a season report is worse than no
 * letter at all.
 */
export const PhaseConstraintSchema = z.object({
  letter: StepLetterSchema,
  text: nonEmptyText(120),
});
export type PhaseConstraint = z.infer<typeof PhaseConstraintSchema>;

/** A practice with seven rules is not a practice, it is a rulebook. */
export const MAX_CONSTRAINTS_PER_PHASE = 6;

// ---------------------------------------------------------------------------
// The Challenge Point Framework, in the two words a coach actually uses
// ---------------------------------------------------------------------------

/**
 * **Progressions and regressions** — make it harder, or make it easier.
 *
 * This is the Challenge Point Framework (Guadagnoli & Lee, 2004) with the jargon taken out.
 * Its claim is that learning peaks at an *optimal challenge point*: a task too easy stops
 * informing, a task too hard stops being performable. The coach's lever for that is the
 * practice, and coaches already write the lever down — `"Add pressure once it is clean"`,
 * `"passive, then live"` — in prose that nothing could read.
 *
 * The app never uses the phrase "challenge point", never scores a practice, and never says a
 * coach adjusted too much or too little. What it can honestly do is count.
 */
export const AdjustmentDirectionSchema = z.enum(['progressed', 'regressed']);
export type AdjustmentDirection = z.infer<typeof AdjustmentDirectionSchema>;

const ADJUSTMENT_LABELS: Record<AdjustmentDirection, string> = {
  progressed: 'Made it harder',
  regressed: 'Made it easier',
};

/** The word for the *plan* side — a list of progressions, a list of regressions. */
const ADJUSTMENT_PLAN_LABELS: Record<AdjustmentDirection, string> = {
  progressed: 'Progressions',
  regressed: 'Regressions',
};

export const adjustmentLabel = (direction: AdjustmentDirection): string =>
  ADJUSTMENT_LABELS[direction];

export const adjustmentPlanLabel = (direction: AdjustmentDirection): string =>
  ADJUSTMENT_PLAN_LABELS[direction];

/**
 * One recorded change to how hard the practice was, stamped when the coach tapped it.
 *
 * **`text` is frozen, not a reference into `phase.progressions`.** Same argument as
 * `MethodologySnapshot`: the plan can be edited after the session and the evidence must not
 * move underneath it. An empty `text` is an off-plan adjustment — the coach changed something
 * they had not written down, which is the most interesting kind.
 *
 * **This is not an intervention.** It does not stop the clock, it does not count against the
 * intervention budget, and it never dents ball-rolling time. A coach who changes a constraint
 * without saying a word has coached without stopping play, and the numbers must keep saying so.
 */
export const PracticeAdjustmentSchema = z.object({
  id: PracticeAdjustmentIdSchema,
  phaseId: PhaseIdSchema,
  direction: AdjustmentDirectionSchema,
  /** The progression as written, frozen. Empty when the coach adjusted off-plan. */
  text: optionalText(160).default(''),
  /**
   * Which STEP lever was pulled, when the app knows. Null for an off-plan change — the coach
   * was busy, and asking them to classify it mid-rondo would cost the recording itself.
   * Reported as `unclassified`, never filed under a guess.
   */
  step: StepLetterSchema.nullable().default(null),
  at: IsoDateTimeSchema,
  /** Elapsed time within the phase, so Review can place it inside the practice. */
  phaseElapsedMs: z.number().int().min(0).default(0),
});
export type PracticeAdjustment = z.infer<typeof PracticeAdjustmentSchema>;
export type PracticeAdjustmentInput = z.input<typeof PracticeAdjustmentSchema>;

/** Plan-time caps, matching the existing `progressions` / `regressions` arrays. */
export const MAX_ADJUSTMENTS_PER_PHASE = 5;
export const MAX_ADJUSTMENT_TEXT = 160;

export interface AdjustmentSummary {
  readonly total: number;
  readonly progressed: number;
  readonly regressed: number;
  /** Phases in which the coach adjusted at least once. */
  readonly phasesAdjusted: number;
  /** Phases that had a progression or regression written down at plan time. */
  readonly phasesWithAPlan: number;
  /** Planned adjustments that were written and never used. Descriptive, never a rebuke. */
  readonly plannedUnused: number;
}

/**
 * *"You made the practice harder twice and easier once, across 2 of 3 practices."*
 *
 * Reports what happened and stops. There is no target number of adjustments, and a coach
 * optimising for this number would be fiddling with a practice that was working.
 */
export function describeAdjustments(summary: AdjustmentSummary): string {
  if (summary.total === 0) {
    return summary.phasesWithAPlan === 0
      ? 'No progressions or regressions written down, and none recorded.'
      : `You wrote ${summary.plannedUnused} way${summary.plannedUnused === 1 ? '' : 's'} to change the practice and used none of them.`;
  }

  const parts: string[] = [];
  if (summary.progressed > 0) {
    parts.push(`harder ${summary.progressed === 1 ? 'once' : `${summary.progressed} times`}`);
  }
  if (summary.regressed > 0) {
    parts.push(`easier ${summary.regressed === 1 ? 'once' : `${summary.regressed} times`}`);
  }

  const where =
    summary.phasesAdjusted === 1 ? 'in one practice' : `across ${summary.phasesAdjusted} practices`;

  return `You made the practice ${parts.join(' and ')}, ${where}.`;
}

export interface StepCoverage {
  readonly countByLetter: Record<StepLetter, number>;
  /** Every adjustment considered, classified or not. */
  readonly total: number;
  /** Those that carried a STEP letter. */
  readonly classified: number;
  /** Off-plan changes, which carry no letter. Shown, never swallowed. */
  readonly unclassified: number;
  /** Letters never once touched — the levers going unused. */
  readonly untouched: StepLetter[];
  /** A letter holding more than half of everything classified, if there is one. */
  readonly dominant: StepLetter | null;
}

/** Below this there is no habit to name, only a Tuesday. */
export const MIN_ADJUSTMENTS_FOR_STEP_VIEW = 4;

/** More than half of everything classified is a habit worth showing a coach. */
const DOMINANT_STEP_THRESHOLD = 0.5;

export function stepCoverage(
  adjustments: readonly { readonly step: StepLetter | null }[],
): StepCoverage {
  const countByLetter: Record<StepLetter, number> = {
    space: 0,
    task: 0,
    equipment: 0,
    people: 0,
  };

  let classified = 0;
  for (const adjustment of adjustments) {
    if (adjustment.step === null) continue;
    countByLetter[adjustment.step] += 1;
    classified += 1;
  }

  return {
    countByLetter,
    total: adjustments.length,
    classified,
    unclassified: adjustments.length - classified,
    untouched: STEP_LETTERS.filter((letter) => countByLetter[letter] === 0),
    dominant:
      STEP_LETTERS.find(
        (letter) => classified > 0 && countByLetter[letter] / classified > DOMINANT_STEP_THRESHOLD,
      ) ?? null,
  };
}

export const hasEnoughForStepView = (coverage: StepCoverage): boolean =>
  coverage.classified >= MIN_ADJUSTMENTS_FOR_STEP_VIEW;

/**
 * *"You changed a constraint 4 times: 3 Task, 1 Space — nothing on equipment or people."*
 *
 * The genuinely new mirror in this app. Most coaches pull one lever habitually and cannot see
 * it from inside the habit, exactly as with the 4 Corner Model — which is why this reads like
 * `describeCornerBalance` and stops in the same place: it names the gap and offers nothing.
 *
 * STEP is four places to look, not four boxes to tick. There is no even distribution to reach
 * and the app never suggests one.
 */
export function describeStepCoverage(coverage: StepCoverage): string {
  if (coverage.classified === 0) {
    return coverage.total === 0
      ? 'No constraint changes recorded.'
      : coverage.total +
          ' change' +
          (coverage.total === 1 ? '' : 's') +
          ' to the practice, none of them against a constraint you had written down.';
  }

  const touched = STEP_LETTERS.filter((letter) => coverage.countByLetter[letter] > 0)
    .map((letter) => countByLetterLabel(coverage, letter))
    .join(', ');

  const times = coverage.classified === 1 ? 'time' : 'times';
  let sentence = 'You changed a constraint ' + coverage.classified + ' ' + times + ': ' + touched;

  sentence +=
    coverage.untouched.length === 0
      ? ' — all four letters.'
      : ' — nothing on ' +
        listWords(coverage.untouched.map((letter) => stepLabel(letter).toLowerCase())) +
        '.';

  if (coverage.unclassified > 0) {
    const plural = coverage.unclassified === 1 ? '' : 's';
    sentence += ' ' + coverage.unclassified + ' off-plan change' + plural + ' carried no letter.';
  }

  return sentence;
}

const countByLetterLabel = (coverage: StepCoverage, letter: StepLetter): string =>
  coverage.countByLetter[letter] + ' ' + stepLabel(letter);

/** `a, b or c` - the same joining the corner and capability lines use. */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1];
}
