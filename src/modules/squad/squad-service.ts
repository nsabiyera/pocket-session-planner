import { asPlayerId, asSquadId, type PlayerId, type SquadId } from '@/domain/ids';
import { PlayerSchema, type Player, type PlayerPosition } from '@/domain/player';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { SquadSchema, type Squad } from '@/domain/squad';
import { requestPersistentStorage } from '@/data/idb/storage-persistence';
import { now, type ServiceContext } from '../context';

/**
 * Roster management — the simplest complete vertical slice, and the one that decides whether
 * the coach's data survives at all: creating the first squad is where we ask for persistent
 * storage.
 */

export interface CreateSquadInput {
  name: string;
  ageGroup?: string;
  season?: string;
  defaultSessionDurationMin?: number;
}

export async function createSquad(ctx: ServiceContext, input: CreateSquadInput): Promise<Squad> {
  const at = now(ctx);
  const squad = SquadSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    id: asSquadId(ctx.ids.uuid()),
    name: input.name,
    ...(input.ageGroup ? { ageGroup: input.ageGroup } : {}),
    ...(input.season ? { season: input.season } : {}),
    defaultSessionDurationMin: input.defaultSessionDurationMin ?? 60,
  });

  await ctx.store.squads.put(squad);

  const existing = await ctx.store.squads.list();
  if (existing.length === 1) {
    // The first squad is the first thing worth keeping, and it is also the first moment the
    // browser is likely to *grant* persistence — the heuristics reward engagement, so
    // asking on a cold first paint would simply be refused. Fire-and-forget: a refusal
    // changes nothing except that the export nag becomes the only safety net.
    const persisted = await requestPersistentStorage();
    await ctx.store.meta.patch({ storagePersisted: persisted, activeSquadId: squad.id }, at);
  }

  return squad;
}

export async function updateSquad(
  ctx: ServiceContext,
  squadId: SquadId,
  changes: Partial<Pick<Squad, 'name' | 'ageGroup' | 'season' | 'defaultSessionDurationMin'>>,
): Promise<Squad | undefined> {
  const current = await ctx.store.squads.get(squadId);
  if (!current) return undefined;

  const next = SquadSchema.parse({ ...current, ...changes, updatedAt: now(ctx) });
  await ctx.store.squads.put(next);
  return next;
}

export interface AddPlayerInput {
  squadId: SquadId;
  name: string;
  shirtNumber?: number;
  position?: PlayerPosition;
}

export async function addPlayer(ctx: ServiceContext, input: AddPlayerInput): Promise<Player> {
  const at = now(ctx);
  const player = PlayerSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    id: asPlayerId(ctx.ids.uuid()),
    squadId: input.squadId,
    name: input.name,
    ...(input.shirtNumber !== undefined ? { shirtNumber: input.shirtNumber } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
  });

  await ctx.store.players.put(player);
  return player;
}

/**
 * Adds several players from one pasted or typed list. The roster screen accepts
 * `7 Kai Roberts` per line, because typing a squad in one by one on a phone is the single
 * most tedious thing this app asks of a coach.
 */
export async function addPlayersFromList(
  ctx: ServiceContext,
  squadId: SquadId,
  text: string,
): Promise<Player[]> {
  const at = now(ctx);
  const players = parseRosterLines(text).map((entry) =>
    PlayerSchema.parse({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: at,
      updatedAt: at,
      id: asPlayerId(ctx.ids.uuid()),
      squadId,
      name: entry.name,
      ...(entry.shirtNumber !== undefined ? { shirtNumber: entry.shirtNumber } : {}),
    }),
  );

  await ctx.store.players.putMany(players);
  return players;
}

export interface RosterLine {
  name: string;
  shirtNumber?: number;
}

/** `7 Kai Roberts`, `7. Kai Roberts`, `Kai Roberts` — all mean the same thing. */
export function parseRosterLines(text: string): RosterLine[] {
  return text
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^(\d{1,2})[.)\s]+(.+)$/.exec(line);
      if (match) {
        const [, number, name] = match;
        return { name: (name ?? '').trim(), shirtNumber: Number(number) };
      }
      return { name: line };
    })
    .filter((entry) => entry.name.length > 0);
}

export async function updatePlayer(
  ctx: ServiceContext,
  playerId: PlayerId,
  changes: Partial<Pick<Player, 'name' | 'shirtNumber' | 'position' | 'notes'>>,
): Promise<Player | undefined> {
  const current = await ctx.store.players.get(playerId);
  if (!current) return undefined;

  const next = PlayerSchema.parse({ ...current, ...changes, updatedAt: now(ctx) });
  await ctx.store.players.put(next);
  return next;
}

/**
 * Players are **archived, never deleted**, while any observation references them. Deleting a
 * player would silently orphan a term of evidence about their development — and a coach who
 * archives a player who has left in March still wants their record in June.
 */
export async function archivePlayer(
  ctx: ServiceContext,
  playerId: PlayerId,
): Promise<Player | undefined> {
  const current = await ctx.store.players.get(playerId);
  if (!current) return undefined;

  const at = now(ctx);
  const next = PlayerSchema.parse({ ...current, archivedAt: at, updatedAt: at });
  await ctx.store.players.put(next);
  return next;
}

export async function restorePlayer(
  ctx: ServiceContext,
  playerId: PlayerId,
): Promise<Player | undefined> {
  const current = await ctx.store.players.get(playerId);
  if (!current) return undefined;

  const at = now(ctx);
  // Rebuilt without `archivedAt` rather than setting it to null: it is an indexed field, and
  // an explicit null is not a valid IndexedDB key. See ADR 0001.
  const { archivedAt: _archivedAt, ...rest } = current;
  const next = PlayerSchema.parse({ ...rest, updatedAt: at });
  await ctx.store.players.put(next);
  return next;
}

/**
 * Hard-deletes a player, but only when nothing references them. Offered on the roster as
 * "Remove" for the case that actually happens: a name typed twice, or typed wrong, seconds
 * ago. Anything with history archives instead.
 */
export async function deletePlayerIfUnreferenced(
  ctx: ServiceContext,
  playerId: PlayerId,
): Promise<{ deleted: boolean; reason?: string }> {
  const observations = await ctx.store.observations.listByPlayer(playerId, { limit: 1 });
  if (observations.length > 0) {
    return { deleted: false, reason: 'This player has observations logged against them.' };
  }

  const actions = await ctx.store.actions.listByPlayer(playerId);
  if (actions.length > 0) {
    return { deleted: false, reason: 'This player has carry-forward actions open.' };
  }

  await ctx.store.players.hardDelete(playerId);
  return { deleted: true };
}
