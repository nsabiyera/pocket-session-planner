import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';

/**
 * The **document** migration ladder — data-shape changes, as distinct from the structural
 * `DB_VERSION` ladder in `src/data/idb/migrations/`.
 *
 * Applied **lazily on read** in the app (migrate → write back → return), so a coach with
 * three seasons of observations does not stare at a spinner on launch, and **eagerly on
 * import**, where the file may have come from any older build.
 *
 * Each step is `(document) => document`, keyed by the version it upgrades *from*. Append
 * only; never edit a shipped step.
 */
export type MigrationStep = (document: Record<string, unknown>) => Record<string, unknown>;

const STEPS: Record<number, MigrationStep> = {
  // 1 -> 2 goes here when the first shape change ships. For example:
  // 1: (doc) => ({ ...doc, someNewField: [], schemaVersion: 2 }),
};

/**
 * Walks a document up to the current schema version.
 *
 * A document from the future — a file exported by a newer build — is returned untouched.
 * The schema parse that follows will reject it if it genuinely does not fit, which is a
 * better failure than silently dropping fields we do not understand.
 */
export function migrateDocument(document: Record<string, unknown>): Record<string, unknown> {
  let current = document;
  let version = typeof current.schemaVersion === 'number' ? current.schemaVersion : 1;

  // A document with no version at all predates versioning. Stamp it as 1 so the schema
  // parse that follows has something to check rather than rejecting it for an absent field.
  if (current.schemaVersion !== version) current = { ...current, schemaVersion: version };

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = STEPS[version];
    if (!step) {
      // No step for this version: stamp it forward and let the schema decide. This is the
      // normal path while `CURRENT_SCHEMA_VERSION` is 1 and there are no steps at all.
      current = { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
      break;
    }
    current = step(current);
    const next = typeof current.schemaVersion === 'number' ? current.schemaVersion : version + 1;
    if (next <= version) {
      throw new Error(`Migration from schema version ${version} did not advance the version.`);
    }
    version = next;
  }

  return current;
}

export function migrateAll(documents: readonly unknown[]): Record<string, unknown>[] {
  return documents.map((document) => migrateDocument((document ?? {}) as Record<string, unknown>));
}

export function needsMigration(document: { schemaVersion?: number }): boolean {
  return (document.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION;
}
