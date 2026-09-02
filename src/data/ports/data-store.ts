import { z } from 'zod';
import type {
  CarryForwardActionId,
  MethodologyId,
  ObservationId,
  PhaseId,
  PlayerAssessmentId,
  PlayerId,
  ReviewId,
  SessionId,
  SquadId,
} from '@/domain/ids';
import type { CarryForwardAction, CarryForwardStatus } from '@/domain/carry-forward';
import type { Methodology, MethodologyPreset } from '@/domain/methodology';
import type { Observation } from '@/domain/observation';
import type { Player } from '@/domain/player';
import type { PlayerAssessment } from '@/domain/player-assessment';
import type { IsoDateTime } from '@/domain/primitives';
import { IsoDateTimeSchema } from '@/domain/primitives';
import type { SessionReview } from '@/domain/review';
import type { Session, SessionStatus } from '@/domain/session';
import type { Squad } from '@/domain/squad';

/**
 * The persistence port. Nothing above `src/data` knows IndexedDB exists — which is what lets
 * every service test run headless in milliseconds against `FakeDataStore`, and what would let
 * a sync decorator slot in later without touching a caller. See ADR 0001.
 */

export const STORE_NAMES = [
  'squads',
  'players',
  'methodologies',
  'methodology_prefs',
  'sessions',
  'observations',
  'reviews',
  'carry_forward_actions',
  'player_assessments',
  'app_meta',
] as const;
export type StoreName = (typeof STORE_NAMES)[number];

export interface Repository<TId, T> {
  get(id: TId): Promise<T | undefined>;
  getMany(ids: readonly TId[]): Promise<T[]>;
  put(entity: T): Promise<void>;
  putMany(entities: readonly T[]): Promise<void>;
  /** Sets `deletedAt`. The default for anything a coach can undo. */
  softDelete(id: TId, at: IsoDateTime): Promise<void>;
  /** Removes the row. Reserved for `replace`-mode import and for Settings → wipe. */
  hardDelete(id: TId): Promise<void>;
}

export interface ListOptions {
  limit?: number;
  /** Exclusive upper bound on the store's natural time key — for paging back through history. */
  before?: IsoDateTime;
  includeDeleted?: boolean;
}

export interface SquadRepository extends Repository<SquadId, Squad> {
  list(options?: ListOptions): Promise<Squad[]>;
}

export interface PlayerRepository extends Repository<PlayerId, Player> {
  listBySquad(squadId: SquadId, options?: { includeArchived?: boolean }): Promise<Player[]>;
}

/** Preferences for a methodology the coach did not create — hiding or favouriting a preset. */
export const MethodologyPrefsSchema = z.object({
  methodologyId: z.string().min(1).max(64),
  hidden: z.boolean().default(false),
  favourite: z.boolean().default(false),
  order: z.number().int().min(0).nullable().default(null),
  updatedAt: IsoDateTimeSchema,
});
export type MethodologyPrefs = z.infer<typeof MethodologyPrefsSchema>;

/** What `list()` returns: a preset or a custom row, with the coach's preferences applied. */
export interface CatalogEntry {
  readonly methodology: Methodology | MethodologyPreset;
  readonly isBuiltin: boolean;
  readonly hidden: boolean;
  readonly favourite: boolean;
}

export interface MethodologyRepository extends Repository<MethodologyId, Methodology> {
  /**
   * Presets first, then the coach's custom methodologies. Built-ins are **code-resident**,
   * merged in here at read time rather than seeded — see `src/domain/presets/index.ts`.
   */
  list(options?: { includeHidden?: boolean }): Promise<CatalogEntry[]>;
  listCustom(): Promise<Methodology[]>;
  /** Resolves a preset *or* a custom row by id, which is what a session snapshot needs. */
  resolve(id: MethodologyId): Promise<Methodology | MethodologyPreset | undefined>;
  getPrefs(id: MethodologyId): Promise<MethodologyPrefs | undefined>;
  setPrefs(prefs: MethodologyPrefs): Promise<void>;
}

export interface SessionRepository extends Repository<SessionId, Session> {
  listBySquad(squadId: SquadId, options?: ListOptions): Promise<Session[]>;
  listByStatus(squadId: SquadId, status: SessionStatus): Promise<Session[]>;
  /**
   * The one draft, the one active run, or the one session awaiting review — whichever
   * exists. This is what makes the singleton routes of ADR 0003 work.
   */
  findActive(): Promise<Session | undefined>;
  findDraft(squadId: SquadId): Promise<Session | undefined>;
  findAwaitingReview(squadId: SquadId): Promise<Session | undefined>;
  listRecentCompleted(squadId: SquadId, limit: number): Promise<Session[]>;
}

export interface PlayerAssessmentRepository extends Repository<
  PlayerAssessmentId,
  PlayerAssessment
> {
  /** Newest first — the profile leads with "where are they now". */
  listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<PlayerAssessment[]>;
  listBySquad(squadId: SquadId, options?: ListOptions): Promise<PlayerAssessment[]>;
  findLatest(playerId: PlayerId): Promise<PlayerAssessment | undefined>;
}

export interface ObservationRepository extends Repository<ObservationId, Observation> {
  listBySession(sessionId: SessionId): Promise<Observation[]>;
  /**
   * Everything in one corner for one player — the FA-model question. Unclassified
   * observations are absent by construction, because `corner` is optional-omitted.
   */
  listByPlayerCorner(playerId: PlayerId, corner: string): Promise<Observation[]>;
  /** Deliberately excludes team-wide observations — `playerId` is omitted for those. */
  listByPlayer(playerId: PlayerId, options?: ListOptions): Promise<Observation[]>;
  listByPhase(phaseId: PhaseId): Promise<Observation[]>;
  listBySquad(squadId: SquadId, options?: ListOptions): Promise<Observation[]>;
}

export interface ReviewRepository extends Repository<ReviewId, SessionReview> {
  findBySession(sessionId: SessionId): Promise<SessionReview | undefined>;
  listBySquad(squadId: SquadId, options?: ListOptions): Promise<SessionReview[]>;
}

export interface CarryForwardActionRepository extends Repository<
  CarryForwardActionId,
  CarryForwardAction
> {
  listOpen(squadId: SquadId): Promise<CarryForwardAction[]>;
  listByStatus(squadId: SquadId, status: CarryForwardStatus): Promise<CarryForwardAction[]>;
  listByOriginSession(sessionId: SessionId): Promise<CarryForwardAction[]>;
  listByPlayer(playerId: PlayerId): Promise<CarryForwardAction[]>;
}

export const AppMetaSchema = z.object({
  key: z.literal('app'),
  docSchemaVersion: z.number().int().min(1),
  presetCatalogVersion: z.number().int().min(1),
  installedAt: IsoDateTimeSchema,
  lastExportAt: IsoDateTimeSchema.nullable().default(null),
  /** Mirrored into `localStorage` so a cold start can paint "Resume" before IDB opens. */
  activeSessionId: z.string().uuid().nullable().default(null),
  activeSquadId: z.string().uuid().nullable().default(null),
  /** Whether `navigator.storage.persist()` has been granted. Surfaced in Settings. */
  storagePersisted: z.boolean().default(false),
  completedSessionCount: z.number().int().min(0).default(0),
});
export type AppMeta = z.infer<typeof AppMetaSchema>;

export interface MetaRepository {
  get(): Promise<AppMeta | undefined>;
  put(meta: AppMeta): Promise<void>;
  patch(changes: Partial<Omit<AppMeta, 'key'>>, now: IsoDateTime): Promise<AppMeta>;
}

export interface PocketDataStore {
  readonly squads: SquadRepository;
  readonly players: PlayerRepository;
  readonly methodologies: MethodologyRepository;
  readonly sessions: SessionRepository;
  readonly observations: ObservationRepository;
  readonly reviews: ReviewRepository;
  readonly actions: CarryForwardActionRepository;
  readonly assessments: PlayerAssessmentRepository;
  readonly meta: MetaRepository;

  /**
   * Multi-store atomic write.
   *
   * **CRITICAL: do not `await` a non-store promise inside `fn`.** IndexedDB auto-commits a
   * transaction on the first empty microtask turn, so awaiting anything that is not an IDB
   * request silently ends the transaction and every write after that point is lost — with no
   * error. Compute everything first, then transact.
   */
  transact<T>(
    stores: readonly StoreName[],
    mode: 'readonly' | 'readwrite',
    fn: (store: PocketDataStore) => Promise<T>,
  ): Promise<T>;

  /** Removes every row in every store. `replace`-mode import and Settings → wipe only. */
  clear(): Promise<void>;

  close(): void;
}
