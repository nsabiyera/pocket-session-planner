import { err, ok, type Result } from '@/lib/result';
import type { SquadId } from '@/domain/ids';
import type { PocketDataStore } from '@/data/ports/data-store';
import { now, type ServiceContext } from '../context';
import {
  countData,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  TransferDataSchema,
  TransferEnvelopeSchema,
  type TransferCounts,
  type TransferData,
  type TransferEnvelope,
} from './envelope';
import { migrateAll } from './document-migrations';

export const APP_VERSION = '0.1.0';

/**
 * Export and import.
 *
 * **Import is always two steps: a dry run, then a commit.** A coach about to merge another
 * device's file into a season of work deserves to see exactly what will change before
 * anything does — and a malformed file must never touch IndexedDB at all.
 */

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportAll(
  ctx: ServiceContext,
  options: { squadId?: SquadId } = {},
): Promise<TransferEnvelope> {
  const data = await collect(ctx.store, options.squadId);
  const at = now(ctx);

  const envelope: TransferEnvelope = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion: APP_VERSION,
    docSchemaVersion: 1,
    exportedAt: at,
    scope: options.squadId ? 'squad' : 'all',
    counts: countData(data),
    data,
  };

  await ctx.store.meta.patch({ lastExportAt: at }, at);
  return TransferEnvelopeSchema.parse(envelope);
}

async function collect(store: PocketDataStore, squadId?: SquadId): Promise<TransferData> {
  const squads = (await store.squads.list({ includeDeleted: true })).filter(
    (squad) => squadId === undefined || squad.id === squadId,
  );

  const players = (
    await Promise.all(
      squads.map((squad) => store.players.listBySquad(squad.id, { includeArchived: true })),
    )
  ).flat();

  const sessions = (
    await Promise.all(squads.map((squad) => store.sessions.listBySquad(squad.id, { limit: 5000 })))
  ).flat();

  const observations = (
    await Promise.all(
      squads.map((squad) => store.observations.listBySquad(squad.id, { limit: 50000 })),
    )
  ).flat();

  const reviews = (
    await Promise.all(squads.map((squad) => store.reviews.listBySquad(squad.id, { limit: 5000 })))
  ).flat();

  const assessments = (
    await Promise.all(
      squads.map((squad) => store.assessments.listBySquad(squad.id, { limit: 5000 })),
    )
  ).flat();

  const actions = (
    await Promise.all(
      squads.flatMap((squad) =>
        (['open', 'planned', 'done', 'dropped'] as const).map((status) =>
          store.actions.listByStatus(squad.id, status),
        ),
      ),
    )
  ).flat();

  return TransferDataSchema.parse({
    squads,
    players,
    // **Custom only.** Built-in presets are code-resident and never travel.
    methodologies: await store.methodologies.listCustom(),
    sessions,
    observations,
    reviews,
    actions,
    assessments,
  });
}

// ---------------------------------------------------------------------------
// Import — step 1, the dry run
// ---------------------------------------------------------------------------

export type ImportMode = 'merge' | 'replace';

export type ImportProblem =
  | { kind: 'malformed'; message: string }
  | { kind: 'session_running' }
  | { kind: 'wrong_format'; found: string };

export interface ImportPlanEntry {
  create: number;
  update: number;
  skip: number;
}

export interface ImportPlan {
  mode: ImportMode;
  envelope: TransferEnvelope;
  counts: TransferCounts;
  entries: Record<keyof TransferData, ImportPlanEntry>;
  /** Rows dropped because a reference they need does not resolve. Reported, never imported. */
  dropped: Array<{ store: keyof TransferData; id: string; reason: string }>;
}

export interface ImportReport {
  written: TransferCounts;
  dropped: ImportPlan['dropped'];
}

/**
 * Parses, migrates and diffs a file against what is already stored — **without writing
 * anything**.
 */
export async function planImport(
  ctx: ServiceContext,
  raw: unknown,
  mode: ImportMode,
): Promise<Result<ImportPlan, ImportProblem>> {
  // Refusing mid-session is not fussiness: a merge could rewrite the very session document
  // the timer is writing to.
  const active = await ctx.store.sessions.findActive();
  if (active?.status === 'in_progress') return err({ kind: 'session_running' });

  if (typeof raw !== 'object' || raw === null) {
    return err({ kind: 'malformed', message: 'That file is not a JSON object.' });
  }

  const format = (raw as { format?: unknown }).format;
  if (format !== EXPORT_FORMAT) {
    return err({ kind: 'wrong_format', found: typeof format === 'string' ? format : 'unknown' });
  }

  // Migrate every array *before* parsing, so a file from an older build still validates.
  const rawData = ((raw as { data?: unknown }).data ?? {}) as Record<string, unknown[]>;
  const migrated = {
    squads: migrateAll(rawData.squads ?? []),
    players: migrateAll(rawData.players ?? []),
    methodologies: migrateAll(rawData.methodologies ?? []),
    sessions: migrateAll(rawData.sessions ?? []),
    observations: migrateAll(rawData.observations ?? []),
    reviews: migrateAll(rawData.reviews ?? []),
    actions: migrateAll(rawData.actions ?? []),
    assessments: migrateAll(rawData.assessments ?? []),
  };

  // **Parse first.** A malformed file never touches IndexedDB.
  const parsed = TransferEnvelopeSchema.safeParse({ ...(raw as object), data: migrated });
  if (!parsed.success) {
    return err({ kind: 'malformed', message: parsed.error.issues[0]?.message ?? 'Invalid file.' });
  }

  const envelope = parsed.data;
  const dropped = await checkReferences(ctx.store, envelope.data, mode);
  const droppedIds = new Set(dropped.map((entry) => `${entry.store}:${entry.id}`));

  const entries = {
    squads: await diff(ctx.store, 'squads', envelope.data.squads, droppedIds, mode),
    players: await diff(ctx.store, 'players', envelope.data.players, droppedIds, mode),
    methodologies: await diff(
      ctx.store,
      'methodologies',
      envelope.data.methodologies,
      droppedIds,
      mode,
    ),
    sessions: await diff(ctx.store, 'sessions', envelope.data.sessions, droppedIds, mode),
    observations: await diff(
      ctx.store,
      'observations',
      envelope.data.observations,
      droppedIds,
      mode,
    ),
    reviews: await diff(ctx.store, 'reviews', envelope.data.reviews, droppedIds, mode),
    actions: await diff(ctx.store, 'actions', envelope.data.actions, droppedIds, mode),
    assessments: await diff(ctx.store, 'assessments', envelope.data.assessments, droppedIds, mode),
  };

  return ok({ mode, envelope, counts: envelope.counts, entries, dropped });
}

type Row = { id: string; updatedAt: string };

/**
 * Merge policy, id-keyed: absent → create; incoming newer → update; older or equal → skip.
 *
 * Because ids are UUIDs, re-importing your own export is a clean no-op and importing another
 * coach's squad can never collide. That is why the model uses UUIDs rather than
 * autoincrement keys.
 */
async function diff(
  store: PocketDataStore,
  name: keyof TransferData,
  rows: readonly Row[],
  droppedIds: ReadonlySet<string>,
  mode: ImportMode,
): Promise<ImportPlanEntry> {
  if (mode === 'replace') {
    const live = rows.filter((row) => !droppedIds.has(`${name}:${row.id}`));
    return { create: live.length, update: 0, skip: rows.length - live.length };
  }

  const entry: ImportPlanEntry = { create: 0, update: 0, skip: 0 };
  for (const row of rows) {
    if (droppedIds.has(`${name}:${row.id}`)) {
      entry.skip += 1;
      continue;
    }
    const existing = await repositoryFor(store, name).get(row.id);
    if (!existing) entry.create += 1;
    else if (row.updatedAt > existing.updatedAt) entry.update += 1;
    else entry.skip += 1;
  }
  return entry;
}

interface AnyRepository {
  get(id: string): Promise<Row | undefined>;
  putMany(rows: readonly unknown[]): Promise<void>;
}

function repositoryFor(store: PocketDataStore, name: keyof TransferData): AnyRepository {
  const map: Record<keyof TransferData, unknown> = {
    squads: store.squads,
    players: store.players,
    methodologies: store.methodologies,
    sessions: store.sessions,
    observations: store.observations,
    reviews: store.reviews,
    actions: store.actions,
    assessments: store.assessments,
  };
  return map[name] as AnyRepository;
}

/**
 * Referential integrity, run **before** the commit.
 *
 * Every `session.squadId`, `focusPlayers[].playerId`, `phase.focusPlayerIds`,
 * `observation.sessionId`, `review.sessionId` and `action.originSessionId` must resolve
 * against existing data ∪ the incoming file. Anything that does not is reported and dropped,
 * never imported half-connected.
 */
async function checkReferences(
  store: PocketDataStore,
  data: TransferData,
  mode: ImportMode,
): Promise<ImportPlan['dropped']> {
  const dropped: ImportPlan['dropped'] = [];

  const incomingSquads = new Set(data.squads.map((squad) => squad.id as string));
  const incomingPlayers = new Set(data.players.map((player) => player.id as string));

  // In `replace` mode the existing rows are about to be wiped, so they cannot satisfy a
  // reference — only the file itself can.
  const existingSquads = mode === 'replace' ? new Set<string>() : await idsOf(store, 'squads');
  const existingPlayers = mode === 'replace' ? new Set<string>() : await idsOf(store, 'players');
  const existingSessions = mode === 'replace' ? new Set<string>() : await idsOf(store, 'sessions');

  const squadExists = (id: string) => incomingSquads.has(id) || existingSquads.has(id);
  const playerExists = (id: string) => incomingPlayers.has(id) || existingPlayers.has(id);

  for (const player of data.players) {
    if (!squadExists(player.squadId)) {
      dropped.push({ store: 'players', id: player.id, reason: 'Its squad is missing.' });
    }
  }

  const validSessions = new Set<string>();
  for (const session of data.sessions) {
    if (!squadExists(session.squadId)) {
      dropped.push({ store: 'sessions', id: session.id, reason: 'Its squad is missing.' });
      continue;
    }
    const unknownFocus = session.focusPlayers.find((focus) => !playerExists(focus.playerId));
    if (unknownFocus) {
      dropped.push({ store: 'sessions', id: session.id, reason: 'A focus player is missing.' });
      continue;
    }
    const unknownPhaseFocus = session.phases.some((phase) =>
      phase.focusPlayerIds.some((playerId) => !playerExists(playerId)),
    );
    if (unknownPhaseFocus) {
      dropped.push({
        store: 'sessions',
        id: session.id,
        reason: 'A phase focus player is missing.',
      });
      continue;
    }
    validSessions.add(session.id);
  }

  const sessionResolves = (id: string) => validSessions.has(id) || existingSessions.has(id);

  for (const observation of data.observations) {
    if (!sessionResolves(observation.sessionId)) {
      dropped.push({
        store: 'observations',
        id: observation.id,
        reason: 'Its session is missing.',
      });
    }
  }

  for (const review of data.reviews) {
    if (!sessionResolves(review.sessionId)) {
      dropped.push({ store: 'reviews', id: review.id, reason: 'Its session is missing.' });
    }
  }

  for (const action of data.actions) {
    if (!sessionResolves(action.originSessionId)) {
      dropped.push({ store: 'actions', id: action.id, reason: 'Its origin session is missing.' });
    }
  }

  for (const assessment of data.assessments) {
    if (!playerExists(assessment.playerId)) {
      dropped.push({
        store: 'assessments',
        id: assessment.id,
        reason: 'Its player is missing.',
      });
    }
  }

  return dropped;
}

async function idsOf(store: PocketDataStore, name: 'squads' | 'players' | 'sessions') {
  if (name === 'squads') {
    return new Set(
      (await store.squads.list({ includeDeleted: true })).map((row) => row.id as string),
    );
  }
  const squads = await store.squads.list({ includeDeleted: true });
  const rows = (
    await Promise.all(
      squads.map((squad) =>
        name === 'players'
          ? store.players.listBySquad(squad.id, { includeArchived: true })
          : store.sessions.listBySquad(squad.id, { limit: 5000 }),
      ),
    )
  ).flat();
  return new Set(rows.map((row) => row.id as string));
}

// ---------------------------------------------------------------------------
// Import — step 2, the commit
// ---------------------------------------------------------------------------

/**
 * Applies a plan in **one transaction** across every store, so a failure leaves nothing
 * half-applied. The whole plan was computed before the transaction opened, because awaiting
 * anything that is not an IndexedDB request inside one silently commits it.
 */
export async function commitImport(
  ctx: ServiceContext,
  plan: ImportPlan,
): Promise<Result<ImportReport, ImportProblem>> {
  const active = await ctx.store.sessions.findActive();
  if (active?.status === 'in_progress') return err({ kind: 'session_running' });

  const droppedIds = new Set(plan.dropped.map((entry) => `${entry.store}:${entry.id}`));
  const keep = <T extends { id: string }>(name: keyof TransferData, rows: readonly T[]) =>
    rows.filter((row) => !droppedIds.has(`${name}:${row.id}`));

  const data = plan.envelope.data;
  const payload = {
    squads: keep('squads', data.squads),
    players: keep('players', data.players),
    methodologies: keep('methodologies', data.methodologies),
    sessions: keep('sessions', data.sessions),
    observations: keep('observations', data.observations),
    reviews: keep('reviews', data.reviews),
    actions: keep('actions', data.actions),
    assessments: keep('assessments', data.assessments),
  };

  // In merge mode, resolve every conflict *before* opening the transaction.
  const toWrite =
    plan.mode === 'replace'
      ? payload
      : {
          squads: await newerOnly(ctx.store, 'squads', payload.squads),
          players: await newerOnly(ctx.store, 'players', payload.players),
          methodologies: await newerOnly(ctx.store, 'methodologies', payload.methodologies),
          sessions: await newerOnly(ctx.store, 'sessions', payload.sessions),
          observations: await newerOnly(ctx.store, 'observations', payload.observations),
          reviews: await newerOnly(ctx.store, 'reviews', payload.reviews),
          actions: await newerOnly(ctx.store, 'actions', payload.actions),
          assessments: await newerOnly(ctx.store, 'assessments', payload.assessments),
        };

  if (plan.mode === 'replace') await ctx.store.clear();

  await ctx.store.transact(
    [
      'squads',
      'players',
      'methodologies',
      'sessions',
      'observations',
      'reviews',
      'carry_forward_actions',
    ],
    'readwrite',
    async (tx) => {
      await tx.squads.putMany(toWrite.squads);
      await tx.players.putMany(toWrite.players);
      await tx.methodologies.putMany(toWrite.methodologies);
      await tx.sessions.putMany(toWrite.sessions);
      await tx.observations.putMany(toWrite.observations);
      await tx.reviews.putMany(toWrite.reviews);
      await tx.actions.putMany(toWrite.actions);
      await tx.assessments.putMany(toWrite.assessments);
    },
  );

  return ok({
    written: {
      squads: toWrite.squads.length,
      players: toWrite.players.length,
      methodologies: toWrite.methodologies.length,
      sessions: toWrite.sessions.length,
      observations: toWrite.observations.length,
      reviews: toWrite.reviews.length,
      actions: toWrite.actions.length,
      assessments: toWrite.assessments.length,
    },
    dropped: plan.dropped,
  });
}

async function newerOnly<T extends Row>(
  store: PocketDataStore,
  name: keyof TransferData,
  rows: readonly T[],
): Promise<T[]> {
  const out: T[] = [];
  for (const row of rows) {
    const existing = await repositoryFor(store, name).get(row.id);
    if (!existing || row.updatedAt > existing.updatedAt) out.push(row);
  }
  return out;
}
