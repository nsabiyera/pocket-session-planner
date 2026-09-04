import { beforeEach, describe, expect, it } from 'vitest';
import { commitImport, exportAll, planImport } from './transfer-service';
import { EXPORT_FORMAT, exportFilename } from './envelope';
import { migrateAll, migrateDocument, needsMigration } from './document-migrations';
import { commitAndStart, startDraft } from '../planning/planning-service';
import { addChallenge } from '../planning/challenges';
import { dispatch, logObservation } from '../run/run-service';
import { proposeCarryForward, saveReview } from '../review/review-service';
import { addPlayer, createSquad } from '../squad/squad-service';
import { cloneMethodology } from '@/domain/methodology-clone';
import { PLAY_PRACTICE_PLAY } from '@/domain/presets';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { T0 } from '@/test/builders';
import type { ServiceContext } from '../context';
import type { SquadId } from '@/domain/ids';

let ctx: ServiceContext;
const clock = () => ctx.clock as FakeClock;

function freshContext(prefix = '0000'): ServiceContext {
  return {
    store: new FakeDataStore(),
    clock: new FakeClock(T0),
    ids: new FakeIdGenerator(prefix),
  };
}

/** Builds a squad with a season's worth of shape: players, a run session, and a review. */
async function seed(target: ServiceContext): Promise<SquadId> {
  const squad = await createSquad(target, { name: 'U12 Reds' });
  const kai = await addPlayer(target, { squadId: squad.id, name: 'Kai Roberts', shirtNumber: 7 });
  await addPlayer(target, { squadId: squad.id, name: 'Maya Okafor' });

  await target.store.methodologies.put(
    cloneMethodology(PLAY_PRACTICE_PLAY, {
      name: 'My PPP',
      now: T0,
      ids: new FakeIdGenerator('cccc'),
    }),
  );

  const draft = unwrap(
    await startDraft(target, {
      squadId: squad.id,
      objectiveText: 'Playing out from the back',
      objectiveTemplateId: 'playing-out-from-the-back',
      focusPlayerIds: [kai.id],
    }),
  );
  const started = unwrap(await commitAndStart(target, draft.id));
  await logObservation(target, { sessionId: started.id, playerId: kai.id, ratingKind: 'good' });
  (target.clock as FakeClock).advanceMinutes(55);
  const finished = unwrap(await dispatch(target, started.id, { kind: 'finish' }));

  const proposals = unwrap(
    await proposeCarryForward(
      target,
      finished.id,
      unwrap(
        await (async () => {
          const { SessionReviewSchema } = await import('@/domain/review');
          return {
            ok: true as const,
            value: SessionReviewSchema.parse({
              schemaVersion: CURRENT_SCHEMA_VERSION,
              createdAt: T0,
              updatedAt: T0,
              id: '00000000-0000-4000-8000-0000000000d1',
              sessionId: finished.id,
              squadId: squad.id,
              completedAt: T0,
              objectiveOutcome: 'partially_met',
            }),
          };
        })(),
      ),
    ),
  );

  await saveReview(target, {
    sessionId: finished.id,
    objectiveOutcome: 'partially_met',
    acceptedProposals: proposals.filter((proposal) => proposal.defaultSelected),
  });

  const { recordAssessment } = await import('../squad/assessment-service');
  await recordAssessment(target, {
    playerId: kai.id,
    ratings: { technical_tactical: 4, physical: 3, psychological: 2, social: 5 },
    focusCorner: 'psychological',
  });

  const { recordScan } = await import('../squad/scan-service');
  await recordScan(target, {
    playerId: kai.id,
    skill: 'turning',
    ratings: { scanning: 2, timing: 3, techniques: 5 },
    focusCapability: 'scanning',
  });

  return squad.id;
}

beforeEach(() => {
  localStorage.clear();
  ctx = freshContext();
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
});

describe('exportAll', () => {
  it('produces a complete, self-describing envelope', async () => {
    await seed(ctx);
    const envelope = await exportAll(ctx);

    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(envelope.scope).toBe('all');
    expect(envelope.counts.squads).toBe(1);
    expect(envelope.counts.players).toBe(2);
    expect(envelope.counts.sessions).toBe(1);
    expect(envelope.counts.observations).toBe(1);
    expect(envelope.counts.reviews).toBe(1);
    expect(envelope.counts.actions).toBeGreaterThan(0);
    expect(envelope.counts.assessments).toBe(1);
  });

  it('carries the six-capability scans, which exist nowhere else either', async () => {
    await seed(ctx);
    const envelope = await exportAll(ctx);

    expect(envelope.counts.scans).toBe(1);
    expect(envelope.data.scans[0]?.skill).toBe('turning');
    expect(envelope.data.scans[0]?.ratings).toEqual({
      scanning: 2,
      timing: 3,
      movement: null,
      positioning: null,
      deception: null,
      techniques: 5,
    });
    expect(envelope.data.scans[0]?.focusCapability).toBe('scanning');
  });

  it('carries FA 4 Corner assessments, which exist nowhere else', async () => {
    await seed(ctx);
    const envelope = await exportAll(ctx);

    expect(envelope.data.assessments[0]?.ratings).toEqual({
      technical_tactical: 4,
      physical: 3,
      psychological: 2,
      social: 5,
    });
    expect(envelope.data.assessments[0]?.focusCorner).toBe('psychological');
  });

  it('carries custom methodologies but never the built-in presets', async () => {
    await seed(ctx);
    const envelope = await exportAll(ctx);

    expect(envelope.data.methodologies).toHaveLength(1);
    expect(envelope.data.methodologies[0]?.name).toBe('My PPP');
    expect(envelope.data.methodologies.some((m) => m.origin.kind === 'builtin')).toBe(false);
  });

  it('records the export so the 30-day nag can reset', async () => {
    await seed(ctx);
    const envelope = await exportAll(ctx);
    expect((await ctx.store.meta.get())?.lastExportAt).toBe(envelope.exportedAt);
    expect(envelope.exportedAt).toBe(clock().nowIso());
  });

  it('can scope to one squad', async () => {
    const squadId = await seed(ctx);
    await createSquad(ctx, { name: 'U13 Blues' });

    expect((await exportAll(ctx)).counts.squads).toBe(2);
    expect((await exportAll(ctx, { squadId })).counts.squads).toBe(1);
  });

  it('is JSON-serialisable, because that is the only thing it will ever be', async () => {
    await seed(ctx);
    const envelope = await exportAll(ctx);
    expect(() => JSON.parse(JSON.stringify(envelope))).not.toThrow();
  });
});

describe('planImport', () => {
  it('rejects a file that is not ours, without touching the store', async () => {
    const notJson = await planImport(ctx, 'a string', 'merge');
    expect(isErr(notJson) && notJson.error.kind).toBe('malformed');

    const wrong = await planImport(ctx, { format: 'some-other-app' }, 'merge');
    expect(isErr(wrong) && wrong.error.kind).toBe('wrong_format');
    expect((ctx.store as FakeDataStore).writeCount).toBe(0);
  });

  it('rejects a structurally invalid payload before IndexedDB sees it', async () => {
    const result = await planImport(
      ctx,
      {
        format: EXPORT_FORMAT,
        formatVersion: 1,
        appVersion: '0.1.0',
        docSchemaVersion: 1,
        exportedAt: T0,
        scope: 'all',
        counts: {
          squads: 1,
          players: 0,
          methodologies: 0,
          sessions: 0,
          observations: 0,
          reviews: 0,
          actions: 0,
        },
        data: { squads: [{ id: 'not-a-uuid', name: '' }] },
      },
      'merge',
    );
    expect(isErr(result) && result.error.kind).toBe('malformed');
  });

  it('refuses while a session is running', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const draft = unwrap(await startDraft(ctx, { squadId: squad.id, objectiveText: 'Pressing' }));
    await commitAndStart(ctx, draft.id);

    const result = await planImport(ctx, { format: EXPORT_FORMAT }, 'merge');
    expect(isErr(result) && result.error.kind).toBe('session_running');
  });

  it('writes nothing during the dry run', async () => {
    await seed(ctx);
    const envelope = await exportAll(ctx);

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, JSON.parse(JSON.stringify(envelope)), 'merge'));

    expect(plan.entries.squads.create).toBe(1);
    expect((target.store as FakeDataStore).writeCount).toBe(0);
    expect(await target.store.squads.list()).toEqual([]);
  });

  it('reports creates, updates and skips honestly', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    // Re-planning against the same database: everything is already there and identical.
    const plan = unwrap(await planImport(ctx, envelope, 'merge'));
    expect(plan.entries.squads).toEqual({ create: 0, update: 0, skip: 1 });
    expect(plan.entries.players).toEqual({ create: 0, update: 0, skip: 2 });
  });

  it('accepts a file written before 4 Corner support existed', async () => {
    // An older export has no `assessments` key at all. It must import cleanly rather than
    // being rejected as malformed — that is the whole promise of the migration ladder.
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    delete envelope.data.assessments;
    delete envelope.counts.assessments;

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    expect(plan.counts.assessments).toBe(0);
    const report = unwrap(await commitImport(target, plan));
    expect(report.written.sessions).toBe(1);
    expect(report.written.assessments).toBe(0);
  });

  it('accepts a file written before the microscope existed', async () => {
    // Same promise as the 4 Corner case: no `scans` key at all must import cleanly rather
    // than being rejected as malformed.
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    delete envelope.data.scans;
    delete envelope.counts.scans;

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));
    expect(plan.counts.scans).toBe(0);

    const report = unwrap(await commitImport(target, plan));
    expect(report.written.sessions).toBe(1);
    expect(report.written.scans).toBe(0);
  });

  it('drops a scan whose player did not come with it', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    envelope.data.players = [];

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    expect(plan.dropped.some((entry) => entry.store === 'scans')).toBe(true);
    expect(plan.entries.scans.create).toBe(0);
  });

  it('drops an assessment whose player did not come with it', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    envelope.data.players = [];

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    expect(plan.dropped.some((entry) => entry.store === 'assessments')).toBe(true);
    expect(plan.entries.assessments.create).toBe(0);
  });

  it('drops a session whose challenged player did not come with it', async () => {
    // A challenge is not a focus assignment, so it needs its own referential check: a row
    // reading "undefined · two touches" is worse than a session that did not import.
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const kai = await addPlayer(ctx, { squadId: squad.id, name: 'Kai' });
    const maya = await addPlayer(ctx, { squadId: squad.id, name: 'Maya' });
    const draft = unwrap(
      await startDraft(ctx, {
        squadId: squad.id,
        objectiveText: 'Playing out from the back',
        focusPlayerIds: [kai.id],
      }),
    );
    unwrap(await addChallenge(ctx, draft.id, { playerId: maya.id, text: 'Two touches' }));

    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    envelope.data.players = envelope.data.players.filter(
      (player: { id: string }) => player.id !== maya.id,
    );

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    expect(plan.dropped.find((entry) => entry.store === 'sessions')?.reason).toMatch(
      /challenged player/i,
    );
    expect(plan.entries.sessions.create).toBe(0);
  });

  it('imports a session whose challenged player came with it', async () => {
    const squad = await createSquad(ctx, { name: 'U12 Reds' });
    const maya = await addPlayer(ctx, { squadId: squad.id, name: 'Maya' });
    const draft = unwrap(
      await startDraft(ctx, { squadId: squad.id, objectiveText: 'Playing out from the back' }),
    );
    unwrap(await addChallenge(ctx, draft.id, { playerId: maya.id, text: 'Two touches' }));

    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    expect(plan.dropped).toEqual([]);
    const report = unwrap(await commitImport(target, plan));
    expect(report.written.sessions).toBe(1);

    const imported = await target.store.sessions.get(draft.id);
    expect(imported?.challenges[0]?.text).toBe('Two touches');
  });

  it('drops rows whose references do not resolve, and says why', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    envelope.data.squads = []; // the squad every other row hangs off

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    expect(plan.dropped.some((entry) => entry.store === 'players')).toBe(true);
    expect(plan.dropped.some((entry) => entry.store === 'sessions')).toBe(true);
    expect(plan.dropped.find((entry) => entry.store === 'players')?.reason).toMatch(/squad/i);
    expect(plan.entries.players.create).toBe(0);
  });

  it('resolves references against existing data as well as the file', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    // The observations reference a session that is not in the file but *is* in the store.
    const observationsOnly = { ...envelope, data: { observations: envelope.data.observations } };

    const plan = unwrap(await planImport(ctx, observationsOnly, 'merge'));
    expect(plan.dropped).toEqual([]);
  });
});

describe('commitImport', () => {
  it('round-trips: import(export(db)) equals db', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));
    unwrap(await commitImport(target, plan));

    const reexported = await exportAll(target);

    expect(reexported.counts).toEqual(envelope.counts);
    for (const key of [
      'squads',
      'players',
      'sessions',
      'observations',
      'reviews',
      'assessments',
      'scans',
    ] as const) {
      const before = [...envelope.data[key]].sort(byId);
      const after = [...reexported.data[key]].sort(byId);
      expect(after).toEqual(before);
    }
  });

  it('re-importing your own export is a clean no-op', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    const before = await exportAll(ctx);

    const plan = unwrap(await planImport(ctx, envelope, 'merge'));
    unwrap(await commitImport(ctx, plan));

    const after = await exportAll(ctx);
    expect(after.counts).toEqual(before.counts);
    expect([...after.data.sessions].sort(byId)).toEqual([...before.data.sessions].sort(byId));
  });

  it('takes the newer row on a conflict and leaves an older one alone', async () => {
    const squadId = await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    // The file claims an older edit than what is stored: the store must win.
    envelope.data.squads[0].name = 'Stale name';
    envelope.data.squads[0].updatedAt = '2020-01-01T00:00:00.000Z';
    unwrap(await commitImport(ctx, unwrap(await planImport(ctx, envelope, 'merge'))));
    expect((await ctx.store.squads.get(squadId))?.name).toBe('U12 Reds');

    // And now a newer one, which must be applied.
    clock().advanceMinutes(60);
    envelope.data.squads[0].name = 'Fresh name';
    envelope.data.squads[0].updatedAt = clock().nowIso();
    unwrap(await commitImport(ctx, unwrap(await planImport(ctx, envelope, 'merge'))));
    expect((await ctx.store.squads.get(squadId))?.name).toBe('Fresh name');
  });

  it('merges another coach squad alongside yours without colliding', async () => {
    await seed(ctx);

    const other = freshContext('ffff');
    await seed(other);
    const theirFile = JSON.parse(JSON.stringify(await exportAll(other)));

    unwrap(await commitImport(ctx, unwrap(await planImport(ctx, theirFile, 'merge'))));

    // UUID ids, so nothing overwrote anything.
    expect(await ctx.store.squads.list()).toHaveLength(2);
  });

  it('replace mode wipes first, so nothing of the old data survives', async () => {
    const squadId = await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    const target = freshContext('aaaa');
    await createSquad(target, { name: 'Will be wiped' });

    unwrap(await commitImport(target, unwrap(await planImport(target, envelope, 'replace'))));

    const squads = await target.store.squads.list();
    expect(squads).toHaveLength(1);
    expect(squads[0]?.id).toBe(squadId);
  });

  it('refuses to commit while a session is running', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    const plan = unwrap(await planImport(ctx, envelope, 'merge'));

    const draft = unwrap(
      await startDraft(ctx, {
        squadId: (await ctx.store.squads.list())[0]!.id,
        objectiveText: 'X',
      }),
    );
    await commitAndStart(ctx, draft.id);

    const result = await commitImport(ctx, plan);
    expect(isErr(result) && result.error.kind).toBe('session_running');
  });

  it('reports what it wrote and what it dropped', async () => {
    await seed(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    const target = freshContext('aaaa');
    const report = unwrap(
      await commitImport(target, unwrap(await planImport(target, envelope, 'merge'))),
    );

    expect(report.written.squads).toBe(1);
    expect(report.written.players).toBe(2);
    expect(report.dropped).toEqual([]);
  });
});

describe('document migrations', () => {
  it('stamps a document forward to the current schema version', () => {
    expect(migrateDocument({ schemaVersion: 1, id: 'x' })).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  });

  it('stamps a document that predates versioning, rather than leaving the field absent', () => {
    expect(migrateDocument({ id: 'x' }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('leaves a document from a newer build alone, for the schema to judge', () => {
    const future = { schemaVersion: 99, id: 'x' };
    expect(migrateDocument(future)).toEqual(future);
  });

  it('migrates whole arrays, tolerating a null row', () => {
    expect(migrateAll([{ schemaVersion: 1 }, null])).toHaveLength(2);
  });

  it('answers whether a document is behind', () => {
    expect(needsMigration({ schemaVersion: CURRENT_SCHEMA_VERSION })).toBe(false);
    expect(needsMigration({})).toBe(false);
  });
});

describe('exportFilename', () => {
  it('is legible in a Files app and sorts by date in a folder', () => {
    expect(exportFilename('U12 Reds', '2026-08-31T18:00:00.000Z')).toBe(
      'psp-u12-reds-2026-08-31.json',
    );
  });

  it('copes with an unnamed or awkward squad', () => {
    expect(exportFilename(null, '2026-08-31T18:00:00.000Z')).toBe('psp-all-2026-08-31.json');
    expect(exportFilename('!!!', '2026-08-31T18:00:00.000Z')).toBe('psp-all-2026-08-31.json');
  });
});

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}
