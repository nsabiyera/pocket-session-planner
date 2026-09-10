import { describe, expect, it } from 'vitest';
import { deriveCarryForwardProposals, proposalKey } from './derive-carry-forward';
import { MAX_PROPOSALS, type CarryForwardProposal } from '@/domain/carry-forward';
import { interventionSummary } from '@/domain/session/selectors';
import { applySessionCommand } from '@/domain/session/state-machine';
import { buildSessionFromMethodology } from '@/domain/session/build-from-methodology';
import { PLAY_PRACTICE_PLAY } from '@/domain/presets';
import { unwrap } from '@/lib/result';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { FakeClock } from '@/lib/fake-clock';
import { asInterventionEventId } from '@/domain/ids';
import { isoDateTime } from '@/domain/primitives';
import { aPlayer, aReview, aSquad, anAction, anObservation, playerId, T0 } from '@/test/builders';
import type { Session } from '@/domain/session';

const players = [aPlayer('kai'), aPlayer('maya'), aPlayer('sam')];

function sessionFixture(): Session {
  const draft = buildSessionFromMethodology(PLAY_PRACTICE_PLAY, {
    squad: aSquad(),
    objective: {
      text: 'Playing out from the back',
      successCriteria: ['We beat the first press', 'The keeper is an option'],
      sourceActionId: null,
      principleId: null,
      commonMisconception: null,
    },
    now: T0,
    ids: new FakeIdGenerator(),
    focusPlayers: [
      { playerId: playerId('kai'), sourceActionId: null },
      { playerId: playerId('maya'), sourceActionId: null },
    ],
  });
  const planned = unwrap(applySessionCommand(draft, { kind: 'commitPlan' }, T0));
  const started = unwrap(applySessionCommand(planned, { kind: 'start' }, T0));
  return unwrap(
    applySessionCommand(started, { kind: 'finish' }, isoDateTime('2026-08-31T19:00:00.000Z')),
  );
}

const derive = (over: Partial<Parameters<typeof deriveCarryForwardProposals>[0]> = {}) => {
  const session = over.session ?? sessionFixture();
  return deriveCarryForwardProposals({
    session,
    review: aReview(),
    observations: [],
    interventions: interventionSummary(session, Date.parse(T0)),
    openActions: [],
    players,
    ...over,
  });
};

const withKind = (proposals: CarryForwardProposal[], trigger: string) =>
  proposals.filter((p) => p.trigger === trigger);

describe('trigger: objective not met', () => {
  it('proposes a high-priority revisit carrying only the unmet criteria', () => {
    const proposals = derive({
      review: aReview({ objectiveOutcome: 'partially_met', metCriteria: [0] }),
    });
    const [objective] = withKind(proposals, 'objective:unmet');

    expect(objective).toMatchObject({ kind: 'objective', priority: 'high', defaultSelected: true });
    expect(objective?.title).toBe('Revisit: Playing out from the back');
    expect(objective?.payload).toMatchObject({
      kind: 'objective',
      intent: 'revisit',
      successCriteria: ['The keeper is an option'],
    });
  });

  it('says so plainly when nothing was met', () => {
    const proposals = derive({ review: aReview({ objectiveOutcome: 'not_met' }) });
    const [objective] = withKind(proposals, 'objective:unmet');
    expect(objective?.payload).toMatchObject({
      successCriteria: ['We beat the first press', 'The keeper is an option'],
    });
  });
});

describe('trigger: objective met', () => {
  it('proposes a progression, unticked — met may mean move on', () => {
    const proposals = derive({ review: aReview({ objectiveOutcome: 'met' }) });
    const [objective] = withKind(proposals, 'objective:met');

    expect(objective).toMatchObject({ defaultSelected: false, priority: 'normal' });
    expect(objective?.title).toBe('Progress: Playing out from the back');
    expect(objective?.detail).toBe('Add pressure / reduce time / increase distance');
    expect(objective?.payload).toMatchObject({ intent: 'progress' });
  });

  it('treats exceeded the same way', () => {
    expect(
      withKind(derive({ review: aReview({ objectiveOutcome: 'exceeded' }) }), 'objective:met'),
    ).toHaveLength(1);
  });
});

describe('trigger: focus player did not progress', () => {
  it('carries the player forward with their next step as the target behaviour', () => {
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          {
            playerId: playerId('kai'),
            progress: 'no_change',
            nextStep: 'Scan before receiving',
            note: '',
          },
        ],
      }),
    });
    const [focus] = withKind(proposals, 'focus-player:no-progress');

    expect(focus).toMatchObject({ kind: 'focus_player', defaultSelected: true });
    expect(focus?.title).toBe('Keep focusing on Kai');
    expect(focus?.payload).toMatchObject({
      kind: 'focus_player',
      playerId: playerId('kai'),
      targetBehaviour: 'Scan before receiving',
    });
  });

  it('raises the priority when a player has gone backwards', () => {
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'regressed', nextStep: 'Body shape', note: '' },
        ],
      }),
    });
    expect(withKind(proposals, 'focus-player:no-progress')[0]?.priority).toBe('high');
  });

  it('says nothing when the player progressed', () => {
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'progressed', nextStep: '', note: '' },
        ],
      }),
    });
    expect(withKind(proposals, 'focus-player:no-progress')).toHaveLength(0);
  });

  it('falls back to the objective when no next step was written', () => {
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'no_change', nextStep: '', note: '' },
        ],
      }),
    });
    expect(withKind(proposals, 'focus-player:no-progress')[0]?.payload).toMatchObject({
      targetBehaviour: 'Playing out from the back',
    });
  });
});

describe('trigger: focus player next step', () => {
  it('becomes a coaching point aimed at that player', () => {
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'progressed', nextStep: 'Scan twice', note: '' },
        ],
      }),
    });
    const [point] = withKind(proposals, 'focus-player:next-step');

    expect(point).toMatchObject({ kind: 'coaching_point', defaultSelected: true });
    expect(point?.title).toBe('Scan twice');
    expect(point?.detail).toBe('For Kai');
  });

  it('infers the phase kind from where that player was actually observed', () => {
    const session = sessionFixture();
    const practice = session.phases.find((p) => p.kind === 'skill_practice')!;

    const proposals = derive({
      session,
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'progressed', nextStep: 'Scan twice', note: '' },
        ],
      }),
      observations: [
        anObservation('o1', { playerId: playerId('kai'), phaseId: practice.id }),
        anObservation('o2', { playerId: playerId('kai'), phaseId: practice.id }),
        anObservation('o3', { playerId: playerId('kai'), phaseId: session.phases[0]!.id }),
      ],
    });

    expect(withKind(proposals, 'focus-player:next-step')[0]?.payload).toMatchObject({
      preferredPhaseKind: 'skill_practice',
    });
  });

  it('leaves the phase kind unset when the player was never observed', () => {
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'progressed', nextStep: 'Scan twice', note: '' },
        ],
      }),
    });
    expect(withKind(proposals, 'focus-player:next-step')[0]?.payload).toMatchObject({
      preferredPhaseKind: null,
    });
  });
});

describe('trigger: a struggled observation', () => {
  it('proposes the tag as a coaching point for that player', () => {
    const session = sessionFixture();
    const proposals = derive({
      session,
      observations: [
        anObservation('o1', {
          playerId: playerId('kai'),
          phaseId: session.phases[0]!.id,
          kind: 'development',
          rating: 2,
          tags: ['Head up before you receive'],
        }),
      ],
    });
    const [point] = withKind(proposals, 'observation:struggled');

    expect(point?.title).toBe('Head up before you receive');
    expect(point?.detail).toBe('Kai struggled with this');
    expect(point?.defaultSelected).toBe(true);
  });

  it('ignores a strength, and a development note that went well', () => {
    const session = sessionFixture();
    const proposals = derive({
      session,
      observations: [
        anObservation('o1', {
          playerId: playerId('kai'),
          phaseId: session.phases[0]!.id,
          kind: 'strength',
          rating: 5,
          tags: ['Great first touch'],
        }),
        anObservation('o2', {
          playerId: playerId('maya'),
          phaseId: session.phases[0]!.id,
          kind: 'development',
          rating: 4,
          tags: ['Nearly there'],
        }),
      ],
    });
    expect(withKind(proposals, 'observation:struggled')).toHaveLength(0);
  });

  it('deduplicates the same point logged twice for the same player', () => {
    const session = sessionFixture();
    const observation = {
      playerId: playerId('kai'),
      phaseId: session.phases[0]!.id,
      kind: 'development' as const,
      rating: 2,
      tags: ['Body shape'],
    };
    const proposals = derive({
      session,
      observations: [
        anObservation('o1', observation),
        anObservation('o2', { ...observation, tags: ['body shape!'] }),
      ],
    });
    expect(withKind(proposals, 'observation:struggled')).toHaveLength(1);
  });

  it('keeps the same point for two different players separate', () => {
    const session = sessionFixture();
    const base = {
      phaseId: session.phases[0]!.id,
      kind: 'development' as const,
      rating: 2,
      tags: ['Body shape'],
    };
    const proposals = derive({
      session,
      observations: [
        anObservation('o1', { ...base, playerId: playerId('kai') }),
        anObservation('o2', { ...base, playerId: playerId('maya') }),
      ],
    });
    expect(withKind(proposals, 'observation:struggled')).toHaveLength(2);
  });

  it('ignores a struggle with nothing written or tagged', () => {
    const session = sessionFixture();
    const proposals = derive({
      session,
      observations: [
        anObservation('o1', {
          playerId: playerId('kai'),
          phaseId: session.phases[0]!.id,
          kind: 'development',
          rating: 1,
        }),
      ],
    });
    expect(withKind(proposals, 'observation:struggled')).toHaveLength(0);
  });
});

describe('trigger: ball rolling time', () => {
  function sessionWithStoppages(count: number): Session {
    const clock = new FakeClock(T0);
    const draft = buildSessionFromMethodology(PLAY_PRACTICE_PLAY, {
      squad: aSquad(),
      objective: {
        text: 'Playing out',
        successCriteria: [],
        sourceActionId: null,
        principleId: null,
        commonMisconception: null,
      },
      now: T0,
      ids: new FakeIdGenerator(),
    });
    let session = unwrap(applySessionCommand(draft, { kind: 'commitPlan' }, T0));
    session = unwrap(applySessionCommand(session, { kind: 'start' }, T0));

    for (let i = 0; i < count; i += 1) {
      clock.advanceMinutes(1);
      session = unwrap(
        applySessionCommand(
          session,
          {
            kind: 'logIntervention',
            id: asInterventionEventId(`00000000-0000-4000-8000-0000000000${(i + 16).toString(16)}`),
            mechanic: 'play_stop_play',
          },
          isoDateTime(clock.nowIso()),
        ),
      );
      clock.advanceMinutes(1);
      session = unwrap(
        applySessionCommand(session, { kind: 'closeIntervention' }, isoDateTime(clock.nowIso())),
      );
    }
    clock.advanceMinutes(1);
    return unwrap(applySessionCommand(session, { kind: 'finish' }, isoDateTime(clock.nowIso())));
  }

  it('proposes a concrete plan change, not a scolding', () => {
    const session = sessionWithStoppages(6);
    const interventions = interventionSummary(session, Date.parse(T0) + 60 * 60_000);
    expect(interventions.ballRollingRatio).toBeLessThan(0.7);

    const [intervention] = withKind(
      derive({ session, interventions }),
      'intervention:ball-rolling',
    );
    expect(intervention).toMatchObject({ kind: 'intervention', defaultSelected: true });
    expect(intervention?.detail).toMatch(/Ball rolling time was \d+%\. Try in-flow coaching/);
    expect(intervention?.payload).toMatchObject({ kind: 'intervention' });
  });

  it('stays quiet when the ball was rolling', () => {
    const session = sessionFixture();
    const proposals = derive({
      session,
      interventions: {
        ...interventionSummary(session, Date.parse(T0)),
        ballRollingRatio: 0.92,
        overBudgetPhases: [],
      },
    });
    expect(withKind(proposals, 'intervention:ball-rolling')).toHaveLength(0);
  });

  it('speaks up for an over-budget phase even when the ratio is fine', () => {
    const session = sessionFixture();
    const proposals = derive({
      session,
      interventions: {
        ...interventionSummary(session, Date.parse(T0)),
        ballRollingRatio: 0.95,
        overBudgetPhases: [session.phases[0]!.id],
      },
    });
    const [intervention] = withKind(proposals, 'intervention:ball-rolling');
    expect(intervention?.detail).toMatch(/went over the intervention budget/);
  });
});

describe('trigger: a command plan that was never used', () => {
  it('asks the honest question, at low priority and unticked', () => {
    const session = sessionFixture();
    const commandSession = {
      ...session,
      intervention: { ...session.intervention, method: 'command' as const },
    };
    const proposals = derive({
      session: commandSession,
      interventions: interventionSummary(commandSession, Date.parse(T0)),
    });
    const [intervention] = withKind(proposals, 'intervention:unused-plan');

    expect(intervention).toMatchObject({ priority: 'low', defaultSelected: false });
    expect(intervention?.title).toMatch(/planned to coach directly and never stopped play/);
  });

  it('does not ask it of a session that never planned to command', () => {
    expect(withKind(derive(), 'intervention:unused-plan')).toHaveLength(0);
  });
});

describe('trigger: a phase worth running again', () => {
  it('freezes a copy with points reset and ids left for the apply step', () => {
    const session = sessionFixture();
    const phase = session.phases[2]!;
    const proposals = derive({
      session,
      review: aReview({
        phaseReviews: [
          {
            phaseId: phase.id,
            ranAsPlanned: true,
            rating: 5,
            wouldRunAgain: true,
            note: 'Brilliant',
          },
        ],
      }),
    });
    const [proposal] = withKind(proposals, 'phase:run-again');

    expect(proposal?.title).toBe(`Run again: ${phase.title}`);
    // Unticked: re-running a phase is a bigger commitment than a coaching point.
    expect(proposal?.defaultSelected).toBe(false);
    expect(proposal?.payload).toMatchObject({ kind: 'phase', originalOrder: phase.order });
  });

  it('also proposes a phase that went badly and did not run as planned', () => {
    const session = sessionFixture();
    const phase = session.phases[2]!;
    const proposals = derive({
      session,
      review: aReview({
        phaseReviews: [
          { phaseId: phase.id, ranAsPlanned: false, rating: 2, wouldRunAgain: false, note: '' },
        ],
      }),
    });
    expect(withKind(proposals, 'phase:run-again')[0]?.title).toBe(`Try again: ${phase.title}`);
  });

  it('says nothing about a phase that simply worked', () => {
    const session = sessionFixture();
    const proposals = derive({
      session,
      review: aReview({
        phaseReviews: [
          {
            phaseId: session.phases[0]!.id,
            ranAsPlanned: true,
            rating: 4,
            wouldRunAgain: false,
            note: '',
          },
        ],
      }),
    });
    expect(withKind(proposals, 'phase:run-again')).toHaveLength(0);
  });
});

describe('trigger: coaching points never delivered', () => {
  it('offers them at low priority, unticked', () => {
    const proposals = derive();
    const undelivered = withKind(proposals, 'coaching-point:undelivered');

    expect(undelivered.length).toBeGreaterThan(0);
    expect(undelivered[0]).toMatchObject({ priority: 'low', defaultSelected: false });
    expect(undelivered[0]?.title).toMatch(/^Didn't get to: /);
  });

  it('says nothing about a session that is not finished', () => {
    const session = sessionFixture();
    const proposals = derive({ session: { ...session, status: 'in_progress' } });
    expect(withKind(proposals, 'coaching-point:undelivered')).toHaveLength(0);
  });
});

describe('trigger: what did not work', () => {
  it('becomes a low-priority reminder', () => {
    const proposals = derive({
      review: aReview({ whatDidnt: ['The rondo area was too big'] }),
    });
    const [reminder] = withKind(proposals, 'review:what-didnt');

    expect(reminder).toMatchObject({ kind: 'reminder', priority: 'low', defaultSelected: false });
    expect(reminder?.title).toBe('The rondo area was too big');
  });
});

describe('trigger: a neglected 4 Corner', () => {
  const history = (counts: Partial<Record<string, number>>) => {
    const rows = Object.entries(counts).flatMap(([corner, count]) =>
      Array.from({ length: count ?? 0 }, (_, index) =>
        anObservation(`${corner}${index}`, {
          playerId: playerId('kai'),
          corner: corner as never,
        }),
      ),
    );
    return new Map([[playerId('kai'), rows]]);
  };

  it('names the gap and suggests the corner, unticked', () => {
    const proposals = derive({
      playerHistory: history({ technical_tactical: 29, physical: 5 }),
    });
    const [nudge] = withKind(proposals, 'four-corners:neglected');

    expect(nudge).toMatchObject({ kind: 'focus_player', defaultSelected: false });
    expect(nudge?.title).toBe('Look at the psych corner with Kai');
    expect(nudge?.detail).toContain('nothing psych or social');
    expect(nudge?.payload).toMatchObject({
      kind: 'focus_player',
      playerId: playerId('kai'),
    });
  });

  it('stays quiet on one session worth of data', () => {
    // Three technical notes on a Tuesday is not a development bias.
    const proposals = derive({ playerHistory: history({ technical_tactical: 3 }) });
    expect(withKind(proposals, 'four-corners:neglected')).toHaveLength(0);
  });

  it('stays quiet when the spread is already reasonable', () => {
    const proposals = derive({
      playerHistory: history({
        technical_tactical: 3,
        physical: 3,
        psychological: 3,
        social: 3,
      }),
    });
    expect(withKind(proposals, 'four-corners:neglected')).toHaveLength(0);
  });

  it('says nothing at all when no history was supplied', () => {
    expect(withKind(derive(), 'four-corners:neglected')).toHaveLength(0);
  });

  it('only nudges about the session focus players', () => {
    const proposals = derive({
      playerHistory: new Map([
        [
          playerId('sam'),
          Array.from({ length: 20 }, (_, i) =>
            anObservation(`s${i}`, { playerId: playerId('sam'), corner: 'technical_tactical' }),
          ),
        ],
      ]),
    });
    // Sam is not a focus player of this session, so their imbalance is not this review's business.
    expect(withKind(proposals, 'four-corners:neglected')).toHaveLength(0);
  });
});

describe('chaining', () => {
  it('supersedes a matching open action instead of duplicating it', () => {
    const open = anAction('a1', {
      kind: 'focus_player',
      title: 'Keep focusing on Kai',
      playerIds: [playerId('kai')],
      payload: {
        kind: 'focus_player',
        playerId: playerId('kai'),
        targetBehaviour: 'Scan before receiving',
      },
    });

    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'no_change', nextStep: 'Scan earlier', note: '' },
        ],
      }),
      openActions: [open],
    });

    expect(withKind(proposals, 'focus-player:no-progress')[0]?.supersedesActionId).toBe(open.id);
  });

  it('chains a focus-player action by player, whatever words the coach used', () => {
    const open = anAction('a1', {
      kind: 'focus_player',
      title: 'Completely different wording',
      playerIds: [playerId('kai')],
      payload: {
        kind: 'focus_player',
        playerId: playerId('kai'),
        targetBehaviour: 'Something else',
      },
    });
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'regressed', nextStep: 'Scan', note: '' },
        ],
      }),
      openActions: [open],
    });
    expect(withKind(proposals, 'focus-player:no-progress')[0]?.supersedesActionId).toBe(open.id);
  });

  it('does not chain across different players or kinds', () => {
    const open = anAction('a1', {
      kind: 'focus_player',
      title: 'Keep focusing on Maya',
      playerIds: [playerId('maya')],
      payload: {
        kind: 'focus_player',
        playerId: playerId('maya'),
        targetBehaviour: 'Positioning',
      },
    });
    const proposals = derive({
      review: aReview({
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'regressed', nextStep: 'Scan', note: '' },
        ],
      }),
      openActions: [open],
    });
    expect(withKind(proposals, 'focus-player:no-progress')[0]?.supersedesActionId).toBeNull();
  });

  it('ignores an action that is no longer open', () => {
    const done = anAction('a1', {
      kind: 'reminder',
      status: 'done',
      title: 'Bring the bibs',
      payload: { kind: 'reminder', text: 'Bring the bibs' },
    });
    const proposals = derive({
      review: aReview({ whatDidnt: ['Bring the bibs'] }),
      openActions: [done],
    });
    expect(withKind(proposals, 'review:what-didnt')[0]?.supersedesActionId).toBeNull();
  });
});

describe('volume and ordering', () => {
  it('caps at eight proposals — a review with thirty checkboxes is one nobody completes', () => {
    const session = sessionFixture();
    const proposals = derive({
      session,
      review: aReview({
        objectiveOutcome: 'not_met',
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'regressed', nextStep: 'Scan', note: '' },
          { playerId: playerId('maya'), progress: 'no_change', nextStep: 'Body shape', note: '' },
        ],
        phaseReviews: session.phases.map((phase) => ({
          phaseId: phase.id,
          ranAsPlanned: true,
          rating: 5,
          wouldRunAgain: true,
          note: '',
        })),
        whatDidnt: ['One', 'Two', 'Three'],
      }),
      observations: session.phases.flatMap((phase, index) => [
        anObservation(`obs${index}`, {
          playerId: playerId('sam'),
          phaseId: phase.id,
          kind: 'development',
          rating: 1,
          tags: [`Problem ${index}`],
        }),
      ]),
    });

    expect(proposals).toHaveLength(MAX_PROPOSALS);
  });

  it('puts the high-priority, most specific proposals first', () => {
    const proposals = derive({
      review: aReview({
        objectiveOutcome: 'not_met',
        focusPlayerReviews: [
          { playerId: playerId('kai'), progress: 'regressed', nextStep: 'Scan', note: '' },
        ],
        whatDidnt: ['A minor gripe'],
      }),
    });

    expect(proposals[0]?.trigger).toBe('objective:unmet');
    expect(proposals[1]?.trigger).toBe('focus-player:no-progress');
    // The low-priority reminder is last, if it survives the cap at all.
    expect(proposals.findIndex((p) => p.trigger === 'review:what-didnt')).toBeGreaterThan(1);
  });

  it('is deterministic', () => {
    const session = sessionFixture();
    const review = aReview({ objectiveOutcome: 'partially_met' });
    const first = derive({ session, review });
    for (let i = 0; i < 3; i += 1) {
      expect(derive({ session, review })).toEqual(first);
    }
  });
});

describe('proposalKey', () => {
  it('normalises punctuation, case and whitespace', () => {
    expect(proposalKey('coaching_point', 'Scan  before   receiving!')).toBe(
      proposalKey('coaching_point', 'scan before receiving'),
    );
  });

  it('keeps different players and kinds apart', () => {
    expect(proposalKey('coaching_point', 'Scan', playerId('kai'))).not.toBe(
      proposalKey('coaching_point', 'Scan', playerId('maya')),
    );
    expect(proposalKey('reminder', 'Scan')).not.toBe(proposalKey('coaching_point', 'Scan'));
  });
});
