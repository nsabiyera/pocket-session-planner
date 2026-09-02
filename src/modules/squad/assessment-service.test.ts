import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadCornerProfile,
  loadSquadCornerBalance,
  recordAssessment,
  updateAssessment,
} from './assessment-service';
import { addPlayer, createSquad } from './squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asPlayerAssessmentId, asPlayerId, type PlayerId, type SquadId } from '@/domain/ids';
import { isComplete, overallRating, ratedCorners } from '@/domain/player-assessment';
import { anObservation, T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';
import type { FourCorner } from '@/domain/four-corners';

let ctx: ServiceContext;
let squadId: SquadId;
let kai: PlayerId;

const clock = () => ctx.clock as FakeClock;

beforeEach(async () => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });

  const squad = await createSquad(ctx, { name: 'U12 Reds' });
  squadId = squad.id;
  kai = (await addPlayer(ctx, { squadId, name: 'Kai Roberts' })).id;
});

const seedObservations = async (corner: FourCorner, count: number, playerId = kai) => {
  await ctx.store.observations.putMany(
    Array.from({ length: count }, (_, index) =>
      anObservation(`${corner}-${playerId}-${index}`, { playerId, squadId, corner }),
    ),
  );
};

describe('recordAssessment', () => {
  it('records a full four-corner profile', async () => {
    const assessment = unwrap(
      await recordAssessment(ctx, {
        playerId: kai,
        ratings: {
          technical_tactical: 4,
          physical: 3,
          psychological: 2,
          social: 5,
        },
      }),
    );

    expect(isComplete(assessment)).toBe(true);
    expect(overallRating(assessment)).toBe(3.5);
    expect(assessment.squadId).toBe(squadId);
    expect(assessment.assessedAt).toBe(T0);
  });

  it('keeps a half-finished assessment rather than forcing four judgements', async () => {
    // A coach with a view on two corners today should not have to invent the other two.
    const assessment = unwrap(
      await recordAssessment(ctx, { playerId: kai, ratings: { social: 4 } }),
    );

    expect(isComplete(assessment)).toBe(false);
    expect(ratedCorners(assessment)).toEqual(['social']);
    expect(overallRating(assessment)).toBe(4);
  });

  it('records nothing rated at all without inventing a score', async () => {
    const assessment = unwrap(await recordAssessment(ctx, { playerId: kai }));
    expect(overallRating(assessment)).toBeNull();
    expect(ratedCorners(assessment)).toEqual([]);
  });

  it('carries the focus corner, which seeds the next carry-forward action', async () => {
    const assessment = unwrap(
      await recordAssessment(ctx, { playerId: kai, focusCorner: 'psychological' }),
    );
    expect(assessment.focusCorner).toBe('psychological');
  });

  it('reports an unknown player rather than throwing', async () => {
    const result = await recordAssessment(ctx, { playerId: asPlayerId(testId('ghost')) });
    expect(isErr(result) && result.error.kind).toBe('player_not_found');
  });
});

describe('updateAssessment', () => {
  it('merges partial changes and bumps updatedAt', async () => {
    const first = unwrap(
      await recordAssessment(ctx, { playerId: kai, ratings: { technical_tactical: 3 } }),
    );
    clock().advanceMinutes(10);

    const updated = unwrap(await updateAssessment(ctx, first.id, { ratings: { social: 5 } }));
    expect(updated.ratings.technical_tactical).toBe(3);
    expect(updated.ratings.social).toBe(5);
    expect(updated.updatedAt).not.toBe(first.updatedAt);
    // The assessment date is when it was made, not when it was last edited.
    expect(updated.assessedAt).toBe(T0);
  });

  it('reports an assessment that does not exist', async () => {
    const result = await updateAssessment(ctx, asPlayerAssessmentId(testId('ghost')), {});
    expect(isErr(result) && result.error.kind).toBe('assessment_not_found');
  });
});

describe('loadCornerProfile', () => {
  it('reports the derived balance alongside the recorded assessments', async () => {
    await seedObservations('technical_tactical', 9);
    await seedObservations('physical', 3);
    unwrap(await recordAssessment(ctx, { playerId: kai, ratings: { technical_tactical: 4 } }));

    const profile = await loadCornerProfile(ctx, kai);

    expect(profile.balance.countByCorner.technical_tactical).toBe(9);
    expect(profile.balance.neglected).toEqual(['psychological', 'social']);
    expect(profile.latest?.ratings.technical_tactical).toBe(4);
    // The two halves are independent: the balance is free, the assessment is deliberate.
    expect(profile.suggestion).toBe('psychological');
  });

  it('reports what moved between the two most recent assessments', async () => {
    unwrap(
      await recordAssessment(ctx, {
        playerId: kai,
        ratings: { technical_tactical: 2, social: 3 },
      }),
    );
    clock().advanceMinutes(60 * 24 * 90);
    unwrap(
      await recordAssessment(ctx, {
        playerId: kai,
        ratings: { technical_tactical: 4, social: 3, physical: 5 },
      }),
    );

    const profile = await loadCornerProfile(ctx, kai);

    expect(profile.history).toHaveLength(2);
    expect(profile.deltas).toEqual([
      { corner: 'technical_tactical', from: 2, to: 4, change: 2 },
      // `physical` appears in only one of the two, so it is omitted rather than invented.
      { corner: 'social', from: 3, to: 3, change: 0 },
    ]);
  });

  it('has no deltas with only one assessment', async () => {
    unwrap(await recordAssessment(ctx, { playerId: kai, ratings: { social: 3 } }));
    const profile = await loadCornerProfile(ctx, kai);

    expect(profile.previous).toBeNull();
    expect(profile.deltas).toEqual([]);
  });

  it('is empty and quiet for a player with no history at all', async () => {
    const profile = await loadCornerProfile(ctx, kai);

    expect(profile.balance.total).toBe(0);
    expect(profile.latest).toBeNull();
    // Not enough evidence to nudge about anything yet.
    expect(profile.suggestion).toBeNull();
  });
});

describe('loadSquadCornerBalance', () => {
  it('answers the more useful question: which corner is the coach neglecting', async () => {
    const maya = (await addPlayer(ctx, { squadId, name: 'Maya' })).id;
    await seedObservations('technical_tactical', 6, kai);
    await seedObservations('technical_tactical', 6, maya);
    await seedObservations('physical', 2, maya);

    const balance = await loadSquadCornerBalance(ctx, squadId);

    expect(balance.classified).toBe(14);
    expect(balance.dominant).toBe('technical_tactical');
    // A coach who never logs anything social is not doing it selectively.
    expect(balance.neglected).toEqual(['psychological', 'social']);
  });
});
