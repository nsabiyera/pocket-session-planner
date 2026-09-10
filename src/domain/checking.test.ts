import { describe, expect, it } from 'vitest';
import {
  describeFollowUp,
  describeUncheckedStreak,
  followUpSummary,
  hasEnoughForFollowUp,
  regressionOffer,
  REGRESSION_OFFER_MESSAGE,
  uncheckedStreaks,
} from './checking';
import { findObjectiveTemplate } from './objectives';
import { buildSessionFromMethodology } from './session/build-from-methodology';
import { mainPracticePhase } from './session/selectors';
import { PLAY_PRACTICE_PLAY } from './presets';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { aSquad, phaseId, testId, T0 } from '@/test/builders';
import { asCoachingPointId, asSessionId } from './ids';
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

/**
 * The complement of the existing chain-depth warning. That one says *you keep saying it*; this
 * says *you never found out whether they heard you* — and consecutive, not cumulative, because
 * a point checked once has been checked.
 */
describe('said three sessions running, never checked', () => {
  const said = (session: string, text: string, checked = false) => ({
    sessionId: asSessionId(testId(session)),
    text,
    checked,
  });

  it('fires at three consecutive sessions and not before', () => {
    const two = uncheckedStreaks([said('s1', 'Head up'), said('s2', 'Head up')]);
    expect(two).toEqual([]);

    const three = uncheckedStreaks([
      said('s1', 'Head up'),
      said('s2', 'Head up'),
      said('s3', 'Head up'),
    ]);
    expect(three).toEqual([{ text: 'Head up', sessions: 3 }]);
  });

  it('resets the moment it was checked once', () => {
    // Checked in the middle, so only two sessions of streak remain at the recent end.
    const streaks = uncheckedStreaks([
      said('s1', 'Head up'),
      said('s2', 'Head up'),
      said('s3', 'Head up', true),
      said('s4', 'Head up'),
      said('s5', 'Head up'),
    ]);
    expect(streaks).toEqual([]);
  });

  it('counts back from the most recent, not across the whole term', () => {
    const streaks = uncheckedStreaks([
      said('s1', 'Head up', true),
      said('s2', 'Head up'),
      said('s3', 'Head up'),
      said('s4', 'Head up'),
    ]);
    expect(streaks).toEqual([{ text: 'Head up', sessions: 3 }]);
  });

  it('treats a point in two phases of one session as one session', () => {
    // Otherwise a coach who puts the same point in the warm-up and the practice would clock up
    // three sessions of streak in one night.
    const streaks = uncheckedStreaks([
      said('s1', 'Head up'),
      said('s1', 'Head up'),
      said('s1', 'Head up'),
    ]);
    expect(streaks).toEqual([]);
  });

  it('counts a session as checked when any one phase checked it', () => {
    const streaks = uncheckedStreaks([
      said('s1', 'Head up'),
      said('s2', 'Head up'),
      said('s3', 'Head up'),
      said('s3', 'Head up', true),
    ]);
    expect(streaks).toEqual([]);
  });

  it('matches on the same normalisation as the carry-forward dedupe', () => {
    const streaks = uncheckedStreaks([
      said('s1', 'Head up before you receive'),
      said('s2', 'head up before you receive.'),
      said('s3', 'Head up before you receive!'),
    ]);
    expect(streaks).toHaveLength(1);
    // Quoted as the coach last wrote it.
    expect(streaks[0]?.text).toBe('Head up before you receive!');
  });

  it('keeps separate points separate, longest streak first', () => {
    const streaks = uncheckedStreaks([
      said('s1', 'Head up'),
      said('s1', 'Body shape'),
      said('s2', 'Head up'),
      said('s2', 'Body shape'),
      said('s3', 'Head up'),
      said('s3', 'Body shape'),
      said('s4', 'Head up'),
    ]);
    expect(streaks.map((streak) => streak.text)).toEqual(['Head up', 'Body shape']);
    expect(streaks[0]?.sessions).toBe(4);
  });

  it('describes the record and draws no conclusion from it', () => {
    const line = describeUncheckedStreak({ text: 'Head up', sessions: 3 });
    expect(line).toBe('Said in 3 sessions running, and never checked in any of them.');
    // The point may be perfectly well understood. Nobody knows, which is what it says.
    expect(line).not.toMatch(/understood|stick|ignored|failed|should/i);
  });

  it('has nothing to say about an empty term', () => {
    expect(uncheckedStreaks([])).toEqual([]);
  });
});
