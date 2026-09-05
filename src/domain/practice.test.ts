import { describe, expect, it } from 'vitest';
import {
  AdjustmentDirectionSchema,
  describeStepCoverage,
  hasEnoughForStepView,
  MIN_ADJUSTMENTS_FOR_STEP_VIEW,
  PhaseConstraintSchema,
  STEP_LETTERS,
  stepCoverage,
  stepDescription,
  stepInitial,
  stepLabel,
  StepLetterSchema,
  type StepLetter,
  describeAdjustments,
  describePracticeArea,
  describeSessionShape,
  MAX_GROUP_SIZE,
  PRACTICE_SPECTRUM,
  PracticeAreaSchema,
  PracticeSpectrumSchema,
  practiceAreaM2,
  relativePlayingArea,
  spectrumDescription,
  spectrumLabel,
  spectrumRank,
  spectrumShortLabel,
  type PracticeSpectrum,
} from './practice';

describe('the FA practice spectrum', () => {
  it('is the FA four, in the FA order, least game-like first', () => {
    expect(PRACTICE_SPECTRUM).toEqual(['unopposed', 'interference', 'overloaded', 'matched_up']);
  });

  it('rejects anything that is not one of the four', () => {
    expect(PracticeSpectrumSchema.safeParse('overloaded').success).toBe(true);
    // No escape hatch on purpose: a `custom` value would destroy the ordering that
    // `describeSessionShape` is built on.
    expect(PracticeSpectrumSchema.safeParse('custom').success).toBe(false);
    expect(PracticeSpectrumSchema.safeParse('small_sided').success).toBe(false);
  });

  it('uses the FA wording for the long label', () => {
    expect(spectrumLabel('interference')).toBe('Unopposed with interference');
    expect(spectrumLabel('matched_up')).toBe('Matched-up');
  });

  it('labels and describes every one of them', () => {
    for (const spectrum of PRACTICE_SPECTRUM) {
      expect(spectrumLabel(spectrum).length).toBeGreaterThan(0);
      expect(spectrumShortLabel(spectrum).length).toBeGreaterThan(0);
      // A spectrum value a coach cannot be reminded of is one they will not use.
      expect(spectrumDescription(spectrum).length).toBeGreaterThan(20);
    }
  });

  it('ranks them in ascending game-likeness', () => {
    const ranks = PRACTICE_SPECTRUM.map(spectrumRank);
    expect(ranks).toEqual([0, 1, 2, 3]);
  });
});

describe('the practice area', () => {
  it('takes a grid a coach could actually pace out', () => {
    expect(PracticeAreaSchema.safeParse({ lengthM: 15, widthM: 15 }).success).toBe(true);
    expect(PracticeAreaSchema.safeParse({ lengthM: 100, widthM: 64 }).success).toBe(true);
  });

  it('catches a fat thumb rather than having an opinion about practice design', () => {
    expect(PracticeAreaSchema.safeParse({ lengthM: 155, widthM: 15 }).success).toBe(false);
    expect(PracticeAreaSchema.safeParse({ lengthM: 0, widthM: 15 }).success).toBe(false);
    expect(PracticeAreaSchema.safeParse({ lengthM: 15.5, widthM: 15 }).success).toBe(false);
  });

  it('multiplies out', () => {
    expect(practiceAreaM2({ lengthM: 15, widthM: 15 })).toBe(225);
  });
});

describe('relative playing area', () => {
  it('is area divided by players, and nothing else', () => {
    expect(relativePlayingArea({ lengthM: 30, widthM: 20 }, 8)).toBe(75);
  });

  it('returns the bare number with no band attached', () => {
    // The whole decision, pinned. The FA publishes no figures, and the literature disagrees
    // with itself by a factor of three (36 m²/player "small" in one study, 120 in another).
    // Any adjective here would be this app's invention wearing the FA's clothes.
    const result = relativePlayingArea({ lengthM: 15, widthM: 15 }, 6);
    expect(typeof result).toBe('number');
    expect(result).toBeCloseTo(37.5);
  });

  it('refuses to divide by a group that cannot exist', () => {
    expect(relativePlayingArea({ lengthM: 15, widthM: 15 }, 0)).toBeNull();
    expect(relativePlayingArea({ lengthM: 15, widthM: 15 }, -3)).toBeNull();
  });
});

describe('describePracticeArea', () => {
  it('reads the grid, the group and the m² back', () => {
    expect(describePracticeArea({ lengthM: 15, widthM: 15 }, 6)).toBe(
      '15 × 15 m for 6 players — 38 m² each.',
    );
  });

  it('says nothing at all without an area', () => {
    expect(describePracticeArea(null, 6)).toBeNull();
    expect(describePracticeArea(null, null)).toBeNull();
  });

  it('asks for the missing half rather than guessing it', () => {
    // The app cannot derive group size from anything it stores — `focusPlayerIds` is the
    // watch list, not the participants — so it says so instead of inventing a denominator.
    expect(describePracticeArea({ lengthM: 20, widthM: 20 }, null)).toBe(
      '20 × 20 m — set the group size for m² per player.',
    );
  });

  it('gets the singular right', () => {
    expect(describePracticeArea({ lengthM: 10, widthM: 10 }, 1)).toContain('for 1 player —');
  });

  it('never emits an adjective', () => {
    const banned = ['small', 'large', 'medium', 'tight', 'too ', 'should'];
    for (const groupSize of [1, 4, 8, MAX_GROUP_SIZE]) {
      const line = describePracticeArea({ lengthM: 40, widthM: 30 }, groupSize)!.toLowerCase();
      for (const word of banned) expect(line).not.toContain(word);
    }
  });
});

describe('describeSessionShape', () => {
  const shape = (...spectrums: PracticeSpectrum[]) => describeSessionShape(spectrums);

  it('says nothing about a single practice — one practice is not a shape', () => {
    expect(shape()).toBeNull();
    expect(shape('overloaded')).toBeNull();
  });

  it('names the path and the direction when it rises', () => {
    expect(shape('unopposed', 'overloaded', 'matched_up')).toBe(
      'Unopposed → overloaded → matched-up. The practice got more game-like as it went.',
    );
  });

  it('names the useful case: a session that ends further from the game than it started', () => {
    expect(shape('matched_up', 'unopposed')).toBe(
      'Matched-up → unopposed. The practice got less game-like as it went.',
    );
  });

  it('reports a dip and a return without calling it wrong', () => {
    // Play-Practice-Play and Whole-Part-Whole both do exactly this on purpose, so the app
    // has no standing to grade it — it describes the movement and stops.
    const line = shape('matched_up', 'overloaded', 'matched_up')!;
    expect(line).toContain('moved back and forth');
    expect(line).not.toMatch(/should|try|better|wrong/i);
  });

  it('notices when nothing changed', () => {
    expect(shape('matched_up', 'matched_up', 'matched_up')).toContain(
      'Every practice was the same distance from the game.',
    );
  });

  it('never prescribes, whatever the shape', () => {
    const all: PracticeSpectrum[] = [...PRACTICE_SPECTRUM];
    for (const a of all) {
      for (const b of all) {
        expect(shape(a, b)).not.toMatch(/should|ought|try to|needs? to|too much|too little/i);
      }
    }
  });
});

describe('progressions and regressions', () => {
  it('is two directions and no third', () => {
    expect(AdjustmentDirectionSchema.safeParse('progressed').success).toBe(true);
    expect(AdjustmentDirectionSchema.safeParse('regressed').success).toBe(true);
    // No 'held' / 'unchanged': not adjusting is the absence of an event, not an event.
    expect(AdjustmentDirectionSchema.safeParse('held').success).toBe(false);
  });
});

describe('describeAdjustments', () => {
  const summary = (over: Partial<Parameters<typeof describeAdjustments>[0]> = {}) =>
    describeAdjustments({
      total: 0,
      progressed: 0,
      regressed: 0,
      phasesAdjusted: 0,
      phasesWithAPlan: 0,
      plannedUnused: 0,
      ...over,
    });

  it('says nothing happened when nothing was planned either', () => {
    expect(summary()).toBe('No progressions or regressions written down, and none recorded.');
  });

  it('names the plan that went unused — the sentence that pairs with chainDepth', () => {
    expect(summary({ phasesWithAPlan: 2, plannedUnused: 3 })).toBe(
      'You wrote 3 ways to change the practice and used none of them.',
    );
  });

  it('gets the singular right on an unused plan', () => {
    expect(summary({ phasesWithAPlan: 1, plannedUnused: 1 })).toContain('1 way to change');
  });

  it('counts both directions', () => {
    expect(summary({ total: 3, progressed: 2, regressed: 1, phasesAdjusted: 2 })).toBe(
      'You made the practice harder 2 times and easier once, across 2 practices.',
    );
  });

  it('reads naturally for a single adjustment in a single phase', () => {
    expect(summary({ total: 1, progressed: 1, phasesAdjusted: 1 })).toBe(
      'You made the practice harder once, in one practice.',
    );
  });

  it('omits a direction that never happened', () => {
    const line = summary({ total: 2, regressed: 2, phasesAdjusted: 1 });
    expect(line).toContain('easier 2 times');
    expect(line).not.toContain('harder');
  });

  it('never sets a target or grades the count', () => {
    // A coach optimising for this number would be fiddling with a practice that was working.
    for (const total of [1, 4, 12]) {
      const line = summary({ total, progressed: total, phasesAdjusted: 2 });
      expect(line).not.toMatch(/should|too many|too few|enough|try to|aim for/i);
    }
  });
});

describe('STEP', () => {
  it('is the FA four, in the order that makes the mnemonic work', () => {
    expect(STEP_LETTERS).toEqual(['space', 'task', 'equipment', 'people']);
    expect(STEP_LETTERS.map(stepInitial).join('')).toBe('STEP');
  });

  it('uses the FA\u2019s P - People, not Players', () => {
    // The FA's own P covers the opposition and the keeper, not just the squad.
    expect(StepLetterSchema.safeParse('people').success).toBe(true);
    expect(StepLetterSchema.safeParse('players').success).toBe(false);
  });

  it('labels and describes every letter', () => {
    for (const letter of STEP_LETTERS) {
      expect(stepLabel(letter).length).toBeGreaterThan(0);
      // A letter a coach cannot be reminded of is one they will not use.
      expect(stepDescription(letter).length).toBeGreaterThan(20);
    }
  });
});

describe('a phase constraint', () => {
  it('takes a tapped letter and the coach\u2019s own words', () => {
    expect(
      PhaseConstraintSchema.safeParse({ letter: 'task', text: 'Two touches maximum' }).success,
    ).toBe(true);
  });

  it('refuses a letter outside the four, and refuses an empty condition', () => {
    expect(PhaseConstraintSchema.safeParse({ letter: 'tempo', text: 'Quicker' }).success).toBe(
      false,
    );
    expect(PhaseConstraintSchema.safeParse({ letter: 'task', text: '' }).success).toBe(false);
  });
});

describe('stepCoverage', () => {
  const of = (...steps: Array<StepLetter | null>) => stepCoverage(steps.map((step) => ({ step })));

  it('counts only what carried a letter', () => {
    const coverage = of('task', 'task', null, 'space');
    expect(coverage.total).toBe(4);
    expect(coverage.classified).toBe(3);
    expect(coverage.unclassified).toBe(1);
    expect(coverage.countByLetter).toEqual({ space: 1, task: 2, equipment: 0, people: 0 });
  });

  it('names the letters never touched', () => {
    expect(of('task', 'task').untouched).toEqual(['space', 'equipment', 'people']);
    expect(of('space', 'task', 'equipment', 'people').untouched).toEqual([]);
  });

  it('names a dominant letter only when it is more than half', () => {
    expect(of('task', 'task', 'space').dominant).toBe('task');
    // Exactly half is not a habit worth naming.
    expect(of('task', 'space').dominant).toBeNull();
  });

  it('stays quiet until there is enough to be worth saying', () => {
    expect(hasEnoughForStepView(of('task', 'task', 'task'))).toBe(false);
    expect(hasEnoughForStepView(of('task', 'task', 'task', 'task'))).toBe(true);
    expect(MIN_ADJUSTMENTS_FOR_STEP_VIEW).toBe(4);
  });

  it('counts only classified changes towards the threshold', () => {
    // Four off-plan taps are four changes and no evidence about which lever was pulled.
    expect(hasEnoughForStepView(of(null, null, null, null))).toBe(false);
  });
});

describe('describeStepCoverage', () => {
  const line = (...steps: Array<StepLetter | null>) =>
    describeStepCoverage(stepCoverage(steps.map((step) => ({ step }))));

  it('says nothing happened when nothing did', () => {
    expect(line()).toBe('No constraint changes recorded.');
  });

  it('owns the gap when every change was off-plan', () => {
    expect(line(null, null)).toBe(
      '2 changes to the practice, none of them against a constraint you had written down.',
    );
  });

  it('is the sentence a coach cannot get from inside the habit', () => {
    expect(line('task', 'task', 'task', 'space')).toBe(
      'You changed a constraint 4 times: 1 Space, 3 Task — nothing on equipment or people.',
    );
  });

  it('notices all four', () => {
    expect(line('space', 'task', 'equipment', 'people')).toContain('all four letters.');
  });

  it('reports off-plan changes rather than swallowing them', () => {
    // Same contract as `cornerBalance.unclassified`: an invisible gap is the gap this
    // whole feature exists to surface.
    expect(line('task', 'task', null)).toContain('1 off-plan change carried no letter.');
    expect(line('task', 'task', null, null)).toContain('2 off-plan changes carried no letter.');
  });

  it('never tells the coach to even it out', () => {
    // STEP is four places to look, not four boxes to tick.
    for (const steps of [
      ['task'],
      ['task', 'task', 'space'],
      ['space', 'people'],
    ] as StepLetter[][]) {
      expect(line(...steps)).not.toMatch(/should|try|balance|even|more of|too much/i);
    }
  });
});
