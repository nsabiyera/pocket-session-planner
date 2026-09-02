import { z } from 'zod';

/**
 * Every timestamp in this model is a **UTC ISO-8601 string**, never an epoch number
 * and never a `Date`.
 *
 * Three reasons, all of which bite if you pick otherwise:
 *  - it sorts correctly as an IndexedDB index key, so `[squadId, scheduledFor]` ranges work;
 *  - it survives the JSON export legibly, which matters because that file is the only backup
 *    a coach has and they may well open it;
 *  - `structuredClone` round-trips a `Date` into a *different object identity*, which makes
 *    equality assertions in the data-store contract suite quietly wrong.
 */
export const IsoDateTimeSchema = z.string().datetime({ offset: false }).brand<'IsoDateTime'>();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Converts epoch milliseconds to the canonical string form. */
export function isoFromMs(ms: number): IsoDateTime {
  return new Date(ms).toISOString() as IsoDateTime;
}

/** Parses an untrusted string into an `IsoDateTime`. Throws on malformed input. */
export function isoDateTime(value: string): IsoDateTime {
  return IsoDateTimeSchema.parse(value);
}

/** Epoch milliseconds for an `IsoDateTime`. Total, because the brand guarantees the shape. */
export function msOf(value: IsoDateTime): number {
  return Date.parse(value);
}

/**
 * Every persisted aggregate carries this.
 *
 * `deletedAt` is **optional-omitted rather than nullable** because it is an indexed field, and
 * IndexedDB drops records whose index key path resolves to `undefined` — which is exactly the
 * semantics we want for "not deleted". See ADR 0001.
 */
export const RecordMetaSchema = z.object({
  schemaVersion: z.number().int().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.optional(),
});
export type RecordMeta = z.infer<typeof RecordMetaSchema>;

/** The current document schema version. Bumped when a *data shape* changes, not the DB. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Text that must actually say something. Trimmed, so "   " is rejected. */
export const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

/** Free text that may be blank. Trimmed so a whitespace-only note stores as "". */
export const optionalText = (max: number) => z.string().trim().max(max);

/** The five-circle scale used for every rating in Review. */
export const RatingSchema = z.number().int().min(1).max(5);
export type Rating = z.infer<typeof RatingSchema>;

/** Minutes, as a coach thinks about them: whole numbers, never zero-length, never a workday. */
export const DurationMinSchema = z.number().int().min(1).max(240);

/** A shirt number, allowing 0 because youth squads do issue it. */
export const ShirtNumberSchema = z.number().int().min(0).max(99);

export const PrioritySchema = z.enum(['high', 'normal', 'low']);
export type Priority = z.infer<typeof PrioritySchema>;

/** Sort order for `Priority` — high first. Used wherever open actions are listed. */
export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
