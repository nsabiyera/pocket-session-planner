import { beforeEach, describe, expect, it } from 'vitest';
import { setEffortQuality } from './run-service';
import { startDraft } from '../planning/planning-service';
import { createSquad, updateSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { T0 } from '@/test/builders';
import type { ServiceContext } from '../context';
import type { SquadId } from '@/domain/ids';

let ctx: ServiceContext;
let squadId: SquadId;

beforeEach(async () => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
  squadId = (await createSquad(ctx, { name: 'First Team' })).id;
});

const aDraft = async () =>
  unwrap(await startDraft(ctx, { squadId, objectiveText: 'Playing out from the back' }));

describe('the safeguarding gate on effort labelling', () => {
  /**
   * ADR 0007's line, enforced in the service rather than only in the UI. A gate that trusted
   * the screen would be one deep link away from putting adult load concepts against a squad
   * of eleven-year-olds.
   */
  it('refuses a label on a youth squad', async () => {
    const draft = await aDraft();
    // Youth is the default, deliberately — a squad whose level was never set is protected.
    expect(isErr(await setEffortQuality(ctx, draft.id, 'tension'))).toBe(true);
  });

  it('allows it once the squad is marked senior', async () => {
    await updateSquad(ctx, squadId, { level: 'senior' });
    const draft = await aDraft();
    expect(unwrap(await setEffortQuality(ctx, draft.id, 'tension')).effortQuality).toBe('tension');
  });

  it('allows clearing a label even on a youth squad', async () => {
    // A squad switched from senior to youth must be able to shed what it recorded, or the data
    // is stuck in a state the coach can no longer reach.
    await updateSquad(ctx, squadId, { level: 'senior' });
    const draft = await aDraft();
    unwrap(await setEffortQuality(ctx, draft.id, 'velocity'));

    await updateSquad(ctx, squadId, { level: 'youth' });
    expect(unwrap(await setEffortQuality(ctx, draft.id, null)).effortQuality).toBeNull();
  });

  it('defaults a squad to youth', async () => {
    expect((await ctx.store.squads.get(squadId))?.level).toBe('youth');
  });

  it('refuses a session that is gone', async () => {
    await updateSquad(ctx, squadId, { level: 'senior' });
    const draft = await aDraft();
    await ctx.store.sessions.hardDelete(draft.id);
    expect(isErr(await setEffortQuality(ctx, draft.id, 'tension'))).toBe(true);
  });
});
