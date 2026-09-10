import type { InterventionEvent } from './intervention';
import type { PlayerId } from './ids';

/**
 * **The questioning record** — the app's own logged questions, read as questioning.
 *
 * `InterventionEvent` has always carried `method: 'question_and_answer'` and a `playerIds`
 * list. Nothing has ever read either as a fact about questioning, which in game-centred
 * coaching is the mechanism by which understanding is both developed *and* revealed. The FA's
 * Five Pillars name it; the app logged it and looked at it exactly never.
 *
 * ---
 *
 * **Two measurement problems, and the wording answers both.**
 *
 * 1. **A pre-filled method is not evidence.** `✋ Intervene` is one tap and takes `method`
 *    straight from the phase plan, so a naive question count is the coach's own plan read back
 *    to them wearing the clothes of an observation. `styleChosen` separates the two and this
 *    module never adds them together — the same split `describeStyleEvidence` already makes.
 * 2. **Naming who you asked is optional, so silence is not absence.** The roadmap wanted
 *    *"seven players were never asked anything"*. That sentence is only true when the coach
 *    named somebody on **every** question; below that it is a claim about the record dressed
 *    up as a claim about the session. So the spread is reported three ways:
 *
 *    | What the record holds | What the app says |
 *    | --- | --- |
 *    | Every question names somebody | *"…to 4 players. Seven were never asked."* |
 *    | Some do | *"You named who 5 of the 12 went to."* — and nothing about the rest |
 *    | None do | The count, and how to record it next time |
 *
 * **No target and no ranking.** There is no correct number of questions and the app never
 * suggests one — Q&A is one of five pillars, not the good one. Same discipline as
 * `coaching-style.ts` and `practice/mix.ts`.
 */

/**
 * Below this the report stays quiet.
 *
 * Four questions is roughly a coach who questioned at all rather than one who happened to have
 * `question_and_answer` sitting in a phase plan. Naming somebody's questioning habit off one
 * pre-filled tap is how a coach learns to ignore the app — the reasoning behind
 * `MIN_INTERVENTIONS_FOR_STYLE`, at session scale.
 */
export const MIN_QUESTIONS_FOR_REPORT = 4;

export interface QuestioningSummary {
  /** Every logged intervention whose method was Q&A. */
  readonly questions: number;
  /** Of those, the ones where the coach picked the method in the moment. */
  readonly chosen: number;
  /** Questions that name at least one player. */
  readonly attributed: number;
  /** Distinct players named across all of them. */
  readonly playersNamed: number;
  /**
   * Squad members never named on any question — **only meaningful when every question names
   * somebody**, which is what `fullyAttributed` reports. Ordered as the roster was given.
   */
  readonly neverNamed: readonly PlayerId[];
  /** True when every question records who it went to, so the spread can be stated plainly. */
  readonly fullyAttributed: boolean;
}

export interface QuestioningInput {
  readonly events: readonly InterventionEvent[];
  /** The squad, in roster order. The spread is meaningless without knowing who was there. */
  readonly rosterIds: readonly PlayerId[];
}

export function questioningSummary(input: QuestioningInput): QuestioningSummary {
  const questions = input.events.filter((event) => event.method === 'question_and_answer');

  const named = new Set<PlayerId>();
  let attributed = 0;
  let chosen = 0;

  for (const question of questions) {
    if (question.styleChosen) chosen += 1;
    if (question.playerIds.length === 0) continue;
    attributed += 1;
    for (const playerId of question.playerIds) named.add(playerId);
  }

  return {
    questions: questions.length,
    chosen,
    attributed,
    playersNamed: named.size,
    neverNamed: input.rosterIds.filter((playerId) => !named.has(playerId)),
    // Vacuously true for no questions at all, which `hasEnoughForQuestioning` filters out
    // before any sentence gets built from it.
    fullyAttributed: attributed === questions.length,
  };
}

export const hasEnoughForQuestioning = (summary: QuestioningSummary): boolean =>
  summary.questions >= MIN_QUESTIONS_FOR_REPORT;

/**
 * *"12 questions this session, to 4 players."*
 *
 * The count, then the spread as far as the record supports it. Never a target, never a
 * suggestion to ask more — a coach running a silent conditioned game on purpose has done
 * nothing wrong, and the app is in no position to know which it was.
 */
export function describeQuestioning(summary: QuestioningSummary): string {
  const count = `${summary.questions} question${summary.questions === 1 ? '' : 's'}`;

  if (summary.attributed === 0) {
    // Nothing to say about spread, so say what is missing and how to have it. The same shape
    // `describeStyleEvidence` uses for the axis nobody overrode.
    return `${count} logged, with nobody recorded against them — tap and hold ✋ Intervene to name who you asked.`;
  }

  if (!summary.fullyAttributed) {
    // Partial. Deliberately silent about the players who were never named: on this record
    // "never named" and "never asked" are different things, and only one of them is a fact.
    return `${count} logged. You named who ${summary.attributed} of them went to — ${summary.playersNamed} player${
      summary.playersNamed === 1 ? '' : 's'
    }.`;
  }

  const spread = `${count}, to ${summary.playersNamed} player${summary.playersNamed === 1 ? '' : 's'}.`;
  if (summary.neverNamed.length === 0) return spread;

  return `${spread} ${summary.neverNamed.length} player${
    summary.neverNamed.length === 1 ? ' was' : 's were'
  } never asked anything.`;
}

/**
 * *"9 of 12 were a question you chose in the moment; the other 3 came from your plan."*
 *
 * The sentence that stops the line above being the plan read back as evidence. Null when every
 * question was a deliberate choice, which is the one case needing no qualification.
 */
export function describeQuestioningEvidence(summary: QuestioningSummary): string | null {
  if (summary.questions === 0) return null;

  const inherited = summary.questions - summary.chosen;
  if (inherited === 0) return null;

  if (summary.chosen === 0) {
    return 'Every one of these took Q&A from your phase plan, so they show what you meant to do rather than what you did.';
  }

  return `${summary.chosen} of ${summary.questions} were a question you chose in the moment; the other ${inherited} came from your plan.`;
}
