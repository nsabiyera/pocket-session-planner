import type { IDBPDatabase } from 'idb';
import type { PocketDBSchema } from '../schema';

/**
 * Migration 2 — the FA 4 Corner Model.
 *
 * Adds the `player_assessments` store and an index letting the profile answer "everything
 * psychological about Kai" as a single range scan rather than a full walk of their timeline.
 *
 * Appended, never edited into v1: a coach already on version 1 runs only this block, and a
 * fresh install runs both in order and arrives at exactly the same schema. Editing `v1.ts` to
 * add these would give the two populations silently different databases.
 */
export function migrateToV2(db: IDBPDatabase<PocketDBSchema>, transaction: IdbUpgradeTx): void {
  const assessments = db.createObjectStore('player_assessments', { keyPath: 'id' });
  assessments.createIndex('by-player-at', ['playerId', 'assessedAt']);
  assessments.createIndex('by-squad-at', ['squadId', 'assessedAt']);

  // `corner` is optional-omitted, so unclassified observations are absent from this index —
  // which is the desired semantics, not a gap. See ADR 0001.
  transaction.objectStore('observations').createIndex('by-player-corner', ['playerId', 'corner']);
}

/**
 * The upgrade transaction `idb` hands to `upgrade()`. Typed loosely on purpose: adding an
 * index to an *existing* store needs the version-change transaction rather than the `db`
 * handle, and the precise generic is unhelpfully wide.
 */
export interface IdbUpgradeTx {
  objectStore(name: 'observations'): { createIndex(name: string, keyPath: string[]): unknown };
}
