import type { IDBPDatabase } from 'idb';
import type { PocketDBSchema } from '../schema';

/**
 * Migration 4 — photographs of the practice.
 *
 * Adds the `phase_images` store: the drawing a coach did at the kitchen table, put back under
 * their thumb during delivery.
 *
 * **The first store since the microscope, and the first the practice-design work could not
 * avoid.** Every field added for spectrum, area, constraints and player choice rode
 * `nullable().default()` on an existing document precisely to skip this ladder. Images are
 * binary and large, so they get a store, and the phase holds ids only.
 *
 * One index. `by-session` is what export, import and cleanup all need — "every drawing
 * belonging to this session" — and it is the only question anything asks of this store in
 * bulk. Do mode looks images up by id, which the key path already answers.
 *
 * Appended, never edited into v1-v3: a coach already on version 3 runs only this block.
 */
export function migrateToV4(db: IDBPDatabase<PocketDBSchema>): void {
  const images = db.createObjectStore('phase_images', { keyPath: 'id' });
  images.createIndex('by-session', 'sessionId');
}
