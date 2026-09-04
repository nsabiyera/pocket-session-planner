import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import { migrateToV1 } from './migrations/v1';
import { migrateToV2, type IdbUpgradeTx } from './migrations/v2';
import { migrateToV3 } from './migrations/v3';
import { DB_NAME, DB_VERSION, type PocketDBSchema } from './schema';

export interface OpenDatabaseOptions {
  name?: string;
  version?: number;
  /**
   * Another tab is holding an old version open and blocking our upgrade. There is nothing
   * we can do from here except tell the coach — hence a callback rather than a console
   * warning nobody will ever see on a phone.
   */
  onBlocked?: () => void;
  /** *We* are the old version blocking a newer tab. We close; the UI prompts a reload. */
  onBlocking?: () => void;
  /** The browser killed the connection (usually storage pressure). Everything must reopen. */
  onTerminated?: () => void;
}

/**
 * Opens the database, running the migration ladder as needed.
 *
 * The ladder is **append-only**: each `if (oldVersion < n)` block is a shipped migration that
 * must never be edited. A coach upgrading from v1 to v4 runs blocks 2, 3 and 4 in order; a
 * fresh install runs all of them and arrives at exactly the same schema.
 */
export async function openDatabase(
  options: OpenDatabaseOptions = {},
): Promise<IDBPDatabase<PocketDBSchema>> {
  const { name = DB_NAME, version = DB_VERSION } = options;

  // `blocking` fires on a `versionchange` event against a connection we already hold, so it
  // can only run after this await has resolved — referring to `connection` from inside it is
  // safe despite the apparent cycle.
  const connection: IDBPDatabase<PocketDBSchema> = await openDB<PocketDBSchema>(name, version, {
    upgrade(db, oldVersion, newVersion, transaction) {
      /**
       * A step runs only when the database is *below* it **and** the version being opened is
       * at or above it.
       *
       * The `newVersion` half matters: guarding on `oldVersion` alone means opening a fresh
       * database at version 1 also runs step 2, and the later real upgrade to version 2 then
       * throws `ConstraintError` trying to create a store that already exists. In production
       * we always open at `DB_VERSION`, so it is latent — which is exactly the kind of bug
       * that surfaces years later during someone's migration.
       */
      const runs = (step: number) => oldVersion < step && (newVersion ?? DB_VERSION) >= step;

      if (runs(1)) migrateToV1(db);
      if (runs(2)) migrateToV2(db, transaction as unknown as IdbUpgradeTx);
      if (runs(3)) migrateToV3(db);
      // if (runs(4)) migrateToV4(db, transaction);  <- append here, never edit above
    },
    blocked() {
      options.onBlocked?.();
    },
    blocking() {
      // Close immediately so the other tab's upgrade can proceed. Holding the connection
      // open would deadlock both tabs indefinitely, and neither would say why.
      connection.close();
      options.onBlocking?.();
    },
    terminated() {
      options.onTerminated?.();
    },
  });

  return connection;
}

/** Deletes the whole database. Settings → wipe, and test teardown. */
export async function deleteDatabase(name = DB_NAME): Promise<void> {
  await deleteDB(name);
}
