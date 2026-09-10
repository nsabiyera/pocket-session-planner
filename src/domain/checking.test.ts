import { describe, expect, it } from 'vitest';
import {
  describeFollowUp,
  followUpSummary,
  hasEnoughForFollowUp,
  regressionOffer,
  REGRESSION_OFFER_MESSAGE,
} from './checking';
import { findObjectiveTemplate } from './objectives';
import { buildSessionFromMethodology } from './session/build-from-methodology';
import { mainPracticePhase } from './session/selectors';
import { PLAY_PRACTICE_PLAY } from './presets';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { aSquad, phaseId, testId, T0 } from '@/test/builders';
import { asCoachingPointId } from './ids';
import { isoDateTime } from './primitives';
import type { CoachingPoint } from './coaching-point';
import type { Observation } from './observation';
import type { PracticeAdjustment } from './practice';

const PHASE = phaseId('practice');
const OTHER_PHASE = phaseId('warmup');
const MISCONCEPTION = 'They think playing out means never going long.';

type ObservationLike = Pick<Observation, 'phaseId' | 'ratingKind' | 'tags'>;
type AdjustmentLike = Pick<PracticeAdjustment, 'phaseId' | 'direction'>;

const seen = (over: Partial<ObservationLike> = {}): ObservationLike => ({
  phaseId: PHASE,
  ratingKind: 'struggled',
  tags: [MISCONCEPTION],
  ...over,
});

const offerFor = (over: {
  misconception?: string | null;
  regressions?: readonly string[];
  observations?: readonly ObservationLike[];
  adjustments?: readonly AdjustmentLike[];
}) =>
  regressionOffer({
    phaseId: PHASE,
    misconception: MISCONCEPTION,
    regressions: ['Take a defender out', 'Two touches minimum'],
    observations: [seen()],
    adjustments: [],
    ...over,
  });

describe('the regression offer', () => {
  it('offers the first written regression when the predicted mistake turns up', () => {
    expect(offerFor({})).toEqual({ text: 'Take a defender out', others: 1 });
  });

  it('offers the coach their own words, never a suggestion of its own', () => {
    const offer = offerFor({ regressions: ['Drop the far winger in'] });
    // The whole feature is a join. If this ever stops being verbatim plan text, the app has
    // started coaching, which is not its job (ADR 0009 §3).
    expect(offer?.text).toBe('Drop the far winger in');
    expect(offer?.others).toBe(0);
  });

  it('says what the record says, and nothing about understanding', () => {
    expect(REGRESSION_OFFER_MESSAGE).toMatch(/way you said/i);
    expect(REGRESSION_OFFER_MESSAGE).not.toMatch(/understood|understand|comprehen|learn/i);
    // Not an instruction either — the coach decides, and the fix is their own sentence.
    expect(REGRESSION_OFFER_MESSAGE).not.toMatch(/you should|must|need to/i);
  });
});

describe('the cases that get silence', () => {
  it('stays quiet for a coach who typed their own objective', () => {
    expect(offerFor({ misconception: null })).toBeNull();
    expect(offerFor({ misconception: '   ' })).toBeNull();
  });

  it('stays quiet when the coach wrote no way to make it easier', () => {
    // Nothing to offer. Whole-Part-Whole's WHOLE games ship with none on purpose, and
    // inventing one there would destroy the comparison the methodology exists to make.
    expect(offerFor({ regressions: [] })).toBeNull();
  });

  it('stays quiet until the predicted mistake has actually been logged', () => {
    expect(offerFor({ observations: [] })).toBeNull();
    // A struggle that is not the predicted one is a different problem, and the coach did not
    // write this regression for it.
    expect(offerFor({ observations: [seen({ tags: ['First touch'] })] })).toBeNull();
  });

  it('does not fire on a player who is working at it', () => {
    // `working` is where the learning is. Making it easier at that moment takes the practice
    // away from them.
    expect(offerFor({ observations: [seen({ ratingKind: 'working' })] })).toBeNull();
    expect(offerFor({ observations: [seen({ ratingKind: 'good' })] })).toBeNull();
    expect(offerFor({ observations: [seen({ ratingKind: null })] })).toBeNull();
  });

  it('is scoped to the phase that is running', () => {
    // It went wrong in the warm-up; this is the game. A different practice needs a different
    // answer, and the regression written here is for this one.
    expect(offerFor({ observations: [seen({ phaseId: OTHER_PHASE })] })).toBeNull();
  });

  it('clears once the coach has made this practice easier', () => {
    // Only the direction and the phase are read, which is deliberate: an off-plan change, or
    // a different regression than the one offered, is still a response, and the app is in no
    // position to tell a coach they responded wrongly.
    expect(offerFor({ adjustments: [{ phaseId: PHASE, direction: 'regressed' }] })).toBeNull();
  });

  it('does not clear because they made it harder, or eased a different phase', () => {
    expect(offerFor({ adjustments: [{ phaseId: PHASE, direction: 'progressed' }] })).not.toBeNull();
    expect(
      offerFor({ adjustments: [{ phaseId: OTHER_PHASE, direction: 'regressed' }] }),
    ).not.toBeNull();
  });
});

/**
 * The response half only exists if the content lines up: an objective that predicts a mistake,
 * a phase that ships a way back, and a tag string that is the same string on both ends. Three
 * separate files have to agree, and nothing else in the build would notice if one drifted.
 *
 * The other end of the tag is pinned by `run-service.test.ts` — *"offers the predicted mistake
 * as one tag, verbatim"* — which asserts the sheet offers `objective.commonMisconception`
 * itself rather than a label of its own.
 */
describe('reachability on the default path', () => {
  it('lines up: the objective predicts, the practice has a way back, the tag matches', () => {
    const template = findObjectiveTemplate('playing-out-from-the-back')!;
    const session = buildSessionFromMethodology(PLAY_PRACTICE_PLAY, {
      squad: aSquad(),
      objective: {
        text: template.text,
        successCriteria: [...template.successCriteria],
        sourceActionId: null,
        principleId: null,
        commonMisconception: template.commonMisconception,
      },
      now: T0,
      ids: new FakeIdGenerator(),
    });

    const practice = mainPracticePhase(session)!;
    expect(practice.regressions.length, 'the default practice ships no way back').toBeGreaterThan(
      0,
    );

    const offer = regressionOffer({
      phaseId: practice.id,
      misconception: session.objective.commonMisconception,
      regressions: practice.regressions,
      observations: [
        {
          phaseId: practice.id,
          ratingKind: 'struggled',
          // The tag the observation sheet would have offered, verbatim.
          tags: [template.commonMisconception],
        },
      ],
      adjustments: [],
    });

    expect(offer?.text).toBe(practice.regressions[0]);
  });
});

describe('matching the tag', () => {
  it('ignores case and surrounding space, like the rest of the tag bank', () => {
    expect(
      offerFor({ observations: [seen({ tags: [`  ${MISCONCEPTION.toUpperCase()} `] })] }),
    ).not.toBeNull();
  });

  it('needs the whole prediction, not a fragment of it', () => {
    // Tags are whole sentences here. A substring match would fire on a coaching point that
    // happened to share an opening clause.
    expect(offerFor({ observations: [seen({ tags: ['They think playing out'] })] })).toBeNull();
  });

  it('finds it among several tags on one observation', () => {
    expect(
      offerFor({ observations: [seen({ tags: ['Decision making', MISCONCEPTION, 'Scanning'] })] }),
    ).not.toBeNull();
  });
});

/**
 * The did-it-stick join. It only works because `logObservation` now recovers the coaching
 * point from the tag the coach tapped — the write-path fix in `docs/known-issues.md` 3 — and
 * because the chip stamps `deliveredAt`.
 */
describe('did it stick', () => {
  const point = (
    label: string,
    over: Partial<Pick<CoachingPoint, 'delivered' | 'deliveredAt' | 'checked'>> = {},
  ) => ({
    id: asCoachingPointId(testId(label)),
    text: `Point ${label}`,
    delivered: true,
    deliveredAt: T0,
    checked: false,
    ...over,
  });

  const at = (minutes: number) =>
    isoDateTime(new Date(Date.parse(T0) + minutes * 60_000).toISOString());

  const observed = (
    pointId: string | null,
    minutes: number,
    ratingKind: Observation['ratingKind'] = 'working',
  ) => ({ coachingPointId: pointId as never, ratingKind, at: at(minutes) });

  it('counts what was logged against each point after it was said', () => {
    const a = point('a');
    const b = point('b');
    const summary = followUpSummary({
      phases: [{ coachingPoints: [a, b] }],
      observations: [observed(a.id, 2, 'working'), observed(a.id, 5, 'good')],
    });

    expect(summary.delivered).toBe(2);
    expect(summary.followedUp).toBe(1);
    expect(summary.points[0]?.loggedAfter).toBe(2);
    expect(summary.points[0]?.ratings).toEqual(['working', 'good']);
    expect(summary.points[1]?.loggedAfter).toBe(0);
  });

  it('ignores an observation logged before the point was said', () => {
    // A coach who ticks their chips at the end of a phase would otherwise get a report full of
    // follow-ups that happened before the coaching did.
    const a = point('a', { deliveredAt: at(10) });
    const summary = followUpSummary({
      phases: [{ coachingPoints: [a] }],
      observations: [observed(a.id, 3), observed(a.id, 12)],
    });
    expect(summary.points[0]?.loggedAfter).toBe(1);
  });

  it('counts everything for a point with no timestamp at all', () => {
    // Imported or hand-edited. Dropping real evidence over a missing timestamp is worse.
    const a = point('a', { deliveredAt: null });
    const summary = followUpSummary({
      phases: [{ coachingPoints: [a] }],
      observations: [observed(a.id, -5), observed(a.id, 5)],
    });
    expect(summary.points[0]?.loggedAfter).toBe(2);
  });

  it('skips points the coach never said — that is a different report', () => {
    const summary = followUpSummary({
      phases: [{ coachingPoints: [point('a', { delivered: false, deliveredAt: null })] }],
      observations: [],
    });
    // The "Didn't get to: …" proposals cover those.
    expect(summary.delivered).toBe(0);
    expect(summary.points).toEqual([]);
  });

  it('ignores observations tagged to nothing', () => {
    const a = point('a');
    const summary = followUpSummary({
      phases: [{ coachingPoints: [a] }],
      observations: [observed(null, 5)],
    });
    expect(summary.followedUp).toBe(0);
  });

  it('walks the phases in order', () => {
    const summary = followUpSummary({
      phases: [{ coachingPoints: [point('a')] }, { coachingPoints: [point('b')] }],
      observations: [],
    });
    expect(summary.points.map((entry) => entry.text)).toEqual(['Point a', 'Point b']);
  });
});

describe('describing did it stick', () => {
  const summary = (delivered: number, followedUp: number) => ({
    delivered,
    followedUp,
    points: [],
  });

  it('reports the ratio', () => {
    expect(describeFollowUp(summary(5, 3))).toBe(
      '3 of the 5 points you said have something logged against them afterwards.',
    );
  });

  it('says nothing was logged, and never that it did not stick', () => {
    const line = describeFollowUp(summary(5, 0));
    expect(line).toBe('5 points you said, and nothing logged about any of them afterwards.');
    // The whole feature is this sentence. An absent observation is an absence in the record.
    expect(line).not.toMatch(/stick|land|fail|work|forgot|ignored/i);
  });

  it('reads well when every point was followed up', () => {
    expect(describeFollowUp(summary(3, 3))).toBe(
      'Every one of the 3 points you said has something logged against it afterwards.',
    );
  });

  it('gets the singular right', () => {
    expect(describeFollowUp(summary(1, 0))).toBe(
      '1 point you said, and nothing logged about it afterwards.',
    );
  });

  it('stays silent below two said points', () => {
    expect(hasEnoughForFollowUp(summary(0, 0))).toBe(false);
    expect(hasEnoughForFollowUp(summary(1, 1))).toBe(false);
    expect(hasEnoughForFollowUp(summary(2, 0))).toBe(true);
  });
});
