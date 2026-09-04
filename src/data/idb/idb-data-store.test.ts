import { describe, expect, it } from 'vitest';
import { describeDataStoreContract } from '../ports/data-store-contract';
import { IdbDataStore } from './idb-data-store';
import { deleteDatabase, openDatabase } from './open-database';
import { DB_VERSION } from './schema';
import {
  anAssessment,
  anObservation,
  aReview,
  aScan,
  aSession,
  aSquad,
  playerId,
  SQUAD_ID,
  T0,
  testId,
} from '@/test/builders';
import { asObservationId, asReviewId, asSessionId } from '@/domain/ids';

/**
 * The real adapter, held to the **same contract** as the fake, under `fake-indexeddb`.
 *
 * This is the test that earns the offline layer its coverage honestly. Anything the fake
 * lets through that IndexedDB would not — an unclonable value, a null index key, a
 * transaction awaited across a microtask — shows up here rather than on a pitch.
 */

let counter = 0;
describeDataStoreContract('IdbDataStore', async () => {
  // A fresh database per suite run: `fake-indexeddb` is a module-level singleton, and a
  // shared name would leak an upgrade between test files.
  counter += 1;
  return IdbDataStore.open({ name: `psp-contract-${counter}` });
});

describe('IdbDataStore — IndexedDB specifics', () => {
  const freshStore = async (name: string) => {
    await deleteDatabase(name);
    return IdbDataStore.open({ name });
  };

  it('creates every store and index the schema declares', async () => {
    const db = await openDatabase({ name: 'psp-schema-check' });
    expect([...db.objectStoreNames].sort()).toEqual([
      'app_meta',
      'capability_scans',
      'carry_forward_actions',
      'methodologies',
      'methodology_prefs',
      'observations',
      'player_assessments',
      'players',
      'reviews',
      'sessions',
      'squads',
    ]);
    expect(db.version).toBe(DB_VERSION);

    const tx = db.transaction(
      ['observations', 'carry_forward_actions', 'player_assessments', 'capability_scans'],
      'readonly',
    );
    expect([...tx.objectStore('observations').indexNames].sort()).toEqual([
      'by-phase',
      'by-player-at',
      'by-player-corner',
      'by-session-at',
      'by-squad-at',
    ]);
    expect([...tx.objectStore('player_assessments').indexNames].sort()).toEqual([
      'by-player-at',
      'by-squad-at',
    ]);
    expect([...tx.objectStore('carry_forward_actions').indexNames].sort()).toEqual([
      'by-origin-session',
      'by-player',
      'by-squad-status',
    ]);
    expect([...tx.objectStore('capability_scans').indexNames].sort()).toEqual([
      'by-player-at',
      'by-player-skill-at',
      'by-squad-at',
    ]);
    await tx.done;
    db.close();
  });

  it('really does skip records whose index key path is undefined', async () => {
    // The behaviour ADR 0001 is built around, asserted against a real IndexedDB rather than
    // taken on trust. A team-wide observation has no `playerId`, so `by-player-at` cannot
    // see it — which is exactly the semantics we want.
    const store = await freshStore('psp-index-nulls');
    await store.observations.putMany([
      anObservation('withPlayer', { playerId: playerId('kai'), at: T0 }),
      anObservation('teamWide', { at: T0, kind: 'note' }),
    ]);

    expect(await store.observations.listByPlayer(playerId('kai'))).toHaveLength(1);
    // Both rows are still in the store; only the index excludes one of them.
    expect(await store.observations.listBySession(asSessionId(testId('session1')))).toHaveLength(2);
    store.close();
  });

  it('enforces one review per session through the unique index', async () => {
    const store = await freshStore('psp-unique-review');
    await store.reviews.put(aReview());

    const duplicate = aReview({ id: asReviewId(testId('review2')) });
    await expect(store.reviews.put(duplicate)).rejects.toThrow();
    store.close();
  });

  it('refuses to nest transactions rather than deadlocking against its own locks', async () => {
    const store = await freshStore('psp-nested-tx');
    await expect(
      store.transact(['squads'], 'readwrite', async (tx) => {
        await tx.transact(['players'], 'readwrite', async () => undefined);
      }),
    ).rejects.toThrow(/already open/);
    store.close();
  });

  it('aborts the real transaction on throw, leaving nothing half-written', async () => {
    const store = await freshStore('psp-abort');
    await store.sessions.put(aSession());

    await expect(
      store.transact(['sessions', 'observations'], 'readwrite', async (tx) => {
        await tx.observations.put(anObservation('o1'));
        await tx.sessions.put(aSession({ title: 'Half-written · 31 Aug' }));
        throw new Error('integrity check failed');
      }),
    ).rejects.toThrow('integrity check failed');

    expect(await store.observations.get(asObservationId(testId('o1')))).toBeUndefined();
    expect((await store.sessions.get(aSession().id))?.title).toBe(
      'Playing out from the back · 31 Aug',
    );
    store.close();
  });

  it('survives being reopened — the data is genuinely on disk, not in a closure', async () => {
    const name = 'psp-reopen';
    const first = await freshStore(name);
    await first.sessions.put(aSession());
    first.close();

    const second = await IdbDataStore.open({ name });
    expect((await second.sessions.get(aSession().id))?.title).toBe(
      'Playing out from the back · 31 Aug',
    );
    expect(await second.sessions.listBySquad(SQUAD_ID)).toHaveLength(1);
    second.close();
  });

  it('upgrades a v1 database in place, keeping every row', async () => {
    // The append-only ladder's whole promise: a coach already on v1 gets the new store and
    // the new index without losing a single observation.
    const name = 'psp-v1-upgrade';
    await deleteDatabase(name);

    const v1 = await openDatabase({ name, version: 1 });
    expect(v1.objectStoreNames.contains('player_assessments')).toBe(false);
    await v1.put('observations', anObservation('legacy', { playerId: playerId('kai') }));
    await v1.put('squads', aSquad());
    v1.close();

    const v2 = await openDatabase({ name });
    expect(v2.version).toBe(DB_VERSION);
    expect(v2.objectStoreNames.contains('player_assessments')).toBe(true);

    const tx = v2.transaction('observations', 'readonly');
    expect([...tx.objectStore('observations').indexNames]).toContain('by-player-corner');
    await tx.done;

    // The data survived the upgrade.
    expect(await v2.count('observations')).toBe(1);
    expect(await v2.count('squads')).toBe(1);
    v2.close();

    // And the new index works against a row written before it existed — which is only true
    // because IndexedDB rebuilds indexes over existing records during the upgrade.
    const store = new IdbDataStore(await openDatabase({ name }));
    await store.observations.put(
      anObservation('after', { playerId: playerId('kai'), corner: 'social' }),
    );
    expect(await store.observations.listByPlayerCorner(playerId('kai'), 'social')).toHaveLength(1);
    // The legacy row has no corner, so it is absent from the index rather than miscounted.
    expect(await store.observations.listByPlayer(playerId('kai'))).toHaveLength(2);
    store.close();
  });

  it('upgrades a v2 database in place, adding the scan store and keeping every row', async () => {
    // The path a coach who already has the 4 Corner release actually takes.
    const name = 'psp-v2-upgrade';
    await deleteDatabase(name);

    const v2 = await openDatabase({ name, version: 2 });
    expect(v2.objectStoreNames.contains('capability_scans')).toBe(false);
    await v2.put('player_assessments', anAssessment('legacy'));
    await v2.put('squads', aSquad());
    v2.close();

    const v3 = await openDatabase({ name });
    expect(v3.version).toBe(DB_VERSION);
    expect(v3.objectStoreNames.contains('capability_scans')).toBe(true);

    const tx = v3.transaction('capability_scans', 'readonly');
    expect([...tx.objectStore('capability_scans').indexNames].sort()).toEqual([
      'by-player-at',
      'by-player-skill-at',
      'by-squad-at',
    ]);
    await tx.done;

    // The assessment written before the upgrade is still there.
    expect(await v3.count('player_assessments')).toBe(1);
    expect(await v3.count('squads')).toBe(1);
    v3.close();

    // And the store the migration added answers the question it exists for.
    const store = new IdbDataStore(await openDatabase({ name }));
    await store.scans.put(aScan('turning1', { skill: 'turning' }));
    await store.scans.put(aScan('pressing1', { skill: 'pressing' }));

    expect(await store.scans.listByPlayerSkill(playerId('kai'), 'turning')).toHaveLength(1);
    expect(await store.scans.listByPlayer(playerId('kai'))).toHaveLength(2);
    store.close();
  });

  it('opening at the same version twice does not re-run the migration', async () => {
    const name = 'psp-idempotent-open';
    const first = await openDatabase({ name });
    first.close();
    const second = await openDatabase({ name });
    expect(second.version).toBe(DB_VERSION);
    second.close();
  });
});
