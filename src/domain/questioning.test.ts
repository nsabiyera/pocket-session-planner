import { describe, expect, it } from 'vitest';
import {
  describeQuestioning,
  describeQuestioningEvidence,
  hasEnoughForQuestioning,
  MIN_QUESTIONS_FOR_REPORT,
  questioningSummary,
} from './questioning';
import { asInterventionEventId } from './ids';
import { phaseId, playerId, T0 } from '@/test/builders';
import type { InterventionEvent, InterventionMethod } from './intervention';

const ROSTER = ['kai', 'maya', 'sam', 'jo'].map((label) => playerId(label));

let nextId = 0;
const anEvent = (over: Partial<InterventionEvent> = {}): InterventionEvent => ({
  id: asInterventionEventId(
    `00000000-0000-4000-8000-0000000000${(nextId++).toString(16).padStart(2, '0')}`,
  ),
  phaseId: phaseId('practice'),
  at: T0,
  phaseElapsedMs: 0,
  method: 'question_and_answer',
  mechanic: 'in_flow',
  audience: 'team',
  durationMs: 0,
  playerIds: [],
  coachingPointId: null,
  overBudget: false,
  styleChosen: false,
  ...over,
});

const question = (players: string[] = [], styleChosen = true) =>
  anEvent({ playerIds: players.map((label) => playerId(label)), styleChosen });

const summaryOf = (events: readonly InterventionEvent[]) =>
  questioningSummary({ events, rosterIds: ROSTER });

describe('counting questions', () => {
  it('counts only the interventions whose method was Q&A', () => {
    const methods: InterventionMethod[] = ['command', 'guided_discovery', 'trial_and_error'];
    const summary = summaryOf([
      question(),
      question(),
      ...methods.map((method) => anEvent({ method })),
    ]);
    expect(summary.questions).toBe(2);
  });

  it('separates the ones the coach picked from the ones the plan supplied', () => {
    const summary = summaryOf([question([], true), question([], false), question([], false)]);
    expect(summary.chosen).toBe(1);
  });

  it('counts distinct players named, not mentions', () => {
    const summary = summaryOf([question(['kai']), question(['kai', 'maya']), question(['kai'])]);
    expect(summary.attributed).toBe(3);
    expect(summary.playersNamed).toBe(2);
    expect(summary.neverNamed).toEqual([playerId('sam'), playerId('jo')]);
  });

  it('reports the roster order for who was never named', () => {
    // Same order as given, so the sentence reads the same way twice running.
    const summary = summaryOf([question(['maya'])]);
    expect(summary.neverNamed).toEqual([playerId('kai'), playerId('sam'), playerId('jo')]);
  });
});

describe('the three ways the spread can be reported', () => {
  it('states it plainly when every question names somebody', () => {
    const summary = summaryOf([question(['kai']), question(['maya']), question(['kai', 'maya'])]);
    expect(summary.fullyAttributed).toBe(true);
    expect(describeQuestioning(summary)).toBe(
      '3 questions, to 2 players. 2 players were never asked anything.',
    );
  });

  it('drops the never-asked clause when the whole squad was asked', () => {
    const summary = summaryOf(
      ROSTER.map((_, index) => question([['kai', 'maya', 'sam', 'jo'][index]!])),
    );
    expect(describeQuestioning(summary)).toBe('4 questions, to 4 players.');
  });

  it('says only what it recorded when some questions name nobody', () => {
    const summary = summaryOf([question(['kai']), question(), question()]);
    expect(summary.fullyAttributed).toBe(false);
    expect(describeQuestioning(summary)).toBe(
      '3 questions logged. You named who 1 of them went to — 1 player.',
    );
    // The crucial omission: on this record "never named" and "never asked" are different
    // things, and only one of them is a fact.
    expect(describeQuestioning(summary)).not.toMatch(/never asked/);
  });

  it('offers the control rather than a number when nothing names anybody', () => {
    const summary = summaryOf([question(), question(), question(), question()]);
    const line = describeQuestioning(summary);
    expect(line).toMatch(/nobody recorded against them/);
    expect(line).toMatch(/tap and hold/);
    // And no spread at all, invented or otherwise.
    expect(line).not.toMatch(/\d+ players?\./);
  });

  it('gets the singulars right, because a coach reads this line', () => {
    const summary = summaryOf([question(['kai'])]);
    expect(describeQuestioning(summary)).toBe(
      '1 question, to 1 player. 3 players were never asked anything.',
    );
  });
});

describe('the evidence qualifier', () => {
  it('says nothing when every question was a deliberate choice', () => {
    expect(describeQuestioningEvidence(summaryOf([question([], true)]))).toBeNull();
  });

  it('splits chosen from inherited', () => {
    const summary = summaryOf([question([], true), question([], false), question([], false)]);
    expect(describeQuestioningEvidence(summary)).toBe(
      '1 of 3 were a question you chose in the moment; the other 2 came from your plan.',
    );
  });

  it('says the count is the plan when nothing was chosen', () => {
    const summary = summaryOf([question([], false), question([], false)]);
    const line = describeQuestioningEvidence(summary)!;
    expect(line).toMatch(/what you meant to do rather than what you did/);
  });

  it('has nothing to qualify when there were no questions', () => {
    expect(describeQuestioningEvidence(summaryOf([]))).toBeNull();
  });
});

describe('the floor', () => {
  it('stays silent below four questions', () => {
    for (let count = 0; count < MIN_QUESTIONS_FOR_REPORT; count += 1) {
      const events = Array.from({ length: count }, () => question(['kai']));
      expect(hasEnoughForQuestioning(summaryOf(events)), `${count} questions`).toBe(false);
    }
  });

  it('speaks at four', () => {
    const events = Array.from({ length: MIN_QUESTIONS_FOR_REPORT }, () => question(['kai']));
    expect(hasEnoughForQuestioning(summaryOf(events))).toBe(true);
  });
});

describe('what it refuses to say', () => {
  it('never sets a target or suggests asking more', () => {
    const lines = [
      describeQuestioning(summaryOf([question(['kai']), question(), question(), question()])),
      describeQuestioning(summaryOf([question(['kai']), question(['maya'])])),
      describeQuestioning(summaryOf([question(), question()])),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/should|try to|aim for|too few|not enough|%/i);
    }
  });

  it('never claims anything about understanding', () => {
    // Q&A is one of five pillars, not the good one, and a question is not a measurement.
    const line = describeQuestioning(summaryOf([question(['kai']), question(['maya'])]));
    expect(line).not.toMatch(/understood|understand|comprehen|learn/i);
  });
});
