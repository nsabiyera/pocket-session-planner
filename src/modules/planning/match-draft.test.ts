import { beforeEach, describe, expect, it } from 'vitest';
import { getDraft, lastUsedMethodologyId, startDraft, startMatchDraft } from './planning-service';
import { addPlayer, createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asSquadId, type SquadId } from '@/domain/ids';
import { phasesInOrder } from '@/domain/session';
import { periodsOf } from '@/domain/session/build-match';
import { T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';
import type { MatchDetailsInput } from '@/domain/match-day';

let ctx: ServiceContext;
let squadId: SquadId;

beforeEach(async () => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });

  const squad = await createSquad(ctx, { name: 'U12 Reds' });
  squadId = squad.id;
  await addPlayer(ctx, { squadId, name: 'Kai' });
});

const fixture = (over: Partial<MatchDetailsInput> = {}): MatchDetailsInput => ({
  opponent: 'Eastfield Rovers',
  venue: 'away',
  fixtureType: 'league',
  format: '9v9',
  shapeName: '3-2-3',
  periodCount: 2,
  ...over,
});

const matchFor = async (over = {}, match: Partial<MatchDetailsInput> = {}) =>
  unwrap(
    await startMatchDraft(ctx, {
      squadId,
      objectiveText: 'Playing out from the back',
      objectiveTemplateId: 'playing-out-from-the-back',
      match: fixture(match),
      ...over,
    }),
  );

describe('startMatchDraft', () => {
  it('produces a match draft that is the squad’s one draft', async () => {
    const draft = await matchFor();
    expect(draft.kind).toBe('match');
    expect(draft.status).toBe('draft');
    expect((await getDraft(ctx, squadId))?.id).toBe(draft.id);
  });

  it('records the fixture the coach entered', async () => {
    const draft = await matchFor();
    expect(draft.match).toMatchObject({
      opponent: 'Eastfield Rovers',
      venue: 'away',
      fixtureType: 'league',
      format: '9v9',
      shapeName: '3-2-3',
    });
  });

  it('builds the periods and the half time', async () => {
    expect(phasesInOrder(await matchFor()).map((phase) => phase.title)).toEqual([
      'First half',
      'Half time',
      'Second half',
    ]);
  });

  it('honours an explicit period length', async () => {
    const draft = await matchFor({ periodMin: 30 });
    expect(periodsOf(draft)[0]?.plannedDurationMin).toBe(30);
    expect(draft.plannedDurationMin).toBe(65); // 30 + 5 + 30
  });

  it('carries the unit objectives through', async () => {
    const draft = await matchFor(
      {},
      { unitObjectives: [{ unit: 'midfield', text: 'Screen the back three' }] },
    );
    expect(draft.match?.unitObjectives).toEqual([
      { unit: 'midfield', text: 'Screen the back three' },
    ]);
  });

  /**
   * The one-draft rule from ADR 0003 has to hold *across* kinds, or a coach who plans a match
   * and then taps New session ends up with two drafts and a `/plan` route that can only show
   * one of them.
   */
  it('replaces a training draft, rather than sitting alongside it', async () => {
    await startDraft(ctx, { squadId, objectiveText: 'Pressing triggers' });
    const match = await matchFor();

    const draft = await getDraft(ctx, squadId);
    expect(draft?.id).toBe(match.id);
    expect(draft?.kind).toBe('match');
  });

  it('is replaced in turn by a training draft', async () => {
    await matchFor();
    const training = unwrap(await startDraft(ctx, { squadId, objectiveText: 'Pressing triggers' }));

    const draft = await getDraft(ctx, squadId);
    expect(draft?.id).toBe(training.id);
    expect(draft?.kind).toBe('training');
    expect(draft?.match).toBeNull();
  });

  /**
   * Regression. The sticky-methodology default reads the most recent session, and a match
   * carries the `match-day` snapshot — which is deliberately not a training preset and does
   * not resolve. Before this was filtered, planning a match and then tapping `New session`
   * failed outright.
   */
  it('does not let a match become the sticky training methodology', async () => {
    await startDraft(ctx, { squadId, objectiveText: 'Pressing triggers' });
    const before = await lastUsedMethodologyId(ctx, squadId);

    await matchFor();

    expect(await lastUsedMethodologyId(ctx, squadId)).toBe(before);
    expect(await lastUsedMethodologyId(ctx, squadId)).not.toBe('match-day');
  });

  it('refuses a squad that does not exist', async () => {
    const result = await startMatchDraft(ctx, {
      squadId: asSquadId(testId('nope')),
      objectiveText: 'Playing out',
      match: fixture(),
    });
    expect(isErr(result)).toBe(true);
  });

  it('takes the objective’s success criteria with it, as training does', async () => {
    // Saturday is where Tuesday shows up, so the objective library is shared deliberately.
    expect((await matchFor()).objective.successCriteria.length).toBeGreaterThan(0);
  });
});
