import { describe, expect, it } from 'vitest';
import {
  describeAppearance,
  describeTransfer,
  hasEnoughForTransfer,
  phaseRole,
  transferRecord,
  type TransferInput,
} from './transfer';
import { asPhaseId } from '../ids';
import type { PhaseKind } from '../methodology';

const PART = asPhaseId('00000000-0000-4000-8000-0000000000b1');
const GAME = asPhaseId('00000000-0000-4000-8000-0000000000b2');
const HUDDLE = asPhaseId('00000000-0000-4000-8000-0000000000b3');

const PHASES: TransferInput['phases'] = [
  { id: PART, kind: 'technical' },
  { id: GAME, kind: 'game' },
  { id: HUDDLE, kind: 'huddle' },
];

const logged = (phaseId: typeof PART, ...tags: string[]) => ({ phaseId, tags });

const recordOf = (...observations: TransferInput['observations']) =>
  transferRecord({ phases: PHASES, observations });

describe('phaseRole', () => {
  it('reads the two isolating kinds as the practice', () => {
    expect(phaseRole('technical')).toBe('isolated');
    expect(phaseRole('skill_practice')).toBe('isolated');
  });

  it('reads every game form as a game, phase of play included', () => {
    // Opposed, directional, with a goal to attack. Not a whole game, but a game form.
    for (const kind of ['phase_of_play', 'small_sided_game', 'conditioned_game', 'game'] as const) {
      expect(phaseRole(kind), kind).toBe('game');
    }
  });

  it('reads everything else as neither, custom included', () => {
    // A coach's own phase kind could be anything, and guessing would file half the report
    // under an assumption.
    for (const kind of [
      'arrival',
      'warm_up',
      'huddle',
      'player_review',
      'water_break',
      'custom',
    ] as PhaseKind[]) {
      expect(phaseRole(kind), kind).toBe('neither');
    }
  });
});

describe('transferRecord', () => {
  it('counts a tag on both sides of the isolated block', () => {
    const record = recordOf(
      logged(PART, 'Head up before you receive'),
      logged(PART, 'Head up before you receive'),
      logged(GAME, 'Head up before you receive'),
    );

    expect(record.tags).toEqual([{ tag: 'Head up before you receive', inPractice: 2, inGame: 1 }]);
    expect(record.hasIsolatedPractice).toBe(true);
    expect(record.hasGame).toBe(true);
  });

  it('ignores observations logged where neither question applies', () => {
    // A note in the huddle is a real observation about something else entirely.
    const record = recordOf(logged(HUDDLE, 'Head up before you receive'));
    expect(record.tags).toEqual([]);
  });

  it('ignores an observation against a phase this session does not have', () => {
    const orphan = { phaseId: asPhaseId('00000000-0000-4000-8000-0000000000ff'), tags: ['x'] };
    expect(transferRecord({ phases: PHASES, observations: [orphan] }).tags).toEqual([]);
  });

  it('orders by how much was logged, then alphabetically for a stable render', () => {
    const record = recordOf(
      logged(PART, 'Zebra'),
      logged(GAME, 'Zebra'),
      logged(PART, 'Apple'),
      logged(GAME, 'Banana'),
    );

    expect(record.tags.map((tag) => tag.tag)).toEqual(['Zebra', 'Apple', 'Banana']);
  });

  it('trims and keeps the coach own wording, without merging different tags', () => {
    const record = recordOf(logged(PART, '  Went long  '), logged(GAME, 'Went long'));
    expect(record.tags).toEqual([{ tag: 'Went long', inPractice: 1, inGame: 1 }]);
  });

  it('counts one observation once per tag it carries', () => {
    const record = recordOf(logged(PART, 'Went long', 'Scanning'));
    expect(record.tags).toEqual([
      { tag: 'Scanning', inPractice: 1, inGame: 0 },
      { tag: 'Went long', inPractice: 1, inGame: 0 },
    ]);
  });
});

describe('hasEnoughForTransfer', () => {
  it('needs a shape rather than a sample — one observation is enough', () => {
    expect(hasEnoughForTransfer(recordOf(logged(PART, 'Went long')))).toBe(true);
  });

  it('refuses a session with no isolated practice', () => {
    // Most sessions. Play-Practice-Play's PRACTICE is a skill practice, but a coach running
    // two games and a warm-up has isolated nothing, so there is nothing to compare.
    const record = transferRecord({
      phases: [
        { id: GAME, kind: 'game' },
        { id: HUDDLE, kind: 'huddle' },
      ],
      observations: [logged(GAME, 'Went long')],
    });
    expect(hasEnoughForTransfer(record)).toBe(false);
  });

  it('refuses a session that never got to a game', () => {
    const record = transferRecord({
      phases: [{ id: PART, kind: 'technical' }],
      observations: [logged(PART, 'Went long')],
    });
    expect(hasEnoughForTransfer(record)).toBe(false);
  });

  it('refuses a session where nothing was tagged in either', () => {
    expect(hasEnoughForTransfer(recordOf(logged(PART)))).toBe(false);
    expect(hasEnoughForTransfer(recordOf())).toBe(false);
  });
});

describe('describeTransfer', () => {
  it('counts what was logged in the practice, and how much of it came back', () => {
    const record = recordOf(
      logged(PART, 'Went long'),
      logged(PART, 'Played short'),
      logged(GAME, 'Went long'),
    );
    expect(describeTransfer(record)).toBe(
      '2 things logged in the practice, 1 of them logged in a game as well.',
    );
  });

  it('names the things that only turned up in the game', () => {
    // The case a drill-first session never produces, and the one worth seeing.
    const record = recordOf(logged(PART, 'Went long'), logged(GAME, 'Played short'));
    expect(describeTransfer(record)).toBe(
      '1 thing logged in the practice, and nothing logged in a game. ' +
        '1 other thing turned up only in a game.',
    );
  });

  it('reads as English in the singular, and when none of it came back', () => {
    // "0 of them" and "1 of them" both read as though a machine wrote them, and this is the
    // sentence a coach judges the feature by.
    const one = recordOf(logged(PART, 'Went long'), logged(GAME, 'Went long'));
    expect(describeTransfer(one)).toBe(
      '1 thing logged in the practice, and it was logged in a game as well.',
    );

    const none = recordOf(logged(PART, 'Went long'), logged(PART, 'Played short'));
    expect(describeTransfer(none)).toBe(
      '2 things logged in the practice, none of them logged in a game.',
    );
  });

  it('says so plainly when the practice was not tagged at all', () => {
    const record = recordOf(logged(GAME, 'Went long'), logged(GAME, 'Played short'));
    expect(describeTransfer(record)).toBe(
      'Nothing logged in the practice. 2 things logged in a game.',
    );
  });
});

describe('describeAppearance', () => {
  it('reads as a record on both sides', () => {
    expect(describeAppearance({ tag: 'Head up', inPractice: 2, inGame: 1 })).toBe(
      '“Head up” — logged twice in the practice and once in a game.',
    );
  });

  it('says nothing was logged in a game, never that it did not transfer', () => {
    // A coach coaching a point is a coach not logging. ADR 0009 phase 3's wording rule.
    expect(describeAppearance({ tag: 'Head up', inPractice: 3, inGame: 0 })).toBe(
      '“Head up” — logged 3 times in the practice, and nothing in a game.',
    );
  });

  it('handles the game-only case from the other end', () => {
    expect(describeAppearance({ tag: 'Went long', inPractice: 0, inGame: 1 })).toBe(
      '“Went long” — logged once in a game, and nothing in the practice.',
    );
  });

  it('never claims transfer, learning or improvement in any wording it can produce', () => {
    const sentences = [
      describeAppearance({ tag: 'x', inPractice: 2, inGame: 1 }),
      describeAppearance({ tag: 'x', inPractice: 2, inGame: 0 }),
      describeAppearance({ tag: 'x', inPractice: 0, inGame: 2 }),
      describeTransfer(recordOf(logged(PART, 'x'), logged(GAME, 'x'))),
      describeTransfer(recordOf(logged(GAME, 'x'))),
    ];

    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/transfer|stuck|learn|understood|improv|worked|failed/i);
    }
  });
});
