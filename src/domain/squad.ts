import { z } from 'zod';
import { SquadIdSchema } from './ids';
import { DurationMinSchema, IsoDateTimeSchema, nonEmptyText, RecordMetaSchema } from './primitives';

/**
 * A squad is the container everything else hangs off.
 *
 * Squads are in the model but muted in the UI: the switcher only appears once a second
 * squad exists. A player belongs to exactly one squad; a player moving between age groups
 * while keeping their observation history is a v2 concern, and modelling it now (a
 * many-to-many `squadIds`) would buy complexity a first release will not use.
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
  /** Indexed, therefore optional-omitted rather than nullable. See ADR 0001. */
  archivedAt: IsoDateTimeSchema.optional(),
});
export type Squad = z.infer<typeof SquadSchema>;
export type SquadInput = z.input<typeof SquadSchema>;
