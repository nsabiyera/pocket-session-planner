import { describe, expect, it } from 'vitest';
import {
  GameModelSchema,
  MOMENTS,
  MOMENT_FORMAL_LABELS,
  MOMENT_LABELS,
  PRINCIPLE_LEVELS,
  PRINCIPLE_LEVEL_LABELS,
  childrenOf,
  describeGameModel,
  macroPrinciples,
  momentsWithoutPrinciples,
  parentLevelOf,
  principlesForMoment,
  type GameModelInput,
  type PrincipleInput,
} from './game-model';
import { CURRENT_SCHEMA_VERSION } from './primitives';
import { asPrincipleId } from './ids';
import { SQUAD_ID, T0, testId } from '@/test/builders';

const principle = (over: Partial<PrincipleInput> & { id: string }): PrincipleInput => ({
  moment: 'offensive_organisation',
  level: 'macro',
  parentId: null,
  text: 'Build from the back',
  ...over,
  id: testId(over.id),
});

const model = (over: Partial<GameModelInput> = {}) =>
  GameModelSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: T0,
    updatedAt: T0,
    id: testId('gm01'),
    squadId: SQUAD_ID,
    identity: 'We build from the back and attack through the middle',
    principles: [],
    ...over,
  });

describe('the four moments', () => {
  it('are ordered as the game cycles, not alphabetically', () => {
    // A coach reads this as a loop: we have it, we lose it, we defend, we win it back.
    expect(MOMENTS).toEqual([
      'offensive_organisation',
      'transition_to_defence',
      'defensive_organisation',
      'transition_to_attack',
    ]);
  });

  it('carry both a plain and a formal label for every moment', () => {
    // The audience spans a coach who says "when we lose it" and one who says "defensive
    // transition". Neither should have to translate.
    for (const moment of MOMENTS) {
      expect(MOMENT_LABELS[moment]).toBeTruthy();
      expect(MOMENT_FORMAL_LABELS[moment]).toBeTruthy();
    }
  });
});

describe('the levels', () => {
  it('run coarsest to finest', () => {
    expect(PRINCIPLE_LEVELS).toEqual(['macro', 'meso', 'micro', 'sub']);
  });

  it('names the level each one hangs from, and nothing above macro', () => {
    expect(parentLevelOf('macro')).toBeNull();
    expect(parentLevelOf('meso')).toBe('macro');
    expect(parentLevelOf('micro')).toBe('meso');
    expect(parentLevelOf('sub')).toBe('micro');
  });

  it('labels every level', () => {
    for (const level of PRINCIPLE_LEVELS) expect(PRINCIPLE_LEVEL_LABELS[level]).toBeTruthy();
  });
});

describe('the tree rule', () => {
  /**
   * The load-bearing tests of this module, and the one part of the methodology the app can
   * enforce rather than merely record. The sources put it as a fractal: a micro-principle
   * detached from its macro is a leaf off a tree — it still looks like a leaf, and it is no
   * longer alive.
   */
  it('accepts a coherent chain from macro to sub', () => {
    const built = model({
      principles: [
        principle({ id: 'p1', level: 'macro' }),
        principle({ id: 'p2', level: 'meso', parentId: testId('p1'), text: 'Through the pivot' }),
        principle({ id: 'p3', level: 'micro', parentId: testId('p2'), text: 'Pivot drops in' }),
        principle({ id: 'p4', level: 'sub', parentId: testId('p3'), text: 'Open body shape' }),
      ],
    });
    expect(built.principles).toHaveLength(4);
  });

  it('refuses a macro that hangs off something', () => {
    expect(() =>
      model({
        principles: [
          principle({ id: 'p1' }),
          principle({ id: 'p2', level: 'macro', parentId: testId('p1') }),
        ],
      }),
    ).toThrow(/cannot hang off/i);
  });

  it('refuses a meso with no parent — the leaf off the tree', () => {
    expect(() => model({ principles: [principle({ id: 'p1', level: 'meso' })] })).toThrow(
      /needs a macro/i,
    );
  });

  it('refuses a parent that is not there', () => {
    expect(() =>
      model({ principles: [principle({ id: 'p1', level: 'meso', parentId: testId('ghost') })] }),
    ).toThrow(/parent principle is missing/i);
  });

  it('refuses a level skip — a micro hanging straight off a macro', () => {
    expect(() =>
      model({
        principles: [
          principle({ id: 'p1', level: 'macro' }),
          principle({ id: 'p2', level: 'micro', parentId: testId('p1') }),
        ],
      }),
    ).toThrow(/must hang off a meso/i);
  });

  it('refuses a principle in a different moment from its parent', () => {
    // The detail no longer describes the thing above it, which is exactly the incoherence
    // the fractal analogy warns about.
    expect(() =>
      model({
        principles: [
          principle({ id: 'p1', level: 'macro', moment: 'offensive_organisation' }),
          principle({
            id: 'p2',
            level: 'meso',
            parentId: testId('p1'),
            moment: 'defensive_organisation',
          }),
        ],
      }),
    ).toThrow(/same moment as its parent/i);
  });

  it('refuses duplicate principle ids', () => {
    expect(() => model({ principles: [principle({ id: 'p1' }), principle({ id: 'p1' })] })).toThrow(
      /unique/i,
    );
  });
});

describe('reading a model', () => {
  const populated = () =>
    model({
      principles: [
        principle({ id: 'p1', level: 'macro' }),
        principle({ id: 'p2', level: 'meso', parentId: testId('p1'), text: 'Through the pivot' }),
        principle({
          id: 'p3',
          level: 'macro',
          moment: 'defensive_organisation',
          text: 'Press high',
        }),
      ],
    });

  it('lists a moment’s principles coarsest first', () => {
    const found = principlesForMoment(populated(), 'offensive_organisation');
    expect(found.map((p) => p.level)).toEqual(['macro', 'meso']);
  });

  it('lists the children hanging directly off a principle', () => {
    expect(childrenOf(populated(), asPrincipleId(testId('p1'))).map((p) => p.text)).toEqual([
      'Through the pivot',
    ]);
  });

  it('lists the macro principles a coach reads first', () => {
    expect(macroPrinciples(populated(), 'defensive_organisation').map((p) => p.text)).toEqual([
      'Press high',
    ]);
  });
});

describe('the holes in a model', () => {
  /**
   * The most useful thing the app can say about a coach's own model, and the reason to hold it
   * as data at all: a model that says a great deal about being in possession and nothing about
   * losing the ball has a hole in it, and that is invisible in a document.
   */
  it('names every moment with nothing said about it', () => {
    const built = model({ principles: [principle({ id: 'p1' })] });
    expect(momentsWithoutPrinciples(built)).toEqual([
      'transition_to_defence',
      'defensive_organisation',
      'transition_to_attack',
    ]);
  });

  it('names none once all four are covered', () => {
    const built = model({
      principles: MOMENTS.map((moment, index) =>
        principle({ id: `p${index}`, moment, text: `Something about ${moment}` }),
      ),
    });
    expect(momentsWithoutPrinciples(built)).toEqual([]);
  });
});

describe('describeGameModel', () => {
  it('says where to start when there is nothing yet', () => {
    expect(describeGameModel(model())).toBe('No principles yet. Start with one line per moment.');
  });

  it('counts, and names the gaps', () => {
    const built = model({ principles: [principle({ id: 'p1' })] });
    expect(describeGameModel(built)).toBe(
      '1 principle across 1 moment. Nothing yet on when we lose it, out of possession or when we win it.',
    );
  });

  it('says so when all four are covered', () => {
    const built = model({
      principles: MOMENTS.map((moment, index) =>
        principle({ id: `p${index}`, moment, text: `Something about ${moment}` }),
      ),
    });
    expect(describeGameModel(built)).toBe(
      '4 principles across 4 moments. All four moments covered.',
    );
  });

  it('prescribes no number of principles', () => {
    // No source says how many a model should have, and inventing one would be the app
    // pretending to know. It counts and names the gap; it does not set a target.
    const built = model({ principles: [principle({ id: 'p1' })] });
    expect(describeGameModel(built)).not.toMatch(/should|need|too few|at least/i);
  });
});

describe('the identity line', () => {
  it('is required, because a model without one says nothing', () => {
    expect(() => model({ identity: '' })).toThrow();
  });

  it('is enough on its own — principles can come later', () => {
    expect(model({ identity: 'We press high and play forward', principles: [] })).toBeTruthy();
  });
});
