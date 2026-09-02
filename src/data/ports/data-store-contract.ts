import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asMethodologyId, asPlayerId, asSessionId, asSquadId } from '@/domain/ids';
import { cloneMethodology } from '@/domain/methodology-clone';
import { PLAY_PRACTICE_PLAY } from '@/domain/presets';
import { isoDateTime, type IsoDateTime } from '@/domain/primitives';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import {
  aPlayer,
  anAssessment,
  aReview,
  aSession,
  aSquad,
  anAction,
  anObservation,
  playerId,
  SQUAD_ID,
  T0,
  testId,
} from '@/test/builders';
import { defaultAppMeta } from './fake-data-store';
import type { PocketDataStore } from './data-store';

/**
 * **One contract, two implementations.**
 *
 * Run against `FakeDataStore` directly and against `IdbDataStore` under `fake-indexeddb`.
 * This is how the offline layer earns its coverage honestly, and — more importantly — it is
 * what guarantees the fake every service test depends on stays behaviourally faithful to the
 * thing it stands in for. A difference between them shows up here rather than on a pitch.
 */
export function describeDataStoreContract(
  name: string,
  factory: () => Promise<PocketDataStore> | PocketDataStore,
): void {
  describe(`${name} — PocketDataStore contract`, () => {
    let store: PocketDataStore;

    beforeEach(async () => {
      store = await factory();
      await store.clear();
    });

    afterEach(() => {
      store.close();
    });

    const later = (minutes: number): IsoDateTime =>
      isoDateTime(new Date(Date.parse(T0) + minutes * 60_000).toISOString());

    // -----------------------------------------------------------------------
    // Repository basics — the same for every store, so tested once on squads.
    // -----------------------------------------------------------------------

    describe('repository basics', () => {
      it('round-trips an entity', async () => {
        const squad = aSquad();
        await store.squads.put(squad);
        expect(await store.squads.get(squad.id)).toEqual(squad);
      });

      it('returns undefined for an id that was never stored', async () => {
        expect(await store.squads.get(asSquadId(testId('ghost')))).toBeUndefined();
      });

      it('overwrites on a second put rather than duplicating', async () => {
        await store.squads.put(aSquad());
        await store.squads.put(aSquad({ name: 'U13 Blues' }));
        const all = await store.squads.list();
        expect(all).toHaveLength(1);
        expect(all[0]?.name).toBe('U13 Blues');
      });

      it('putMany and getMany move sets, and getMany skips absent ids', async () => {
        const players = [aPlayer('kai'), aPlayer('maya'), aPlayer('sam')];
        await store.players.putMany(players);

        const found = await store.players.getMany([
          players[0]!.id,
          asPlayerId(testId('ghost')),
          players[2]!.id,
        ]);
        expect(found.map((p) => p.name)).toEqual(['Kai', 'Sam']);
      });

      it('putMany of an empty list is a no-op, not an error', async () => {
        await expect(store.players.putMany([])).resolves.toBeUndefined();
      });

      it('soft delete keeps the row but hides it from lists', async () => {
        const squad = aSquad();
        await store.squads.put(squad);
        await store.squads.softDelete(squad.id, later(5));

        expect(await store.squads.list()).toEqual([]);
        expect((await store.squads.list({ includeDeleted: true }))[0]?.deletedAt).toBe(later(5));
        // Still fetchable by id — an undo has to be able to find it.
        expect((await store.squads.get(squad.id))?.deletedAt).toBe(later(5));
      });

      it('soft deleting an absent row does nothing rather than throwing', async () => {
        await expect(
          store.squads.softDelete(asSquadId(testId('ghost')), later(1)),
        ).resolves.toBeUndefined();
      });

      it('hard delete removes the row entirely', async () => {
        const squad = aSquad();
        await store.squads.put(squad);
        await store.squads.hardDelete(squad.id);
        expect(await store.squads.get(squad.id)).toBeUndefined();
      });

      it('stores are isolated from caller mutation in both directions', async () => {
        const squad = aSquad();
        await store.squads.put(squad);

        // Mutating what we put must not reach the store...
        (squad as { name: string }).name = 'MUTATED AFTER PUT';
        const read = await store.squads.get(squad.id);
        expect(read?.name).toBe('U12 Reds');

        // ...and neither must mutating what we read.
        (read as { name: string }).name = 'MUTATED AFTER GET';
        expect((await store.squads.get(squad.id))?.name).toBe('U12 Reds');
      });
    });

    // -----------------------------------------------------------------------
    // Players
    // -----------------------------------------------------------------------

    describe('players', () => {
      it('lists a squad roster by name, excluding archived players by default', async () => {
        await store.players.putMany([
          aPlayer('sam'),
          aPlayer('kai'),
          aPlayer('maya', { archivedAt: later(1) }),
        ]);

        expect((await store.players.listBySquad(SQUAD_ID)).map((p) => p.name)).toEqual([
          'Kai',
          'Sam',
        ]);
        expect(
          (await store.players.listBySquad(SQUAD_ID, { includeArchived: true })).map((p) => p.name),
        ).toEqual(['Kai', 'Maya', 'Sam']);
      });

      it('does not leak players from another squad', async () => {
        const otherSquad = asSquadId(testId('squad2'));
        await store.players.putMany([aPlayer('kai'), aPlayer('rio', { squadId: otherSquad })]);
        expect((await store.players.listBySquad(SQUAD_ID)).map((p) => p.name)).toEqual(['Kai']);
      });
    });

    // -----------------------------------------------------------------------
    // Methodologies — the code-resident preset merge
    // -----------------------------------------------------------------------

    describe('methodologies', () => {
      it('lists the built-in presets without anything having been seeded', async () => {
        const catalog = await store.methodologies.list();
        expect(catalog).toHaveLength(5);
        expect(catalog.every((entry) => entry.isBuiltin)).toBe(true);
        expect(catalog[0]?.methodology.id).toBe('play-practice-play');
      });

      it('appends custom methodologies after the presets', async () => {
        const custom = cloneMethodology(PLAY_PRACTICE_PLAY, {
          name: 'My PPP',
          now: T0,
          ids: new FakeIdGenerator('bbbb'),
        });
        await store.methodologies.put(custom);

        const catalog = await store.methodologies.list();
        expect(catalog).toHaveLength(6);
        expect(catalog[5]?.methodology.name).toBe('My PPP');
        expect(catalog[5]?.isBuiltin).toBe(false);
        // Only custom rows are stored — presets never touch the database.
        expect(await store.methodologies.listCustom()).toHaveLength(1);
      });

      it('hides a preset the coach has hidden, without deleting anything', async () => {
        await store.methodologies.setPrefs({
          methodologyId: 'command-direct',
          hidden: true,
          favourite: false,
          order: null,
          updatedAt: T0,
        });

        const visible = await store.methodologies.list();
        expect(visible.map((e) => e.methodology.id)).not.toContain('command-direct');
        expect(
          (await store.methodologies.list({ includeHidden: true })).map((e) => e.methodology.id),
        ).toContain('command-direct');
      });

      it('lifts a favourite to the top of its group', async () => {
        await store.methodologies.setPrefs({
          methodologyId: 'whole-part-whole',
          hidden: false,
          favourite: true,
          order: null,
          updatedAt: T0,
        });
        const catalog = await store.methodologies.list();
        expect(catalog[0]?.methodology.id).toBe('whole-part-whole');
      });

      it('resolves a preset id and a custom id through the same accessor', async () => {
        const custom = cloneMethodology(PLAY_PRACTICE_PLAY, {
          name: 'My PPP',
          now: T0,
          ids: new FakeIdGenerator('cccc'),
        });
        await store.methodologies.put(custom);

        expect((await store.methodologies.resolve(asMethodologyId('constraints-led')))?.name).toBe(
          'Constraints-Led',
        );
        expect((await store.methodologies.resolve(custom.id))?.name).toBe('My PPP');
        expect(await store.methodologies.resolve(asMethodologyId('nope'))).toBeUndefined();
      });

      it('round-trips preferences', async () => {
        const prefs = {
          methodologyId: 'constraints-led',
          hidden: false,
          favourite: true,
          order: 2,
          updatedAt: T0,
        };
        await store.methodologies.setPrefs(prefs);
        expect(await store.methodologies.getPrefs(asMethodologyId('constraints-led'))).toEqual(
          prefs,
        );
        expect(await store.methodologies.getPrefs(asMethodologyId('nope'))).toBeUndefined();
      });
    });

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    describe('sessions', () => {
      it('lists a squad newest scheduled first', async () => {
        await store.sessions.putMany([
          aSession({ id: asSessionId(testId('s1')), scheduledFor: later(0) }),
          aSession({ id: asSessionId(testId('s2')), scheduledFor: later(120) }),
          aSession({ id: asSessionId(testId('s3')), scheduledFor: later(60) }),
        ]);
        const listed = await store.sessions.listBySquad(SQUAD_ID);
        expect(listed.map((s) => s.scheduledFor)).toEqual([later(120), later(60), later(0)]);
      });

      it('pages with limit and before', async () => {
        await store.sessions.putMany([
          aSession({ id: asSessionId(testId('s1')), scheduledFor: later(0) }),
          aSession({ id: asSessionId(testId('s2')), scheduledFor: later(120) }),
          aSession({ id: asSessionId(testId('s3')), scheduledFor: later(60) }),
        ]);

        expect(await store.sessions.listBySquad(SQUAD_ID, { limit: 2 })).toHaveLength(2);
        const older = await store.sessions.listBySquad(SQUAD_ID, { before: later(60) });
        expect(older.map((s) => s.scheduledFor)).toEqual([later(0)]);
      });

      it('filters by status within a squad', async () => {
        await store.sessions.putMany([
          aSession({ id: asSessionId(testId('s1')), status: 'draft' }),
          aSession({ id: asSessionId(testId('s2')), status: 'completed' }),
        ]);
        expect(await store.sessions.listByStatus(SQUAD_ID, 'draft')).toHaveLength(1);
        expect(await store.sessions.listByStatus(SQUAD_ID, 'abandoned')).toEqual([]);
      });

      it('findActive prefers an in-progress run over a stale draft', async () => {
        const running = aSession({
          id: asSessionId(testId('running')),
          status: 'in_progress',
          updatedAt: later(1),
          run: {
            startedAt: T0,
            endedAt: null,
            currentPhaseIndex: 0,
            phaseRuns: [
              {
                phaseId: aSession().phases[0]!.id,
                startedAt: T0,
                runningSince: T0,
                accumulatedMs: 0,
                endedAt: null,
                skipped: false,
              },
            ],
            pauseReason: null,
            openInterventionId: null,
            lastHeartbeatAt: T0,
            interventionEvents: [],
          },
        });
        await store.sessions.putMany([
          aSession({ id: asSessionId(testId('draft')), status: 'draft', updatedAt: later(90) }),
          running,
        ]);

        expect((await store.sessions.findActive())?.id).toBe(running.id);
      });

      it('findActive returns undefined when everything is finished', async () => {
        await store.sessions.put(aSession({ status: 'completed' }));
        expect(await store.sessions.findActive()).toBeUndefined();
      });

      it('findDraft and findAwaitingReview answer the singleton-route questions', async () => {
        await store.sessions.putMany([
          aSession({ id: asSessionId(testId('d')), status: 'draft' }),
          aSession({ id: asSessionId(testId('c')), status: 'completed', reviewId: null }),
        ]);

        expect((await store.sessions.findDraft(SQUAD_ID))?.status).toBe('draft');
        expect((await store.sessions.findAwaitingReview(SQUAD_ID))?.status).toBe('completed');
      });

      it('a reviewed session is no longer awaiting review', async () => {
        await store.sessions.put(
          aSession({
            status: 'completed',
            reviewId: aReview().id,
          }),
        );
        expect(await store.sessions.findAwaitingReview(SQUAD_ID)).toBeUndefined();
      });

      it('lists recent completed sessions, newest first, capped', async () => {
        await store.sessions.putMany([
          aSession({ id: asSessionId(testId('c1')), status: 'completed', scheduledFor: later(0) }),
          aSession({ id: asSessionId(testId('c2')), status: 'completed', scheduledFor: later(60) }),
          aSession({ id: asSessionId(testId('c3')), status: 'completed', scheduledFor: later(30) }),
        ]);
        const recent = await store.sessions.listRecentCompleted(SQUAD_ID, 2);
        expect(recent.map((s) => s.scheduledFor)).toEqual([later(60), later(30)]);
      });
    });

    // -----------------------------------------------------------------------
    // Observations — including the indexed-nullable behaviour
    // -----------------------------------------------------------------------

    describe('observations', () => {
      it('lists a session in chronological order', async () => {
        await store.observations.putMany([
          anObservation('o2', { at: later(10) }),
          anObservation('o1', { at: later(2) }),
        ]);
        const listed = await store.observations.listBySession(asSessionId(testId('session1')));
        expect(listed.map((o) => o.at)).toEqual([later(2), later(10)]);
      });

      it('lists a player newest first, and excludes team-wide observations entirely', async () => {
        await store.observations.putMany([
          anObservation('kai1', { playerId: playerId('kai'), at: later(2) }),
          anObservation('kai2', { playerId: playerId('kai'), at: later(20) }),
          anObservation('team1', { at: later(5), kind: 'note' }),
        ]);

        const kai = await store.observations.listByPlayer(playerId('kai'));
        expect(kai.map((o) => o.at)).toEqual([later(20), later(2)]);
        // The team-wide note has no playerId at all, so it cannot appear under any player.
        expect(kai.some((o) => o.playerId === undefined)).toBe(false);
      });

      it('lists by phase and by squad', async () => {
        await store.observations.putMany([
          anObservation('o1', { at: later(1) }),
          anObservation('o2', { at: later(2) }),
        ]);
        expect(await store.observations.listByPhase(anObservation('x').phaseId)).toHaveLength(2);
        expect(await store.observations.listBySquad(SQUAD_ID)).toHaveLength(2);
      });

      it('pages a squad timeline backwards through history', async () => {
        await store.observations.putMany([
          anObservation('o1', { at: later(1) }),
          anObservation('o2', { at: later(10) }),
          anObservation('o3', { at: later(20) }),
        ]);
        const page = await store.observations.listBySquad(SQUAD_ID, {
          before: later(10),
          limit: 5,
        });
        expect(page.map((o) => o.at)).toEqual([later(1)]);
      });
    });

    // -----------------------------------------------------------------------
    // The FA 4 Corner Model
    // -----------------------------------------------------------------------

    describe('corner-tagged observations', () => {
      it('finds everything in one corner for one player', async () => {
        await store.observations.putMany([
          anObservation('t1', {
            playerId: playerId('kai'),
            corner: 'technical_tactical',
            at: later(1),
          }),
          anObservation('s1', { playerId: playerId('kai'), corner: 'social', at: later(2) }),
          anObservation('s2', { playerId: playerId('kai'), corner: 'social', at: later(3) }),
          anObservation('s3', { playerId: playerId('maya'), corner: 'social', at: later(4) }),
        ]);

        const social = await store.observations.listByPlayerCorner(playerId('kai'), 'social');
        expect(social.map((o) => o.at)).toEqual([later(2), later(3)]);
      });

      it('excludes unclassified observations entirely, which is the desired semantics', async () => {
        await store.observations.putMany([
          anObservation('classified', {
            playerId: playerId('kai'),
            corner: 'physical',
            at: later(1),
          }),
          // No corner at all — a note the coach never tagged.
          anObservation('unclassified', { playerId: playerId('kai'), at: later(2) }),
        ]);

        for (const corner of ['technical_tactical', 'physical', 'psychological', 'social']) {
          const rows = await store.observations.listByPlayerCorner(playerId('kai'), corner);
          expect(rows.every((o) => o.corner !== undefined)).toBe(true);
        }
        expect(
          await store.observations.listByPlayerCorner(playerId('kai'), 'physical'),
        ).toHaveLength(1);
        // Still present in the player's full timeline — it is hidden from the index, not lost.
        expect(await store.observations.listByPlayer(playerId('kai'))).toHaveLength(2);
      });

      it('returns nothing for a corner the player has never been seen in', async () => {
        await store.observations.put(
          anObservation('t1', { playerId: playerId('kai'), corner: 'technical_tactical' }),
        );
        expect(await store.observations.listByPlayerCorner(playerId('kai'), 'social')).toEqual([]);
      });
    });

    describe('player assessments', () => {
      it('lists a player newest first — the profile leads with where they are now', async () => {
        await store.assessments.putMany([
          anAssessment('a1', { assessedAt: later(0) }),
          anAssessment('a2', { assessedAt: later(120) }),
          anAssessment('a3', { assessedAt: later(60) }),
        ]);

        const listed = await store.assessments.listByPlayer(playerId('kai'));
        expect(listed.map((a) => a.assessedAt)).toEqual([later(120), later(60), later(0)]);
      });

      it('findLatest is the most recent one', async () => {
        await store.assessments.putMany([
          anAssessment('a1', { assessedAt: later(0) }),
          anAssessment('a2', { assessedAt: later(120) }),
        ]);
        expect((await store.assessments.findLatest(playerId('kai')))?.assessedAt).toBe(later(120));
        expect(await store.assessments.findLatest(playerId('nobody'))).toBeUndefined();
      });

      it('does not leak one player assessments into another', async () => {
        await store.assessments.putMany([
          anAssessment('a1'),
          anAssessment('a2', { playerId: playerId('maya') }),
        ]);
        expect(await store.assessments.listByPlayer(playerId('kai'))).toHaveLength(1);
        expect(await store.assessments.listBySquad(SQUAD_ID)).toHaveLength(2);
      });

      it('pages a squad history backwards', async () => {
        await store.assessments.putMany([
          anAssessment('a1', { assessedAt: later(0) }),
          anAssessment('a2', { assessedAt: later(120) }),
        ]);
        const page = await store.assessments.listBySquad(SQUAD_ID, { before: later(120) });
        expect(page.map((a) => a.assessedAt)).toEqual([later(0)]);
      });
    });

    // -----------------------------------------------------------------------
    // Reviews and carry-forward actions
    // -----------------------------------------------------------------------

    describe('reviews', () => {
      it('finds the one review for a session', async () => {
        const review = aReview();
        await store.reviews.put(review);
        expect((await store.reviews.findBySession(review.sessionId))?.id).toBe(review.id);
        expect(await store.reviews.findBySession(asSessionId(testId('other')))).toBeUndefined();
      });

      it('lists a squad newest completed first', async () => {
        await store.reviews.putMany([
          aReview({ id: aReview().id, completedAt: later(5) }),
          aReview({
            id: aReview({ sessionId: asSessionId(testId('s2')) }).id,
            sessionId: asSessionId(testId('s2')),
            completedAt: later(50),
          }),
        ]);
        const listed = await store.reviews.listBySquad(SQUAD_ID);
        expect(listed[0]?.completedAt).toBe(later(50));
      });
    });

    describe('carry-forward actions', () => {
      it('lists open actions oldest first, so the longest-waiting is at the top', async () => {
        await store.actions.putMany([
          anAction('a1', { createdAt: later(100) }),
          anAction('a2', { createdAt: later(1) }),
        ]);
        const open = await store.actions.listOpen(SQUAD_ID);
        expect(open.map((a) => a.createdAt)).toEqual([later(1), later(100)]);
      });

      it('separates statuses', async () => {
        await store.actions.putMany([
          anAction('a1'),
          anAction('a2', { status: 'done', resolvedAt: later(5) }),
        ]);
        expect(await store.actions.listOpen(SQUAD_ID)).toHaveLength(1);
        expect(await store.actions.listByStatus(SQUAD_ID, 'done')).toHaveLength(1);
      });

      it('finds actions by the session that produced them', async () => {
        await store.actions.put(anAction('a1'));
        expect(
          await store.actions.listByOriginSession(asSessionId(testId('session1'))),
        ).toHaveLength(1);
        expect(await store.actions.listByOriginSession(asSessionId(testId('nope')))).toEqual([]);
      });

      it('finds actions by player through the multi-entry index', async () => {
        await store.actions.putMany([
          anAction('a1', { playerIds: [playerId('kai'), playerId('maya')] }),
          anAction('a2', { playerIds: [playerId('sam')] }),
          anAction('a3'),
        ]);

        expect((await store.actions.listByPlayer(playerId('kai'))).map((a) => a.id)).toEqual([
          anAction('a1').id,
        ]);
        expect(await store.actions.listByPlayer(playerId('nobody'))).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    // Meta
    // -----------------------------------------------------------------------

    describe('app meta', () => {
      it('is absent until written', async () => {
        expect(await store.meta.get()).toBeUndefined();
      });

      it('round-trips and patches', async () => {
        await store.meta.put(defaultAppMeta(T0));
        const patched = await store.meta.patch({ lastExportAt: later(10) }, later(10));

        expect(patched.lastExportAt).toBe(later(10));
        expect(patched.installedAt).toBe(T0);
        expect((await store.meta.get())?.lastExportAt).toBe(later(10));
      });

      it('patching before anything is written creates the record', async () => {
        const created = await store.meta.patch({ completedSessionCount: 1 }, T0);
        expect(created.key).toBe('app');
        expect(created.completedSessionCount).toBe(1);
      });
    });

    // -----------------------------------------------------------------------
    // Transactions
    // -----------------------------------------------------------------------

    describe('transact', () => {
      it('commits every store it touched', async () => {
        await store.transact(['sessions', 'carry_forward_actions'], 'readwrite', async (tx) => {
          await tx.sessions.put(aSession());
          await tx.actions.put(anAction('a1'));
        });

        expect(await store.sessions.get(aSession().id)).toBeDefined();
        expect(await store.actions.get(anAction('a1').id)).toBeDefined();
      });

      it('rolls back everything when the body throws — no half-applied import', async () => {
        await store.squads.put(aSquad());

        await expect(
          store.transact(['squads', 'players'], 'readwrite', async (tx) => {
            await tx.players.put(aPlayer('kai'));
            await tx.squads.softDelete(SQUAD_ID, later(1));
            throw new Error('referential integrity failed');
          }),
        ).rejects.toThrow('referential integrity failed');

        expect(await store.players.listBySquad(SQUAD_ID)).toEqual([]);
        expect((await store.squads.get(SQUAD_ID))?.deletedAt).toBeUndefined();
      });

      it('returns the body result', async () => {
        const result = await store.transact(['squads'], 'readonly', async () => 'done');
        expect(result).toBe('done');
      });

      it('reads inside a transaction see writes made earlier in the same transaction', async () => {
        const seen = await store.transact(['squads'], 'readwrite', async (tx) => {
          await tx.squads.put(aSquad({ name: 'Inside' }));
          return (await tx.squads.get(SQUAD_ID))?.name;
        });
        expect(seen).toBe('Inside');
      });
    });

    describe('clear', () => {
      it('empties every store', async () => {
        await store.squads.put(aSquad());
        await store.players.put(aPlayer('kai'));
        await store.sessions.put(aSession());
        await store.assessments.put(anAssessment('a1'));
        await store.meta.put(defaultAppMeta(T0));

        await store.clear();

        expect(await store.squads.list()).toEqual([]);
        expect(await store.players.listBySquad(SQUAD_ID)).toEqual([]);
        expect(await store.sessions.listBySquad(SQUAD_ID)).toEqual([]);
        expect(await store.assessments.listBySquad(SQUAD_ID)).toEqual([]);
        expect(await store.meta.get()).toBeUndefined();
        // Presets are code-resident, so they survive a wipe. That is the point of them.
        expect(await store.methodologies.list()).toHaveLength(5);
      });
    });
  });
}
