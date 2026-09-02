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
export const SquadSchema = RecordMetaSchema.extend({
  id: SquadIdSchema,
  name: nonEmptyText(60),
  ageGroup: nonEmptyText(20).optional(),
  season: nonEmptyText(20).optional(),
  /** Pre-fills the duration stepper on `/plan`, so creating a session costs no taps here. */
  defaultSessionDurationMin: DurationMinSchema.default(60),
  /** Indexed, therefore optional-omitted rather than nullable. See ADR 0001. */
  archivedAt: IsoDateTimeSchema.optional(),
});
export type Squad = z.infer<typeof SquadSchema>;
export type SquadInput = z.input<typeof SquadSchema>;
