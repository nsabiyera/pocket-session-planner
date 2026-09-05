import { describe, expect, it } from 'vitest';
import {
  AGE_BANDS,
  ageBandOf,
  describeRepresentativeness,
  matchReference,
  matchRelativeArea,
  REFLECTION_PROMPTS,
  type AgeBand,
} from './match';

describe('the FA match reference', () => {
  it('covers every band it claims to', () => {
    for (const band of AGE_BANDS) {
      const reference = matchReference(band);
      expect(reference.players).toBeGreaterThan(0);
      expect(reference.area.lengthM).toBeGreaterThan(reference.area.widthM);
    }
  });

  it('matches the FA guide once yards are converted to metres', () => {
    // The cross-check that makes this table shippable at all: two FA publications, one in
    // yards and one in metres, agreeing on the pitch for each format. 1 yard = 0.9144 m.
    const yardsToM = (yards: number) => Math.round(yards * 0.9144);

    // 5v5 - FA guide 40 x 30 yards.
    expect(matchReference('u9').area).toEqual({ lengthM: yardsToM(40), widthM: yardsToM(30) });
    // 7v7 - FA guide 60 x 40 yards.
    expect(matchReference('u11').area).toEqual({ lengthM: yardsToM(60), widthM: yardsToM(40) });
    // 9v9 - FA guide 80 x 50 yards.
    expect(matchReference('u13').area).toEqual({ lengthM: yardsToM(80), widthM: yardsToM(50) });
    // 11v11 at U14 - FA guide 90 x 55 yards.
    expect(matchReference('u14').area).toEqual({ lengthM: yardsToM(90), widthM: yardsToM(55) });
  });

  it('counts both teams and both keepers, like a training grid counts everyone in it', () => {
    expect(matchReference('u9').players).toBe(10);
    expect(matchReference('u13').players).toBe(18);
    expect(matchReference('u16').players).toBe(22);
  });

  it('computes a match m² per player a coach could check by hand', () => {
    // 73 x 46 = 3358 m2, over 18 players.
    expect(Math.round(matchRelativeArea('u12'))).toBe(187);
    expect(Math.round(matchRelativeArea('u9'))).toBe(100);
  });
});

describe('ageBandOf', () => {
  it('reads the forms a coach actually types', () => {
    expect(ageBandOf('U12')).toBe('u12');
    expect(ageBandOf('u12')).toBe('u12');
    expect(ageBandOf(' U 12 ')).toBe('u12');
    expect(ageBandOf('Under 12')).toBe('u12');
    expect(ageBandOf('U7')).toBe('u7');
    // The plural everyone writes.
    expect(ageBandOf('U12s')).toBe('u12');
    expect(ageBandOf('Under 12s')).toBe('u12');
  });

  it('refuses to guess from a squad name', () => {
    // "U12 Reds" is a name, not an age group. Reading an age out of it would be exactly the
    // prose-parsing ADR 0004 rejected, and a wrong band means a wrong match comparison.
    expect(ageBandOf('U12 Reds')).toBeNull();
    expect(ageBandOf('Reds')).toBeNull();
    expect(ageBandOf('')).toBeNull();
    expect(ageBandOf(undefined)).toBeNull();
  });

  it('refuses ages the FA table does not cover', () => {
    expect(ageBandOf('U6')).toBeNull();
    expect(ageBandOf('U21')).toBeNull();
    expect(ageBandOf('U17')).toBeNull();
  });
});

describe('describeRepresentativeness', () => {
  const of = (
    spectrum: Parameters<typeof describeRepresentativeness>[0]['spectrum'],
    practiceArea: number | null,
    band: AgeBand | null,
  ) => describeRepresentativeness({ spectrum, practiceArea, band });

  it('puts the practice and the match side by side', () => {
    expect(of('overloaded', 37.5, 'u12')).toBe(
      'You finished on an overloaded practice at 38 m² a player. ' +
        'A U12 match is 9v9 on a recommended 73 × 46 m — about 187 m² a player.',
    );
  });

  it('prints the format it assumed, so a different league can spot the mismatch', () => {
    // The soft half of the data. Two FA sources disagree on which age plays which format,
    // so the assumption is shown rather than hidden.
    expect(of('matched_up', 100, 'u11')).toContain('7v7');
    expect(of('matched_up', 100, 'u13')).toContain('9v9');
  });

  it('says "recommended", so the number is not read as the only legal pitch', () => {
    expect(of('matched_up', 100, 'u12')).toContain('recommended');
  });

  it('owns the limit when it cannot read the age group', () => {
    const line = of('overloaded', 37.5, null)!;
    expect(line).toContain('38 m² a player');
    expect(line).toContain('Set the squad’s age group');
  });

  it('still speaks with a spectrum and no area', () => {
    expect(of('unopposed', null, null)).toBe('You finished on an unopposed practice.');
  });

  it('says nothing when it has nothing', () => {
    expect(of(null, null, null)).toBeNull();
    expect(of(null, null, 'u12')).toBeNull();
  });

  it('gets the article right', () => {
    expect(of('unopposed', null, null)).toContain('on an unopposed');
    expect(of('overloaded', null, null)).toContain('on an overloaded');
    expect(of('matched_up', null, null)).toContain('on a matched-up');
    expect(of('interference', null, null)).toContain('on an unopposed with interference');
  });

  it('never grades the comparison', () => {
    // The FA poses this as a question for the coach. A practice that deliberately ends tight
    // is a legitimate choice, and the app has no standing to call it wrong.
    const banned = /too |should|not enough|should be|better|worse|poor|ideal|target|aim/i;
    for (const band of AGE_BANDS) {
      for (const area of [5, 40, 200, 500]) {
        expect(of('matched_up', area, band)).not.toMatch(banned);
        expect(of('unopposed', area, band)).not.toMatch(banned);
      }
    }
  });
});

describe('the reflection prompt', () => {
  it('is the FA three, as questions rather than scores', () => {
    expect(REFLECTION_PROMPTS.map((p) => p.word)).toEqual(['Realism', 'Relevance', 'Repetition']);
    for (const prompt of REFLECTION_PROMPTS) {
      expect(prompt.question.endsWith('?')).toBe(true);
    }
  });

  it('asks nothing the app could have answered itself', () => {
    // If a prompt were countable the app should count it, not ask.
    for (const prompt of REFLECTION_PROMPTS) {
      expect(prompt.question).not.toMatch(/how many|how often did you|count/i);
    }
  });
});
