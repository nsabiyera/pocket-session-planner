import { beforeEach, describe, expect, it } from 'vitest';
import { commitImport, exportAll, planImport } from './transfer-service';
import { commitAndStart, startMatchDraft } from '../planning/planning-service';
import { dispatch, setPeriodPresence } from '../run/run-service';
import { addPlayer, createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { unwrap } from '@/lib/result';
import { periodsOf } from '@/domain/session/build-match';
import { matchMinutes } from '@/domain/session/match-minutes';
import { T0 } from '@/test/builders';
import type { ServiceContext } from '../context';
import type { PlayerId, SessionId } from '@/domain/ids';

/**
 * The export is the only backup there is, and the only route between devices.
 *
 * Match day added `kind`, `match`, unit objectives, a lineup, period presence and a result to
 * the session document. None of it needed transfer wiring — the fields ride inside a session,
 * which already travels — but "should ride for free" and "does ride, with the minutes still
 * computable on the far side" are different claims, and only one of them is testable.
 */

let ctx: ServiceContext;

const freshContext = (prefix = '0000'): ServiceContext => ({
  store: new FakeDataStore(),
  clock: new FakeClock(T0),
  ids: new FakeIdGenerator(prefix),
});

beforeEach(() => {
  localStorage.clear();
  ctx = freshContext();
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
});

/** A match played to the final whistle, with presence ticked and a score recorded. */
async function playedMatch(target: ServiceContext): Promise<{
  sessionId: SessionId;
  kai: PlayerId;
  rosa: PlayerId;
}> {
  const squad = await createSquad(target, { name: 'U12 Reds', ageGroup: 'U12' });
  const kai = await addPlayer(target, { squadId: squad.id, name: 'Kai Roberts', shirtNumber: 7 });
  const rosa = await addPlayer(target, { squadId: squad.id, name: 'Rosa Silva' });

  const draft = unwrap(
    await startMatchDraft(target, {
      squadId: squad.id,
      objectiveText: 'Playing out from the back',
      objectiveTemplateId: 'playing-out-from-the-back',
      periodMin: 25,
      match: {
        opponent: 'Eastfield Rovers',
        venue: 'away',
        fixtureType: 'cup',
        format: '9v9',
        shapeName: '3-2-3',
        periodCount: 2,
        unitObjectives: [
          { unit: 'defence', text: 'First pass forward, not sideways' },
          { unit: 'midfield', text: 'Screen in front of the back three' },
        ],
        lineup: [
          { playerId: kai.id, unit: 'midfield' },
          { playerId: rosa.id, unit: 'defence' },
        ],
      },
    }),
  );

  const started = unwrap(await commitAndStart(target, draft.id));
  const periods = periodsOf(started);

  // Kai plays both halves; Rosa only the first.
  unwrap(await setPeriodPresence(target, started.id, periods[0]!.id, [kai.id, rosa.id]));
  (target.clock as FakeClock).advanceMinutes(25);
  unwrap(await dispatch(target, started.id, { kind: 'nextPhase' }));
  unwrap(await dispatch(target, started.id, { kind: 'nextPhase' }));
  unwrap(await setPeriodPresence(target, started.id, periods[1]!.id, [kai.id]));
  (target.clock as FakeClock).advanceMinutes(25);
  unwrap(await dispatch(target, started.id, { kind: 'finish' }));

  return { sessionId: started.id, kai: kai.id, rosa: rosa.id };
}

describe('a match in the export envelope', () => {
  it('carries the fixture, the shape and the units', async () => {
    const { sessionId } = await playedMatch(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    const session = envelope.data.sessions.find(
      (candidate: { id: string }) => candidate.id === sessionId,
    );
    expect(session.kind).toBe('match');
    expect(session.match).toMatchObject({
      opponent: 'Eastfield Rovers',
      venue: 'away',
      fixtureType: 'cup',
      format: '9v9',
      shapeName: '3-2-3',
    });
    expect(session.match.unitObjectives).toHaveLength(2);
    expect(session.match.lineup).toHaveLength(2);
  });

  it('carries who was on the pitch, which exists nowhere else', async () => {
    const { sessionId, kai } = await playedMatch(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    const session = envelope.data.sessions.find(
      (candidate: { id: string }) => candidate.id === sessionId,
    );
    // Lose this and the minutes report is gone with it — there is no other record of it.
    expect(session.match.presence).toHaveLength(2);
    expect(session.match.presence[0].playerIds).toContain(kai);
  });

  it('is readable JSON a person could understand', async () => {
    await playedMatch(ctx);
    const text = JSON.stringify(await exportAll(ctx), null, 2);
    expect(text).toContain('"opponent": "Eastfield Rovers"');
    expect(text).toContain('"shapeName": "3-2-3"');
  });
});

describe('a match imported onto a second device', () => {
  it('arrives whole, with the minutes still computable', async () => {
    const { sessionId, kai, rosa } = await playedMatch(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));
    expect(plan.dropped).toEqual([]);
    unwrap(await commitImport(target, plan));

    const imported = await target.store.sessions.get(sessionId);
    expect(imported?.kind).toBe('match');
    expect(imported?.match?.opponent).toBe('Eastfield Rovers');

    // The real test of the round trip: the derived report still works on the far side.
    const report = matchMinutes(imported!, [kai, rosa])!;
    expect(report.availableMinutes).toBe(50);

    const byPlayer = new Map(report.rows.map((row) => [row.playerId, row.minutes]));
    expect(byPlayer.get(kai)).toBe(50);
    expect(byPlayer.get(rosa)).toBe(25);
  });

  it('re-importing the same file changes nothing', async () => {
    await playedMatch(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    const target = freshContext('aaaa');
    unwrap(await commitImport(target, unwrap(await planImport(target, envelope, 'merge'))));

    const second = unwrap(await planImport(target, envelope, 'merge'));
    expect(second.entries.sessions.create).toBe(0);
    expect(second.entries.sessions.update + second.entries.sessions.skip).toBeGreaterThan(0);
  });

  it('drops a match whose lineup player did not come with it', async () => {
    const { rosa } = await playedMatch(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));
    envelope.data.players = envelope.data.players.filter(
      (player: { id: string }) => player.id !== rosa,
    );

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    /*
     * Before the match block was added to `checkReferences`, this imported happily: the
     * session's own squad, focus players and challenges all resolved, and nothing looked at
     * the lineup or the presence records. A match then sat on the second device crediting
     * minutes to a player id nobody could name, in the one report a coach opens specifically
     * to check that nobody was left out.
     */
    expect(plan.entries.sessions.create).toBe(0);
    expect(plan.dropped.find((entry) => entry.store === 'sessions')?.reason).toMatch(
      /lineup|on the pitch/i,
    );
  });

  it('drops a match whose presence names a player who did not come with it', async () => {
    const { rosa } = await playedMatch(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    // Rosa stays in the file as a player but is removed from the lineup, so only the
    // presence check can catch her — the two references are validated separately.
    for (const session of envelope.data.sessions) {
      if (session.match) {
        session.match.lineup = session.match.lineup.filter(
          (slot: { playerId: string }) => slot.playerId !== rosa,
        );
      }
    }
    envelope.data.players = envelope.data.players.filter(
      (player: { id: string }) => player.id !== rosa,
    );

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));

    expect(plan.entries.sessions.create).toBe(0);
    expect(plan.dropped.find((entry) => entry.store === 'sessions')?.reason).toMatch(
      /on the pitch/i,
    );
  });
});

describe('a file written before match day existed', () => {
  it('imports, with its sessions reading as training', async () => {
    // The whole point of `kind` defaulting: every session anyone exported before today.
    const { sessionId } = await playedMatch(ctx);
    const envelope = JSON.parse(JSON.stringify(await exportAll(ctx)));

    for (const session of envelope.data.sessions) {
      delete session.kind;
      delete session.match;
    }

    const target = freshContext('aaaa');
    const plan = unwrap(await planImport(target, envelope, 'merge'));
    expect(plan.dropped).toEqual([]);
    unwrap(await commitImport(target, plan));

    const imported = await target.store.sessions.get(sessionId);
    expect(imported?.kind).toBe('training');
    expect(imported?.match).toBeNull();
  });
});
