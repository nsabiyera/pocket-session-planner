import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPlayer,
  addPlayersFromList,
  archivePlayer,
  createSquad,
  deletePlayerIfUnreferenced,
  parseRosterLines,
  restorePlayer,
  updatePlayer,
  updateSquad,
} from './squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { asPlayerId, asSquadId } from '@/domain/ids';
import { anAction, anObservation, playerId, T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';

let ctx: ServiceContext;
const originalStorage = navigator.storage;

beforeEach(() => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', {
    value: { persisted: async () => false, persist: async () => true },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, 'storage', { value: originalStorage, configurable: true });
  vi.restoreAllMocks();
});

describe('createSquad', () => {
  it('creates a squad with a sensible default session length', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds', ageGroup: 'U12' });
    expect(squad).toMatchObject({
      name: 'U12 Reds',
      ageGroup: 'U12',
      defaultSessionDurationMin: 60,
    });
    expect(await ctx.store.squads.get(squad.id)).toEqual(squad);
  });

  it('asks for persistent storage on the first squad, and records the answer', async () => {
    await createSquad(ctx, { name: 'U12 Reds' });
    const meta = await ctx.store.meta.get();
    expect(meta?.storagePersisted).toBe(true);
    expect(meta?.activeSquadId).toBeTruthy();
  });

  it('does not ask again on the second squad', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: async () => false, persist },
      configurable: true,
    });

    await createSquad(ctx, { name: 'U12 Reds' });
    await createSquad(ctx, { name: 'U13 Blues' });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('survives a browser that refuses persistence', async () => {
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    const squad = await createSquad(ctx, { name: 'U12 Reds' });

    expect(squad.name).toBe('U12 Reds');
    expect((await ctx.store.meta.get())?.storagePersisted).toBe(false);
  });

  it('rejects a blank name at the schema boundary', async () => {
    await expect(createSquad(ctx, { name: '   ' })).rejects.toThrow();
  });
});

describe('updateSquad', () => {
  it('applies changes and bumps updatedAt', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    (ctx.clock as FakeClock).advanceMinutes(10);

    const updated = await updateSquad(ctx, squad.id, { defaultSessionDurationMin: 75 });
    expect(updated?.defaultSessionDurationMin).toBe(75);
    expect(updated?.updatedAt).not.toBe(squad.updatedAt);
  });

  it('returns undefined for a squad that does not exist', async () => {
    expect(await updateSquad(ctx, asSquadId(testId('ghost')), { name: 'X' })).toBeUndefined();
  });
});

describe('players', () => {
  it('adds a player with an optional number and position', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const player = await addPlayer(ctx, {
      squadId: squad.id,
      name: 'Kai Roberts',
      shirtNumber: 7,
      position: 'midfielder',
    });

    expect(player).toMatchObject({ name: 'Kai Roberts', shirtNumber: 7, position: 'midfielder' });
    expect(await ctx.store.players.listBySquad(squad.id)).toHaveLength(1);
  });

  it('updates a player', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const player = await addPlayer(ctx, { squadId: squad.id, name: 'Kai' });

    const updated = await updatePlayer(ctx, player.id, { shirtNumber: 9 });
    expect(updated?.shirtNumber).toBe(9);
    expect(await updatePlayer(ctx, asPlayerId(testId('ghost')), { name: 'X' })).toBeUndefined();
  });

  it('archives rather than deletes, and can restore without a null index key', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const player = await addPlayer(ctx, { squadId: squad.id, name: 'Kai' });

    const archived = await archivePlayer(ctx, player.id);
    expect(archived?.archivedAt).toBe(T0);
    expect(await ctx.store.players.listBySquad(squad.id)).toHaveLength(0);
    expect(await ctx.store.players.listBySquad(squad.id, { includeArchived: true })).toHaveLength(
      1,
    );

    const restored = await restorePlayer(ctx, player.id);
    // Absent, not null — `archivedAt` is indexed, and IndexedDB cannot store a null key.
    expect(restored && 'archivedAt' in restored).toBe(false);
    expect(await ctx.store.players.listBySquad(squad.id)).toHaveLength(1);
  });

  it('returns undefined when archiving or restoring a stranger', async () => {
    expect(await archivePlayer(ctx, asPlayerId(testId('ghost')))).toBeUndefined();
    expect(await restorePlayer(ctx, asPlayerId(testId('ghost')))).toBeUndefined();
  });

  it('hard-deletes a player typed by mistake, with no history behind them', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const player = await addPlayer(ctx, { squadId: squad.id, name: 'Kai' });

    expect(await deletePlayerIfUnreferenced(ctx, player.id)).toEqual({ deleted: true });
    expect(await ctx.store.players.get(player.id)).toBeUndefined();
  });

  it('refuses to delete a player with observations, and says why', async () => {
    await ctx.store.observations.put(anObservation('o1', { playerId: playerId('kai') }));
    const result = await deletePlayerIfUnreferenced(ctx, playerId('kai'));

    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/observations/);
  });

  it('refuses to delete a player with open carry-forward actions', async () => {
    await ctx.store.actions.put(anAction('a1', { playerIds: [playerId('maya')] }));
    const result = await deletePlayerIfUnreferenced(ctx, playerId('maya'));

    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/carry-forward/);
  });

  it('adds a whole roster from one pasted list', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const players = await addPlayersFromList(
      ctx,
      squad.id,
      '7 Kai Roberts\n9. Maya Okafor\nSam Ellis\n\n  ',
    );

    expect(players.map((p) => [p.shirtNumber, p.name])).toEqual([
      [7, 'Kai Roberts'],
      [9, 'Maya Okafor'],
      [undefined, 'Sam Ellis'],
    ]);
    expect(await ctx.store.players.listBySquad(squad.id)).toHaveLength(3);
  });

  it('parses the roster shorthands a coach actually types', () => {
    expect(parseRosterLines('7 Kai')).toEqual([{ name: 'Kai', shirtNumber: 7 }]);
    expect(parseRosterLines('7. Kai')).toEqual([{ name: 'Kai', shirtNumber: 7 }]);
    expect(parseRosterLines('7) Kai')).toEqual([{ name: 'Kai', shirtNumber: 7 }]);
    expect(parseRosterLines('Kai')).toEqual([{ name: 'Kai' }]);
    expect(parseRosterLines('Kai, Maya')).toEqual([{ name: 'Kai' }, { name: 'Maya' }]);
    expect(parseRosterLines('   \n  ')).toEqual([]);
    // A three-digit lead is not a shirt number; treat the whole thing as a name.
    expect(parseRosterLines('100 Club')).toEqual([{ name: '100 Club' }]);
  });
});
