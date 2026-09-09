import { beforeEach, describe, expect, it } from 'vitest';
import {
  changeMethodology,
  commitAndStart,
  discardDraft,
  getDraft,
  lastUsedMethodologyId,
  repeatSession,
  reorderPhases,
  setIntervention,
  startDraft,
  startMatchDraft,
  updateDraft,
  updatePhase,
} from './planning-service';
import { addChallenge } from './challenges';
import { setMatchResult, setPeriodPresence, setUnitObjectiveStatus } from '../run/run-service';
import { addPlayer, createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asMethodologyId, asSessionId, type PlayerId, type SquadId } from '@/domain/ids';
import { InterventionPlanSchema } from '@/domain/intervention';
import { totalPlannedPhaseMin } from '@/domain/session';
import { periodsOf } from '@/domain/session/build-match';
import { mainPracticePhase } from '@/domain/session/selectors';
import { T0, testId } from '@/test/builders';
import type { ServiceContext } from '../context';

let ctx: ServiceContext;
let squadId: SquadId;
let kai: PlayerId;
let maya: PlayerId;

beforeEach(async () => {
  ctx = { store: new FakeDataStore(), clock: new FakeClock(T0), ids: new FakeIdGenerator() };
  Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });

  const squad = await createSquad(ctx, { name: 'U12 Reds' });
  squadId = squad.id;
  kai = (await addPlayer(ctx, { squadId, name: 'Kai' })).id;
  maya = (await addPlayer(ctx, { squadId, name: 'Maya' })).id;
});

const draftFor = async (over = {}) =>
  unwrap(
    await startDraft(ctx, {
      squadId,
      objectiveText: 'Playing out from the back',
      objectiveTemplateId: 'playing-out-from-the-back',
      ...over,
    }),
  );

describe('startDraft', () => {
  it('produces a complete draft from an objective and nothing else', async () => {
    const draft = await draftFor();

    expect(draft.status).toBe('draft');
    expect(draft.title).toBe('Playing out from the back · 31 Aug');
    expect(draft.plannedDurationMin).toBe(60);
    expect(totalPlannedPhaseMin(draft)).toBe(60);
    // The grassroots default, because no session has been run yet.
    expect(draft.methodology.methodologyId).toBe('play-practice-play');
  });

  it('brings the objective library success criteria and coaching points with it', async () => {
    const draft = await draftFor();
    expect(draft.objective.successCriteria).toEqual([
      'We keep the ball past the first line of pressure',
      'The keeper is an option',
    ]);

    const practice = mainPracticePhase(draft);
    expect(practice?.coachingPoints.map((p) => p.text)).toContain(
      'Split the centre-backs wide of the box',
    );
    expect(practice?.coachingPoints.some((p) => p.source === 'coach')).toBe(true);
  });

  it('accepts a free-typed objective with no template', async () => {
    const draft = unwrap(await startDraft(ctx, { squadId, objectiveText: 'Set pieces' }));
    expect(draft.objective.text).toBe('Set pieces');
    expect(draft.objective.successCriteria).toEqual([]);
  });

  it('pre-selects focus players', async () => {
    const draft = await draftFor({ focusPlayerIds: [kai, maya] });
    expect(draft.focusPlayers.map((f) => f.playerId)).toEqual([kai, maya]);
  });

  it('records the draft as the active session, for the singleton route', async () => {
    const draft = await draftFor();
    expect((await ctx.store.meta.get())?.activeSessionId).toBe(draft.id);
    expect((await getDraft(ctx, squadId))?.id).toBe(draft.id);
  });

  it('replaces an existing draft rather than refusing — there is only ever one', async () => {
    const first = await draftFor();
    const second = await draftFor({ objectiveText: 'Pressing as a unit' });

    expect(second.id).not.toBe(first.id);
    expect(await ctx.store.sessions.listByStatus(squadId, 'draft')).toHaveLength(1);
    expect((await getDraft(ctx, squadId))?.objective.text).toBe('Pressing as a unit');
  });

  it('reports an unknown squad or methodology rather than throwing', async () => {
    const noSquad = await startDraft(ctx, {
      squadId: asSessionId(testId('ghost')) as unknown as SquadId,
      objectiveText: 'X',
    });
    expect(isErr(noSquad) && noSquad.error.kind).toBe('squad_not_found');

    const noMethodology = await startDraft(ctx, {
      squadId,
      objectiveText: 'X',
      methodologyId: asMethodologyId('nope'),
    });
    expect(isErr(noMethodology) && noMethodology.error.kind).toBe('methodology_not_found');
  });
});

describe('the objective library and the methodology preset overlap', () => {
  it('does not put the same coaching point in a phase twice', async () => {
    // Both offer "Head up before you receive" for playing out from the back. Appending
    // blindly showed the coach the same instruction twice in Do mode, and made the
    // observation tag bank render two identical buttons.
    const draft = await draftFor();
    const practice = mainPracticePhase(draft);
    const texts = (practice?.coachingPoints ?? []).map((point) => point.text);

    expect(texts.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('still carries the objective points the phase did not already have', async () => {
    const draft = await draftFor();
    const texts = (mainPracticePhase(draft)?.coachingPoints ?? []).map((point) => point.text);

    // From the objective library, not the methodology preset.
    expect(texts).toContain('Split the centre-backs wide of the box');
    // And the methodology's own points are still there.
    expect(texts).toContain('Head up before you receive');
  });
});

describe('lastUsedMethodologyId', () => {
  it('is the grassroots default until a session exists', async () => {
    expect(await lastUsedMethodologyId(ctx, squadId)).toBe('play-practice-play');
  });

  it('sticks to whatever the coach used last', async () => {
    const draft = await draftFor();
    unwrap(await changeMethodology(ctx, draft.id, asMethodologyId('constraints-led')));
    expect(await lastUsedMethodologyId(ctx, squadId)).toBe('constraints-led');
  });
});

describe('changeMethodology', () => {
  it('rebuilds the phases and re-derives the intervention plan', async () => {
    const draft = await draftFor();
    const changed = unwrap(
      await changeMethodology(ctx, draft.id, asMethodologyId('constraints-led')),
    );

    expect(changed.id).toBe(draft.id);
    expect(changed.methodology.name).toBe('Constraints-Led');
    expect(changed.phases.map((p) => p.fromTemplateId)).toEqual([
      'cla-arrival',
      'cla-game-a',
      'cla-freeze',
      'cla-game-b',
      'cla-free-game',
    ]);
    expect(changed.intervention.mechanic).toBe('constraint_change');
    expect(totalPlannedPhaseMin(changed)).toBe(60);
  });

  it('keeps a deliberately chosen intervention across a methodology change', async () => {
    const draft = await draftFor();
    const custom = InterventionPlanSchema.parse({
      method: 'command',
      mechanic: 'play_stop_play',
      maxPerPhase: 9,
    });
    unwrap(await setIntervention(ctx, draft.id, custom));

    const changed = unwrap(
      await changeMethodology(ctx, draft.id, asMethodologyId('constraints-led')),
    );
    expect(changed.interventionTouched).toBe(true);
    expect(changed.intervention).toEqual(custom);
  });

  it('keeps the objective, duration and focus players', async () => {
    const draft = await draftFor({ focusPlayerIds: [kai], totalMin: 75 });
    const changed = unwrap(
      await changeMethodology(ctx, draft.id, asMethodologyId('whole-part-whole')),
    );

    expect(changed.objective.text).toBe('Playing out from the back');
    expect(changed.plannedDurationMin).toBe(75);
    expect(totalPlannedPhaseMin(changed)).toBe(75);
    expect(changed.focusPlayers.map((f) => f.playerId)).toEqual([kai]);
  });
});

describe('updateDraft', () => {
  it('re-scales the phases when the duration changes', async () => {
    const draft = await draftFor();
    const updated = unwrap(await updateDraft(ctx, draft.id, { totalMin: 45 }));

    expect(updated.plannedDurationMin).toBe(45);
    expect(totalPlannedPhaseMin(updated)).toBe(45);
  });

  it('retitles automatically while the title is still the generated one', async () => {
    const draft = await draftFor();
    const updated = unwrap(
      await updateDraft(ctx, draft.id, {
        objective: {
          text: 'Pressing as a unit',
          successCriteria: [],
          sourceActionId: null,
          principleId: null,
        },
      }),
    );
    expect(updated.title).toBe('Pressing as a unit · 31 Aug');
  });

  it('leaves a hand-written title alone', async () => {
    const draft = await draftFor();
    unwrap(await updateDraft(ctx, draft.id, { title: 'Tuesday night' }));
    const updated = unwrap(
      await updateDraft(ctx, draft.id, {
        objective: {
          text: 'Pressing as a unit',
          successCriteria: [],
          sourceActionId: null,
          principleId: null,
        },
      }),
    );
    expect(updated.title).toBe('Tuesday night');
  });

  it('prunes phase focus players when a player is dropped from the session', async () => {
    const draft = await draftFor({ focusPlayerIds: [kai, maya] });
    const practice = mainPracticePhase(draft)!;
    unwrap(await updatePhase(ctx, draft.id, { ...practice, focusPlayerIds: [kai, maya] }));

    const updated = unwrap(await updateDraft(ctx, draft.id, { focusPlayerIds: [kai] }));
    expect(updated.focusPlayers.map((f) => f.playerId)).toEqual([kai]);
    expect(updated.phases.find((p) => p.id === practice.id)?.focusPlayerIds).toEqual([kai]);
  });

  it('keeps the carry-forward provenance of a focus player who stays', async () => {
    const draft = await draftFor({ focusPlayerIds: [kai] });
    const withSource = {
      ...draft,
      focusPlayers: [{ playerId: kai, sourceActionId: null, reason: 'Scan before receiving' }],
    };
    await ctx.store.sessions.put(withSource);

    const updated = unwrap(await updateDraft(ctx, draft.id, { focusPlayerIds: [kai, maya] }));
    expect(updated.focusPlayers[0]?.reason).toBe('Scan before receiving');
  });
});

describe('phases', () => {
  it('replaces a phase wholesale', async () => {
    const draft = await draftFor();
    const phase = draft.phases[0]!;
    const updated = unwrap(
      await updatePhase(ctx, draft.id, { ...phase, title: 'Rondo', organisation: '4v2, 15x15' }),
    );

    expect(updated.phases[0]?.title).toBe('Rondo');
    expect(updated.phases[0]?.organisation).toBe('4v2, 15x15');
  });

  it('reorders by id list', async () => {
    const draft = await draftFor();
    const reversed = [...draft.phases].sort((a, b) => b.order - a.order).map((p) => p.id);
    const updated = unwrap(await reorderPhases(ctx, draft.id, reversed));

    const ordered = [...updated.phases].sort((a, b) => a.order - b.order).map((p) => p.id);
    expect(ordered).toEqual(reversed);
  });
});

describe('setIntervention', () => {
  it('sets the session plan and marks it touched', async () => {
    const draft = await draftFor();
    const plan = InterventionPlanSchema.parse({ method: 'guided_discovery', mechanic: 'in_flow' });

    const updated = unwrap(await setIntervention(ctx, draft.id, plan));
    expect(updated.intervention).toEqual(plan);
    expect(updated.interventionTouched).toBe(true);
  });

  it('sets and clears a phase override without touching the session flag', async () => {
    const draft = await draftFor();
    const phaseId = draft.phases[0]!.id;
    const plan = InterventionPlanSchema.parse({ method: 'command', mechanic: 'play_stop_play' });

    const set = unwrap(await setIntervention(ctx, draft.id, plan, phaseId));
    expect(set.phases[0]?.intervention).toEqual(plan);
    expect(set.interventionTouched).toBe(false);

    const cleared = unwrap(await setIntervention(ctx, draft.id, null, phaseId));
    expect(cleared.phases[0]?.intervention).toBeNull();
  });
});

describe('commitAndStart', () => {
  it('commits and starts in one step', async () => {
    const draft = await draftFor();
    const started = unwrap(await commitAndStart(ctx, draft.id));

    expect(started.status).toBe('in_progress');
    expect(started.run?.phaseRuns).toHaveLength(1);
    expect((await ctx.store.meta.get())?.activeSessionId).toBe(started.id);
  });

  it('starts an already-committed session without complaining', async () => {
    const draft = await draftFor();
    const planned = { ...draft, status: 'planned' as const };
    await ctx.store.sessions.put(planned);

    expect(unwrap(await commitAndStart(ctx, draft.id)).status).toBe('in_progress');
  });

  it('reports a guard failure rather than throwing', async () => {
    const draft = await draftFor();
    await ctx.store.sessions.put({ ...draft, phases: [] });

    const result = await commitAndStart(ctx, draft.id);
    expect(isErr(result) && result.error.kind).toBe('transition');
  });
});

describe('repeatSession', () => {
  it('clones into a fresh draft with new ids and no run', async () => {
    const draft = await draftFor({ focusPlayerIds: [kai] });
    const started = unwrap(await commitAndStart(ctx, draft.id));
    (ctx.clock as FakeClock).advanceMinutes(60 * 24 * 7);

    const repeated = unwrap(await repeatSession(ctx, started.id));

    expect(repeated.id).not.toBe(started.id);
    expect(repeated.status).toBe('draft');
    expect(repeated.run).toBeNull();
    expect(repeated.objective.text).toBe(started.objective.text);
    expect(repeated.phases).toHaveLength(started.phases.length);
    expect(repeated.phases.map((p) => p.id)).not.toEqual(started.phases.map((p) => p.id));
    // A week on, retitled to the new date. Matched loosely because ICU spells September
    // as either "Sep" or "Sept" depending on the Node build.
    expect(repeated.title).toMatch(/^Playing out from the back · 7 Sept?$/);
  });

  it('resets every coaching point to undelivered', async () => {
    const draft = await draftFor();
    const withDelivered = {
      ...draft,
      phases: draft.phases.map((phase) => ({
        ...phase,
        coachingPoints: phase.coachingPoints.map((p) => ({ ...p, delivered: true })),
      })),
    };
    await ctx.store.sessions.put(withDelivered);

    const repeated = unwrap(await repeatSession(ctx, draft.id));
    expect(repeated.phases.flatMap((p) => p.coachingPoints).every((p) => !p.delivered)).toBe(true);
  });

  it('repeats the asks but not last week’s verdicts', async () => {
    const draft = await draftFor({ focusPlayerIds: [kai] });
    const added = unwrap(
      await addChallenge(ctx, draft.id, {
        playerId: kai,
        text: 'Three forward passes',
        targetCount: 3,
        corner: 'technical_tactical',
      }),
    );
    // Judge it, the way the coach would have at the end of the session.
    await ctx.store.sessions.put({
      ...added,
      challenges: added.challenges.map((challenge) => ({
        ...challenge,
        status: 'met' as const,
        settledAt: T0,
        note: 'All three, second half',
      })),
    });

    const repeated = unwrap(await repeatSession(ctx, added.id));
    const challenge = repeated.challenges[0];

    expect(repeated.challenges).toHaveLength(1);
    expect(challenge?.text).toBe('Three forward passes');
    expect(challenge?.targetCount).toBe(3);
    expect(challenge?.corner).toBe('technical_tactical');
    expect(challenge?.playerId).toBe(kai);
    expect(challenge?.id).not.toBe(added.challenges[0]?.id);
    expect(challenge?.status).toBe('open');
    expect(challenge?.settledAt).toBeNull();
    expect(challenge?.note).toBe('');
  });

  it('remaps a phase-scoped challenge onto the new session’s phases', async () => {
    const draft = await draftFor();
    const rondo = draft.phases[1];
    const added = unwrap(
      await addChallenge(ctx, draft.id, {
        playerId: kai,
        text: 'Left foot only',
        phaseIds: rondo ? [rondo.id] : [],
      }),
    );

    const repeated = unwrap(await repeatSession(ctx, added.id));
    const position = added.phases.findIndex((phase) => phase.id === rondo?.id);

    // Same position in the plan, a new id: the schema would reject a phase id from last week.
    expect(repeated.challenges[0]?.phaseIds).toEqual([repeated.phases[position]?.id]);
    expect(repeated.challenges[0]?.phaseIds).not.toEqual([rondo?.id]);
  });

  it('leaves an unscoped challenge live for the whole session', async () => {
    const draft = await draftFor();
    const added = unwrap(
      await addChallenge(ctx, draft.id, { playerId: kai, text: 'Talk to your full back' }),
    );

    const repeated = unwrap(await repeatSession(ctx, added.id));
    expect(repeated.challenges[0]?.phaseIds).toEqual([]);
  });

  it('swaps in the carry-forward focus players when given some', async () => {
    const draft = await draftFor({ focusPlayerIds: [kai] });
    const repeated = unwrap(await repeatSession(ctx, draft.id, { focusPlayerIds: [maya] }));
    expect(repeated.focusPlayers.map((f) => f.playerId)).toEqual([maya]);
  });

  it('reports a session that does not exist', async () => {
    const result = await repeatSession(ctx, asSessionId(testId('ghost')));
    expect(isErr(result) && result.error.kind).toBe('session_not_found');
  });

  /** A fixture played to the final whistle: presence ticked, score in, the units ruled. */
  const playedMatch = async () => {
    const draft = unwrap(
      await startMatchDraft(ctx, {
        squadId,
        objectiveText: 'Away to Eastfield Rovers',
        periodMin: 25,
        match: {
          opponent: 'Eastfield Rovers',
          venue: 'away',
          fixtureType: 'league',
          format: '9v9',
          shapeName: '3-2-3',
          periodCount: 2,
          unitObjectives: [{ unit: 'defence', text: 'First pass forward, not sideways' }],
          lineup: [{ playerId: kai, unit: 'defence' }],
        },
      }),
    );

    const started = unwrap(await commitAndStart(ctx, draft.id));
    unwrap(await setPeriodPresence(ctx, started.id, periodsOf(started)[0]!.id, [kai, maya]));
    unwrap(await setMatchResult(ctx, started.id, { goalsFor: 3, goalsAgainst: 1 }));
    return unwrap(await setUnitObjectiveStatus(ctx, started.id, 'defence', 'met'));
  };

  it('repeats the fixture plan — the shape, the lineup and the units’ asks', async () => {
    const repeated = unwrap(await repeatSession(ctx, (await playedMatch()).id));

    expect(repeated.kind).toBe('match');
    expect(repeated.match).toMatchObject({
      opponent: 'Eastfield Rovers',
      venue: 'away',
      format: '9v9',
      shapeName: '3-2-3',
      periodCount: 2,
    });
    expect(repeated.match?.unitObjectives[0]?.text).toBe('First pass forward, not sideways');
    expect(repeated.match?.lineup).toEqual([{ playerId: kai, unit: 'defence' }]);
  });

  it('leaves behind the record of the game that was actually played', async () => {
    const played = await playedMatch();
    const repeated = unwrap(await repeatSession(ctx, played.id));

    // The bug this covers: presence still pointed at the *source* session's periods, so the
    // schema rejected the clone and Repeat threw before the coach saw a draft.
    expect(played.match?.presence).toHaveLength(1);
    expect(repeated.match?.presence).toEqual([]);
    expect(repeated.match?.result).toBeNull();
    expect(repeated.match?.unitObjectives[0]?.status).toBe('open');
  });
});

describe('discardDraft', () => {
  it('removes the draft and clears the active pointer', async () => {
    await draftFor();
    await discardDraft(ctx, squadId);

    expect(await getDraft(ctx, squadId)).toBeUndefined();
    expect((await ctx.store.meta.get())?.activeSessionId).toBeNull();
  });

  it('is a no-op when there is no draft', async () => {
    await expect(discardDraft(ctx, squadId)).resolves.toBeUndefined();
  });
});
