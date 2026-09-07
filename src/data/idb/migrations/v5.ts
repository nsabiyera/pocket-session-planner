import type { IDBPDatabase } from 'idb';
import type { PocketDBSchema } from '../schema';

/**
 * Migration 5 — the game model.
 *
 * Adds the `game_models` store: a squad's intended way of playing, decomposed into principles
 * across the four moments (ADR 0007).
 *
 * **The second store the tactical work could not avoid**, and for the same reason images could
 * not: this is a new aggregate rather than a new field. Match day (ADR 0005) deliberately went
 * the other way — `kind` and `match` rode `nullable().default()` on the session document
 * precisely to skip this ladder — but a game model outlives every session that references it
 * and is edited on its own schedule, so there is no document it could ride without distorting
 * one. ADR 0001's rule is that only new aggregates pay the store tax; this one is.
 *
 * One index. `by-squad` answers the only question anything asks in bulk: *"this squad's model"*.
 * There is exactly one per squad, so this is effectively a unique lookup — IndexedDB cannot
 * enforce that, so `putGameModel` does.
 *
 * Appended, never edited into v1-v4: a coach already on version 4 runs only this block.
 */
export function migrateToV5(db: IDBPDatabase<PocketDBSchema>): void {
  const models = db.createObjectStore('game_models', { keyPath: 'id' });
  models.createIndex('by-squad', 'squadId');
}
