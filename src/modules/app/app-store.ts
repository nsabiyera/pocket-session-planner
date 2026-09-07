'use client';

import { useSyncExternalStore } from 'react';
import type { CarryForwardAction } from '@/domain/carry-forward';
import type { SessionId, SquadId } from '@/domain/ids';
import type { Player } from '@/domain/player';
import type { Session } from '@/domain/session';
import type { Squad } from '@/domain/squad';
import { rememberNamesToRedact } from '@/lib/crash-store';
import { IdbDataStore } from '@/data/idb/idb-data-store';
import type { AppMeta, CatalogEntry, PocketDataStore } from '@/data/ports/data-store';
import { systemClock } from '@/lib/clock';
import { cryptoIdGenerator } from '@/lib/id';
import { readResumeMirror, type ResumeMirror } from '@/lib/resume-mirror';
import { createStore } from '@/lib/store';
import type { ServiceContext } from '../context';

/**
 * The single source of truth for every screen.
 *
 * One module store read through `useSyncExternalStore` — the whole of the "no client state
 * library" convention. A write in Do mode repaints the home screen's resume line without
 * either component knowing the other exists.
 *
 * Loading is deliberately two-stage. The **synchronous `localStorage` mirror** is read during
 * the very first render so `/` can paint `Resume — Main practice, 8:42 left` immediately;
 * IndexedDB then opens and replaces it with the truth. See ADR 0002.
 */

export type AppStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AppState {
  readonly status: AppStatus;
  readonly error: string | null;
  readonly squads: readonly Squad[];
  readonly squad: Squad | null;
  readonly players: readonly Player[];
  /** The one draft, planned or in-progress session. See ADR 0003. */
  readonly activeSession: Session | null;
  /** The one completed session with no review yet. */
  readonly reviewSession: Session | null;
  readonly recentSessions: readonly Session[];
  readonly openActions: readonly CarryForwardAction[];
  readonly catalog: readonly CatalogEntry[];
  readonly meta: AppMeta | null;
  /** Painted before IndexedDB opens. Discarded the moment real data arrives. */
  readonly mirror: ResumeMirror | null;
  /** A stale connection was closed by a newer tab; the UI prompts a reload. */
  readonly needsReload: boolean;
}

const EMPTY: AppState = {
  status: 'idle',
  error: null,
  squads: [],
  squad: null,
  players: [],
  activeSession: null,
  reviewSession: null,
  recentSessions: [],
  openActions: [],
  catalog: [],
  meta: null,
  mirror: null,
  needsReload: false,
};

const store = createStore<AppState>(EMPTY);

/**
 * Prerendering runs in Node, where there is no IndexedDB and no `localStorage`. Returning a
 * frozen empty state keeps the static HTML consistent with the first client render, so
 * hydration never mismatches — every screen simply renders its loading state.
 */
const SERVER_SNAPSHOT: AppState = EMPTY;

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
}

/** For code outside React — the service-calling helpers below. */
export function getAppState(): AppState {
  return store.getSnapshot();
}

let dataStore: PocketDataStore | null = null;
let opening: Promise<void> | null = null;

export function getServiceContext(): ServiceContext {
  if (!dataStore) throw new Error('The data store is not open yet.');
  return { store: dataStore, clock: systemClock, ids: cryptoIdGenerator };
}

export function isDataStoreOpen(): boolean {
  return dataStore !== null;
}

/**
 * Opens the database and loads everything. Idempotent and concurrency-safe: React 19 strict
 * mode mounts effects twice, and two `IdbDataStore.open()` calls would leave a leaked
 * connection blocking the next upgrade.
 */
export function initApp(): Promise<void> {
  if (opening) return opening;

  // Paint from the mirror first — synchronous, so this lands in the very next frame.
  store.setState((current) => ({
    ...current,
    status: 'loading',
    mirror: readResumeMirror(),
  }));

  opening = (async () => {
    try {
      dataStore = await IdbDataStore.open({
        onBlocking: () => store.setState((s) => ({ ...s, needsReload: true })),
        onTerminated: () => store.setState((s) => ({ ...s, needsReload: true })),
      });
      await refresh();
    } catch (error) {
      store.setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not open the database.',
      }));
    }
  })();

  return opening;
}

/** Re-reads everything the shell shows. Cheap enough to call after every mutation. */
export async function refresh(): Promise<void> {
  if (!dataStore) return;

  const meta = await dataStore.meta.get();
  const squads = await dataStore.squads.list();
  const preferredId = (meta?.activeSquadId ?? null) as SquadId | null;
  const squad = squads.find((candidate) => candidate.id === preferredId) ?? squads[0] ?? null;

  if (!squad) {
    store.setState({
      ...EMPTY,
      status: 'ready',
      meta: meta ?? null,
      catalog: await dataStore.methodologies.list(),
    });
    return;
  }

  const [players, activeSession, reviewSession, recentSessions, openActions, catalog] =
    await Promise.all([
      dataStore.players.listBySquad(squad.id),
      dataStore.sessions.findActive(),
      dataStore.sessions.findAwaitingReview(squad.id),
      dataStore.sessions.listRecentCompleted(squad.id, 10),
      dataStore.actions.listOpen(squad.id),
      dataStore.methodologies.list(),
    ]);

  /*
   * Hand the crash reporter the names it must never publish.
   *
   * Done here because a global error handler has no React context and cannot await a read.
   * The reporter keeps them in `localStorage` so it can redact a stack trace synchronously,
   * before anything is rendered and before the coach sees the report.
   */
  rememberNamesToRedact([
    ...players.map((player) => player.name),
    ...squads.map((candidate) => candidate.name),
  ]);

  store.setState((current) => ({
    ...current,
    status: 'ready',
    error: null,
    squads,
    squad,
    players,
    activeSession: activeSession ?? null,
    reviewSession: reviewSession ?? null,
    recentSessions,
    openActions,
    catalog,
    meta: meta ?? null,
    // The truth has arrived; the placeholder is no longer needed.
    mirror: null,
  }));
}

/**
 * Replaces just the active session in the snapshot.
 *
 * Do mode dispatches several commands a second at its busiest, and a full `refresh()` per tap
 * would re-read the whole squad for nothing. The rest of the state cannot have changed.
 */
export function patchActiveSession(session: Session): void {
  store.setState((current) => ({ ...current, activeSession: session, mirror: null }));
}

export function setActiveSquad(squadId: SquadId): Promise<void> {
  if (!dataStore) return Promise.resolve();
  return dataStore.meta
    .patch({ activeSquadId: squadId }, systemClock.nowIso() as never)
    .then(() => refresh());
}

/** Closes and reopens — used after an import, which rewrites everything underneath us. */
export async function reopen(): Promise<void> {
  dataStore?.close();
  dataStore = null;
  opening = null;
  await initApp();
}

/** Test seam: lets component tests drive the shell without IndexedDB. */
export function __setStateForTest(state: Partial<AppState>): void {
  store.setState((current) => ({ ...current, ...state }));
}

export function __setDataStoreForTest(next: PocketDataStore | null): void {
  dataStore = next;
  opening = next ? Promise.resolve() : null;
}

export function __resetForTest(): void {
  dataStore = null;
  opening = null;
  store.setState(EMPTY);
}

/** The session `/plan` and `/run` operate on, without threading an id through the URL. */
export function activeSessionId(state: AppState): SessionId | null {
  return state.activeSession?.id ?? null;
}
