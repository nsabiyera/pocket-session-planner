import { beforeEach, describe, expect, it } from 'vitest';
import { addFixtures, getDraft, listFixtures, startDraft } from './planning-service';
import { createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { parseFixtureLines } from '@/domain/fixture-list';
import { asSquadId, type SquadId } from '@/domain/ids';
import { T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';

let ctx: ServiceContext;
let squadId: SquadId;

beforeEach(async () => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
  squadId = (await createSquad(ctx, { name: 'First Team', ageGroup: 'U16' })).id;
});

const season = () =>
  parseFixtureLines(
    [
      '2026-09-14 H Eastfield Rovers',
      '2026-09-21 A Northgate United',
      '2026-09-28 H Westbrook',
    ].join('\n'),
  ).fixtures;

describe('adding a run of fixtures', () => {
  /**
   * The structural reason there was no fixture list: `startMatchDraft` replaces the squad's
   * single draft (ADR 0003), so entering a second fixture discarded the first. A fixture goes
   * to `planned`, where sessions accumulate freely.
   */
  it('holds every fixture at once, which a draft could not', () => {
    return addFixtures(ctx, squadId, season()).then(async (result) => {
      expect(unwrap(result)).toHaveLength(3);
      expect(await listFixtures(ctx, squadId)).toHaveLength(3);
    });
  });

  it('commits them to planned rather than into the draft slot', async () => {
    unwrap(await addFixtures(ctx, squadId, season()));

    const fixtures = await listFixtures(ctx, squadId);
    expect(fixtures.every((fixture) => fixture.status === 'planned')).toBe(true);
    // The draft slot is left free for the session the coach is actually composing.
    expect(await getDraft(ctx, squadId)).toBeUndefined();
  });

  it('leaves an existing draft untouched', async () => {
    const draft = unwrap(await startDraft(ctx, { squadId, objectiveText: 'Pressing triggers' }));
    unwrap(await addFixtures(ctx, squadId, season()));

    expect((await getDraft(ctx, squadId))?.id).toBe(draft.id);
  });

  it('orders them soonest first', async () => {
    unwrap(await addFixtures(ctx, squadId, season()));
    const fixtures = await listFixtures(ctx, squadId);
    expect(fixtures.map((f) => f.match?.opponent)).toEqual([
      'Eastfield Rovers',
      'Northgate United',
      'Westbrook',
    ]);
  });

  it('takes the format from the squad’s age group', async () => {
    // U16 plays 11v11, and the coach should not have to say so once per fixture.
    unwrap(await addFixtures(ctx, squadId, season()));
    expect((await listFixtures(ctx, squadId))[0]?.match?.format).toBe('11v11');
  });

  it('falls back to 11v11 when the age group says nothing', async () => {
    const senior = await createSquad(ctx, { name: 'Reserves' });
    unwrap(await addFixtures(ctx, senior.id, season()));
    expect((await listFixtures(ctx, senior.id))[0]?.match?.format).toBe('11v11');
  });

  it('records the venue each line asked for', async () => {
    unwrap(await addFixtures(ctx, squadId, season()));
    expect((await listFixtures(ctx, squadId)).map((f) => f.match?.venue)).toEqual([
      'home',
      'away',
      'home',
    ]);
  });

  /**
   * The team objective starts as the fixture line, which is a label rather than a plan: in July
   * a coach does not know what March's game is about. It carries no principle, so every report
   * downstream correctly counts the fixture as unlinked until the brief is written.
   */
  it('leaves the fixture unlinked to any principle', async () => {
    unwrap(await addFixtures(ctx, squadId, season()));
    const fixture = (await listFixtures(ctx, squadId))[0]!;

    expect(fixture.objective.principleId).toBeNull();
    expect(fixture.objective.text).toBe('At home to Eastfield Rovers');
  });

  it('gives each fixture no shape yet', async () => {
    // A shape is chosen the week of the game, not the day the season was entered.
    unwrap(await addFixtures(ctx, squadId, season()));
    expect((await listFixtures(ctx, squadId))[0]?.match?.shapeName).toBeNull();
  });

  it('adds nothing for an empty list', async () => {
    expect(unwrap(await addFixtures(ctx, squadId, []))).toEqual([]);
    expect(await listFixtures(ctx, squadId)).toEqual([]);
  });

  it('refuses a squad that does not exist', async () => {
    expect(isErr(await addFixtures(ctx, asSquadId(testId('nope')), season()))).toBe(true);
  });

  it('can be run twice without disturbing what is already there', async () => {
    unwrap(await addFixtures(ctx, squadId, season()));
    unwrap(await addFixtures(ctx, squadId, parseFixtureLines('2026-10-05 A Carlton').fixtures));

    expect(await listFixtures(ctx, squadId)).toHaveLength(4);
  });
});
