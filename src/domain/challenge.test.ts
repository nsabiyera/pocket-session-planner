import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_STATUSES,
  ChallengeEventSchema,
  MAX_CHALLENGE_TARGET,
  PlayerChallengeSchema,
  challengeStatusLabel,
  describeChallengeProgress,
  effectiveChallengeStatus,
  hasHitTarget,
  isChallengeLiveInPhase,
  type ChallengeStatus,
} from './challenge';
import { asChallengeEventId } from './ids';
import { aChallenge, challengeId, phaseId, playerId, testId, T0 } from '@/test/builders';

/** `parse` takes `unknown`, so an overrides bag needs no cast to probe a bad value. */
const parse = (over: Record<string, unknown> = {}) =>
  PlayerChallengeSchema.safeParse({
    id: challengeId('c1'),
    playerId: playerId('kai'),
    text: 'Three forward passes',
    targetCount: 3,
    ...over,
  });

const challenge = (over: Record<string, unknown> = {}) => {
  const result = parse(over);
  if (!result.success) throw result.error;
  return result.data;
};

const event = (over: Record<string, unknown> = {}) =>
  ChallengeEventSchema.safeParse({
    id: asChallengeEventId(testId('event1')),
    challengeId: challengeId('c1'),
    phaseId: phaseId('warmup'),
    at: T0,
    ...over,
  });

describe('PlayerChallengeSchema', () => {
  it('defaults to a counted, unscoped, unjudged coach ask', () => {
    const parsed = challenge();

    expect(parsed.measure).toBe('count');
    expect(parsed.phaseIds).toEqual([]);
    expect(parsed.corner).toBeNull();
    expect(parsed.status).toBe('open');
    expect(parsed.settledAt).toBeNull();
    expect(parsed.note).toBe('');
    expect(parsed.source).toBe('coach');
    expect(parsed.sourceActionId).toBeNull();
  });

  it('refuses a counted challenge with no target — there would be nothing to reach', () => {
    const result = parse({ targetCount: undefined });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/counted challenge needs a target/);
  });

  it('refuses a judged challenge that carries a target', () => {
    const result = parse({ measure: 'judged', targetCount: 3 });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/judged challenge cannot have a target/);
  });

  it('accepts a judged challenge — "stay positive when you lose it"', () => {
    const parsed = challenge({ measure: 'judged', targetCount: null, text: 'Stay positive' });
    expect(parsed.measure).toBe('judged');
    expect(parsed.targetCount).toBeNull();
  });

  it('refuses a target outside the range a coach can keep on a phone', () => {
    expect(parse({ targetCount: 0 }).success).toBe(false);
    expect(parse({ targetCount: MAX_CHALLENGE_TARGET + 1 }).success).toBe(false);
    expect(parse({ targetCount: 2.5 }).success).toBe(false);
    expect(parse({ targetCount: MAX_CHALLENGE_TARGET }).success).toBe(true);
  });

  it('refuses a settledAt on a challenge nobody has ruled on', () => {
    const result = parse({ settledAt: T0 });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/open challenge has not been settled/);
  });

  it('accepts a settledAt once the coach has ruled', () => {
    expect(challenge({ status: 'met', settledAt: T0 }).settledAt).toBe(T0);
  });

  it('accepts a ruling with no settledAt — a verdict typed in Review, not stamped', () => {
    expect(challenge({ status: 'missed' }).settledAt).toBeNull();
  });

  it('refuses duplicate phase ids', () => {
    const result = parse({ phaseIds: [phaseId('warmup'), phaseId('warmup')] });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Phase ids must be unique/);
  });

  it('refuses blank text, and text longer than a coach would ever say out loud', () => {
    expect(parse({ text: '' }).success).toBe(false);
    expect(parse({ text: '   ' }).success).toBe(false);
    expect(parse({ text: 'a'.repeat(161) }).success).toBe(false);
    expect(parse({ text: 'a'.repeat(160) }).success).toBe(true);
  });

  it('trims text and note, so a stray space is not stored as content', () => {
    const parsed = challenge({ text: '  Three forward passes  ', note: '  went well  ' });
    expect(parsed.text).toBe('Three forward passes');
    expect(parsed.note).toBe('went well');
  });

  it('refuses an unknown measure, status or source', () => {
    expect(parse({ measure: 'vibes' }).success).toBe(false);
    expect(parse({ status: 'nearly' }).success).toBe(false);
    expect(parse({ source: 'guesswork' }).success).toBe(false);
  });

  it('does not require the player to be a focus player — that is the point', () => {
    // No focus list is consulted here at all: a quiet player can hold a challenge.
    expect(challenge({ playerId: playerId('sam') }).playerId).toBe(playerId('sam'));
  });
});

describe('ChallengeEventSchema', () => {
  it('defaults phaseElapsedMs to zero', () => {
    const parsed = event();
    expect(parsed.success && parsed.data.phaseElapsedMs).toBe(0);
  });

  it('refuses a negative or fractional elapsed time', () => {
    expect(event({ phaseElapsedMs: -1 }).success).toBe(false);
    expect(event({ phaseElapsedMs: 1.5 }).success).toBe(false);
  });

  it('requires a phase — a sighting outside a phase places nowhere in Review', () => {
    expect(event({ phaseId: undefined }).success).toBe(false);
  });
});

describe('the statuses the coach can tap', () => {
  it('offers met, partly and missed — open is a starting state, not a choice', () => {
    expect(CHALLENGE_STATUSES).toEqual(['met', 'partly', 'missed']);
    expect(CHALLENGE_STATUSES).not.toContain('open');
  });

  it('labels every status, including the one that is not offered', () => {
    const all: ChallengeStatus[] = ['open', 'met', 'partly', 'missed'];
    expect(all.map(challengeStatusLabel)).toEqual(['Open', 'Met', 'Partly', 'Missed']);
  });
});

describe('isChallengeLiveInPhase', () => {
  it('an unscoped challenge is live in every phase', () => {
    const unscoped = aChallenge('c1');
    expect(isChallengeLiveInPhase(unscoped, phaseId('warmup'))).toBe(true);
    expect(isChallengeLiveInPhase(unscoped, phaseId('game'))).toBe(true);
  });

  it('a scoped challenge is live only in the phases it names', () => {
    const scoped = aChallenge('c1', { phaseIds: [phaseId('rondo')] });
    expect(isChallengeLiveInPhase(scoped, phaseId('rondo'))).toBe(true);
    expect(isChallengeLiveInPhase(scoped, phaseId('warmup'))).toBe(false);
  });
});

describe('describeChallengeProgress', () => {
  it('reads as a fraction for a counted challenge', () => {
    expect(describeChallengeProgress(aChallenge('c1', { targetCount: 3 }), 2)).toBe('2/3');
    expect(describeChallengeProgress(aChallenge('c1', { targetCount: 3 }), 0)).toBe('0/3');
  });

  it('shows an em dash for a judged one rather than inventing a denominator', () => {
    const judged = aChallenge('c1', { measure: 'judged', targetCount: null });
    expect(describeChallengeProgress(judged, 0)).toBe('—');
    expect(describeChallengeProgress(judged, 4)).toBe('—');
  });
});

describe('hasHitTarget', () => {
  const counted = aChallenge('c1', { targetCount: 3 });

  it('is false short of the target and true at or past it', () => {
    expect(hasHitTarget(counted, 2)).toBe(false);
    expect(hasHitTarget(counted, 3)).toBe(true);
    expect(hasHitTarget(counted, 9)).toBe(true);
  });

  it('is always false for a judged challenge — there is nothing to reach', () => {
    const judged = aChallenge('c1', { measure: 'judged', targetCount: null });
    expect(hasHitTarget(judged, 99)).toBe(false);
  });
});

describe('effectiveChallengeStatus', () => {
  const counted = aChallenge('c1', { targetCount: 3 });

  it('reads met the moment the tally says so, without asking the coach twice', () => {
    expect(effectiveChallengeStatus(counted, 3)).toBe('met');
  });

  it('stays open while the tally is short', () => {
    expect(effectiveChallengeStatus(counted, 2)).toBe('open');
  });

  it('lets an explicit ruling beat the tally — the coach was there and it was not met', () => {
    const ruled = aChallenge('c1', { targetCount: 3, status: 'missed', settledAt: T0 });
    expect(effectiveChallengeStatus(ruled, 5)).toBe('missed');
  });

  it('keeps a partly ruling on a challenge with no sightings at all', () => {
    const ruled = aChallenge('c1', { status: 'partly', settledAt: T0 });
    expect(effectiveChallengeStatus(ruled, 0)).toBe('partly');
  });

  it('leaves a judged challenge open until it is ruled on', () => {
    const judged = aChallenge('c1', { measure: 'judged', targetCount: null });
    expect(effectiveChallengeStatus(judged, 7)).toBe('open');
  });
});
