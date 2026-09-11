'use client';

import { useSyncExternalStore } from 'react';
import type { CarryForwardAction } from '@/domain/carry-forward';
import type { SessionId, SquadId } from '@/domain/ids';
import type { Player } from '@/domain/player';
import type { Session } from '@/domain/session';
import type { Squad } from '@/domain/squad';
import { rememberNamesToRedact } from '@/lib/crash-store';
import { DatabaseClosedError, IdbDataStore } from '@/data/idb/idb-data-store';
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
  /** The squads a coach is currently coaching. Archived ones are read on demand, in Settings. */
  readonly squads: readonly Squad[];
  /** The one the whole app is about. Changed in Settings via `switchSquad` (ADR 0010). */
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
      /*
       * Only a newer tab earns the reload prompt: this page is running the old code and
       * cannot be talked round. A connection the *browser* drops — the ordinary fate of a
       * backgrounded page on a phone — is reopened by the data store on the next call, so
       * asking the coach to reload for it would be both alarming and unnecessary.
       */
      dataStore = await IdbDataStore.open({
        onBlocking: () => store.setState((s) => ({ ...s, needsReload: true })),
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

/**
 * Re-reads everything the shell shows. Cheap enough to call after every mutation.
 *
 * Called on every `visibilitychange → visible`, which is exactly when the connection is
 * most likely to have been closed underneath us — so a closed store is answered with
 * silence rather than a crash report. Either another tab is upgrading, and the reload
 * banner is already up, or `reopen()` is swapping the store and a fresh read is moments
 * away. Every other failure still surfaces.
 */
export async function refresh(): Promise<void> {
  if (!dataStore) return;
  try {
    await read(dataStore);
  } catch (error) {
    if (error instanceof DatabaseClosedError) return;
    throw error;
  }
}

async function read(dataStore: PocketDataStore): Promise<void> {
  const meta = await dataStore.meta.get();

  /*
   * Read the archived squads too, then split.
   *
   * `state.squads` is the live list — it is what the switcher offers, and an archived team
   * must not be switchable from anywhere. But the crash reporter needs *every* squad name it
   * must never publish, last season's included, and that is worth more than the second read
   * avoiding it would cost.
   */
  const allSquads = await dataStore.squads.list({ includeArchived: true });
  const squads = allSquads.filter((candidate) => candidate.archivedAt === undefined);

  /*
   * A run in progress outranks the stored pointer.
   *
   * `findActive()` is deliberately device-wide — *"the coach has one session in flight,
   * whoever it is with"* — so a running session decides which squad the app is about, and
   * every screen lines up behind the session the coach is standing in front of. This is the
   * other half of `switchSquad`'s refusal (ADR 0010): the switch is blocked mid-run precisely
   * because this line would override it a moment later.
   */
  const active = await dataStore.sessions.findActive();
  const running = active?.status === 'in_progress' ? active : undefined;
  const preferredId = (meta?.activeSquadId ?? null) as SquadId | null;

  /*
   * A running session is resolved against `allSquads`, not the live list, so the squad and
   * the session can never disagree. A run on an archived squad should not be reachable —
   * archiving refuses mid-run — but an imported file can assert any pair of facts it likes,
   * and every screen below here assumes `activeSession` belongs to `squad`.
   */
  const squad =
    (running ? allSquads.find((candidate) => candidate.id === running.squadId) : undefined) ??
    squads.find((candidate) => candidate.id === preferredId) ??
    squads[0] ??
    null;

  if (!squad) {
    store.setState({
      ...EMPTY,
      status: 'ready',
      meta: meta ?? null,
      catalog: await dataStore.methodologies.list(),
    });
    return;
  }

  /*
   * The active session, scoped to this squad — which matters the moment a coach has two.
   *
   * Drafts are one *per squad* (ADR 0003 holds per squad, not per device), so a coach with the
   * U12s and the U14s can legitimately have a half-composed session for each. Handing `/plan`
   * the other team's draft, under a header naming this one, would let them edit the wrong
   * session and never notice.
   *
   * A run needs no second read: it was already found above, and it is the reason `squad` is
   * what it is.
   */
  const [players, activeSession, reviewSession, recentSessions, openActions, catalog] =
    await Promise.all([
      dataStore.players.listBySquad(squad.id),
      running ?? dataStore.sessions.findActive(squad.id),
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
    ...allSquads.map((candidate) => candidate.name),
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

/**
 * Switch the tactical periodization planning set on or off (ADR 0008).
 *
 * A `meta.patch` rather than squad data, so it is one device's answer and never travels in the
 * export — see `AppMetaSchema.tacticalPeriodization`. Turning it off writes nothing else: no
 * game model is deleted, no session's `principleId` is cleared, and no stored `Squad.level` is
 * reset, which is what makes the switch safe to try.
 */
export function setTacticalPeriodization(enabled: boolean): Promise<void> {
  if (!dataStore) return Promise.resolve();
  return dataStore.meta
    .patch({ tacticalPeriodization: enabled }, systemClock.nowIso() as never)
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

/**
 * Is the tactical periodization work switched on? (ADR 0008.)
 *
 * **One accessor, and nothing reads `meta.tacticalPeriodization` directly** — the same rule
 * `resolvePhaseIntervention` sets for the intervention plan. Four screens and one component
 * hang off this, and a flag re-derived in five places is a flag that will disagree with
 * itself the first time one of them is edited.
 *
 * Absent meta answers `false`: a cold start before IndexedDB opens, and any install whose
 * meta was written before the field existed. Both are the safe answer rather than a
 * placeholder — the periodization screens are the ones a coach has to ask for.
 */
export function periodizationEnabled(state: AppState): boolean {
  return state.meta?.tacticalPeriodization ?? false;
}
