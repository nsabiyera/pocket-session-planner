import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPlayer,
  addPlayersFromList,
  archivePlayer,
  archiveSquad,
  createSquad,
  deletePlayerIfUnreferenced,
  parseRosterLines,
  restorePlayer,
  restoreSquad,
  switchSquad,
  updatePlayer,
  updateSquad,
} from './squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { asPlayerId, asSquadId } from '@/domain/ids';
import { anAction, anObservation, playerId, T0, testId } from '@/test/builders';
import { commitAndStart, startDraft } from '../planning/planning-service';
import { isErr, unwrap } from '@/lib/result';
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

describe('several squads', () => {
  /** Two squads — the shape ADR 0010 exists for. */
  const twoSquads = async () => ({
    reds: await createSquad(ctx, { name: 'U12 Reds' }),
    greens: await createSquad(ctx, { name: 'U14 Greens' }),
  });

  it('switches which squad is current', async () => {
    const { reds, greens } = await twoSquads();

    expect(unwrap(await switchSquad(ctx, greens.id)).id).toBe(greens.id);
    expect((await ctx.store.meta.get())?.activeSquadId).toBe(greens.id);

    expect(unwrap(await switchSquad(ctx, reds.id)).id).toBe(reds.id);
    expect((await ctx.store.meta.get())?.activeSquadId).toBe(reds.id);
  });

  it('switching to the squad already current is an Ok no-op', async () => {
    const { reds } = await twoSquads();
    await switchSquad(ctx, reds.id);
    (ctx.clock as FakeClock).advanceMinutes(10);

    expect(unwrap(await switchSquad(ctx, reds.id)).id).toBe(reds.id);
  });

  it('refuses a squad that is not there, or is archived', async () => {
    const { reds, greens } = await twoSquads();
    await switchSquad(ctx, reds.id);
    unwrap(await archiveSquad(ctx, greens.id));

    const ghost = await switchSquad(ctx, asSquadId(testId('ghost')));
    expect(isErr(ghost) && ghost.error.kind).toBe('squad_not_found');

    const archived = await switchSquad(ctx, greens.id);
    expect(isErr(archived) && archived.error.kind).toBe('squad_archived');
    // The refusal changed nothing.
    expect((await ctx.store.meta.get())?.activeSquadId).toBe(reds.id);
  });

  it('refuses to switch mid-run, and says which session is in the way', async () => {
    // The rule that makes several teams safe: every observation logged in Do mode is filed
    // against the session's squad, so switching mid-run is the one move that could file a
    // Tuesday's evidence under the wrong team.
    const { reds, greens } = await twoSquads();
    const draft = unwrap(await startDraft(ctx, { squadId: reds.id, objectiveText: 'Pressing' }));
    const started = unwrap(await commitAndStart(ctx, draft.id));

    const result = await switchSquad(ctx, greens.id);
    expect(isErr(result) && result.error).toEqual({
      kind: 'session_running',
      sessionTitle: started.title,
    });
    expect((await ctx.store.meta.get())?.activeSquadId).toBe(reds.id);
  });

  it('lets a draft for another squad stand in nobody’s way', async () => {
    // Drafts are one per squad, not one per device, so both survive the switch untouched.
    const { reds, greens } = await twoSquads();
    const redsDraft = unwrap(await startDraft(ctx, { squadId: reds.id, objectiveText: 'Press' }));

    expect(unwrap(await switchSquad(ctx, greens.id)).id).toBe(greens.id);
    expect(await ctx.store.sessions.get(redsDraft.id)).toBeDefined();
  });

  it('archives a squad without deleting a thing', async () => {
    const { reds, greens } = await twoSquads();
    const player = await addPlayer(ctx, { squadId: greens.id, name: 'Kai' });
    const draft = unwrap(await startDraft(ctx, { squadId: greens.id, objectiveText: 'Press' }));
    await switchSquad(ctx, reds.id);

    const archived = unwrap(await archiveSquad(ctx, greens.id));
    expect(archived.archivedAt).toBe(T0);
    expect(await ctx.store.squads.list()).toHaveLength(1);
    expect(await ctx.store.squads.list({ includeArchived: true })).toHaveLength(2);

    // The roster and the season are exactly where they were.
    expect(await ctx.store.players.get(player.id)).toBeDefined();
    expect(await ctx.store.sessions.get(draft.id)).toBeDefined();
  });

  it('moves the pointer off a squad it archives', async () => {
    const { reds, greens } = await twoSquads();
    await switchSquad(ctx, greens.id);

    unwrap(await archiveSquad(ctx, greens.id));
    expect((await ctx.store.meta.get())?.activeSquadId).toBe(reds.id);
  });

  it('refuses to archive the only squad', async () => {
    // Otherwise the app drops to `Name your squad` with a full database behind it, which
    // reads as "my season is gone".
    const reds = await createSquad(ctx, { name: 'U12 Reds' });

    const result = await archiveSquad(ctx, reds.id);
    expect(isErr(result) && result.error.kind).toBe('last_squad');
    expect(await ctx.store.squads.list()).toHaveLength(1);
  });

  it('refuses to archive a squad that is mid-session', async () => {
    const { greens } = await twoSquads();
    const draft = unwrap(await startDraft(ctx, { squadId: greens.id, objectiveText: 'Press' }));
    unwrap(await commitAndStart(ctx, draft.id));

    const result = await archiveSquad(ctx, greens.id);
    expect(isErr(result) && result.error.kind).toBe('session_running');
  });

  it('archives another squad happily while one is mid-session', async () => {
    const { reds, greens } = await twoSquads();
    const draft = unwrap(await startDraft(ctx, { squadId: reds.id, objectiveText: 'Press' }));
    unwrap(await commitAndStart(ctx, draft.id));

    expect(unwrap(await archiveSquad(ctx, greens.id)).archivedAt).toBe(T0);
  });

  it('archiving an already archived squad is an Ok no-op, and a ghost is not found', async () => {
    const { greens } = await twoSquads();
    unwrap(await archiveSquad(ctx, greens.id));

    expect(unwrap(await archiveSquad(ctx, greens.id)).id).toBe(greens.id);

    const ghost = await archiveSquad(ctx, asSquadId(testId('ghost')));
    expect(isErr(ghost) && ghost.error.kind).toBe('squad_not_found');
  });

  it('restores without leaving a null key behind, and does not make it current', async () => {
    const { reds, greens } = await twoSquads();
    await switchSquad(ctx, reds.id);
    unwrap(await archiveSquad(ctx, greens.id));

    const restored = await restoreSquad(ctx, greens.id);
    // Absent, not null — the same rule `restorePlayer` follows (ADR 0001).
    expect(restored && 'archivedAt' in restored).toBe(false);
    expect(await ctx.store.squads.list()).toHaveLength(2);
    // Back in the switcher, but switching to it is a tap of its own.
    expect((await ctx.store.meta.get())?.activeSquadId).toBe(reds.id);

    expect(await restoreSquad(ctx, asSquadId(testId('ghost')))).toBeUndefined();
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
