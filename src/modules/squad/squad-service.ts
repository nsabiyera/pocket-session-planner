import { asPlayerId, asSquadId, type PlayerId, type SquadId } from '@/domain/ids';
import { PlayerSchema, type Player, type PlayerPosition } from '@/domain/player';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { SquadSchema, type Squad } from '@/domain/squad';
import { requestPersistentStorage } from '@/data/idb/storage-persistence';
import { err, ok, type Result } from '@/lib/result';
import { now, type ServiceContext } from '../context';

/**
 * Roster management — the simplest complete vertical slice, and the one that decides whether
 * the coach's data survives at all: creating the first squad is where we ask for persistent
 * storage.
 *
 * It also owns the several-teams half of ADR 0010: which squad is current, and archiving the
 * ones a coach has finished with. Both are one `app_meta` write, and neither touches a row
 * under a squad — that is the whole design.
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

  // `includeArchived`, so a coach who archived last season's only team and starts a new one
  // is not asked for persistence a second time — and, more to the point, does not have their
  // recorded answer overwritten by a fresh refusal.
  const existing = await ctx.store.squads.list({ includeArchived: true });
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
  changes: Partial<
    Pick<Squad, 'name' | 'ageGroup' | 'season' | 'defaultSessionDurationMin' | 'level'>
  >,
): Promise<Squad | undefined> {
  const current = await ctx.store.squads.get(squadId);
  if (!current) return undefined;

  const next = SquadSchema.parse({ ...current, ...changes, updatedAt: now(ctx) });
  await ctx.store.squads.put(next);
  return next;
}

/**
 * Which squad every other screen is about.
 *
 * **Refused while a session is running**, and this is the one rule that makes several teams
 * safe rather than merely possible. Two reasons, and they point the same way:
 *
 * - A run in progress *pins* the current squad — `read()` in the app store resolves the
 *   active squad from the running session, because the app must never hide a session a coach
 *   is standing in front of. A switch here would therefore be silently undone, and a control
 *   that appears to do nothing is worse than one that explains itself.
 * - Every observation, intervention and challenge logged in Do mode is filed against the
 *   session's squad. Switching mid-run is the one move that could put a Tuesday's evidence
 *   under the wrong team, which is the single thing this app cannot let a coach do by accident.
 *
 * Finishing or abandoning the session clears it. Nothing else is checked: a *draft* for
 * another squad is not in the way, because drafts are one-per-squad already (ADR 0003 holds
 * per squad, not per device) and both survive the switch untouched.
 */
export type SwitchSquadError =
  | { kind: 'squad_not_found' }
  | { kind: 'squad_archived' }
  | { kind: 'session_running'; sessionTitle: string };

export async function switchSquad(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<Result<Squad, SwitchSquadError>> {
  const squad = await ctx.store.squads.get(squadId);
  if (!squad || squad.deletedAt !== undefined) return err({ kind: 'squad_not_found' });
  if (squad.archivedAt !== undefined) return err({ kind: 'squad_archived' });

  const running = await runningSession(ctx);
  if (running) return err({ kind: 'session_running', sessionTitle: running.title });

  // Already there. Still `Ok` — the caller asked for a state, not for a transition.
  if ((await ctx.store.meta.get())?.activeSquadId === squadId) return ok(squad);

  await ctx.store.meta.patch({ activeSquadId: squadId }, now(ctx));
  return ok(squad);
}

/**
 * Archives a squad the coach has finished with.
 *
 * **Nothing is deleted.** The squad keeps every player, session, observation, review and
 * carried action; it leaves the switcher and the export carries it on. That is the same
 * bargain `archivePlayer` strikes, and for the same reason — a season of notes about
 * children's development is not the app's to throw away.
 *
 * Two refusals:
 *
 * - **The last squad.** Archiving it would drop the app back to the `Name your squad` first
 *   run with a database full of data behind it, which reads as *"my season is gone"*. A coach
 *   who has genuinely finished adds the new team first, then archives the old one.
 * - **A squad mid-session.** Same argument as `switchSquad`, one step stronger: the archived
 *   squad would leave the switcher while a coach was still logging against it.
 */
export type ArchiveSquadError =
  | { kind: 'squad_not_found' }
  | { kind: 'last_squad' }
  | { kind: 'session_running'; sessionTitle: string };

export async function archiveSquad(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<Result<Squad, ArchiveSquadError>> {
  const squad = await ctx.store.squads.get(squadId);
  if (!squad || squad.deletedAt !== undefined) return err({ kind: 'squad_not_found' });
  if (squad.archivedAt !== undefined) return ok(squad);

  const live = await ctx.store.squads.list();
  if (live.length <= 1) return err({ kind: 'last_squad' });

  const running = await runningSession(ctx);
  if (running?.squadId === squadId) {
    return err({ kind: 'session_running', sessionTitle: running.title });
  }

  const at = now(ctx);
  const next = SquadSchema.parse({ ...squad, archivedAt: at, updatedAt: at });
  await ctx.store.squads.put(next);

  /*
   * Move the pointer off it if it was the current squad, rather than leaving `activeSquadId`
   * aimed at a squad no screen will show. `read()` would fall back to `squads[0]` anyway, but
   * an explicit write means the coach's next cold start opens where this one left off.
   */
  const meta = await ctx.store.meta.get();
  if (meta?.activeSquadId === squadId) {
    // `live` held at least two squads, so in practice there is always one left to point at;
    // the `null` is the honest answer to a race rather than a state a coach can reach.
    const successor = live.find((candidate) => candidate.id !== squadId);
    await ctx.store.meta.patch({ activeSquadId: successor?.id ?? null }, at);
  }

  return ok(next);
}

/** Brings an archived squad back. It does **not** become the current one — that is a tap of its own. */
export async function restoreSquad(
  ctx: ServiceContext,
  squadId: SquadId,
): Promise<Squad | undefined> {
  const current = await ctx.store.squads.get(squadId);
  if (!current) return undefined;

  const at = now(ctx);
  // Rebuilt without `archivedAt` rather than setting it to null, exactly as `restorePlayer`
  // does: the field is optional-omitted, and null is not a valid IndexedDB key (ADR 0001).
  const { archivedAt: _archivedAt, ...rest } = current;
  const next = SquadSchema.parse({ ...rest, updatedAt: at });
  await ctx.store.squads.put(next);
  return next;
}

/**
 * The one session that is actually being run, or `undefined`.
 *
 * `findActive()` answers draft-or-planned-or-running and prefers the run, so the status check
 * is what narrows it — a draft blocks nothing.
 */
async function runningSession(ctx: ServiceContext) {
  const active = await ctx.store.sessions.findActive();
  return active?.status === 'in_progress' ? active : undefined;
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
