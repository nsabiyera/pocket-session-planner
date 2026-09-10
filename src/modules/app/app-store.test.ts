import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTest,
  __setDataStoreForTest,
  __setStateForTest,
  activeSessionId,
  getAppState,
  getServiceContext,
  isDataStoreOpen,
  patchActiveSession,
  periodizationEnabled,
  refresh,
  setActiveSquad,
  setTacticalPeriodization,
} from './app-store';
import { DatabaseClosedError } from '@/data/idb/idb-data-store';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { commitAndStart, startDraft } from '../planning/planning-service';
import { addPlayer, createSquad } from '../squad/squad-service';
import { getGameModel, setIdentity } from '../planning/game-model-service';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { unwrap } from '@/lib/result';
import { T0 } from '@/test/builders';
import type { ServiceContext } from '../context';

let store: FakeDataStore;
let ctx: ServiceContext;

beforeEach(() => {
  localStorage.clear();
  store = new FakeDataStore();
  ctx = { store, clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
  __resetForTest();
  __setDataStoreForTest(store);
});

afterEach(() => {
  __resetForTest();
});

describe('the app store', () => {
  it('starts idle and empty', () => {
    __resetForTest();
    expect(getAppState()).toMatchObject({ status: 'idle', squad: null, squads: [] });
  });

  it('reports ready with no squad on a fresh install', async () => {
    await refresh();
    const state = getAppState();

    expect(state.status).toBe('ready');
    expect(state.squad).toBeNull();
    // The presets are code-resident, so the catalogue is populated before anything is saved.
    expect(state.catalog).toHaveLength(5);
  });

  it('loads the squad, roster and open actions once there is data', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    await addPlayer(ctx, { squadId: squad.id, name: 'Kai' });
    await refresh();

    const state = getAppState();
    expect(state.squad?.id).toBe(squad.id);
    expect(state.players).toHaveLength(1);
    expect(state.status).toBe('ready');
  });

  it('surfaces the one draft as the active session', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const draft = unwrap(await startDraft(ctx, { squadId: squad.id, objectiveText: 'Pressing' }));
    await refresh();

    expect(activeSessionId(getAppState())).toBe(draft.id);
    expect(getAppState().reviewSession).toBeNull();
  });

  it('separates the running session from the one awaiting review', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const draft = unwrap(await startDraft(ctx, { squadId: squad.id, objectiveText: 'Pressing' }));
    const started = unwrap(await commitAndStart(ctx, draft.id));

    await refresh();
    expect(getAppState().activeSession?.status).toBe('in_progress');

    await store.sessions.put({ ...started, status: 'completed', reviewId: null });
    await refresh();
    expect(getAppState().reviewSession?.id).toBe(started.id);
  });

  it('prefers the squad app_meta points at', async () => {
    const first = await createSquad(ctx, { name: 'U12 Reds' });
    const second = await createSquad(ctx, { name: 'U13 Blues' });

    await setActiveSquad(second.id);
    expect(getAppState().squad?.id).toBe(second.id);

    await setActiveSquad(first.id);
    expect(getAppState().squad?.id).toBe(first.id);
  });

  it('notifies subscribers with a new snapshot object each time', async () => {
    const before = getAppState();
    await createSquad(ctx, { name: 'U12 Reds' });
    await refresh();

    // Referential inequality is what tells `useSyncExternalStore` to repaint.
    expect(getAppState()).not.toBe(before);
  });

  it('patchActiveSession replaces just the session, for the Do-mode hot path', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const draft = unwrap(await startDraft(ctx, { squadId: squad.id, objectiveText: 'Pressing' }));
    await refresh();

    const players = getAppState().players;
    patchActiveSession({ ...draft, title: 'Renamed · 31 Aug' });

    expect(getAppState().activeSession?.title).toBe('Renamed · 31 Aug');
    // A full refresh per tap would re-read the whole squad for nothing.
    expect(getAppState().players).toBe(players);
  });

  it('discards the synchronous mirror as soon as real data arrives', async () => {
    __setStateForTest({ mirror: { activeSessionId: null } as never });
    await refresh();
    expect(getAppState().mirror).toBeNull();
  });

  it('exposes a service context only once the store is open', () => {
    expect(isDataStoreOpen()).toBe(true);
    expect(getServiceContext().store).toBe(store);

    __setDataStoreForTest(null);
    expect(isDataStoreOpen()).toBe(false);
    expect(() => getServiceContext()).toThrow(/not open/);
  });

  it('refresh is a no-op with no store rather than throwing', async () => {
    __setDataStoreForTest(null);
    await expect(refresh()).resolves.toBeUndefined();
    await expect(setActiveSquad('x' as never)).resolves.toBeUndefined();
  });

  it('meets a closed database with silence rather than a crash report', async () => {
    // `refresh()` runs on every return to the app, which is exactly when the connection is
    // most likely to have gone — either a newer tab took it, and the reload banner is already
    // up, or `reopen()` is mid-swap. Throwing here reaches the global crash handler.
    vi.spyOn(store.meta, 'get').mockRejectedValue(new DatabaseClosedError());
    await expect(refresh()).resolves.toBeUndefined();

    // Everything else still surfaces.
    vi.spyOn(store.meta, 'get').mockRejectedValue(new Error('the disk is full'));
    await expect(refresh()).rejects.toThrow('the disk is full');
  });

  it('reports no active session when nothing is in flight', async () => {
    await createSquad(ctx, { name: 'U12 Reds' });
    await refresh();
    expect(activeSessionId(getAppState())).toBeNull();
  });

  describe('the tactical periodization flag', () => {
    it('is off for a squad that never asked for it', async () => {
      await createSquad(ctx, { name: 'U12 Reds' });
      await refresh();
      expect(periodizationEnabled(getAppState())).toBe(false);
    });

    it('is off before the database has opened', () => {
      // The cold-start frame: `meta` is null and the mirror is painting `Resume`. Four screens
      // read this, and the honest answer with no meta is the same as the default.
      expect(periodizationEnabled(getAppState())).toBe(false);
    });

    it('is off for an install whose meta predates the field', async () => {
      // Meta is stored and read unparsed, so a record written before this field existed has
      // `undefined` here rather than `false`. That must resolve to off, not to a truthy blank.
      await createSquad(ctx, { name: 'U12 Reds' });
      const stored = await store.meta.get();
      await store.meta.put({ ...stored!, tacticalPeriodization: undefined as never });
      await refresh();
      expect(periodizationEnabled(getAppState())).toBe(false);
    });

    it('turns on, survives a refresh, and turns back off', async () => {
      await createSquad(ctx, { name: 'First Team' });
      await setTacticalPeriodization(true);
      expect(periodizationEnabled(getAppState())).toBe(true);

      await refresh();
      expect(periodizationEnabled(getAppState())).toBe(true);

      await setTacticalPeriodization(false);
      expect(periodizationEnabled(getAppState())).toBe(false);
    });

    it('deletes nothing on the way off', async () => {
      // The promise the Settings copy makes. Turning the flag off hides screens; a game model
      // already authored has to still be there when the coach turns it back on.
      const squad = await createSquad(ctx, { name: 'First Team' });
      await setTacticalPeriodization(true);
      unwrap(await setIdentity(ctx, squad.id, 'We build from the back'));

      await setTacticalPeriodization(false);
      expect((await getGameModel(ctx, squad.id))?.identity).toBe('We build from the back');

      await setTacticalPeriodization(true);
      expect((await getGameModel(ctx, squad.id))?.identity).toBe('We build from the back');
    });

    it('does nothing rather than throwing when the store is not open', async () => {
      __setDataStoreForTest(null);
      await expect(setTacticalPeriodization(true)).resolves.toBeUndefined();
    });
  });
});
