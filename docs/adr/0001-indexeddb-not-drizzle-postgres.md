# ADR 0001 — IndexedDB behind a repository port, not Drizzle/Postgres

- **Status:** Accepted
- **Date:** 2026-08-31
- **Divergence from:** `hodorhub` (Drizzle ORM + PostgreSQL)

## Context

Pocket Session Planner is an **offline-first PWA with no backend and no accounts**. A coach
standing on a pitch has no signal and no laptop; every byte of their data lives on the device.
There is no server process to run migrations against, no connection pool to hold, and no
network round-trip to make. Drizzle and Postgres — the house persistence stack in `hodorhub` —
have nothing to bind to.

The browser offers three durable stores. `localStorage` is synchronous, string-only and ~5 MB;
it cannot hold a season of observations and it blocks the main thread, which is fatal for a
250ms timer repaint. The Cache API is for HTTP responses. **IndexedDB** is the only option with
indexes, transactions and a realistic quota.

Raw IndexedDB is unpleasant enough to be a hazard: a callback API, and an auto-commit rule that
silently kills a transaction the moment you await a non-IDB promise inside it. `dexie` fixes
that but costs ~25 kB and brings a query DSL we would immediately hide behind our own port.
`idb` (~1.2 kB gzip) is a faithful promise wrapper with a generic `DBSchema` type that
compile-time-checks store names and index key types, a first-class `upgrade()` hook, and the
`blocked` / `blocking` / `terminated` callbacks needed for honest multi-tab handling.

## Decision

**Persist to IndexedDB via `idb` ^8, behind a repository port.**

- `src/data/ports/data-store.ts` defines `PocketDataStore` — a set of repositories plus a
  multi-store `transact()`. Nothing above `src/data` knows IndexedDB exists.
- `src/data/idb/idb-data-store.ts` is the real adapter.
- `src/data/ports/fake-data-store.ts` is an in-memory adapter used by **every** test above the
  data layer.
- `src/data/ports/data-store-contract.ts` exports one shared contract suite, run against
  **both** implementations — directly for the fake, and under `fake-indexeddb` for the real one.
  This is what keeps the fake behaviourally faithful to the thing it stands in for.

Two-level versioning: `DB_VERSION` for structural change (an append-only `if (oldVersion < n)`
migration ladder — **never modify a shipped migration**), and a per-document `schemaVersion`
for data-shape change, applied lazily on read and eagerly on import.

## Consequences

- **Positive:** No server, no bill, no auth, genuine offline operation. Every service test runs
  headless in milliseconds against `FakeDataStore`. A future sync layer would slot in as a
  decorator behind the same port without touching a single caller.
- **Negative:** IndexedDB is **evictable by default**, which is an existential risk for an app
  whose entire value is on-device. We mitigate with `navigator.storage.persist()` at first
  write, a storage estimate in Settings, and an export nag after 30 days. Data does not follow
  the coach between devices except through a JSON file, and on iOS an installed PWA gets a
  **separate storage bucket** from Safari, so the same file is the bridge there too.
- **Constraint inherited:** IDB cannot store `null` as a key and skips records whose index key
  path resolves to `undefined`. Any nullable field that is also **indexed** must be an optional
  omitted property, never `T | null`. Pinned by a test in `src/domain/indexed-nullables.test.ts`.
