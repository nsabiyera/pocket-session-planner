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
import type { PhaseImage } from '@/domain/phase-image';
import type { GameModel } from '@/domain/game-model';
import type { CapabilityScan, ObservedSkill } from '@/domain/capabilities/scan';
import type { CarryForwardAction, CarryForwardStatus } from '@/domain/carry-forward';
import type { Methodology } from '@/domain/methodology';
import type { Observation } from '@/domain/observation';
import type { Player } from '@/domain/player';
import type { PlayerAssessment } from '@/domain/player-assessment';
import { CURRENT_SCHEMA_VERSION, type IsoDateTime } from '@/domain/primitives';
import { PRESET_CATALOG_VERSION } from '@/domain/presets';
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
} from './data-store';

/**
 * The in-memory data store. Every service test above the data layer uses this, and the
 * shared contract suite runs against it *and* against the real IndexedDB adapter — which is
 * what keeps it behaviourally faithful rather than merely convenient.
 *
 * Two deliberate strictnesses, both of which catch real bugs that IndexedDB would catch in
 * production and a naive fake would not:
 *
 *  - **`structuredClone` on read *and* write.** A caller who mutates a returned object must
 *    not thereby mutate stored state. IndexedDB clones both ways; so does this.
 *  - **`transact` snapshots and rolls back on throw**, so a half-applied import fails a test
 *    here rather than corrupting a coach's data there.
 */

interface Tables {
  squads: Map<string, Squad>;
  players: Map<string, Player>;
  methodologies: Map<string, Methodology>;
  methodology_prefs: Map<string, MethodologyPrefs>;
  sessions: Map<string, Session>;
  observations: Map<string, Observation>;
  reviews: Map<string, SessionReview>;
  carry_forward_actions: Map<string, CarryForwardAction>;
  player_assessments: Map<string, PlayerAssessment>;
  capability_scans: Map<string, CapabilityScan>;
  phase_images: Map<string, PhaseImage>;
  game_models: Map<string, GameModel>;
  app_meta: Map<string, AppMeta>;
}

function emptyTables(): Tables {
  return {
    squads: new Map(),
    players: new Map(),
    methodologies: new Map(),
    methodology_prefs: new Map(),
    sessions: new Map(),
    observations: new Map(),
    reviews: new Map(),
    carry_forward_actions: new Map(),
    player_assessments: new Map(),
    capability_scans: new Map(),
    phase_images: new Map(),
    game_models: new Map(),
    app_meta: new Map(),
  };
}

const clone = <T>(value: T): T => structuredClone(value);

/** Shared list post-processing, so every repository pages and filters identically. */
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

class FakeRepository<TId extends string, T extends { id: string; deletedAt?: IsoDateTime }> {
  constructor(
    protected readonly table: () => Map<string, T>,
    private readonly touch: () => void,
  ) {}

  async get(id: TId): Promise<T | undefined> {
    const found = this.table().get(id);
    return found ? clone(found) : undefined;
  }

  async getMany(ids: readonly TId[]): Promise<T[]> {
    const out: T[] = [];
    for (const id of ids) {
      const found = this.table().get(id);
      if (found) out.push(clone(found));
    }
    return out;
  }

  async put(entity: T): Promise<void> {
    this.touch();
    this.table().set(entity.id, clone(entity));
  }

  async putMany(entities: readonly T[]): Promise<void> {
    this.touch();
    for (const entity of entities) this.table().set(entity.id, clone(entity));
  }

  async softDelete(id: TId, at: IsoDateTime): Promise<void> {
    const found = this.table().get(id);
    if (!found) return;
    this.touch();
    this.table().set(id, clone({ ...found, deletedAt: at, updatedAt: at }));
  }

  async hardDelete(id: TId): Promise<void> {
    this.touch();
    this.table().delete(id);
  }

  protected all(): T[] {
    return [...this.table().values()].map(clone);
  }
}

class FakeSquadRepository extends FakeRepository<SquadId, Squad> implements SquadRepository {
  async list(options?: ListOptions): Promise<Squad[]> {
    const sorted = this.all().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return applyListOptions(sorted, options, (squad) => squad.updatedAt);
  }
}

class FakePlayerRepository extends FakeRepository<PlayerId, Player> implements PlayerRepository {
  async listBySquad(squadId: SquadId, options?: { includeArchived?: boolean }): Promise<Player[]> {
    return this.all()
      .filter((player) => player.squadId === squadId && player.deletedAt === undefined)
      .filter((player) => options?.includeArchived === true || player.archivedAt === undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

class FakeMethodologyRepository
  extends FakeRepository<MethodologyId, Methodology>
  implements MethodologyRepository
{
  constructor(
    table: () => Map<string, Methodology>,
    private readonly prefsTable: () => Map<string, MethodologyPrefs>,
    touch: () => void,
  ) {
    super(table, touch);
  }

  async list(options?: { includeHidden?: boolean }): Promise<CatalogEntry[]> {
    return buildCatalog(await this.listCustom(), new Map(this.prefsTable()), options);
  }

  async listCustom(): Promise<Methodology[]> {
    return this.all()
      .filter((methodology) => methodology.deletedAt === undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async resolve(id: MethodologyId) {
    return resolveMethodology(id, await this.listCustom());
  }

  async getPrefs(id: MethodologyId): Promise<MethodologyPrefs | undefined> {
    const found = this.prefsTable().get(id);
    return found ? clone(found) : undefined;
  }

  async setPrefs(prefs: MethodologyPrefs): Promise<void> {
    this.prefsTable().set(prefs.methodologyId, clone(prefs));
  }
}

/** Statuses that mean "this session is the one the coach is in the middle of". */
const ACTIVE_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'in_progress',
  'draft',
  'planned',
]);

class FakeSessionRepository
  extends FakeRepository<SessionId, Session>
  implements SessionRepository
{
  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<Session[]> {
    const sorted = this.all()
      .filter((session) => session.squadId === squadId)
      .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
    return applyListOptions(sorted, options, (session) => session.scheduledFor);
  }

  async listByStatus(squadId: SquadId, status: SessionStatus): Promise<Session[]> {
    return this.all()
      .filter(
        (session) =>
          session.squadId === squadId &&
          session.status === status &&
          session.deletedAt === undefined,
      )
      .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
  }

  async findActive(): Promise<Session | undefined> {
    const candidates = this.all().filter(
      (session) => session.deletedAt === undefined && ACTIVE_STATUSES.has(session.status),
    );
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

class FakeObservationRepository
  extends FakeRepository<ObservationId, Observation>
  implements ObservationRepository
{
  async listBySession(sessionId: SessionId): Promise<Observation[]> {
    return this.byTime((o) => o.sessionId === sessionId);
  }

  async listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<Observation[]> {
    // Team-wide observations omit `playerId` entirely, and are correctly absent here — the
    // real store gets this for free because IndexedDB skips undefined index keys.
    const sorted = this.byTime((o) => o.playerId === playerId).reverse();
    return applyListOptions(sorted, options, (o) => o.at);
  }

  async listByPhase(phaseId: PhaseId): Promise<Observation[]> {
    return this.byTime((o) => o.phaseId === phaseId);
  }

  async listByPlayerCorner(playerId: PlayerId, corner: string): Promise<Observation[]> {
    // Unclassified observations have no `corner` key at all, so they cannot match — which
    // mirrors what the real index does rather than merely resembling it.
    return this.byTime((o) => o.playerId === playerId && o.corner === corner);
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<Observation[]> {
    const sorted = this.byTime((o) => o.squadId === squadId).reverse();
    return applyListOptions(sorted, options, (o) => o.at);
  }

  private byTime(predicate: (observation: Observation) => boolean): Observation[] {
    return this.all()
      .filter((observation) => observation.deletedAt === undefined && predicate(observation))
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}

class FakeReviewRepository
  extends FakeRepository<ReviewId, SessionReview>
  implements ReviewRepository
{
  async findBySession(sessionId: SessionId): Promise<SessionReview | undefined> {
    return this.all().find(
      (review) => review.sessionId === sessionId && review.deletedAt === undefined,
    );
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<SessionReview[]> {
    const sorted = this.all()
      .filter((review) => review.squadId === squadId)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return applyListOptions(sorted, options, (review) => review.completedAt);
  }
}

class FakeCarryForwardActionRepository
  extends FakeRepository<CarryForwardActionId, CarryForwardAction>
  implements CarryForwardActionRepository
{
  async listOpen(squadId: SquadId): Promise<CarryForwardAction[]> {
    return this.listByStatus(squadId, 'open');
  }

  async listByStatus(squadId: SquadId, status: CarryForwardStatus) {
    return this.all()
      .filter(
        (action) =>
          action.squadId === squadId && action.status === status && action.deletedAt === undefined,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listByOriginSession(sessionId: SessionId): Promise<CarryForwardAction[]> {
    return this.all().filter(
      (action) => action.originSessionId === sessionId && action.deletedAt === undefined,
    );
  }

  async listByPlayer(playerId: PlayerId): Promise<CarryForwardAction[]> {
    return this.all().filter(
      (action) => action.deletedAt === undefined && action.playerIds.includes(playerId),
    );
  }
}

class FakeGameModelRepository
  extends FakeRepository<GameModelId, GameModel>
  implements GameModelRepository
{
  async findBySquad(squadId: SquadId): Promise<GameModel | undefined> {
    return (await this.listAll()).find((model) => model.squadId === squadId);
  }

  async listAll(): Promise<GameModel[]> {
    return [...this.table().values()].map(clone);
  }
}

class FakePhaseImageRepository
  extends FakeRepository<PhaseImageId, PhaseImage>
  implements PhaseImageRepository
{
  /**
   * **Blobs are handed back by reference, not cloned.**
   *
   * `clone` exists so a caller cannot mutate what is stored. A `Blob` is immutable, so it
   * needs no such protection — and structured-cloning one under jsdom produces an object
   * that is no longer a `Blob` at all, which real IndexedDB never does. Copying the metadata
   * and keeping the bytes is both faithful and cheaper.
   */
  private read(image: PhaseImage): PhaseImage {
    const { blob, ...meta } = image;
    return { ...clone(meta), blob };
  }

  override async put(image: PhaseImage): Promise<void> {
    this.table().set(image.id, this.read(image));
  }

  override async putMany(images: readonly PhaseImage[]): Promise<void> {
    for (const image of images) await this.put(image);
  }

  override async get(id: PhaseImageId): Promise<PhaseImage | undefined> {
    const found = this.table().get(id);
    return found ? this.read(found) : undefined;
  }

  override async getMany(ids: readonly PhaseImageId[]): Promise<PhaseImage[]> {
    return ids
      .map((id) => this.table().get(id))
      .filter((image): image is PhaseImage => image !== undefined)
      .map((image) => this.read(image));
  }

  async listBySession(sessionId: SessionId): Promise<PhaseImage[]> {
    return (await this.listAll()).filter((image) => image.sessionId === sessionId);
  }

  async listAll(): Promise<PhaseImage[]> {
    return [...this.table().values()].map((image) => this.read(image));
  }
}

class FakeCapabilityScanRepository
  extends FakeRepository<CapabilityScanId, CapabilityScan>
  implements CapabilityScanRepository
{
  async listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<CapabilityScan[]> {
    const sorted = this.all()
      .filter((scan) => scan.playerId === playerId)
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    return applyListOptions(sorted, options, (scan) => scan.scannedAt);
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<CapabilityScan[]> {
    const sorted = this.all()
      .filter((scan) => scan.squadId === squadId)
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    return applyListOptions(sorted, options, (scan) => scan.scannedAt);
  }

  async listByPlayerSkill(
    playerId: PlayerId,
    skill: ObservedSkill,
    options?: ListOptions,
  ): Promise<CapabilityScan[]> {
    const sorted = this.all()
      .filter((scan) => scan.playerId === playerId && scan.skill === skill)
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    return applyListOptions(sorted, options, (scan) => scan.scannedAt);
  }

  async findLatest(playerId: PlayerId): Promise<CapabilityScan | undefined> {
    return (await this.listByPlayer(playerId, { limit: 1 }))[0];
  }
}

class FakePlayerAssessmentRepository
  extends FakeRepository<PlayerAssessmentId, PlayerAssessment>
  implements PlayerAssessmentRepository
{
  async listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<PlayerAssessment[]> {
    const sorted = this.all()
      .filter((assessment) => assessment.playerId === playerId)
      .sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));
    return applyListOptions(sorted, options, (assessment) => assessment.assessedAt);
  }

  async listBySquad(squadId: SquadId, options?: ListOptions): Promise<PlayerAssessment[]> {
    const sorted = this.all()
      .filter((assessment) => assessment.squadId === squadId)
      .sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));
    return applyListOptions(sorted, options, (assessment) => assessment.assessedAt);
  }

  async findLatest(playerId: PlayerId): Promise<PlayerAssessment | undefined> {
    return (await this.listByPlayer(playerId, { limit: 1 }))[0];
  }
}

class FakeMetaRepository implements MetaRepository {
  constructor(private readonly table: () => Map<string, AppMeta>) {}

  async get(): Promise<AppMeta | undefined> {
    const found = this.table().get('app');
    return found ? clone(found) : undefined;
  }

  async put(meta: AppMeta): Promise<void> {
    this.table().set('app', clone(meta));
  }

  async patch(changes: Partial<Omit<AppMeta, 'key'>>, now: IsoDateTime): Promise<AppMeta> {
    const current = (await this.get()) ?? defaultAppMeta(now);
    const next: AppMeta = { ...current, ...changes, key: 'app' };
    await this.put(next);
    return next;
  }
}

export function defaultAppMeta(now: IsoDateTime): AppMeta {
  return {
    key: 'app',
    docSchemaVersion: CURRENT_SCHEMA_VERSION,
    presetCatalogVersion: PRESET_CATALOG_VERSION,
    installedAt: now,
    lastExportAt: null,
    activeSessionId: null,
    activeSquadId: null,
    storagePersisted: false,
    completedSessionCount: 0,
    tacticalPeriodization: false,
  };
}

export class FakeDataStore implements PocketDataStore {
  private tables = emptyTables();
  private closed = false;
  /** Bumped on every write, so tests can assert a code path did not touch the store. */
  writeCount = 0;

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

  constructor() {
    const touch = () => {
      this.writeCount += 1;
    };
    this.squads = new FakeSquadRepository(() => this.tables.squads, touch);
    this.players = new FakePlayerRepository(() => this.tables.players, touch);
    this.methodologies = new FakeMethodologyRepository(
      () => this.tables.methodologies,
      () => this.tables.methodology_prefs,
      touch,
    );
    this.sessions = new FakeSessionRepository(() => this.tables.sessions, touch);
    this.observations = new FakeObservationRepository(() => this.tables.observations, touch);
    this.reviews = new FakeReviewRepository(() => this.tables.reviews, touch);
    this.actions = new FakeCarryForwardActionRepository(
      () => this.tables.carry_forward_actions,
      touch,
    );
    this.assessments = new FakePlayerAssessmentRepository(
      () => this.tables.player_assessments,
      touch,
    );
    this.scans = new FakeCapabilityScanRepository(() => this.tables.capability_scans, touch);
    this.gameModels = new FakeGameModelRepository(() => this.tables.game_models, touch);
    this.phaseImages = new FakePhaseImageRepository(() => this.tables.phase_images, touch);
    this.meta = new FakeMetaRepository(() => this.tables.app_meta);
  }

  /**
   * Snapshot, run, and roll back on throw. Not a real transaction — nothing here is
   * concurrent — but it gives the same all-or-nothing guarantee the IndexedDB adapter does,
   * which is what a half-applied import test needs to be able to assert.
   */
  async transact<T>(
    stores: readonly StoreName[],
    _mode: 'readonly' | 'readwrite',
    fn: (store: PocketDataStore) => Promise<T>,
  ): Promise<T> {
    const snapshot = this.snapshot();
    const real = this.tables;

    /*
     * **The declared store list is enforced**, because IndexedDB enforces it.
     *
     * `IdbDataStore.transact` opens a real transaction scoped to exactly these stores, and
     * writing to one it did not declare throws `NotFoundError`. A fake that ignored the list
     * made that a test which passes and a coach who cannot import — the store names are
     * exactly the table keys, so a Proxy is the whole enforcement.
     */
    const declared = new Set<string>(stores);
    this.tables = new Proxy(real, {
      get(target, key) {
        if (typeof key === 'string' && !declared.has(key)) {
          throw new Error(
            `Store "${key}" was written inside a transaction that did not declare it. ` +
              `Declared: ${[...declared].join(', ') || '(none)'}.`,
          );
        }
        return target[key as keyof Tables];
      },
    }) as Tables;

    try {
      const result = await fn(this);
      this.tables = real;
      return result;
    } catch (error) {
      this.tables = snapshot;
      throw error;
    }
  }

  async clear(): Promise<void> {
    this.writeCount += 1;
    this.tables = emptyTables();
  }

  close(): void {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private snapshot(): Tables {
    const copy = emptyTables();
    for (const name of Object.keys(this.tables) as (keyof Tables)[]) {
      const source = this.tables[name] as Map<string, unknown>;
      const target = copy[name] as Map<string, unknown>;
      for (const [key, value] of source) target.set(key, clone(value));
    }
    return copy;
  }
}
