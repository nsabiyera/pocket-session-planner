import { beforeEach, describe, expect, it } from 'vitest';
import {
  addChallenge,
  challengesByPlayer,
  pruneChallengesForPlayer,
  removeChallenge,
  updateChallenge,
} from './challenges';
import { commitAndStart, startDraft } from './planning-service';
import { logChallengeProgress, setChallengeStatus } from '../run/run-service';
import { addPlayer, createSquad } from '../squad/squad-service';
import { MAX_CHALLENGES_PER_SESSION } from '@/domain/challenge';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asSessionId, type PlayerId, type SquadId } from '@/domain/ids';
import { challengeId, phaseId, testId, T0 } from '@/test/builders';
import type { Session } from '@/domain/session';
import type { ServiceContext } from '../context';

let ctx: ServiceContext;
let squadId: SquadId;
let kai: PlayerId;
let maya: PlayerId;
let draft: Session;

const clock = () => ctx.clock as FakeClock;
const ghostSession = asSessionId(testId('ghost'));

beforeEach(async () => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });

  const squad = await createSquad(ctx, { name: 'U12 Reds' });
  squadId = squad.id;
  kai = (await addPlayer(ctx, { squadId, name: 'Kai' })).id;
  maya = (await addPlayer(ctx, { squadId, name: 'Maya' })).id;

  draft = unwrap(
    await startDraft(ctx, {
      squadId,
      objectiveText: 'Playing out from the back',
      objectiveTemplateId: 'playing-out-from-the-back',
      focusPlayerIds: [kai],
    }),
  );
});

/** Adds a challenge and hands back the one it added, found in the returned session. */
const add = async (over: Parameters<typeof addChallenge>[2], sessionId = draft.id) => {
  const session = unwrap(await addChallenge(ctx, sessionId, over));
  const challenge = session.challenges[session.challenges.length - 1];
  if (!challenge) throw new Error('addChallenge returned a session with no challenges');
  return { session, challenge };
};

describe('addChallenge', () => {
  it('defaults to a counted challenge with a target of one', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Three forward passes' });

    expect(challenge.measure).toBe('count');
    expect(challenge.targetCount).toBe(1);
    expect(challenge.phaseIds).toEqual([]);
    expect(challenge.status).toBe('open');
    expect(challenge.source).toBe('coach');
  });

  it('takes the target it is given', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Forward passes', targetCount: 3 });
    expect(challenge.targetCount).toBe(3);
  });

  it('stores no target for a judged challenge, whatever it was handed', async () => {
    const { challenge } = await add({
      playerId: kai,
      text: 'Stay positive when you lose it',
      measure: 'judged',
      targetCount: 3,
    });

    expect(challenge.measure).toBe('judged');
    expect(challenge.targetCount).toBeNull();
  });

  it('scopes a challenge to named phases', async () => {
    const rondo = draft.phases[1];
    const { challenge } = await add({
      playerId: kai,
      text: 'Left foot only',
      phaseIds: rondo ? [rondo.id] : [],
    });

    expect(challenge.phaseIds).toEqual([rondo?.id]);
  });

  it('refuses a phase this session does not have', async () => {
    const result = await addChallenge(ctx, draft.id, {
      playerId: kai,
      text: 'Left foot only',
      phaseIds: [phaseId('ghostphase')],
    });

    expect(isErr(result) && result.error.kind).toBe('unknown_phase');
    // Nothing was written.
    expect((await ctx.store.sessions.get(draft.id))?.challenges).toEqual([]);
  });

  it('takes a challenge for a player the session is not focusing on', async () => {
    // Giving a quiet player one thing to do is how they stop needing to be a focus player.
    const { challenge } = await add({ playerId: maya, text: 'Two touches, then look up' });
    expect(challenge.playerId).toBe(maya);
  });

  it('gives every challenge its own id', async () => {
    await add({ playerId: kai, text: 'Forward passes' });
    const { session } = await add({ playerId: maya, text: 'Two touches' });

    expect(session.challenges).toHaveLength(2);
    expect(session.challenges[0]?.id).not.toBe(session.challenges[1]?.id);
  });

  it('refuses more than a phone can be expected to monitor', async () => {
    for (let i = 0; i < MAX_CHALLENGES_PER_SESSION; i += 1) {
      await add({ playerId: kai, text: `Challenge ${i + 1}` });
    }

    const result = await addChallenge(ctx, draft.id, { playerId: kai, text: 'One more' });
    expect(isErr(result) && result.error.kind).toBe('too_many');
    expect(isErr(result) && result.error.kind === 'too_many' && result.error.max).toBe(
      MAX_CHALLENGES_PER_SESSION,
    );
  });

  it('adds to a session already under way — the coach just thought of something', async () => {
    const started = unwrap(await commitAndStart(ctx, draft.id));
    const { challenge } = await add({ playerId: kai, text: 'Forward passes' }, started.id);
    expect(challenge.text).toBe('Forward passes');
  });

  it('persists write-through and stamps updatedAt', async () => {
    clock().advanceMinutes(3);
    const { session } = await add({ playerId: kai, text: 'Forward passes' });

    const stored = await ctx.store.sessions.get(draft.id);
    expect(stored?.challenges).toHaveLength(1);
    expect(stored?.updatedAt).toBe(session.updatedAt);
    expect(stored?.updatedAt).not.toBe(draft.updatedAt);
  });

  it('reports a session that does not exist', async () => {
    const result = await addChallenge(ctx, ghostSession, { playerId: kai, text: 'Anything' });
    expect(isErr(result) && result.error.kind).toBe('session_not_found');
  });

  it('refuses blank text at the parse boundary rather than storing an empty ask', async () => {
    await expect(addChallenge(ctx, draft.id, { playerId: kai, text: '   ' })).rejects.toThrow();
  });
});

describe('updateChallenge', () => {
  it('edits the text, the corner and the note', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Forward passes', targetCount: 3 });
    const session = unwrap(
      await updateChallenge(ctx, draft.id, challenge.id, {
        text: 'Three forward passes',
        corner: 'technical_tactical',
        note: 'Ask him at the end',
      }),
    );

    expect(session.challenges[0]?.text).toBe('Three forward passes');
    expect(session.challenges[0]?.corner).toBe('technical_tactical');
    expect(session.challenges[0]?.note).toBe('Ask him at the end');
    expect(session.challenges[0]?.targetCount).toBe(3);
  });

  it('drops the target when the challenge becomes judged', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Forward passes', targetCount: 3 });
    const session = unwrap(
      await updateChallenge(ctx, draft.id, challenge.id, { measure: 'judged' }),
    );

    expect(session.challenges[0]?.measure).toBe('judged');
    expect(session.challenges[0]?.targetCount).toBeNull();
  });

  it('gives a challenge turning back to counted a target, so the schema holds', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Stay positive', measure: 'judged' });

    const defaulted = unwrap(
      await updateChallenge(ctx, draft.id, challenge.id, { measure: 'count' }),
    );
    expect(defaulted.challenges[0]?.targetCount).toBe(1);

    const explicit = unwrap(
      await updateChallenge(ctx, draft.id, challenge.id, { measure: 'count', targetCount: 4 }),
    );
    expect(explicit.challenges[0]?.targetCount).toBe(4);
  });

  it('keeps the existing target when neither the measure nor the target is touched', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Forward passes', targetCount: 5 });
    const session = unwrap(
      await updateChallenge(ctx, draft.id, challenge.id, { text: 'Forward passes, both feet' }),
    );
    expect(session.challenges[0]?.targetCount).toBe(5);
  });

  it('re-scopes to other phases, and refuses a phase the session does not have', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Left foot only' });
    const rondo = draft.phases[1];

    const scoped = unwrap(
      await updateChallenge(ctx, draft.id, challenge.id, {
        phaseIds: rondo ? [rondo.id] : [],
      }),
    );
    expect(scoped.challenges[0]?.phaseIds).toEqual([rondo?.id]);

    const result = await updateChallenge(ctx, draft.id, challenge.id, {
      phaseIds: [phaseId('ghostphase')],
    });
    expect(isErr(result) && result.error.kind).toBe('unknown_phase');
  });

  it('widens a scoped challenge back to the whole session', async () => {
    const rondo = draft.phases[1];
    const { challenge } = await add({
      playerId: kai,
      text: 'Left foot only',
      phaseIds: rondo ? [rondo.id] : [],
    });

    const widened = unwrap(await updateChallenge(ctx, draft.id, challenge.id, { phaseIds: [] }));
    expect(widened.challenges[0]?.phaseIds).toEqual([]);
  });

  it('leaves the coach’s ruling where it is — editing the ask is not re-judging it', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Forward passes', targetCount: 3 });
    const started = unwrap(await commitAndStart(ctx, draft.id));
    unwrap(await setChallengeStatus(ctx, started.id, challenge.id, 'partly'));

    const session = unwrap(
      await updateChallenge(ctx, started.id, challenge.id, { text: 'Forward passes, quicker' }),
    );
    expect(session.challenges[0]?.status).toBe('partly');
    expect(session.challenges[0]?.settledAt).not.toBeNull();
  });

  it('touches only the challenge named', async () => {
    const first = await add({ playerId: kai, text: 'Forward passes' });
    const second = await add({ playerId: maya, text: 'Two touches' });

    const session = unwrap(
      await updateChallenge(ctx, draft.id, second.challenge.id, { text: 'Two touches, head up' }),
    );
    expect(session.challenges[0]?.text).toBe('Forward passes');
    expect(session.challenges[1]?.text).toBe('Two touches, head up');
    expect(session.challenges[0]?.id).toBe(first.challenge.id);
  });

  it('reports a challenge this session does not hold', async () => {
    await add({ playerId: kai, text: 'Forward passes' });
    const result = await updateChallenge(ctx, draft.id, challengeId('ghost'), { text: 'x' });
    expect(isErr(result) && result.error.kind).toBe('challenge_not_found');
  });

  it('reports a session that does not exist', async () => {
    const result = await updateChallenge(ctx, ghostSession, challengeId('ghost'), { text: 'x' });
    expect(isErr(result) && result.error.kind).toBe('session_not_found');
  });
});

describe('removeChallenge', () => {
  it('removes the challenge and every sighting logged against it', async () => {
    const kept = await add({ playerId: kai, text: 'Forward passes', targetCount: 3 });
    const doomed = await add({ playerId: maya, text: 'Two touches', targetCount: 3 });
    const started = unwrap(await commitAndStart(ctx, draft.id));

    unwrap(await logChallengeProgress(ctx, started.id, kept.challenge.id));
    unwrap(await logChallengeProgress(ctx, started.id, doomed.challenge.id));
    unwrap(await logChallengeProgress(ctx, started.id, doomed.challenge.id));

    const session = unwrap(await removeChallenge(ctx, started.id, doomed.challenge.id));

    expect(session.challenges.map((challenge) => challenge.id)).toEqual([kept.challenge.id]);
    // Both halves: the session schema would refuse a sighting whose challenge is gone.
    expect(session.run?.challengeEvents).toHaveLength(1);
    expect(session.run?.challengeEvents[0]?.challengeId).toBe(kept.challenge.id);
  });

  it('works on a session that never ran, leaving the run null', async () => {
    const { challenge } = await add({ playerId: kai, text: 'Forward passes' });
    const session = unwrap(await removeChallenge(ctx, draft.id, challenge.id));

    expect(session.challenges).toEqual([]);
    expect(session.run).toBeNull();
  });

  it('reports a challenge that is not there, and a session that is not there', async () => {
    await add({ playerId: kai, text: 'Forward passes' });

    const missing = await removeChallenge(ctx, draft.id, challengeId('ghost'));
    expect(isErr(missing) && missing.error.kind).toBe('challenge_not_found');

    const noSession = await removeChallenge(ctx, ghostSession, challengeId('ghost'));
    expect(isErr(noSession) && noSession.error.kind).toBe('session_not_found');
  });
});

describe('pruneChallengesForPlayer', () => {
  it('drops the archived player’s challenges and their sightings, keeping the rest', async () => {
    const kais = await add({ playerId: kai, text: 'Forward passes', targetCount: 3 });
    const mayas = await add({ playerId: maya, text: 'Two touches', targetCount: 3 });
    const started = unwrap(await commitAndStart(ctx, draft.id));

    unwrap(await logChallengeProgress(ctx, started.id, kais.challenge.id));
    unwrap(await logChallengeProgress(ctx, started.id, mayas.challenge.id));

    const session = unwrap(await pruneChallengesForPlayer(ctx, started.id, maya));

    expect(session.challenges.map((challenge) => challenge.id)).toEqual([kais.challenge.id]);
    expect(session.run?.challengeEvents.map((event) => event.challengeId)).toEqual([
      kais.challenge.id,
    ]);
  });

  it('drops every challenge a player held, not just the first', async () => {
    await add({ playerId: maya, text: 'Two touches' });
    await add({ playerId: maya, text: 'Talk to your full back' });
    await add({ playerId: kai, text: 'Forward passes' });

    const session = unwrap(await pruneChallengesForPlayer(ctx, draft.id, maya));
    expect(session.challenges).toHaveLength(1);
    expect(session.challenges[0]?.playerId).toBe(kai);
  });

  it('writes nothing when the player held none', async () => {
    const { session: before } = await add({ playerId: kai, text: 'Forward passes' });
    clock().advanceMinutes(5);

    const session = unwrap(await pruneChallengesForPlayer(ctx, draft.id, maya));
    // Returned untouched, with no new updatedAt to make it look like something changed.
    expect(session).toEqual(before);
  });

  it('reports a session that does not exist', async () => {
    const result = await pruneChallengesForPlayer(ctx, ghostSession, kai);
    expect(isErr(result) && result.error.kind).toBe('session_not_found');
  });
});

describe('challengesByPlayer', () => {
  it('includes every player asked for, those with no challenge included', async () => {
    const { session } = await add({ playerId: kai, text: 'Forward passes' });
    const grouped = challengesByPlayer(session, [kai, maya]);

    expect([...grouped.keys()]).toEqual([kai, maya]);
    expect(grouped.get(kai)).toHaveLength(1);
    expect(grouped.get(maya)).toEqual([]);
  });

  it('keeps both of one player’s challenges, in the order they were set', async () => {
    await add({ playerId: kai, text: 'Forward passes' });
    const { session } = await add({ playerId: kai, text: 'Talk to your full back' });

    expect(
      challengesByPlayer(session, [kai])
        .get(kai)
        ?.map((c) => c.text),
    ).toEqual(['Forward passes', 'Talk to your full back']);
  });

  it('still surfaces a challenge whose player was not asked for', async () => {
    // An archived player's challenge must not vanish silently from the editor.
    const { session } = await add({ playerId: maya, text: 'Two touches' });
    const grouped = challengesByPlayer(session, [kai]);

    expect(grouped.get(maya)).toHaveLength(1);
    expect(grouped.get(kai)).toEqual([]);
  });
});
