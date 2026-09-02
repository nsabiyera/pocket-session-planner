import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyActionsToDraft,
  dropAction,
  listOpenActions,
  loadReviewData,
  proposeCarryForward,
  saveReview,
} from './review-service';
import { commitAndStart, startDraft } from '../planning/planning-service';
import { dispatch, logObservation } from '../run/run-service';
import { addPlayer, createSquad } from '../squad/squad-service';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { isErr, unwrap } from '@/lib/result';
import { asSessionId, type PlayerId, type SquadId } from '@/domain/ids';
import { sessionStage } from '@/domain/session/selectors';
import { aReview, T0, testId } from '@/test/builders';
import type { Session } from '@/domain/session';
import type { SessionReview } from '@/domain/review';
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
  kai = (await addPlayer(ctx, { squadId, name: 'Kai Roberts' })).id;
  maya = (await addPlayer(ctx, { squadId, name: 'Maya Okafor' })).id;
});

/** Plans, runs and finishes a session, leaving it awaiting review. */
async function runASession(objectiveText = 'Playing out from the back'): Promise<Session> {
  const draft = unwrap(
    await startDraft(ctx, {
      squadId,
      objectiveText,
      objectiveTemplateId: 'playing-out-from-the-back',
      focusPlayerIds: [kai, maya],
    }),
  );
  const started = unwrap(await commitAndStart(ctx, draft.id));
  clock().advanceMinutes(55);
  return unwrap(await dispatch(ctx, started.id, { kind: 'finish' }));
}

const reviewFor = (session: Session, over: Partial<SessionReview> = {}) =>
  aReview({ sessionId: session.id, squadId, ...over });

describe('loadReviewData', () => {
  it('pre-computes everything the screen would otherwise have to ask for', async () => {
    const session = await runASession();
    await logObservation(ctx, { sessionId: session.id, playerId: kai, ratingKind: 'good' });

    const data = unwrap(await loadReviewData(ctx, session.id));

    expect(data.session.id).toBe(session.id);
    expect(data.observations).toHaveLength(1);
    expect(data.interventions.totalCount).toBe(0);
    // The omission the coach most wants flagged: a focus player nobody watched.
    expect(data.unobservedFocusPlayerIds).toEqual([maya]);
  });

  it('flags the phases that ran over', async () => {
    const draft = unwrap(await startDraft(ctx, { squadId, objectiveText: 'Pressing' }));
    const started = unwrap(await commitAndStart(ctx, draft.id));
    const firstPhase = started.phases[0]!;

    clock().advanceMinutes(firstPhase.plannedDurationMin + 7);
    const finished = unwrap(await dispatch(ctx, started.id, { kind: 'finish' }));

    const data = unwrap(await loadReviewData(ctx, finished.id));
    expect(data.overruns[0]?.phase.id).toBe(firstPhase.id);
    expect(data.overruns[0]?.overrunMs).toBe(7 * 60_000);
  });

  it('refuses a session that is still running, and reports one that is missing', async () => {
    const draft = unwrap(await startDraft(ctx, { squadId, objectiveText: 'Pressing' }));
    const started = unwrap(await commitAndStart(ctx, draft.id));

    const running = await loadReviewData(ctx, started.id);
    expect(isErr(running) && running.error.kind).toBe('not_completed');

    const missing = await loadReviewData(ctx, asSessionId(testId('ghost')));
    expect(isErr(missing) && missing.error.kind).toBe('session_not_found');
  });

  it('reviews an abandoned session too — twenty minutes of evidence is still evidence', async () => {
    const draft = unwrap(await startDraft(ctx, { squadId, objectiveText: 'Pressing' }));
    const started = unwrap(await commitAndStart(ctx, draft.id));
    clock().advanceMinutes(20);
    const abandoned = unwrap(
      await dispatch(ctx, started.id, { kind: 'abandon', reason: 'Thunder' }),
    );

    expect((await loadReviewData(ctx, abandoned.id)).ok).toBe(true);
  });
});

describe('proposeCarryForward', () => {
  it('names players in the proposals it generates', async () => {
    const session = await runASession();
    const proposals = unwrap(
      await proposeCarryForward(
        ctx,
        session.id,
        reviewFor(session, {
          objectiveOutcome: 'partially_met',
          focusPlayerReviews: [
            { playerId: kai, progress: 'no_change', nextStep: 'Scan before receiving', note: '' },
          ],
        }),
      ),
    );

    expect(proposals.some((p) => p.title === 'Keep focusing on Kai')).toBe(true);
  });

  it('writes nothing — proposals are a checklist, not a commitment', async () => {
    const session = await runASession();
    await proposeCarryForward(ctx, session.id, reviewFor(session, { objectiveOutcome: 'not_met' }));

    expect(await listOpenActions(ctx, squadId)).toEqual([]);
    expect(await ctx.store.reviews.findBySession(session.id)).toBeUndefined();
  });
});

describe('saveReview', () => {
  it('writes the review, links the session, and clears the active pointer', async () => {
    const session = await runASession();
    const { review } = unwrap(
      await saveReview(ctx, {
        sessionId: session.id,
        objectiveOutcome: 'met',
        acceptedProposals: [],
      }),
    );

    expect(await ctx.store.reviews.findBySession(session.id)).toMatchObject({ id: review.id });
    const stored = await ctx.store.sessions.get(session.id);
    expect(stored?.reviewId).toBe(review.id);
    expect(sessionStage(stored!)).toBe('archived');
    expect((await ctx.store.meta.get())?.activeSessionId).toBeNull();
  });

  it('creates only the proposals the coach left ticked', async () => {
    const session = await runASession();
    const proposals = unwrap(
      await proposeCarryForward(
        ctx,
        session.id,
        reviewFor(session, { objectiveOutcome: 'not_met' }),
      ),
    );
    const accepted = proposals.filter((p) => p.defaultSelected);

    const { createdActions } = unwrap(
      await saveReview(ctx, {
        sessionId: session.id,
        objectiveOutcome: 'not_met',
        acceptedProposals: accepted,
      }),
    );

    expect(createdActions).toHaveLength(accepted.length);
    expect(await listOpenActions(ctx, squadId)).toHaveLength(accepted.length);
  });

  it('refuses to review the same session twice', async () => {
    const session = await runASession();
    unwrap(
      await saveReview(ctx, {
        sessionId: session.id,
        objectiveOutcome: 'met',
        acceptedProposals: [],
      }),
    );

    const second = await saveReview(ctx, {
      sessionId: session.id,
      objectiveOutcome: 'met',
      acceptedProposals: [],
    });
    expect(isErr(second) && second.error.kind).toBe('already_reviewed');
  });

  it('closes out an action the coach said was done', async () => {
    const first = await runASession();
    const proposals = unwrap(
      await proposeCarryForward(ctx, first.id, reviewFor(first, { objectiveOutcome: 'not_met' })),
    );
    const { createdActions } = unwrap(
      await saveReview(ctx, {
        sessionId: first.id,
        objectiveOutcome: 'not_met',
        acceptedProposals: proposals.filter((p) => p.defaultSelected).slice(0, 1),
      }),
    );

    const action = createdActions[0]!;
    const second = await runASession('Second session');
    unwrap(
      await saveReview(ctx, {
        sessionId: second.id,
        objectiveOutcome: 'met',
        seededActionOutcomes: [{ actionId: action.id, outcome: 'done', note: '' }],
        acceptedProposals: [],
      }),
    );

    const stored = await ctx.store.actions.get(action.id);
    expect(stored?.status).toBe('done');
    expect(stored?.resolutionNote).toBe('done');
  });
});

describe('chaining across sessions', () => {
  it('supersedes rather than duplicating, and climbs the chain depth', async () => {
    const makeAndSave = async (label: string) => {
      const session = await runASession(label);
      const review = reviewFor(session, {
        objectiveOutcome: 'not_met',
        focusPlayerReviews: [
          { playerId: kai, progress: 'no_change', nextStep: 'Scan before receiving', note: '' },
        ],
      });
      const proposals = unwrap(await proposeCarryForward(ctx, session.id, review));
      const focus = proposals.find((p) => p.trigger === 'focus-player:no-progress')!;

      return unwrap(
        await saveReview(ctx, {
          sessionId: session.id,
          objectiveOutcome: 'not_met',
          focusPlayerReviews: review.focusPlayerReviews,
          acceptedProposals: [focus],
        }),
      );
    };

    const first = await makeAndSave('Session one');
    expect(first.createdActions[0]?.chainDepth).toBe(0);
    expect(first.supersededActionIds).toEqual([]);

    clock().advanceMinutes(60 * 24 * 7);
    const second = await makeAndSave('Session two');
    expect(second.createdActions[0]?.chainDepth).toBe(1);
    expect(second.supersededActionIds).toEqual([first.createdActions[0]?.id]);

    // The predecessor is closed out, so the coach sees one live action, not two.
    expect((await ctx.store.actions.get(first.createdActions[0]!.id))?.status).toBe('done');
    expect(await listOpenActions(ctx, squadId)).toHaveLength(1);

    clock().advanceMinutes(60 * 24 * 7);
    const third = await makeAndSave('Session three');
    // Three sessions chasing the same point: the planner now says change the practice.
    expect(third.createdActions[0]?.chainDepth).toBe(2);

    clock().advanceMinutes(60 * 24 * 7);
    const fourth = await makeAndSave('Session four');
    expect(fourth.createdActions[0]?.chainDepth).toBe(3);
  });
});

describe('applyActionsToDraft', () => {
  it('seeds the next session and marks the actions planned, in one write', async () => {
    const session = await runASession();
    const proposals = unwrap(
      await proposeCarryForward(
        ctx,
        session.id,
        reviewFor(session, {
          objectiveOutcome: 'not_met',
          focusPlayerReviews: [
            { playerId: kai, progress: 'regressed', nextStep: 'Scan before receiving', note: '' },
          ],
        }),
      ),
    );
    const { createdActions } = unwrap(
      await saveReview(ctx, {
        sessionId: session.id,
        objectiveOutcome: 'not_met',
        acceptedProposals: proposals.filter((p) => p.defaultSelected),
      }),
    );

    clock().advanceMinutes(60 * 24 * 7);
    unwrap(await startDraft(ctx, { squadId, objectiveText: 'Something else' }));

    const applied = unwrap(
      await applyActionsToDraft(
        ctx,
        squadId,
        createdActions.map((action) => action.id),
      ),
    );

    // The objective is pre-seeded and marked as carried.
    expect(applied.session.objective.text).toBe('Playing out from the back');
    expect(applied.session.objective.sourceActionId).toBeTruthy();
    expect(applied.session.focusPlayers.map((f) => f.playerId)).toContain(kai);
    expect(applied.session.seededFromActionIds.length).toBeGreaterThan(0);

    for (const action of createdActions.slice(0, applied.session.seededFromActionIds.length)) {
      const stored = await ctx.store.actions.get(action.id);
      expect(stored?.status).toBe('planned');
      expect(stored?.appliedToSessionId).toBe(applied.session.id);
    }
  });

  it('reports when there is no draft to apply them to', async () => {
    const result = await applyActionsToDraft(ctx, squadId, []);
    expect(isErr(result) && result.error.kind).toBe('no_draft');
  });
});

describe('the loop closes', () => {
  it('session two opens with session one review already answered for it', async () => {
    // 1. Run a session and review it badly.
    const first = await runASession();
    const review = reviewFor(first, {
      objectiveOutcome: 'partially_met',
      metCriteria: [0],
      focusPlayerReviews: [
        { playerId: kai, progress: 'no_change', nextStep: 'Scan before receiving', note: '' },
      ],
    });
    const proposals = unwrap(await proposeCarryForward(ctx, first.id, review));
    const { createdActions } = unwrap(
      await saveReview(ctx, {
        sessionId: first.id,
        objectiveOutcome: 'partially_met',
        metCriteria: [0],
        focusPlayerReviews: review.focusPlayerReviews,
        acceptedProposals: proposals.filter((p) => p.defaultSelected),
      }),
    );

    // 2. A week later, start the next session from the open actions.
    clock().advanceMinutes(60 * 24 * 7);
    unwrap(await startDraft(ctx, { squadId, objectiveText: 'Placeholder' }));
    const seeded = unwrap(
      await applyActionsToDraft(
        ctx,
        squadId,
        (await listOpenActions(ctx, squadId)).map((a) => a.id),
      ),
    ).session;

    // 3. The objective, the focus player and the coaching point are all pre-filled, and each
    //    carries the provenance Do mode needs to render "carried from 31 Aug".
    expect(seeded.objective.text).toBe('Playing out from the back');
    expect(seeded.objective.successCriteria).toEqual(['The keeper is an option']);
    expect(seeded.objective.sourceActionId).toBeTruthy();

    const focus = seeded.focusPlayers.find((f) => f.playerId === kai);
    expect(focus?.reason).toBe('Scan before receiving');
    expect(focus?.sourceActionId).toBeTruthy();

    const carriedPoints = seeded.phases
      .flatMap((phase) => phase.coachingPoints)
      .filter((point) => point.source === 'carry_forward');
    expect(carriedPoints.length).toBeGreaterThan(0);
    expect(carriedPoints.every((point) => point.sourceActionId !== null)).toBe(true);

    // 4. And the review of session two knows which actions to ask about first.
    const started = unwrap(await commitAndStart(ctx, seeded.id));
    clock().advanceMinutes(50);
    const finished = unwrap(await dispatch(ctx, started.id, { kind: 'finish' }));
    const data = unwrap(await loadReviewData(ctx, finished.id));

    expect(data.seededActions.map((a) => a.id).sort()).toEqual(
      createdActions
        .filter((a) => seeded.seededFromActionIds.includes(a.id))
        .map((a) => a.id)
        .sort(),
    );
  });
});

describe('dropAction', () => {
  it('closes an action the coach does not want, with a reason', async () => {
    const session = await runASession();
    const proposals = unwrap(
      await proposeCarryForward(
        ctx,
        session.id,
        reviewFor(session, { objectiveOutcome: 'not_met' }),
      ),
    );
    const { createdActions } = unwrap(
      await saveReview(ctx, {
        sessionId: session.id,
        objectiveOutcome: 'not_met',
        acceptedProposals: proposals.slice(0, 1),
      }),
    );

    await dropAction(ctx, createdActions[0]!.id, 'Not relevant any more');
    const stored = await ctx.store.actions.get(createdActions[0]!.id);

    expect(stored?.status).toBe('dropped');
    expect(stored?.resolutionNote).toBe('Not relevant any more');
    expect(await listOpenActions(ctx, squadId)).toEqual([]);
  });

  it('is a no-op for an action that does not exist', async () => {
    await expect(dropAction(ctx, createdActionIdThatDoesNotExist())).resolves.toBeUndefined();
  });
});

function createdActionIdThatDoesNotExist() {
  return testId('ghost') as never;
}
