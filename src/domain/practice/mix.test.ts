import { describe, expect, it } from 'vitest';
import { describePracticeMix, hasEnoughForMix, MIN_SESSIONS_FOR_MIX, practiceMix } from './mix';
import { PRACTICE_SPECTRUM, type PracticeSpectrum } from '../practice';

const mix = (...spectrums: Array<PracticeSpectrum | null>) => practiceMix(spectrums);
const line = (...spectrums: Array<PracticeSpectrum | null>) =>
  describePracticeMix(practiceMix(spectrums));

const repeat = (spectrum: PracticeSpectrum | null, times: number) =>
  Array.from({ length: times }, () => spectrum);

describe('practiceMix', () => {
  it('counts only sessions whose main practice carried a spectrum', () => {
    const result = mix('matched_up', 'matched_up', null, 'overloaded');
    expect(result.total).toBe(4);
    expect(result.classified).toBe(3);
    expect(result.unclassified).toBe(1);
    expect(result.countBySpectrum).toEqual({
      unopposed: 0,
      interference: 0,
      overloaded: 1,
      matched_up: 2,
    });
  });

  it('keeps unclassified sessions in the total rather than dropping them', () => {
    // Dropping them would make a coach with two classified sessions look like a coach with
    // a habit. The report has to be able to say how much of the term it could not see.
    expect(mix(null, null, null).total).toBe(3);
    expect(mix(null, null, null).classified).toBe(0);
  });

  it('names what never came up', () => {
    expect(mix('matched_up', 'overloaded').missing).toEqual(['unopposed', 'interference']);
    expect(mix(...PRACTICE_SPECTRUM).missing).toEqual([]);
  });

  it('names a dominant kind only when it is more than half', () => {
    expect(mix('matched_up', 'matched_up', 'overloaded').dominant).toBe('matched_up');
    // Exactly half is not a habit.
    expect(mix('matched_up', 'overloaded').dominant).toBeNull();
  });

  it('stays quiet for less than half a term', () => {
    expect(hasEnoughForMix(mix(...repeat('matched_up', MIN_SESSIONS_FOR_MIX - 1)))).toBe(false);
    expect(hasEnoughForMix(mix(...repeat('matched_up', MIN_SESSIONS_FOR_MIX)))).toBe(true);
    expect(MIN_SESSIONS_FOR_MIX).toBe(6);
  });

  it('counts only classified sessions towards the threshold', () => {
    expect(hasEnoughForMix(mix(...repeat(null, 10)))).toBe(false);
  });

  it('has no evenness score, unlike corner balance', () => {
    // Deliberate. The FA calls the four corners equally important, so an evenness number
    // there means something. Nobody says the four practice types should be even.
    expect(mix('matched_up')).not.toHaveProperty('evenness');
  });
});

describe('describePracticeMix', () => {
  it('is the roadmap sentence, verbatim', () => {
    expect(line(...repeat('matched_up', 9), 'overloaded')).toBe(
      '9 of your last 10 main practices were matched-up. Nothing unopposed or unopposed with interference.',
    );
  });

  it('falls back to the plain tally with no dominant kind', () => {
    expect(line('matched_up', 'matched_up', 'overloaded', 'overloaded')).toContain(
      'Your last 4 main practices: 2 overloaded, 2 matched-up.',
    );
  });

  it('says so when it can see nothing', () => {
    expect(line()).toBe('No sessions to look at yet.');
    expect(line(null, null)).toBe('2 recent sessions, none with a practice type recorded.');
  });

  it('reports the sessions it could not classify rather than hiding them', () => {
    // Same contract as `cornerBalance.unclassified`.
    expect(line('matched_up', 'matched_up', 'matched_up', null)).toContain(
      '1 other session has no practice type recorded.',
    );
    expect(line('matched_up', 'matched_up', 'matched_up', null, null)).toContain(
      '2 other sessions have no practice type recorded.',
    );
  });

  it('says nothing about what is missing when everything came up', () => {
    const result = line(...PRACTICE_SPECTRUM, ...PRACTICE_SPECTRUM);
    expect(result).not.toContain('Nothing');
  });

  it('never prescribes, whatever the mix', () => {
    // The whole point of the phase. The contextual-interference benefit is contested in
    // sport, so the app has standing to show the pattern and none to grade it.
    const banned =
      /should|try|ought|vary|mix it up|too many|too few|balance|even|more of|less of|consider/i;

    for (const spectrum of PRACTICE_SPECTRUM) {
      expect(line(...repeat(spectrum, 10))).not.toMatch(banned);
      expect(line(...repeat(spectrum, 8), null, null)).not.toMatch(banned);
    }
    expect(line('matched_up', 'overloaded', 'unopposed', 'interference')).not.toMatch(banned);
  });

  it('reads as English for a single session', () => {
    // Gated out by `hasEnoughForMix` in practice, but "your last 1 main practices" is the
    // kind of sentence that escapes into a screenshot.
    expect(line('matched_up')).toContain('Your last main practice was matched-up.');
  });
});
