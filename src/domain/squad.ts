import { z } from 'zod';
import { SquadIdSchema } from './ids';
import { DurationMinSchema, IsoDateTimeSchema, nonEmptyText, RecordMetaSchema } from './primitives';

/**
 * A squad is the container everything else hangs off.
 *
 * A coach may have several — a club volunteer with the U12s and the U14s, a manager with a
 * first team and reserves — and the one they are working with is `AppMeta.activeSquadId`,
 * changed from Settings (ADR 0010). Everything below a squad is scoped to exactly one of
 * them, which is what makes switching a single pointer write rather than a migration.
 *
 * A player belongs to exactly one squad; a player moving between age groups while keeping
 * their observation history is a v2 concern, and modelling it now (a many-to-many
 * `squadIds`) would buy complexity a first release will not use.
 */
export const SquadLevelSchema = z.enum(['youth', 'senior']);
export type SquadLevel = z.infer<typeof SquadLevelSchema>;

export const SQUAD_LEVEL_LABELS: Record<SquadLevel, string> = {
  youth: 'Youth',
  senior: 'Senior',
};

export const SquadSchema = RecordMetaSchema.extend({
  id: SquadIdSchema,
  name: nonEmptyText(60),
  ageGroup: nonEmptyText(20).optional(),
  season: nonEmptyText(20).optional(),
  /** Pre-fills the duration stepper on `/plan`, so creating a session costs no taps here. */
  defaultSessionDurationMin: DurationMinSchema.default(60),
  /**
   * Youth or senior — **the safeguarding gate on the morphocycle** (ADR 0007).
   *
   * Effort-quality labelling (tension, duration, velocity) is adult load management. A
   * professional club runs an academy full of children on the same app, so this cannot be a
   * global setting: it is a property of the squad, and one unfilled field must never put
   * strength-dominant Tuesdays in front of a coach planning for eleven-year-olds.
   *
   * **Defaults to `youth`, deliberately.** ADR 0007's follow-up asked for an explicit field
   * rather than inferring from the free-text `ageGroup`, precisely so the default could be the
   * safe one. `ageBandOf` still *suggests* — a squad called "U12 Reds" is offered `youth` — but
   * a squad called "First Team" resolves to no band at all, and the answer there has to be an
   * opt-in rather than an inference.
   */
  level: SquadLevelSchema.default('youth'),
  /**
   * Set when the coach stops coaching this team — last season's U12s, a team handed on.
   *
   * **Archived, never deleted**, for the same reason a player is: a squad's rows are a
   * season of evidence about children's development, and the coach who archives the U12s in
   * July still wants to read the term back in September. It drops out of the switcher and out
   * of `squads.list()`, and stays in the export.
   *
   * Optional-omitted rather than nullable, following every other soft flag in the schema —
   * an explicit `null` is not a valid IndexedDB key, so restoring rebuilds without the field
   * rather than setting it. See ADR 0001.
   */
  archivedAt: IsoDateTimeSchema.optional(),
});
export type Squad = z.infer<typeof SquadSchema>;
export type SquadInput = z.input<typeof SquadSchema>;

export function isArchived(squad: Squad): boolean {
  return squad.archivedAt !== undefined;
}

/**
 * Switcher order: by name, case-insensitively.
 *
 * Not `updatedAt` — that is the repository's order, and it is right for the export and wrong
 * for a list a coach picks from twice a week. Renaming a team or nudging its default session
 * length would move it, and a switcher whose rows move is a switcher you tap the wrong row in.
 */
export function compareSquads(a: Squad, b: Squad): number {
  return a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' });
}
