import { describe, expect, it } from 'vitest';
import {
  MIN_SESSIONS_FOR_WEEK_REVIEW,
  describeMomentsInWeek,
  describeWeekReview,
  momentsInWeek,
  reviewWeek,
} from './week-review';
import { morphocycleFor, type CycleSession, type EffortQuality } from '../morphocycle';
import { GameModelSchema, type GameModelInput, type PrincipleInput } from '../game-model';
import { asPrincipleId, type PrincipleId } from '../ids';
import { CURRENT_SCHEMA_VERSION } from '../primitives';
import { SQUAD_ID, T0, testId } from '@/test/builders';

const MATCH_DAY = '2026-09-12T14:00:00.000Z';
const at = (day: number): string => `2026-09-${String(day).padStart(2, '0')}T19:00:00.000Z`;

const principle = (over: Partial<PrincipleInput> & { id: string }): PrincipleInput => ({
  moment: 'offensive_organisation',
  level: 'macro',
  parentId: null,
  text: over.id,
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
    identity: 'We build from the back',
    principles: [
      principle({ id: 'build', text: 'Build from the back' }),
      principle({
        id: 'pivot',
        level: 'meso',
        parentId: testId('build'),
        text: 'Through the pivot',
      }),
      principle({ id: 'drop', level: 'micro', parentId: testId('pivot'), text: 'Pivot drops in' }),
      principle({ id: 'press', moment: 'defensive_organisation', text: 'Press high' }),
    ],
    ...over,
  });

const session = (
  id: string,
  day: number,
  effortQuality: EffortQuality | null = null,
): CycleSession => ({
  id,
  title: id,
  scheduledFor: at(day),
  kind: 'training',
  effortQuality,
});

const fixture: CycleSession = {
  id: 'match',
  title: 'match',
  scheduledFor: MATCH_DAY,
  kind: 'match',
  effortQuality: null,
};

/** Builds the week, with a map from session id to the principle it named. */
const week = (
  sessions: readonly CycleSession[],
  links: Record<string, string | null> = {},
  level: 'youth' | 'senior' = 'senior',
) => {
  const cycle = morphocycleFor(fixture, [fixture, ...sessions], { level });
  const lookup = (id: string): PrincipleId | null => {
    const named = links[id];
    return named === undefined || named === null ? null : asPrincipleId(testId(named));
  };
  return reviewWeek(cycle, model(), lookup);
};

describe('reading the week', () => {
  it('resolves each session to its principle, moment and level', () => {
    const review = week([session('tue', 8), session('thu', 10)], {
      tue: 'build',
      thu: 'drop',
    });

    expect(review.days.map((day) => day.label)).toEqual(['MD-4', 'MD-2']);
    expect(review.days[0]?.principle?.text).toBe('Build from the back');
    expect(review.days[1]?.level).toBe('micro');
    expect(review.days[1]?.moment).toBe('offensive_organisation');
  });

  it('counts a session naming no principle as unlinked', () => {
    const review = week([session('tue', 8), session('thu', 10)], { tue: 'build' });
    expect(review.linked).toBe(1);
    expect(review.total).toBe(2);
  });

  it('treats a principle the model no longer has as unlinked', () => {
    // Same reasoning as the coverage report: history is not rewritten, but a principle that is
    // gone cannot be resolved to a moment either.
    const review = week([session('tue', 8), session('thu', 10)], { tue: 'gone', thu: 'build' });
    expect(review.linked).toBe(1);
    expect(review.days[0]?.principle).toBeNull();
  });
});

describe('the week’s theme', () => {
  /**
   * The correction that shaped this module. A week working three sub-principles of one macro is
   * **one** theme, and in tactical periodization that is the normal shape of an acquisition
   * week rather than a fault.
   */
  it('rolls sub-principles up to the one macro they hang from', () => {
    const review = week([session('tue', 8), session('wed', 9), session('thu', 10)], {
      tue: 'drop',
      wed: 'pivot',
      thu: 'build',
    });

    expect(review.macroPrinciples).toHaveLength(1);
    expect(review.macroPrinciples[0]?.text).toBe('Build from the back');
  });

  it('does not flag a week concentrated on one moment', () => {
    // The roadmap originally proposed flagging "the same moment worked three times". Encoding
    // that would have marked good practice as a fault.
    const review = week([session('tue', 8), session('wed', 9), session('thu', 10)], {
      tue: 'build',
      wed: 'pivot',
      thu: 'drop',
    });

    expect(review.findings.map((f) => f.kind)).not.toContain('macro_spread');
    expect(review.findings).toEqual([]);
  });

  it('reports a week spanning two macros, without judging it', () => {
    const review = week([session('tue', 8), session('thu', 10)], {
      tue: 'build',
      thu: 'press',
    });

    const finding = review.findings.find((f) => f.kind === 'macro_spread');
    expect(finding?.text).toBe("The week's work spans 2 macro principles.");
    expect(finding?.text).not.toMatch(/should|too many|incoherent/i);
  });

  it('lists the moments the week touched, for display', () => {
    const review = week([session('tue', 8), session('thu', 10)], {
      tue: 'build',
      thu: 'press',
    });
    expect(momentsInWeek(review)).toEqual(['offensive_organisation', 'defensive_organisation']);
    expect(describeMomentsInWeek(review)).toBe('In possession, Out of possession');
  });

  it('names no moments when nothing was linked', () => {
    expect(describeMomentsInWeek(week([session('tue', 8), session('thu', 10)]))).toBeNull();
  });
});

describe('alternation, the one finding the sources support', () => {
  it('flags an effort quality on consecutive days', () => {
    const review = week([session('wed', 9, 'tension'), session('thu', 10, 'tension')], {
      wed: 'build',
      thu: 'pivot',
    });
    expect(review.findings.map((f) => f.text)).toContain('Tension on consecutive days.');
  });

  it('says nothing when the week alternates', () => {
    const review = week([session('wed', 9, 'tension'), session('thu', 10, 'velocity')], {
      wed: 'build',
      thu: 'pivot',
    });
    expect(review.findings.map((f) => f.kind)).not.toContain('quality_repeated');
  });

  it('flags a labelled week with no acquisitive day', () => {
    const review = week([session('wed', 9, 'recovery'), session('thu', 10, 'activation')], {
      wed: 'build',
      thu: 'pivot',
    });
    expect(review.findings.map((f) => f.kind)).toContain('no_acquisitive_day');
  });

  it('says nothing about acquisitive days when none were labelled at all', () => {
    // Silence is right: an unlabelled week is a coach who has not used the feature, not a
    // coach who trained nothing.
    const review = week([session('wed', 9), session('thu', 10)], { wed: 'build', thu: 'pivot' });
    expect(review.findings.map((f) => f.kind)).not.toContain('no_acquisitive_day');
  });

  it('reports no load findings on a youth squad', () => {
    const review = week(
      [session('wed', 9, 'tension'), session('thu', 10, 'tension')],
      { wed: 'build', thu: 'pivot' },
      'youth',
    );
    expect(review.findings.map((f) => f.kind)).not.toContain('quality_repeated');
    expect(review.findings.map((f) => f.kind)).not.toContain('no_acquisitive_day');
  });
});

describe('when the week did not refer to the model at all', () => {
  it('says so plainly rather than reporting a spread of nothing', () => {
    const review = week([session('tue', 8), session('thu', 10)]);
    const finding = review.findings.find((f) => f.kind === 'sessions_unlinked');
    expect(finding?.text).toBe(
      'No session this week named a principle, so the week cannot be checked against the model.',
    );
  });

  it('counts the partial case', () => {
    const review = week([session('tue', 8), session('wed', 9), session('thu', 10)], {
      tue: 'build',
    });
    expect(review.findings.find((f) => f.kind === 'sessions_unlinked')?.text).toBe(
      '2 of 3 sessions named no principle.',
    );
  });
});

describe('describeWeekReview', () => {
  it('says nothing when there is no game model', () => {
    // A coach who has not authored one is not told their week failed to contain it.
    const cycle = morphocycleFor(fixture, [fixture, session('tue', 8), session('thu', 10)], {
      level: 'senior',
    });
    const review = reviewWeek(cycle, null, () => null);
    expect(describeWeekReview(review, null)).toBeNull();
  });

  it('says nothing below two sessions', () => {
    const review = week([session('thu', 10)], { thu: 'build' });
    expect(review.total).toBeLessThan(MIN_SESSIONS_FOR_WEEK_REVIEW);
    expect(describeWeekReview(review, model())).toBeNull();
  });

  it('names the theme when the week has one', () => {
    const review = week([session('tue', 8), session('thu', 10)], { tue: 'build', thu: 'pivot' });
    expect(describeWeekReview(review, model())).toBe(
      '2 of 2 sessions named a principle. Themed on "Build from the back".',
    );
  });

  it('appends the findings', () => {
    const review = week([session('wed', 9, 'tension'), session('thu', 10, 'tension')], {
      wed: 'build',
      thu: 'pivot',
    });
    expect(describeWeekReview(review, model())).toContain('Tension on consecutive days.');
  });

  it('prescribes nothing', () => {
    const review = week([session('tue', 8), session('thu', 10)], { tue: 'build', thu: 'press' });
    expect(describeWeekReview(review, model())!).not.toMatch(/should|must|too many|target/i);
  });
});
