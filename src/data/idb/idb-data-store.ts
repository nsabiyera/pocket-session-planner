import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type {
  CapabilityScanId,
  PhaseImageId,
  CarryForwardActionId,
  MethodologyId,
  ObservationId,
  PhaseId,
  PlayerAssessmentId,
  PlayerId,
  ReviewId,
  SessionId,
  SquadId,
  GameModelId,
} from '@/domain/ids';
import type { CapabilityScan, ObservedSkill } from '@/domain/capabilities/scan';
import type { CarryForwardAction, CarryForwardStatus } from '@/domain/carry-forward';
import { comparePlayers } from '@/domain/player';
import type { Methodology } from '@/domain/methodology';
import type { Observation } from '@/domain/observation';
import type { Player } from '@/domain/player';
import type { PlayerAssessment } from '@/domain/player-assessment';
import { CURRENT_SCHEMA_VERSION, type IsoDateTime } from '@/domain/primitives';
import { PRESET_CATALOG_VERSION } from '@/domain/presets';
import type { PhaseImage } from '@/domain/phase-image';
import type { GameModel } from '@/domain/game-model';
import type { SessionReview } from '@/domain/review';
import type { Session, SessionStatus } from '@/domain/session';
import type { Squad } from '@/domain/squad';
import { buildCatalog, resolveMethodology } from '../methodology-catalog';
import type {
  AppMeta,
  CapabilityScanRepository,
  GameModelRepository,
  PhaseImageRepository,
  CarryForwardActionRepository,
  CatalogEntry,
  ListOptions,
  MetaRepository,
  MethodologyPrefs,
  MethodologyRepository,
  ObservationRepository,
  PlayerAssessmentRepository,
  PlayerRepository,
  PocketDataStore,
  ReviewRepository,
  SessionRepository,
  SquadRepository,
  StoreName,
} from '../ports/data-store';
import { STORE_NAMES } from '../ports/data-store';
import { openDatabase, type OpenDatabaseOptions } from './open-database';
import type { PocketDBSchema } from './schema';

/**
 * The real adapter. Held to the same contract suite as `FakeDataStore`.
 *
 * The one rule that governs every line in here: **IndexedDB auto-commits a transaction on
 * the first empty microtask turn**. Awaiting anything that is not an IDB request inside a
 * transaction silently ends it, and every write after that point vanishes with no error. So
 * nothing in this file awaits a timer, a `fetch`, a `structuredClone` promise, or any other
 * non-IDB work while a transaction is open — the callers compute first and transact after.
 */

type Mode = 'readonly' | 'readwrite';
type Tx = IDBPTransaction<PocketDBSchema, StoreNames<PocketDBSchema>[], Mode>;

/**
 * The connection is gone **for good** — closed by us, or closed because a newer tab is
 * upgrading the schema and holding on would deadlock both tabs.
 *
 * Distinct from a connection the browser merely dropped, which reopens on demand. There is
 * nothing to retry here: the page is running the old code, and only a reload fixes that.
 */
export class DatabaseClosedError extends Error {
  constructor() {
    super('The database connection is closed.');
    this.name = 'DatabaseClosedError';
  }
}

/**
 * `InvalidStateError: the database connection is closing`.
 *
 * A browser is free to close an IndexedDB connection under a page it has backgrounded, and a
 * phone in a pocket between the warm-up and kick-off is the ordinary case rather than the
 * edge one. The *connection* is gone; the data is not.
 */
function isConnectionGone(error: unknown): boolean {
  // Duck-typed on purpose: `DOMException` is not reliably an `Error`, and in a browser it can
  // arrive from another realm, so `instanceof` on either would miss the case that matters.
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'InvalidStateError'
  );
}

/**
 * How a repository reaches the database: the transaction currently open on this data store
 * if there is one, and a fresh one otherwise. This is what lets one set of repository methods
 * serve both `store.sessions.put(...)` and a multi-store `transact([...], ...)` without a
 * second implementation.
 */
interface Context {
  begin(stores: readonly StoreName[], mode: Mode): Promise<Tx>;
  tx(): Tx | null;
}

/** A structurally-typed object store. The `idb` generics are precise but not composable. */
interface AnyStore {
  get(key: IDBValidKey): Promise<unknown>;
  getAll(query?: IDBKeyRange | IDBValidKey): Promise<unknown[]>;
  put(value: unknown): Promise<unknown>;
  delete(key: IDBValidKey): Promise<void>;
  clear(): Promise<void>;
  index(name: string): { getAll(query?: IDBKeyRange | IDBValidKey): Promise<unknown[]> };
}

/**
 * Runs `body` against one object store, inside the open transaction if there is one, or
 * inside a fresh single-store transaction otherwise.
 *
 * The implicit transaction is **awaited to completion**, not merely to request success.
 * That gives Do mode its write-through guarantee — when `sessions.put()` resolves, the timer
 * state is genuinely committed, so a crash on the next frame loses nothing.
 *
 * And on failure `tx.done` is explicitly consumed. A request that rejects also aborts its
 * transaction, and an unobserved `done` rejection would surface as an unhandled promise
 * rejection with no stack anywhere near the cause.
 */
async function run<R>(
  ctx: Context,
  name: StoreName,
  mode: Mode,
  body: (store: AnyStore) => Promise<R>,
): Promise<R> {
  const active = ctx.tx();
  if (active) {
    return body(active.objectStore(name) as unknown as AnyStore);
  }

  const tx = await ctx.begin([name], mode);
  try {
    const result = await body(tx.objectStore(name) as unknown as AnyStore);
    await tx.done;
    return result;
  } catch (error) {
    void tx.done.catch(() => undefined);
    throw error;
  }
}

/** Shared list post-processing, identical to the fake's, so the two cannot drift. */
function applyListOptions<T extends { deletedAt?: IsoDateTime }>(
  items: T[],
  options: ListOptions | undefined,
  timeKey: (item: T) => string | undefined,
): T[] {
  let result = options?.includeDeleted
    ? items
    : items.filter((item) => item.deletedAt === undefined);
  if (options?.before !== undefined) {
    const before = options.before;
    result = result.filter((item) => {
      const key = timeKey(item);
      return key !== undefined && key < before;
    });
  }
  if (options?.limit !== undefined) result = result.slice(0, options.limit);
  return result;
}

class IdbRepository<TId extends string, T extends { id: string; deletedAt?: IsoDateTime }> {
  constructor(
    protected readonly ctx: Context,
    protected readonly name: StoreName,
  ) {}

  async get(id: TId): Promise<T | undefined> {
    return run(this.ctx, this.name, 'readonly', async (store) => {
      return (await store.get(id)) as T | undefined;
    });
  }

  async getMany(ids: readonly TId[]): Promise<T[]> {
    return run(this.ctx, this.name, 'readonly', async (store) => {
      const out: T[] = [];
      for (const id of ids) {
        const found = (await store.get(id)) as T | undefined;
        if (found) out.push(found);
      }
      return out;
    });
  }

  async put(entity: T): Promise<void> {
    await run(this.ctx, this.name, 'readwrite', (store) => store.put(entity));
  }

  async putMany(entities: readonly T[]): Promise<void> {
    if (entities.length === 0) return;
    await run(this.ctx, this.name, 'readwrite', async (store) => {
      for (const entity of entities) await store.put(entity);
    });
  }

  async softDelete(id: TId, at: IsoDateTime): Promise<void> {
    await run(this.ctx, this.name, 'readwrite', async (store) => {
      const found = (await store.get(id)) as T | undefined;
      if (!found) return;
      await store.put({ ...found, deletedAt: at, updatedAt: at });
    });
  }

  async hardDelete(id: TId): Promise<void> {
    await run(this.ctx, this.name, 'readwrite', (store) => store.delete(id));
  }

  protected async all(): Promise<T[]> {
    return run(this.ctx, this.name, 'readonly', async (store) => (await store.getAll()) as T[]);
  }

  protected async fromIndex(indexName: string, query: IDBKeyRange | IDBValidKey): Promise<T[]> {
    return run(
      this.ctx,
      this.name,
      'readonly',
      async (store) => (await store.index(indexName).getAll(query)) as T[],
    );
  }
}

/** `[squadId, '']` to `[squadId, '￿']` — every row for one squad in a compound index. */
const squadRange = (squadId: string) => IDBKeyRange.bound([squadId, ''], [squadId, '￿']);

class IdbSquadRepository extends IdbRepository<SquadId, Squad> implements SquadRepository {
  async list(options?: ListOptions): Promise<Squad[]> {
    const sorted = (await this.all()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return applyListOptions(sorted, options, (squad) => squad.updatedAt);
  }
}

class IdbPlayerRepository extends IdbRepository<PlayerId, Player> implements PlayerRepository {
  async listBySquad(squadId: SquadId, options?: { includeArchived?: boolean }): Promise<Player[]> {
    const rows = await this.fromIndex('by-squad', squadId);
    return rows
      .filter((player) => player.deletedAt === undefined)
      .filter((player) => options?.includeArchived === true || player.archivedAt === undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

class IdbMethodologyRepository
  extends IdbRepository<MethodologyId, Methodology>
  implements MethodologyRepository
{
  async list(options?: { includeHidden?: boolean }): Promise<CatalogEntry[]> {
    const custom = await this.listCustom();
    const prefsRows = await run(
      this.ctx,
      'methodology_prefs',
      'readonly',
      async (store) => (await store.getAll()) as MethodologyPrefs[],
    );
    const prefs = new Map(prefsRows.map((row) => [row.methodologyId, row]));
    return buildCatalog(custom, prefs, options);
  }

  async listCustom(): Promise<Methodology[]> {
    return (await this.all())
      .filter((methodology) => methodology.deletedAt === undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async resolve(id: MethodologyId) {
    return resolveMethodology(id, await this.listCustom());
  }

  async getPrefs(id: MethodologyId): Promise<MethodologyPrefs | undefined> {
    return run(
      this.ctx,
      'methodology_prefs',
      'readonly',
      async (store) => (await store.get(id)) as MethodologyPrefs | undefined,
    );
  }

  async setPrefs(prefs: MethodologyPrefs): Promise<void> {
    await run(this.ctx, 'methodology_prefs', 'readwrite', (store) => store.put(prefs));
  }
}

const ACTIVE_STATUSES: readonly SessionStatus[] = ['in_progress', 'draft', 'planned'];

class IdbSessionRepository extends IdbRepository<SessionId, Session> implements SessionRepository {
  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<Session[]> {
    const rows = await this.fromIndex('by-squad-scheduled', squadRange(squadId));
    const sorted = rows.sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
    return applyListOptions(sorted, options, (session) => session.scheduledFor);
  }

  async listByStatus(squadId: SquadId, status: SessionStatus): Promise<Session[]> {
    const rows = await this.fromIndex('by-squad-status', [squadId, status]);
    return rows
      .filter((session) => session.deletedAt === undefined)
      .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
  }

  async findActive(): Promise<Session | undefined> {
    // Across every squad: the coach has one session in flight, whoever it is with.
    const candidates: Session[] = [];
    for (const status of ACTIVE_STATUSES) {
      const rows = await this.fromIndex('by-status', status);
      for (const session of rows) {
        if (session.deletedAt === undefined) candidates.push(session);
      }
    }

    // An in-progress run always wins: a coach standing on a pitch does not want the draft
    // they started on the bus.
    const running = candidates.find((session) => session.status === 'in_progress');
    if (running) return running;
    return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  async findDraft(squadId: SquadId): Promise<Session | undefined> {
    return (await this.listByStatus(squadId, 'draft'))[0];
  }

  async findAwaitingReview(squadId: SquadId): Promise<Session | undefined> {
    return (await this.listByStatus(squadId, 'completed')).find(
      (session) => session.reviewId === null,
    );
  }

  async listRecentCompleted(squadId: SquadId, limit: number): Promise<Session[]> {
    return (await this.listByStatus(squadId, 'completed')).slice(0, limit);
  }
}

class IdbObservationRepository
  extends IdbRepository<ObservationId, Observation>
  implements ObservationRepository
{
  async listBySession(sessionId: SessionId): Promise<Observation[]> {
    const rows = await this.fromIndex('by-session-at', squadRange(sessionId));
    return rows.filter((o) => o.deletedAt === undefined).sort((a, b) => a.at.localeCompare(b.at));
  }

  async listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<Observation[]> {
    // Team-wide observations omit `playerId`, so IndexedDB has already excluded them from
    // this index. No filtering needed here, and none wanted.
    const rows = await this.fromIndex('by-player-at', squadRange(playerId));
    const sorted = rows
      .filter((o) => o.deletedAt === undefined)
      .sort((a, b) => b.at.localeCompare(a.at));
    return applyListOptions(sorted, options, (o) => o.at);
  }

  async listByPhase(phaseId: PhaseId): Promise<Observation[]> {
    const rows = await this.fromIndex('by-phase', phaseId);
    return rows.filter((o) => o.deletedAt === undefined).sort((a, b) => a.at.localeCompare(b.at));
  }

  async listByPlayerCorner(playerId: PlayerId, corner: string): Promise<Observation[]> {
    // Unclassified observations are absent from this index for free: IndexedDB skips a
    // record whose index key path resolves to `undefined`, and `corner` is optional-omitted.
    const rows = await this.fromIndex('by-player-corner', [playerId, corner]);
    return rows.filter((o) => o.deletedAt === undefined).sort((a, b) => a.at.localeCompare(b.at));
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<Observation[]> {
    const rows = await this.fromIndex('by-squad-at', squadRange(squadId));
    const sorted = rows
      .filter((o) => o.deletedAt === undefined)
      .sort((a, b) => b.at.localeCompare(a.at));
    return applyListOptions(sorted, options, (o) => o.at);
  }
}

class IdbReviewRepository
  extends IdbRepository<ReviewId, SessionReview>
  implements ReviewRepository
{
  async findBySession(sessionId: SessionId): Promise<SessionReview | undefined> {
    const rows = await this.fromIndex('by-session', sessionId);
    return rows.find((review) => review.deletedAt === undefined);
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<SessionReview[]> {
    const rows = await this.fromIndex('by-squad-completed', squadRange(squadId));
    const sorted = rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return applyListOptions(sorted, options, (review) => review.completedAt);
  }
}

class IdbCarryForwardActionRepository
  extends IdbRepository<CarryForwardActionId, CarryForwardAction>
  implements CarryForwardActionRepository
{
  async listOpen(squadId: SquadId): Promise<CarryForwardAction[]> {
    return this.listByStatus(squadId, 'open');
  }

  async listByStatus(squadId: SquadId, status: CarryForwardStatus): Promise<CarryForwardAction[]> {
    const rows = await this.fromIndex('by-squad-status', [squadId, status]);
    return rows
      .filter((action) => action.deletedAt === undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listByOriginSession(sessionId: SessionId): Promise<CarryForwardAction[]> {
    const rows = await this.fromIndex('by-origin-session', sessionId);
    return rows.filter((action) => action.deletedAt === undefined);
  }

  async listByPlayer(playerId: PlayerId): Promise<CarryForwardAction[]> {
    const rows = await this.fromIndex('by-player', playerId);
    return rows.filter((action) => action.deletedAt === undefined);
  }
}

class IdbPlayerAssessmentRepository
  extends IdbRepository<PlayerAssessmentId, PlayerAssessment>
  implements PlayerAssessmentRepository
{
  async listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<PlayerAssessment[]> {
    const rows = await this.fromIndex('by-player-at', squadRange(playerId));
    const sorted = rows.sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));
    return applyListOptions(sorted, options, (assessment) => assessment.assessedAt);
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<PlayerAssessment[]> {
    const rows = await this.fromIndex('by-squad-at', squadRange(squadId));
    const sorted = rows.sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));
    return applyListOptions(sorted, options, (assessment) => assessment.assessedAt);
  }

  async findLatest(playerId: PlayerId): Promise<PlayerAssessment | undefined> {
    return (await this.listByPlayer(playerId, { limit: 1 }))[0];
  }
}

class IdbGameModelRepository
  extends IdbRepository<GameModelId, GameModel>
  implements GameModelRepository
{
  async findBySquad(squadId: SquadId): Promise<GameModel | undefined> {
    // One per squad, so the first hit on the index is the answer. `putGameModel` is what
    // keeps that true; IndexedDB has no way to enforce a unique non-key index.
    const found = await this.fromIndex('by-squad', squadId);
    return found[0];
  }

  async listAll(): Promise<GameModel[]> {
    return this.all();
  }
}

class IdbPhaseImageRepository
  extends IdbRepository<PhaseImageId, PhaseImage>
  implements PhaseImageRepository
{
  async listBySession(sessionId: SessionId): Promise<PhaseImage[]> {
    return this.fromIndex('by-session', sessionId);
  }

  /**
   * Every image, for the export. No paging and no index: this walks the whole store, which is
   * fine because it runs once when a coach taps Export and never anywhere near the timer.
   */
  async listAll(): Promise<PhaseImage[]> {
    return this.all();
  }
}

class IdbCapabilityScanRepository
  extends IdbRepository<CapabilityScanId, CapabilityScan>
  implements CapabilityScanRepository
{
  async listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<CapabilityScan[]> {
    const rows = await this.fromIndex('by-player-at', squadRange(playerId));
    const sorted = rows.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    return applyListOptions(sorted, options, (scan) => scan.scannedAt);
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<CapabilityScan[]> {
    const rows = await this.fromIndex('by-squad-at', squadRange(squadId));
    const sorted = rows.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    return applyListOptions(sorted, options, (scan) => scan.scannedAt);
  }

  async listByPlayerSkill(
    playerId: PlayerId,
    skill: ObservedSkill,
    options?: ListOptions,
  ): Promise<CapabilityScan[]> {
    // Three-part key, so the range pins player *and* skill and lets the timestamp vary.
    const rows = await this.fromIndex(
      'by-player-skill-at',
      IDBKeyRange.bound([playerId, skill, ''], [playerId, skill, '￿']),
    );
    const sorted = rows.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    return applyListOptions(sorted, options, (scan) => scan.scannedAt);
  }

  async findLatest(playerId: PlayerId): Promise<CapabilityScan | undefined> {
    return (await this.listByPlayer(playerId, { limit: 1 }))[0];
  }
}

class IdbMetaRepository implements MetaRepository {
  constructor(private readonly ctx: Context) {}

  async get(): Promise<AppMeta | undefined> {
    return run(
      this.ctx,
      'app_meta',
      'readonly',
      async (store) => (await store.get('app')) as AppMeta | undefined,
    );
  }

  async put(meta: AppMeta): Promise<void> {
    await run(this.ctx, 'app_meta', 'readwrite', (store) => store.put(meta));
  }

  async patch(changes: Partial<Omit<AppMeta, 'key'>>, now: IsoDateTime): Promise<AppMeta> {
    return run(this.ctx, 'app_meta', 'readwrite', async (store) => {
      const current = ((await store.get('app')) as AppMeta | undefined) ?? {
        key: 'app' as const,
        docSchemaVersion: CURRENT_SCHEMA_VERSION,
        presetCatalogVersion: PRESET_CATALOG_VERSION,
        installedAt: now,
        lastExportAt: null,
        activeSessionId: null,
        activeSquadId: null,
        storagePersisted: false,
        completedSessionCount: 0,
      };
      const next: AppMeta = { ...current, ...changes, key: 'app' };
      await store.put(next);
      return next;
    });
  }
}

export class IdbDataStore implements PocketDataStore {
  private activeTx: Tx | null = null;
  private database: IDBPDatabase<PocketDBSchema> | null = null;
  /** The open in flight, so a burst of parallel reads reconnects once rather than six times. */
  private connecting: Promise<IDBPDatabase<PocketDBSchema>> | null = null;
  /** Closed for good. See `DatabaseClosedError`. */
  private retired = false;
  /** Connections opened over this store's life. Read by the reconnection tests. */
  private opened = 0;

  readonly squads: SquadRepository;
  readonly players: PlayerRepository;
  readonly methodologies: MethodologyRepository;
  readonly sessions: SessionRepository;
  readonly observations: ObservationRepository;
  readonly reviews: ReviewRepository;
  readonly actions: CarryForwardActionRepository;
  readonly assessments: PlayerAssessmentRepository;
  readonly scans: CapabilityScanRepository;
  readonly gameModels: GameModelRepository;
  readonly phaseImages: PhaseImageRepository;
  readonly meta: MetaRepository;

  private constructor(private readonly options: OpenDatabaseOptions) {
    const ctx: Context = {
      begin: (stores, mode) => this.begin(stores, mode),
      tx: () => this.activeTx,
    };

    this.squads = new IdbSquadRepository(ctx, 'squads');
    this.players = new IdbPlayerRepository(ctx, 'players');
    this.methodologies = new IdbMethodologyRepository(ctx, 'methodologies');
    this.sessions = new IdbSessionRepository(ctx, 'sessions');
    this.observations = new IdbObservationRepository(ctx, 'observations');
    this.reviews = new IdbReviewRepository(ctx, 'reviews');
    this.actions = new IdbCarryForwardActionRepository(ctx, 'carry_forward_actions');
    this.assessments = new IdbPlayerAssessmentRepository(ctx, 'player_assessments');
    this.scans = new IdbCapabilityScanRepository(ctx, 'capability_scans');
    this.gameModels = new IdbGameModelRepository(ctx, 'game_models');
    this.phaseImages = new IdbPhaseImageRepository(ctx, 'phase_images');
    this.meta = new IdbMetaRepository(ctx);
  }

  static async open(options: OpenDatabaseOptions = {}): Promise<IdbDataStore> {
    const store = new IdbDataStore(options);
    await store.connect();
    return store;
  }

  /**
   * Opens the connection, or joins the one already opening.
   *
   * Deduplicated because `refresh()` fires six reads at once: without it a single dropped
   * connection would be answered with six new ones, five of them leaked for the life of the
   * page — every trip to the background costing another five.
   */
  private connect(): Promise<IDBPDatabase<PocketDBSchema>> {
    if (this.connecting) return this.connecting;

    this.opened += 1;
    const opening = openDatabase({
      ...this.options,
      onBlocking: () => {
        // A newer tab is upgrading, and `openDatabase` has already closed us to let it
        // through. Reopening at the old version would only block it again, so this
        // connection is finished — the UI's reload prompt is the only way forward.
        this.retire();
        this.options.onBlocking?.();
      },
    });

    this.connecting = opening.then(
      (database) => {
        this.connecting = null;
        // `retire()` can have run while we were opening — an import closing the store, say.
        if (this.retired) {
          database.close();
          throw new DatabaseClosedError();
        }
        this.database = database;
        return database;
      },
      (error) => {
        this.connecting = null;
        throw error;
      },
    );

    return this.connecting;
  }

  /**
   * Opens a transaction, reopening the connection first if the browser has taken it away.
   *
   * The retry is safe precisely because it is scoped to `transaction()` itself: when that
   * call throws there is no transaction and nothing has been written, so reopening cannot
   * replay a write. Without it, every call after a backgrounded stint fails with
   * `InvalidStateError: the database connection is closing` — which the coach meets as a
   * crash report and a lost tap, on a connection that would have reopened instantly.
   */
  private async begin(stores: readonly StoreName[], mode: Mode): Promise<Tx> {
    const names = stores as unknown as StoreNames<PocketDBSchema>[];
    const database = this.database;

    if (database !== null) {
      try {
        return database.transaction(names, mode) as Tx;
      } catch (error) {
        if (!isConnectionGone(error)) throw error;
        this.database = null;
      }
    }

    if (this.retired) throw new DatabaseClosedError();
    return (await this.connect()).transaction(names, mode) as Tx;
  }

  /**
   * One transaction across several stores.
   *
   * `fn` receives this same store instance — every repository call inside it is routed to
   * the open transaction. **Do not await anything but those calls inside `fn`**, or the
   * transaction auto-commits underneath you and the rest of the writes disappear silently.
   */
  async transact<T>(
    stores: readonly StoreName[],
    mode: Mode,
    fn: (store: PocketDataStore) => Promise<T>,
  ): Promise<T> {
    if (this.activeTx) {
      // Nesting would deadlock against our own locks. Callers compose by widening the
      // outer store list, not by opening a second transaction.
      throw new Error('A transaction is already open on this data store.');
    }

    const tx = await this.begin(stores, mode);
    this.activeTx = tx;

    try {
      const result = await fn(this);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Already aborted or already committed — the original error is the interesting one.
      }
      // Swallow the AbortError that `tx.done` now rejects with, so the caller sees the
      // reason the transaction failed rather than the consequence.
      await tx.done.catch(() => undefined);
      throw error;
    } finally {
      this.activeTx = null;
    }
  }

  async clear(): Promise<void> {
    const tx = await this.begin(STORE_NAMES, 'readwrite');
    for (const name of STORE_NAMES) {
      // `Tx` keeps both modes open, so `clear` is only reachable through the store cast.
      await (tx.objectStore(name) as unknown as AnyStore).clear();
    }
    await tx.done;
  }

  close(): void {
    this.retire();
  }

  /** Closed and not coming back: the next call gets a `DatabaseClosedError`, not a reopen. */
  private retire(): void {
    this.retired = true;
    this.database?.close();
    this.database = null;
  }

  /**
   * Test seam: what a browser does to a backgrounded page. The connection goes; the handle
   * this store is holding does not, so the next call must reopen rather than throw.
   */
  __dropConnectionForTest(): void {
    this.database?.close();
  }

  /** Test seam: connections opened, so a reconnect storm cannot pass for a single reopen. */
  __connectionsOpenedForTest(): number {
    return this.opened;
  }
}

/** Re-exported so the roster screen and the adapter agree on ordering. */
export { comparePlayers };
