import type { IDBPDatabase } from 'idb';
import type { PocketDBSchema } from '../schema';

/**
 * Migration 1 — the initial schema.
 *
 * **This function has shipped. Never modify it.** A coach whose database is already at
 * version 1 will never run it again, so a change here would only affect fresh installs and
 * would silently give the two populations different indexes. New structure goes in a new
 * `v2.ts` appended to the ladder.
 */
export function migrateToV1(db: IDBPDatabase<PocketDBSchema>): void {
  const squads = db.createObjectStore('squads', { keyPath: 'id' });
  squads.createIndex('by-updated', 'updatedAt');

  const players = db.createObjectStore('players', { keyPath: 'id' });
  players.createIndex('by-squad', 'squadId');
  players.createIndex('by-name', 'name');

  const methodologies = db.createObjectStore('methodologies', { keyPath: 'id' });
  methodologies.createIndex('by-updated', 'updatedAt');

  db.createObjectStore('methodology_prefs', { keyPath: 'methodologyId' });

  const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
  sessions.createIndex('by-squad-scheduled', ['squadId', 'scheduledFor']);
  sessions.createIndex('by-squad-status', ['squadId', 'status']);
  sessions.createIndex('by-status', 'status');
  sessions.createIndex('by-updated', 'updatedAt');

  const observations = db.createObjectStore('observations', { keyPath: 'id' });
  observations.createIndex('by-session-at', ['sessionId', 'at']);
  // Records with no `playerId` are absent from this index — see the note in schema.ts.
  observations.createIndex('by-player-at', ['playerId', 'at']);
  observations.createIndex('by-phase', 'phaseId');
  observations.createIndex('by-squad-at', ['squadId', 'at']);

  const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
  // Unique: a session has one review. A second write is a bug, and should fail loudly.
  reviews.createIndex('by-session', 'sessionId', { unique: true });
  reviews.createIndex('by-squad-completed', ['squadId', 'completedAt']);

  const actions = db.createObjectStore('carry_forward_actions', { keyPath: 'id' });
  actions.createIndex('by-squad-status', ['squadId', 'status']);
  actions.createIndex('by-origin-session', 'originSessionId');
  actions.createIndex('by-player', 'playerIds', { multiEntry: true });

  db.createObjectStore('app_meta', { keyPath: 'key' });
}
