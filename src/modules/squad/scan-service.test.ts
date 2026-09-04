import { beforeEach, describe, expect, it } from 'vitest';
import { listScannedSkills, loadMicroscopeView, recordScan, updateScan } from './scan-service';
import { addPlayer, createSquad } from './squad-service';
import { commitAndStart, startDraft } from '../planning/planning-service';
import { logObservation } from '../run/run-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asCapabilityScanId, type PlayerId, type SquadId } from '@/domain/ids';
import { isScanComplete, ratedCapabilities, scanOverallRating } from '@/domain/capabilities/scan';
import { T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';

let ctx: ServiceContext;
let squadId: SquadId;
let kai: PlayerId;
let maya: PlayerId;

const clock = () => ctx.clock as FakeClock;

beforeEach(async () => {
  localStorage.clear();
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });

  const squad = await createSquad(ctx, { name: 'U12 Reds' });
  squadId = squad.id;
  kai = (await addPlayer(ctx, { squadId, name: 'Kai' })).id;
  maya = (await addPlayer(ctx, { squadId, name: 'Maya' })).id;
});

describe('recordScan', () => {
  it('records one player on one skill, denormalising the squad', async () => {
    const scan = unwrap(
      await recordScan(ctx, {
        playerId: kai,
        skill: 'turning',
        ratings: { scanning: 2, techniques: 4 },
        focusCapability: 'scanning',
      }),
    );

    expect(scan.playerId).toBe(kai);
    expect(scan.squadId).toBe(squadId);
    expect(scan.skill).toBe('turning');
    expect(scan.scannedAt).toBe(T0);
    expect(scan.focusCapability).toBe('scanning');
  });

  it('keeps a half-finished scan rather than forcing six inventions', async () => {
    const scan = unwrap(
      await recordScan(ctx, { playerId: kai, skill: 'pressing', ratings: { timing: 3 } }),
    );

    expect(ratedCapabilities(scan)).toEqual(['timing']);
    expect(isScanComplete(scan)).toBe(false);
    expect(scanOverallRating(scan)).toBe(3);
    // The rest are absent as ratings, not zeroes — a zero would be a judgement.
    expect(scan.ratings.deception).toBeNull();
  });

  it('defaults the unrated capabilities and the notes without being asked', async () => {
    const scan = unwrap(await recordScan(ctx, { playerId: kai, skill: 'finishing' }));

    expect(scan.ratings).toEqual({
      scanning: null,
      timing: null,
      movement: null,
      positioning: null,
      deception: null,
      techniques: null,
    });
    expect(scan.notes.scanning).toBe('');
    expect(scanOverallRating(scan)).toBeNull();
  });

  it('persists write-through', async () => {
    const scan = unwrap(await recordScan(ctx, { playerId: kai, skill: 'turning' }));
    expect((await ctx.store.scans.get(scan.id))?.skill).toBe('turning');
  });

  it('reports a player who is not in the squad', async () => {
    const result = await recordScan(ctx, {
      playerId: testId('ghost') as PlayerId,
      skill: 'turning',
    });
    expect(isErr(result) && result.error.kind).toBe('player_not_found');
  });
});

describe('updateScan', () => {
  it('merges ratings and notes without wiping what is already there', async () => {
    const scan = unwrap(
      await recordScan(ctx, {
        playerId: kai,
        skill: 'turning',
        ratings: { scanning: 2 },
        notes: { scanning: 'Head down before he receives' },
      }),
    );

    clock().advanceMinutes(5);
    const updated = unwrap(await updateScan(ctx, scan.id, { ratings: { techniques: 5 } }));

    expect(updated.ratings.scanning).toBe(2);
    expect(updated.ratings.techniques).toBe(5);
    expect(updated.notes.scanning).toBe('Head down before he receives');
    expect(updated.updatedAt).not.toBe(scan.updatedAt);
    // The scan is still a record of when it was taken, not when it was edited.
    expect(updated.scannedAt).toBe(T0);
  });

  it('clears the focus capability when told to, and leaves it alone otherwise', async () => {
    const scan = unwrap(
      await recordScan(ctx, { playerId: kai, skill: 'turning', focusCapability: 'scanning' }),
    );

    expect(unwrap(await updateScan(ctx, scan.id, { ratings: { timing: 3 } })).focusCapability).toBe(
      'scanning',
    );
    expect(unwrap(await updateScan(ctx, scan.id, { focusCapability: null })).focusCapability).toBe(
      null,
    );
  });

  it('reports a scan that does not exist', async () => {
    const result = await updateScan(ctx, asCapabilityScanId(testId('ghost')), {
      ratings: { timing: 1 },
    });
    expect(isErr(result) && result.error.kind).toBe('scan_not_found');
  });
});

describe('loadMicroscopeView', () => {
  it('is empty but well-formed before the player has ever been scanned', async () => {
    const view = await loadMicroscopeView(ctx, kai, 'turning');

    expect(view.skill).toBe('turning');
    expect(view.latest).toBeNull();
    expect(view.previous).toBeNull();
    expect(view.deltas).toEqual([]);
    expect(view.extremes).toBeNull();
    expect(view.evidence.scanning.count).toBe(0);
  });

  it('puts the observation evidence beside the question', async () => {
    const draft = unwrap(await startDraft(ctx, { squadId, objectiveText: 'Turning' }));
    const started = unwrap(await commitAndStart(ctx, draft.id));

    await logObservation(ctx, {
      sessionId: started.id,
      playerId: kai,
      ratingKind: 'good',
      tags: ['Scanning'],
    });
    await logObservation(ctx, {
      sessionId: started.id,
      playerId: kai,
      ratingKind: 'struggled',
      tags: ['Scanning'],
    });
    await logObservation(ctx, {
      sessionId: started.id,
      playerId: maya,
      ratingKind: 'good',
      tags: ['Deception'],
    });

    const view = await loadMicroscopeView(ctx, kai, 'turning');

    expect(view.evidence.scanning.count).toBe(2);
    expect(view.evidence.scanning.strengths).toBe(1);
    expect(view.evidence.scanning.needsWork).toBe(1);
    // good = 5, struggled = 2.
    expect(view.evidence.scanning.meanValue).toBe(3.5);
    // Maya's observation belongs to Maya.
    expect(view.evidence.deception.count).toBe(0);
  });

  it('shows only scans of the skill being looked at', async () => {
    unwrap(await recordScan(ctx, { playerId: kai, skill: 'turning', ratings: { timing: 3 } }));
    clock().advanceMinutes(10);
    unwrap(await recordScan(ctx, { playerId: kai, skill: 'pressing', ratings: { timing: 5 } }));

    const turning = await loadMicroscopeView(ctx, kai, 'turning');
    expect(turning.history).toHaveLength(1);
    expect(turning.latest?.ratings.timing).toBe(3);
  });

  it('reports what moved between the two most recent scans of that skill', async () => {
    unwrap(
      await recordScan(ctx, {
        playerId: kai,
        skill: 'turning',
        ratings: { scanning: 2, techniques: 4 },
      }),
    );
    clock().advanceMinutes(60 * 24 * 21);
    unwrap(
      await recordScan(ctx, {
        playerId: kai,
        skill: 'turning',
        ratings: { scanning: 4, deception: 3 },
      }),
    );

    const view = await loadMicroscopeView(ctx, kai, 'turning');

    expect(view.history).toHaveLength(2);
    // Scanning was rated both times, so it is the only comparable one. Techniques and
    // deception were each rated once — comparing them would invent a change from an omission.
    expect(view.deltas).toEqual([{ capability: 'scanning', from: 2, to: 4, change: 2 }]);
  });

  it('names the strongest and the weakest of the latest scan', async () => {
    unwrap(
      await recordScan(ctx, {
        playerId: kai,
        skill: 'turning',
        ratings: { scanning: 2, timing: 3, techniques: 5 },
      }),
    );

    expect(await loadMicroscopeView(ctx, kai, 'turning')).toMatchObject({
      extremes: { strongest: 'techniques', weakest: 'scanning' },
    });
  });
});

describe('listScannedSkills', () => {
  it('offers the skills this player has actually been scanned on, newest first', async () => {
    unwrap(await recordScan(ctx, { playerId: kai, skill: 'turning' }));
    clock().advanceMinutes(10);
    unwrap(await recordScan(ctx, { playerId: kai, skill: 'pressing' }));
    clock().advanceMinutes(10);
    // A second turning scan must not list turning twice.
    unwrap(await recordScan(ctx, { playerId: kai, skill: 'turning' }));

    expect((await listScannedSkills(ctx, kai)).map((entry) => entry.skill)).toEqual([
      'turning',
      'pressing',
    ]);
  });

  it('is empty for a player nobody has scanned', async () => {
    expect(await listScannedSkills(ctx, maya)).toEqual([]);
  });
});
