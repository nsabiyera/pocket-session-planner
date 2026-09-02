import type { DBSchema } from 'idb';
import type { CarryForwardAction } from '@/domain/carry-forward';
import type { Methodology } from '@/domain/methodology';
import type { Observation } from '@/domain/observation';
import type { Player } from '@/domain/player';
import type { PlayerAssessment } from '@/domain/player-assessment';
import type { SessionReview } from '@/domain/review';
import type { Session } from '@/domain/session';
import type { Squad } from '@/domain/squad';
import type { AppMeta, MethodologyPrefs } from '../ports/data-store';

export const DB_NAME = 'pocket-session-planner';

/**
 * **Structural** version. Bumped only when stores or indexes change, and handled by an
 * append-only `if (oldVersion < n)` ladder in `migrations/`. Never modify a shipped
 * migration; only append.
 *
 * Document *shape* changes use `RecordMeta.schemaVersion` instead and are applied lazily on
 * read, so a coach with three seasons of observations does not stare at a spinner on launch.
 */
export const DB_VERSION = 2;

/**
 * `idb`'s generic schema type. This is most of the reason the library is worth its 1.2 kB:
 * store names and index key types are checked at compile time, so a typo in `'by-squad-at'`
 * is an error here rather than a silent empty list on a pitch.
 */
export interface PocketDBSchema extends DBSchema {
  squads: {
    key: string;
    value: Squad;
    indexes: { 'by-updated': string };
  };
  players: {
    key: string;
    value: Player;
    indexes: { 'by-squad': string; 'by-name': string };
  };
  /** **Custom methodologies only.** Built-in presets are code-resident. */
  methodologies: {
    key: string;
    value: Methodology;
    indexes: { 'by-updated': string };
  };
  /** Hidden / favourite / order for methodologies the coach did not create. */
  methodology_prefs: {
    key: string;
    value: MethodologyPrefs;
  };
  sessions: {
    key: string;
    value: Session;
    indexes: {
      'by-squad-scheduled': [string, string];
      'by-squad-status': [string, string];
      'by-status': string;
      'by-updated': string;
    };
  };
  observations: {
    key: string;
    value: Observation;
    indexes: {
      'by-session-at': [string, string];
      /**
       * Deliberately **excludes team-wide observations**: `playerId` is omitted for those,
       * and IndexedDB skips records whose index key path resolves to `undefined`. That is
       * the desired semantics, and it is why `playerId` is `.optional()` not `.nullable()`.
       */
      'by-player-at': [string, string];
      'by-phase': string;
      'by-squad-at': [string, string];
      /** Added in v2. Excludes unclassified observations, which is the point. */
      'by-player-corner': [string, string];
    };
  };
  /** Added in v2: point-in-time FA 4 Corner profiles. */
  player_assessments: {
    key: string;
    value: PlayerAssessment;
    indexes: { 'by-player-at': [string, string]; 'by-squad-at': [string, string] };
  };
  reviews: {
    key: string;
    value: SessionReview;
    indexes: { 'by-session': string; 'by-squad-completed': [string, string] };
  };
  carry_forward_actions: {
    key: string;
    value: CarryForwardAction;
    indexes: {
      'by-squad-status': [string, string];
      'by-origin-session': string;
      /** multiEntry, so one action carrying three players is findable under each of them. */
      'by-player': string;
    };
  };
  app_meta: {
    key: string;
    value: AppMeta;
  };
}
