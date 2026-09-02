import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetForTest,
  __setDataStoreForTest,
  __setStateForTest,
  activeSessionId,
  getAppState,
  getServiceContext,
  isDataStoreOpen,
  patchActiveSession,
  refresh,
  setActiveSquad,
} from './app-store';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { commitAndStart, startDraft } from '../planning/planning-service';
import { addPlayer, createSquad } from '../squad/squad-service';
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

  it('reports no active session when nothing is in flight', async () => {
    await createSquad(ctx, { name: 'U12 Reds' });
    await refresh();
    expect(activeSessionId(getAppState())).toBeNull();
  });
});
