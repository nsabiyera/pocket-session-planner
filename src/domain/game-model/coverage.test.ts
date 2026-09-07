import { describe, expect, it } from 'vitest';
import {
  MIN_SESSIONS_FOR_COVERAGE,
  coverageOf,
  describeCoverage,
  hasEnoughForCoverage,
  levelOfPrinciple,
  momentsNotTrainedSince,
  untrainedPrinciples,
  type TrainedSession,
} from './coverage';
import { GameModelSchema, type GameModelInput, type PrincipleInput } from '../game-model';
import { asPrincipleId } from '../ids';
import { CURRENT_SCHEMA_VERSION } from '../primitives';
import { SQUAD_ID, T0, testId } from '@/test/builders';

const principle = (over: Partial<PrincipleInput> & { id: string }): PrincipleInput => ({
  moment: 'offensive_organisation',
  level: 'macro',
  parentId: null,
  text: over.id,
  ...over,
  id: testId(over.id),
});

/** A model with one macro in each of three moments, and a meso under the first. */
const model = (over: Partial<GameModelInput> = {}) =>
  GameModelSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: T0,
    updatedAt: T0,
    id: testId('gm01'),
    squadId: SQUAD_ID,
    identity: 'We build from the back',
    principles: [
      principle({ id: 'build', text: 'Build from the back' }),
      principle({
        id: 'pivot',
        level: 'meso',
        parentId: testId('build'),
        text: 'Through the pivot',
      }),
      principle({ id: 'press', moment: 'defensive_organisation', text: 'Press high' }),
      principle({ id: 'counter', moment: 'transition_to_attack', text: 'Counter fast' }),
    ],
    ...over,
  });

const session = (
  principleId: string | null,
  scheduledFor = '2026-09-01T18:00:00.000Z',
): TrainedSession => ({
  objective: {
    principleId: principleId === null ? null : asPrincipleId(testId(principleId)),
    text: 'x',
  },
  scheduledFor,
});

describe('coverageOf', () => {
  it('counts the sessions that trained each principle', () => {
    const report = coverageOf(model(), [session('build'), session('build'), session('press')]);
    const byText = new Map(
      report.principles.map((entry) => [entry.principle.text, entry.sessions]),
    );

    expect(byText.get('Build from the back')).toBe(2);
    expect(byText.get('Press high')).toBe(1);
    expect(byText.get('Through the pivot')).toBe(0);
  });

  /**
   * The ordering is the feature, the same way it is in the minutes report: a coach opens this
   * to find what they have *not* worked on, so the untouched principles collect at the bottom
   * where the gap is obvious rather than being scattered through the list.
   */
  it('puts the most-trained first and the untouched last', () => {
    const report = coverageOf(model(), [session('press'), session('press'), session('build')]);
    expect(report.principles[0]?.principle.text).toBe('Press high');
    expect(report.principles[report.principles.length - 1]?.sessions).toBe(0);
  });

  it('records when a principle was last trained', () => {
    const report = coverageOf(model(), [
      session('build', '2026-08-01T18:00:00.000Z'),
      session('build', '2026-09-05T18:00:00.000Z'),
    ]);
    const build = report.principles.find((entry) => entry.principle.text === 'Build from the back');
    expect(build?.lastTrainedAt).toBe('2026-09-05T18:00:00.000Z');
  });

  it('rolls principles up into their moment', () => {
    const report = coverageOf(model(), [session('build'), session('pivot'), session('press')]);
    const byMoment = new Map(report.moments.map((entry) => [entry.moment, entry.sessions]));

    // Two principles in offensive organisation, one session each.
    expect(byMoment.get('offensive_organisation')).toBe(2);
    expect(byMoment.get('defensive_organisation')).toBe(1);
    expect(byMoment.get('transition_to_defence')).toBe(0);
  });

  it('counts a session with no principle as unlinked, not as nothing', () => {
    // The normal state before a coach authors a model, and it must not read as neglect.
    const report = coverageOf(model(), [session(null), session(null), session('build')]);
    expect(report.unlinkedSessions).toBe(2);
    expect(report.totalSessions).toBe(3);
  });

  /**
   * A coach who reworks their game model in January leaves November's sessions pointing at
   * principles that no longer exist. Rewriting that history would be worse than reporting it —
   * see the note on `Objective.principleId`.
   */
  it('counts a session naming a principle the model no longer has, without losing it', () => {
    const report = coverageOf(model(), [session('build'), session('deleted-one')]);
    expect(report.orphanedSessions).toBe(1);
    expect(report.totalSessions).toBe(2);
  });

  it('lists every principle even with no sessions at all', () => {
    const report = coverageOf(model(), []);
    expect(report.principles).toHaveLength(4);
    expect(report.principles.every((entry) => entry.sessions === 0)).toBe(true);
  });
});

describe('the gaps', () => {
  it('names the principles never worked on', () => {
    const report = coverageOf(model(), [session('build')]);
    expect(
      untrainedPrinciples(report)
        .map((p) => p.text)
        .sort(),
    ).toEqual(['Counter fast', 'Press high', 'Through the pivot']);
  });

  /**
   * The seed of the horizontal-alternation report: the method's whole claim about a week is
   * that the moments are distributed rather than one of them hammered.
   */
  it('names moments not trained since a cutoff, including never', () => {
    const report = coverageOf(model(), [
      session('build', '2026-09-05T18:00:00.000Z'),
      session('press', '2026-07-01T18:00:00.000Z'),
    ]);

    const stale = momentsNotTrainedSince(report, '2026-08-01T00:00:00.000Z');
    expect(stale).toContain('defensive_organisation'); // July, before the cutoff
    expect(stale).toContain('transition_to_defence'); // never
    expect(stale).not.toContain('offensive_organisation'); // September
  });
});

describe('having enough to say anything', () => {
  it('stays quiet below the floor', () => {
    // Same spirit as the corner-balance report's eight observations: a report that accuses a
    // coach of neglecting a moment after one Tuesday is one they learn to ignore.
    const report = coverageOf(model(), [session('build'), session('build')]);
    expect(hasEnoughForCoverage(report)).toBe(false);
    expect(describeCoverage(report)).toBeNull();
  });

  it('does not count unlinked sessions towards the floor', () => {
    const unlinked = Array.from({ length: 10 }, () => session(null));
    expect(hasEnoughForCoverage(coverageOf(model(), unlinked))).toBe(false);
  });

  it('speaks once there are enough linked sessions', () => {
    const linked = Array.from({ length: MIN_SESSIONS_FOR_COVERAGE }, () => session('build'));
    expect(describeCoverage(coverageOf(model(), linked))).not.toBeNull();
  });
});

describe('describeCoverage', () => {
  const four = (id: string) => Array.from({ length: 4 }, () => session(id));

  it('counts, and names an untrained moment', () => {
    expect(describeCoverage(coverageOf(model(), four('build')))).toBe(
      '1 of 4 principles worked on across 4 sessions. Nothing on when we lose it, out of possession or when we win it.',
    );
  });

  it('reports untouched principles once every moment has been covered', () => {
    const sessions = [
      ...four('build'),
      session('press'),
      session('counter'),
      session('build', '2026-09-02T18:00:00.000Z'),
    ];
    const report = coverageOf(
      model({
        principles: [
          principle({ id: 'build', text: 'Build from the back' }),
          principle({ id: 'press', moment: 'defensive_organisation', text: 'Press high' }),
          principle({ id: 'counter', moment: 'transition_to_attack', text: 'Counter fast' }),
          principle({ id: 'recover', moment: 'transition_to_defence', text: 'Counter-press' }),
        ],
      }),
      [...sessions, session('recover')],
    );
    expect(describeCoverage(report)).toBe('4 of 4 principles worked on across 8 sessions.');
  });

  it('says plainly when sessions name a principle the model has dropped', () => {
    const report = coverageOf(model(), [...four('build'), session('gone')]);
    expect(describeCoverage(report)).toContain(
      '1 session named a principle the model no longer has',
    );
  });

  it('prescribes no number of sessions per principle', () => {
    // No source says what that number would be, and inventing one would be the app pretending
    // to know. It counts and names the gap.
    const text = describeCoverage(coverageOf(model(), four('build')))!;
    expect(text).not.toMatch(/should|need|too few|at least|target/i);
  });
});

describe('levelOfPrinciple', () => {
  /**
   * Carry-forward already warns when a coaching point has been chased three sessions running.
   * Against a game model that warning can name the level — a *sub-principle* worked three times
   * without being acquired is a propensity problem rather than a principle problem, which is
   * the methodology's own diagnosis.
   */
  it('names the level a session was working at', () => {
    expect(levelOfPrinciple(model(), asPrincipleId(testId('pivot')))).toBe('meso');
    expect(levelOfPrinciple(model(), asPrincipleId(testId('build')))).toBe('macro');
  });

  it('says nothing for an unlinked session or a dropped principle', () => {
    expect(levelOfPrinciple(model(), null)).toBeNull();
    expect(levelOfPrinciple(model(), asPrincipleId(testId('gone')))).toBeNull();
  });
});
