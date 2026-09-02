import { z } from 'zod';
import { PlayerIdSchema, SquadIdSchema } from './ids';
import {
  IsoDateTimeSchema,
  nonEmptyText,
  optionalText,
  RecordMetaSchema,
  ShirtNumberSchema,
} from './primitives';

export const PlayerPositionSchema = z.enum([
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
  'any',
]);
export type PlayerPosition = z.infer<typeof PlayerPositionSchema>;

/**
 * `archivedAt` is **optional-omitted, not nullable**, because it is an indexed field and
 * IndexedDB skips records whose index key path resolves to `undefined`. Omitting it is what
 * makes "the active roster" a plain index scan. See ADR 0001.
 *
 * Players are soft-archived and never hard-deleted while observations reference them —
 * deleting a player would silently orphan a term of evidence about their development.
 */
export const PlayerSchema = RecordMetaSchema.extend({
  id: PlayerIdSchema,
  squadId: SquadIdSchema,
  name: nonEmptyText(60),
  shirtNumber: ShirtNumberSchema.optional(),
  position: PlayerPositionSchema.optional(),
  notes: optionalText(500).optional(),
  archivedAt: IsoDateTimeSchema.optional(),
});
export type Player = z.infer<typeof PlayerSchema>;
export type PlayerInput = z.input<typeof PlayerSchema>;

export function isActivePlayer(player: Player): boolean {
  return player.archivedAt === undefined && player.deletedAt === undefined;
}

/** Roster order: shirt number when both have one, then name. Stable and unsurprising. */
export function comparePlayers(a: Player, b: Player): number {
  if (a.shirtNumber !== undefined && b.shirtNumber !== undefined) {
    if (a.shirtNumber !== b.shirtNumber) return a.shirtNumber - b.shirtNumber;
  } else if (a.shirtNumber !== undefined) {
    return -1;
  } else if (b.shirtNumber !== undefined) {
    return 1;
  }
  return a.name.localeCompare(b.name);
}

/** First name plus an initial only when needed — chips in Do mode have ~10 characters. */
export function shortPlayerName(player: Player, roster: readonly Player[]): string {
  const [first = player.name, ...rest] = player.name.split(/\s+/);
  const clashes = roster.filter((p) => p.id !== player.id && p.name.split(/\s+/)[0] === first);
  if (clashes.length === 0 || rest.length === 0) return first;
  return `${first} ${rest[rest.length - 1]?.charAt(0) ?? ''}`.trim();
}
