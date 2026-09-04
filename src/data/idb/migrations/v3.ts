import type { IDBPDatabase } from 'idb';
import type { PocketDBSchema } from '../schema';

/**
 * Migration 3 — the FA's six core capabilities.
 *
 * Adds the `capability_scans` store: one player, under the microscope, on one skill.
 *
 * Three indexes, each earning its place. `by-player-at` and `by-squad-at` mirror
 * `player_assessments` — the profile leads with "where are they now". `by-player-skill-at` is
 * the one this store exists for: *"every turning scan of Kai, oldest first"* is the
 * comparison that makes a scan worth recording at all, and without the index it is a full
 * walk of the store on a phone.
 *
 * Appended, never edited into v1 or v2: a coach already on version 2 runs only this block,
 * and a fresh install runs all three in order and arrives at exactly the same schema.
 */
export function migrateToV3(db: IDBPDatabase<PocketDBSchema>): void {
  const scans = db.createObjectStore('capability_scans', { keyPath: 'id' });
  scans.createIndex('by-player-at', ['playerId', 'scannedAt']);
  scans.createIndex('by-squad-at', ['squadId', 'scannedAt']);
  scans.createIndex('by-player-skill-at', ['playerId', 'skill', 'scannedAt']);
}
