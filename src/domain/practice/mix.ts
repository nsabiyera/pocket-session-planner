import { PRACTICE_SPECTRUM, spectrumLabel, type PracticeSpectrum } from '../practice';

/**
 * **Practice mix over a term** — what kind of practice this coach actually runs.
 *
 * The sibling of `cornerBalance`, one level up: where that asks *what kind of player am I
 * developing*, this asks *what kind of session do I always run*. A coach whose last nine main
 * practices were all matched-up games is running one practice type and, from inside the habit,
 * cannot see it.
 *
 * ---
 *
 * **This module describes and never prescribes. That is not style; it is the evidence.**
 *
 * The reason a theorist would want a varied mix is the *contextual interference* effect —
 * the claim that varying practice hurts performance now and helps retention later. In sport
 * specifically that claim is contested: a 2023 systematic review and meta-analysis
 * ("The myth of contextual interference learning benefits in sports practice",
 * https://www.sciencedirect.com/science/article/abs/pii/S1747938X23000301) finds the benefit
 * does not reliably appear in applied sports settings.
 *
 * So the app has standing to show a coach their own pattern, and **no standing whatsoever to
 * tell them the pattern is wrong**. Every sentence here is a count. There is no target mix, no
 * evenness score, and no suggestion — deliberately unlike `cornerBalance`, whose four corners
 * the FA itself calls *equally important* and which therefore earns an evenness number that
 * this does not.
 */

export interface PracticeMix {
  readonly countBySpectrum: Record<PracticeSpectrum, number>;
  /** Every session considered, classified or not. */
  readonly total: number;
  /** Those whose main practice carried a spectrum. */
  readonly classified: number;
  /** Sessions planned before the field existed, or whose coach left it unset. */
  readonly unclassified: number;
  /** Spectrum values that never came up. Named, never recommended. */
  readonly missing: PracticeSpectrum[];
  /** A spectrum holding more than half of everything classified, if there is one. */
  readonly dominant: PracticeSpectrum | null;
}

const zeroCounts = (): Record<PracticeSpectrum, number> => ({
  unopposed: 0,
  interference: 0,
  overloaded: 0,
  matched_up: 0,
});

/** More than this share of one kind and the app says so out loud. */
export const DOMINANT_SPECTRUM_THRESHOLD = 0.5;

/**
 * Below this many classified sessions the report stays quiet.
 *
 * Six is about half a term. Higher than `MIN_OBSERVATIONS_FOR_BALANCE` in spirit, because the
 * unit here is a whole session rather than one note: three sessions is a fortnight, and "you
 * always run matched-up games" off a fortnight is how a coach learns to ignore the app.
 */
export const MIN_SESSIONS_FOR_MIX = 6;

/**
 * The mix, from the main practice of each session.
 *
 * **One phase per session, not every phase.** Counting all of them would be dominated by
 * warm-ups and would make every coach look unopposed-heavy; `mainPracticePhase` already
 * encodes what a coach means by *the* practice, so the unit stays comparable across sessions.
 *
 * Takes the spectrums rather than the sessions, so this stays a leaf that a term-scan can feed.
 */
export function practiceMix(spectrums: readonly (PracticeSpectrum | null)[]): PracticeMix {
  const countBySpectrum = zeroCounts();
  let classified = 0;

  for (const spectrum of spectrums) {
    if (spectrum === null) continue;
    countBySpectrum[spectrum] += 1;
    classified += 1;
  }

  return {
    countBySpectrum,
    total: spectrums.length,
    classified,
    unclassified: spectrums.length - classified,
    missing: PRACTICE_SPECTRUM.filter((spectrum) => countBySpectrum[spectrum] === 0),
    dominant:
      PRACTICE_SPECTRUM.find(
        (spectrum) =>
          classified > 0 && countBySpectrum[spectrum] / classified > DOMINANT_SPECTRUM_THRESHOLD,
      ) ?? null,
  };
}

export function hasEnoughForMix(mix: PracticeMix): boolean {
  return mix.classified >= MIN_SESSIONS_FOR_MIX;
}

/**
 * *"Nine of your last ten main practices were matched-up games."*
 *
 * Or, without a dominant kind, the plain tally. Both are counts of what the coach did, and
 * the sentence ends there — see the module note on why there is no advice attached.
 */
export function describePracticeMix(mix: PracticeMix): string {
  if (mix.classified === 0) {
    return mix.total === 0
      ? 'No sessions to look at yet.'
      : `${mix.total} recent session${mix.total === 1 ? '' : 's'}, none with a practice type recorded.`;
  }

  let sentence: string;

  if (mix.dominant) {
    const count = mix.countBySpectrum[mix.dominant];
    const kind = spectrumLabel(mix.dominant).toLowerCase();
    sentence =
      mix.classified === 1
        ? `Your last main practice was ${kind}.`
        : `${count} of your last ${mix.classified} main practices ${count === 1 ? 'was' : 'were'} ${kind}.`;
  } else {
    const parts = PRACTICE_SPECTRUM.filter((spectrum) => mix.countBySpectrum[spectrum] > 0).map(
      (spectrum) => `${mix.countBySpectrum[spectrum]} ${spectrumLabel(spectrum).toLowerCase()}`,
    );
    sentence = `Your last ${mix.classified} main practices: ${parts.join(', ')}.`;
  }

  // Name what has not come up — the same instinct as the neglected corner, and the same
  // stopping point. It is an observation about the term, not a gap to be filled.
  if (mix.missing.length > 0 && mix.missing.length < PRACTICE_SPECTRUM.length) {
    const names = mix.missing.map((spectrum) => spectrumLabel(spectrum).toLowerCase());
    sentence += ` Nothing ${listWords(names)}.`;
  }

  if (mix.unclassified > 0) {
    sentence += ` ${mix.unclassified} other ${mix.unclassified === 1 ? 'session has' : 'sessions have'} no practice type recorded.`;
  }

  return sentence;
}

/** `a, b or c` — the same joining the corner and capability lines use. */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}
