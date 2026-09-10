import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeDataStore } from '@/data/ports/fake-data-store';
import { FakeClock } from '@/lib/fake-clock';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { unwrap } from '@/lib/result';
import { isoDateTime } from '@/domain/primitives';
import type { MethodologyId, PlayerId, SessionId } from '@/domain/ids';
import { asMethodologyId } from '@/domain/ids';
import type { ActionMoment } from '@/domain/capabilities';
import { addPlayer, createSquad } from '@/modules/squad/squad-service';
import { recordAssessment } from '@/modules/squad/assessment-service';
import { recordScan } from '@/modules/squad/scan-service';
import { commitAndStart, startDraft } from '@/modules/planning/planning-service';
import { addChallenge } from '@/modules/planning/challenges';
import {
  dispatch,
  logChallengeProgress,
  logIntervention,
  logObservation,
  setChallengeStatus,
} from '@/modules/run/run-service';
import { proposeCarryForward, saveReview } from '@/modules/review/review-service';
import { commitImport, exportAll, planImport } from '@/modules/transfer/transfer-service';
import { exportFilename } from '@/modules/transfer/envelope';
import type { ServiceContext } from '@/modules/context';
import type { TransferEnvelope } from '@/modules/transfer/envelope';

/**
 * **Seed data generator.**
 *
 * Writes a term's worth of realistic data as a normal export file, which the app imports
 * through `Settings → Import` like any other. That is the point of doing it this way: there
 * is no seeding back door, no second write path to keep in step with the real one, and no way
 * for the seed to contain something the app itself could not have produced — every row here
 * comes out of the same services a coach's taps go through.
 *
 * Deterministic: a fixed clock walks week by week and `FakeIdGenerator` hands out the same
 * ids every run, so regenerating produces a byte-identical file.
 *
 * It lives as a test so it typechecks, lints and runs on the existing toolchain rather than
 * needing a TypeScript runner of its own — and so the generator is verified, not just run.
 * The written file is build output (`seed/` is git-ignored); `npm run seed` regenerates it.
 */

const OUT_FILE = resolve(process.cwd(), 'seed', 'pocket-session-planner-seed.json');

/**
 * Tuesday evening, start of a summer term — and deliberately **in the past**.
 *
 * A fixed anchor keeps the output byte-identical between runs, which is worth more than
 * always-recent dates for a file that gets regenerated on demand. But it has to be a *past*
 * anchor: the first version of this used a date four days in the future, and the app duly
 * offered a session that had not happened yet as "Last session", with a whole term of history
 * sorting after the session the coach had just finished.
 *
 * If this drifts far enough from today to look odd, move it and regenerate.
 */
const TERM_START = isoDateTime('2026-05-05T18:00:00.000Z');

const ROSTER: Array<{ name: string; shirtNumber: number }> = [
  { name: 'Kai Roberts', shirtNumber: 7 },
  { name: 'Maya Okafor', shirtNumber: 10 },
  { name: 'Tom Searle', shirtNumber: 4 },
  { name: 'Ola Adeyemi', shirtNumber: 9 },
  { name: 'Rhys Llewellyn', shirtNumber: 1 },
  { name: 'Amara Diallo', shirtNumber: 6 },
  { name: 'Jonah Whitfield', shirtNumber: 2 },
  { name: 'Sofia Marchetti', shirtNumber: 8 },
  { name: 'Dev Patel', shirtNumber: 3 },
  { name: 'Callum Reid', shirtNumber: 5 },
  { name: 'Nia Bevan', shirtNumber: 11 },
  { name: 'Ezra Klein', shirtNumber: 12 },
];

/**
 * One session's worth of intent. Written as data so the shape of a term is legible here
 * rather than buried in a hundred lines of imperative setup.
 */
interface SessionPlan {
  readonly objectiveText: string;
  readonly objectiveTemplateId: string;
  readonly methodologyId: MethodologyId;
  /** Indexes into `ROSTER`. */
  readonly focus: readonly number[];
  readonly challenges: ReadonlyArray<{
    readonly player: number;
    readonly text: string;
    readonly target: number | null;
    /** Sightings to log, then the ruling the coach lands on. */
    readonly sightings: number;
    readonly ruling: 'met' | 'partly' | 'missed' | null;
  }>;
  /** `[playerIndex, tag, rating, moment]` — the observations the coach logged. */
  readonly observations: ReadonlyArray<
    readonly [number, string, 'good' | 'working' | 'struggled', ActionMoment | null]
  >;
  readonly interventions: number;
  readonly outcome: 'met' | 'partially_met' | 'not_met';
}

const TERM: readonly SessionPlan[] = [
  {
    objectiveText: 'Playing out from the back',
    objectiveTemplateId: 'playing-out-from-the-back',
    methodologyId: asMethodologyId('play-practice-play'),
    focus: [0, 4],
    challenges: [
      { player: 0, text: 'Three forward passes', target: 3, sightings: 3, ruling: null },
      { player: 4, text: 'Play to the free side', target: 2, sightings: 1, ruling: 'partly' },
    ],
    observations: [
      [0, 'Scanning', 'working', 'before'],
      [0, 'Passing & receiving', 'good', 'during'],
      [4, 'Positioning', 'good', 'before'],
      [4, 'Decision making', 'struggled', 'during'],
      [2, 'First touch', 'good', 'during'],
      [8, 'Communication', 'good', null],
      [0, 'Techniques', 'good', 'after'],
      [1, 'Movement', 'working', 'after'],
      [6, 'Composure under pressure', 'working', null],
      [3, 'Finishing', 'good', 'during'],
      [9, 'Timing', 'struggled', 'before'],
      [5, 'Teamwork', 'good', null],
    ],
    interventions: 3,
    outcome: 'partially_met',
  },
  {
    objectiveText: 'Pressing as a unit',
    objectiveTemplateId: 'pressing-as-a-unit',
    methodologyId: asMethodologyId('constraints-led'),
    focus: [2, 6],
    challenges: [
      { player: 2, text: 'Press on the poor touch', target: 4, sightings: 4, ruling: null },
      {
        player: 6,
        text: 'Stay switched on when we lose it',
        target: null,
        sightings: 0,
        ruling: 'met',
      },
    ],
    observations: [
      [2, 'Timing', 'good', 'before'],
      [2, 'Movement', 'good', 'during'],
      [6, 'Scanning', 'working', 'before'],
      [6, 'Determination', 'good', null],
      [1, 'Positioning', 'working', 'before'],
      [7, 'Deception', 'good', 'during'],
      [9, 'Speed', 'good', null],
      [0, 'Decision making', 'good', 'during'],
      [10, 'Endurance', 'working', null],
      [3, 'Timing', 'struggled', 'before'],
      [11, 'Leadership', 'good', null],
    ],
    interventions: 5,
    outcome: 'met',
  },
  {
    objectiveText: 'Creating and using width',
    objectiveTemplateId: 'creating-width',
    methodologyId: asMethodologyId('whole-part-whole'),
    focus: [1, 7],
    challenges: [
      { player: 1, text: 'Two crosses from the byline', target: 2, sightings: 1, ruling: 'partly' },
      {
        player: 7,
        text: 'Stay wide until the ball travels',
        target: 3,
        sightings: 3,
        ruling: null,
      },
    ],
    observations: [
      [1, 'Movement', 'good', 'after'],
      [1, 'Techniques', 'working', 'during'],
      [7, 'Positioning', 'good', 'before'],
      [7, 'Scanning', 'good', 'before'],
      [4, 'Passing & receiving', 'working', 'during'],
      [2, 'Deception', 'working', 'during'],
      [8, 'Agility', 'good', null],
      [5, 'Including others', 'good', null],
      [0, 'Timing', 'good', 'before'],
      [3, 'Finishing', 'struggled', 'during'],
    ],
    interventions: 2,
    outcome: 'met',
  },
];

async function buildSeed(): Promise<TransferEnvelope> {
  const clock = new FakeClock(TERM_START);
  const ctx: ServiceContext = {
    store: new FakeDataStore(),
    clock,
    // A distinctive prefix, so a seeded row is recognisable in a debugger.
    ids: new FakeIdGenerator('5eed'),
  };

  const squad = await createSquad(ctx, {
    name: 'U12 Reds',
    ageGroup: 'U12',
    defaultSessionDurationMin: 60,
  });

  const players: PlayerId[] = [];
  for (const entry of ROSTER) {
    players.push((await addPlayer(ctx, { squadId: squad.id, ...entry })).id);
  }
  const playerAt = (index: number): PlayerId => {
    const id = players[index];
    if (!id) throw new Error(`No seeded player at index ${index}`);
    return id;
  };

  for (const plan of TERM) {
    await runSession(ctx, clock, squad.id, playerAt, plan);
    // Next Tuesday.
    clock.advanceMinutes(60 * 24 * 7);
  }

  /*
   * A draft left ready to go, so an imported squad opens on something to do rather than on a
   * blank "New session" screen. Deliberately not started: the coach decides when that is.
   */
  unwrap(
    await startDraft(ctx, {
      squadId: squad.id,
      objectiveText: 'Scanning before receiving',
      objectiveTemplateId: 'scanning',
      methodologyId: asMethodologyId('guided-discovery'),
      focusPlayerIds: [playerAt(0), playerAt(9)],
    }),
  );

  // Two 4 Corner checks on Kai, three weeks apart, so the profile has a delta to show.
  unwrap(
    await recordAssessment(ctx, {
      playerId: playerAt(0),
      ratings: { technical_tactical: 3, physical: 3, psychological: 2, social: 4 },
      notes: { psychological: 'Goes quiet after a mistake.' },
      focusCorner: 'psychological',
    }),
  );
  clock.advanceMinutes(60 * 24 * 21);
  unwrap(
    await recordAssessment(ctx, {
      playerId: playerAt(0),
      ratings: { technical_tactical: 4, physical: 3, psychological: 4, social: 4 },
      focusCorner: 'technical_tactical',
    }),
  );

  // And two turning scans of the same player, for the same reason.
  unwrap(
    await recordScan(ctx, {
      playerId: playerAt(0),
      skill: 'turning',
      ratings: { scanning: 2, timing: 3, movement: 3, positioning: 3, techniques: 4 },
      notes: { scanning: 'Head down as the ball travels.' },
      focusCapability: 'scanning',
    }),
  );
  clock.advanceMinutes(60 * 24 * 14);
  unwrap(
    await recordScan(ctx, {
      playerId: playerAt(0),
      skill: 'turning',
      ratings: { scanning: 4, timing: 3, movement: 4, positioning: 3, deception: 2, techniques: 4 },
      focusCapability: 'deception',
    }),
  );
  unwrap(
    await recordScan(ctx, {
      playerId: playerAt(2),
      skill: 'pressing',
      ratings: { scanning: 3, timing: 4, movement: 4 },
      focusCapability: 'positioning',
    }),
  );

  return exportAll(ctx);
}

async function runSession(
  ctx: ServiceContext,
  clock: FakeClock,
  squadId: Awaited<ReturnType<typeof createSquad>>['id'],
  playerAt: (index: number) => PlayerId,
  plan: SessionPlan,
): Promise<SessionId> {
  const draft = unwrap(
    await startDraft(ctx, {
      squadId,
      objectiveText: plan.objectiveText,
      objectiveTemplateId: plan.objectiveTemplateId,
      methodologyId: plan.methodologyId,
      focusPlayerIds: plan.focus.map(playerAt),
    }),
  );

  const challengeIds = [];
  for (const challenge of plan.challenges) {
    const updated = unwrap(
      await addChallenge(ctx, draft.id, {
        playerId: playerAt(challenge.player),
        text: challenge.text,
        ...(challenge.target === null
          ? { measure: 'judged' as const }
          : { measure: 'count' as const, targetCount: challenge.target }),
      }),
    );
    const added = updated.challenges[updated.challenges.length - 1];
    if (!added) throw new Error('addChallenge returned no challenge');
    challengeIds.push(added.id);
  }

  const started = unwrap(await commitAndStart(ctx, draft.id));

  // Walk the session: observations and sightings spread across the phases, with the clock
  // moving so `phaseElapsedMs` and the timeline are believable rather than all at 00:00.
  for (const [index, observation] of plan.observations.entries()) {
    const [player, tag, rating, moment] = observation;
    clock.advanceMinutes(3);
    unwrap(
      await logObservation(ctx, {
        sessionId: started.id,
        playerId: playerAt(player),
        ratingKind: rating,
        tags: [tag],
        ...(moment !== null ? { actionMoment: moment } : {}),
      }),
    );

    // Advance a phase a third and two thirds of the way through.
    const third = Math.floor(plan.observations.length / 3);
    if (index === third || index === third * 2) {
      unwrap(await dispatch(ctx, started.id, { kind: 'nextPhase' }));
    }
  }

  for (const [index, challenge] of plan.challenges.entries()) {
    const id = challengeIds[index];
    if (!id) continue;
    for (let i = 0; i < challenge.sightings; i += 1) {
      clock.advanceMinutes(2);
      unwrap(await logChallengeProgress(ctx, started.id, id));
    }
    if (challenge.ruling !== null) {
      unwrap(await setChallengeStatus(ctx, started.id, id, challenge.ruling));
    }
  }

  for (let i = 0; i < plan.interventions; i += 1) {
    clock.advanceMinutes(2);
    unwrap(await logIntervention(ctx, started.id));
  }

  clock.advanceMinutes(10);
  const finished = unwrap(await dispatch(ctx, started.id, { kind: 'finish' }));

  // Review it, accepting the proposals the app pre-ticks — which is what a coach does.
  const draftReview = {
    ...unwrapReviewShape(finished.id, squadId),
    objectiveOutcome: plan.outcome,
  };
  const proposals = unwrap(await proposeCarryForward(ctx, finished.id, draftReview));

  unwrap(
    await saveReview(ctx, {
      sessionId: finished.id,
      objectiveOutcome: plan.outcome,
      sessionRating: plan.outcome === 'met' ? 4 : 3,
      focusPlayerReviews: plan.focus.map((index) => ({
        playerId: playerAt(index),
        progress: plan.outcome === 'met' ? ('progressed' as const) : ('no_change' as const),
        nextStep: '',
        note: '',
      })),
      // The takeaway, so the read-back at the start of the next session has something to
      // show in seeded data — it is silent when absent, which looks identical to broken.
      takeaway: `Remember: ${plan.objectiveText.toLowerCase()}`,
      acceptedProposals: proposals.filter((proposal) => proposal.defaultSelected),
    }),
  );

  return finished.id;
}

/**
 * The minimum review a proposal derivation needs. `proposeCarryForward` reads the review the
 * coach is part-way through filling in, which does not exist as a record yet.
 */
function unwrapReviewShape(
  sessionId: SessionId,
  squadId: Awaited<ReturnType<typeof createSquad>>['id'],
) {
  return {
    schemaVersion: 1 as const,
    createdAt: TERM_START,
    updatedAt: TERM_START,
    id: '5eed0000-0000-4000-8000-00000000ffff' as never,
    sessionId,
    squadId,
    completedAt: TERM_START,
    metCriteria: [] as number[],
    sessionRating: null,
    interventionMatchedPlan: null,
    phaseReviews: [],
    focusPlayerReviews: [],
    seededActionOutcomes: [],
    whatWorked: [] as string[],
    whatDidnt: [] as string[],
    takeaway: '',
    note: '',
  };
}

describe('seed data', () => {
  it('generates a term of data the app can import', async () => {
    const envelope = await buildSeed();

    // Enough of everything for every report to have something to say.
    expect(envelope.counts.squads).toBe(1);
    expect(envelope.counts.players).toBe(ROSTER.length);
    // Three played sessions plus the draft left ready.
    expect(envelope.counts.sessions).toBe(TERM.length + 1);
    expect(envelope.counts.reviews).toBe(TERM.length);
    expect(envelope.counts.observations).toBe(
      TERM.reduce((total, plan) => total + plan.observations.length, 0),
    );
    expect(envelope.counts.assessments).toBe(2);
    expect(envelope.counts.scans).toBe(3);
    expect(envelope.counts.actions).toBeGreaterThan(0);

    // **It has to import.** A seed file the app rejects is worse than no seed file, and this
    // runs the real two-step import against a fresh store.
    const target: ServiceContext = {
      store: new FakeDataStore(),
      clock: new FakeClock(TERM_START),
      ids: new FakeIdGenerator('aaaa'),
    };
    const plan = unwrap(await planImport(target, JSON.parse(JSON.stringify(envelope)), 'merge'));
    expect(plan.dropped).toEqual([]);

    const report = unwrap(await commitImport(target, plan));
    expect(report.written.sessions).toBe(TERM.length + 1);
    expect(report.written.scans).toBe(3);
    expect(report.dropped).toEqual([]);

    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    // The name the app itself would give the file, so it looks like a real export.
    expect(exportFilename('U12 Reds', envelope.exportedAt)).toMatch(/^psp-u12-reds-/);
  });
});
