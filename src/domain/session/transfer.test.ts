import { describe, expect, it } from 'vitest';
import {
  describeAppearance,
  describeTransfer,
  hasEnoughForTransfer,
  phaseRole,
  phaseRoles,
  transferRecord,
  transferSubject,
  type TransferInput,
} from './transfer';
import { asPhaseId } from '../ids';
import type { PhaseKind } from '../methodology';

const OPENING_GAME = asPhaseId('00000000-0000-4000-8000-0000000000b0');
const PART = asPhaseId('00000000-0000-4000-8000-0000000000b1');
const GAME = asPhaseId('00000000-0000-4000-8000-0000000000b2');
const HUDDLE = asPhaseId('00000000-0000-4000-8000-0000000000b3');

const PHASES: TransferInput['phases'] = [
  { id: PART, kind: 'technical', order: 1 },
  { id: GAME, kind: 'game', order: 2 },
  { id: HUDDLE, kind: 'huddle', order: 3 },
];

/**
 * Everything the tests below tag, so that a test about ordering is not also a test about the
 * subject filter. The filter has its own describe block.
 */
const SUBJECT = [
  'Head up before you receive',
  'Went long',
  'Played short',
  'Scanning',
  'Zebra',
  'Apple',
  'Banana',
  'x',
];

const logged = (phaseId: typeof PART, ...tags: string[]) => ({ phaseId, tags });

const recordOf = (...observations: TransferInput['observations']) =>
  transferRecord({ phases: PHASES, subject: SUBJECT, observations });

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

describe('phaseRoles', () => {
  /** Whole-Part-Whole: play, find the problem, isolate it, play the same game again. */
  const wholePartWhole: TransferInput['phases'] = [
    { id: OPENING_GAME, kind: 'small_sided_game', order: 1 },
    { id: PART, kind: 'technical', order: 2 },
    { id: GAME, kind: 'small_sided_game', order: 3 },
  ];

  it('demotes the game that ran before the practice', () => {
    // The first WHOLE is where the problem was found. Counting it as a return would let the
    // report say a behaviour came back when it had only ever turned up on the way in.
    const roles = phaseRoles(wholePartWhole);

    expect(roles.get(OPENING_GAME)).toBe('neither');
    expect(roles.get(PART)).toBe('isolated');
    expect(roles.get(GAME)).toBe('game');
  });

  it('does not depend on the phases arriving in order', () => {
    const roles = phaseRoles([...wholePartWhole].reverse());
    expect(roles.get(OPENING_GAME)).toBe('neither');
    expect(roles.get(GAME)).toBe('game');
  });

  it('measures from the first isolated phase when a session isolates twice', () => {
    // A game between two practice blocks is a return from the first of them.
    const between = asPhaseId('00000000-0000-4000-8000-0000000000b4');
    const roles = phaseRoles([
      { id: PART, kind: 'technical', order: 1 },
      { id: between, kind: 'conditioned_game', order: 2 },
      { id: GAME, kind: 'skill_practice', order: 3 },
    ]);

    expect(roles.get(between)).toBe('game');
  });

  it('demotes every game when nothing was isolated', () => {
    const roles = phaseRoles([{ id: GAME, kind: 'game', order: 1 }]);
    expect(roles.get(GAME)).toBe('neither');
  });
});

describe('transferSubject', () => {
  const point = (text: string) => ({ text });

  it('takes the coaching points from every phase, not just the isolated one', () => {
    // The practice and the game carry different points, and the whole question is whether the
    // practice's point turns up while the coach is watching for the game's.
    const subject = transferSubject({
      objective: { commonMisconception: null, options: [] },
      phases: [{ coachingPoints: [point('Head up')] }, { coachingPoints: [point('Play forward')] }],
    });

    expect(subject).toEqual(['Head up', 'Play forward']);
  });

  it('includes the predicted mistake and the options the problem offers', () => {
    const subject = transferSubject({
      objective: { commonMisconception: 'Turns into the pressure', options: ['Go long', 'Switch'] },
      phases: [{ coachingPoints: [point('Head up')] }],
    });

    expect(subject).toEqual(['Head up', 'Turns into the pressure', 'Go long', 'Switch']);
  });

  it('dedupes case-insensitively, keeping the first wording for the report to quote', () => {
    const subject = transferSubject({
      objective: { commonMisconception: 'head up', options: ['HEAD UP'] },
      phases: [{ coachingPoints: [point('Head up')] }, { coachingPoints: [point('  Head up  ')] }],
    });

    expect(subject).toEqual(['Head up']);
  });

  it('is empty for a typed objective with no points, mistake or options', () => {
    const subject = transferSubject({
      objective: { commonMisconception: null, options: [] },
      phases: [{ coachingPoints: [] }],
    });

    expect(subject).toEqual([]);
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
    expect(
      transferRecord({ phases: PHASES, subject: SUBJECT, observations: [orphan] }).tags,
    ).toEqual([]);
  });

  it('counts only the tags the session named, not the generic bank', () => {
    // "Running with the ball" is a capability chip, one tap away in every session ever
    // planned. Counting it made the report answer a question nobody asked.
    const record = transferRecord({
      phases: PHASES,
      subject: ['Head up before you receive'],
      observations: [
        logged(PART, 'Head up before you receive', 'Running with the ball'),
        logged(GAME, 'Running with the ball'),
      ],
    });

    expect(record.tags).toEqual([{ tag: 'Head up before you receive', inPractice: 1, inGame: 0 }]);
  });

  it('matches a tag to the subject ignoring case, and reports the plan wording', () => {
    const record = transferRecord({
      phases: PHASES,
      subject: ['Head Up'],
      observations: [logged(PART, 'head up'), logged(GAME, 'HEAD UP')],
    });

    expect(record.tags).toEqual([{ tag: 'Head Up', inPractice: 1, inGame: 1 }]);
  });

  it('counts nothing when the session named nothing', () => {
    // A typed objective with no coaching points. There is no subject, so there is no report.
    const record = transferRecord({
      phases: PHASES,
      subject: [],
      observations: [logged(PART, 'Went long'), logged(GAME, 'Went long')],
    });

    expect(record.tags).toEqual([]);
    expect(hasEnoughForTransfer(record)).toBe(false);
  });

  it('does not count a game played before the practice', () => {
    // Whole-Part-Whole's first WHOLE. Its job is to find the problem, not to show it back.
    const record = transferRecord({
      phases: [
        { id: OPENING_GAME, kind: 'small_sided_game', order: 1 },
        { id: PART, kind: 'technical', order: 2 },
        { id: GAME, kind: 'small_sided_game', order: 3 },
      ],
      subject: SUBJECT,
      observations: [
        logged(OPENING_GAME, 'Went long'),
        logged(PART, 'Went long'),
        logged(GAME, 'Went long'),
      ],
    });

    expect(record.tags).toEqual([{ tag: 'Went long', inPractice: 1, inGame: 1 }]);
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
        { id: GAME, kind: 'game', order: 1 },
        { id: HUDDLE, kind: 'huddle', order: 2 },
      ],
      subject: SUBJECT,
      observations: [logged(GAME, 'Went long')],
    });
    expect(hasEnoughForTransfer(record)).toBe(false);
  });

  it('refuses a session that never got to a game', () => {
    const record = transferRecord({
      phases: [{ id: PART, kind: 'technical', order: 1 }],
      subject: SUBJECT,
      observations: [logged(PART, 'Went long')],
    });
    expect(hasEnoughForTransfer(record)).toBe(false);
  });

  it('refuses a session whose only game ran before the practice', () => {
    // There is a game in the record and a practice in the record, and still no return to
    // compare — so the report renders nothing rather than reading the diagnosis backwards.
    const record = transferRecord({
      phases: [
        { id: OPENING_GAME, kind: 'small_sided_game', order: 1 },
        { id: PART, kind: 'technical', order: 2 },
      ],
      subject: SUBJECT,
      observations: [logged(OPENING_GAME, 'Went long'), logged(PART, 'Went long')],
    });

    expect(record.hasGame).toBe(false);
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
