import {
  INTERVENTION_METHODS,
  interventionMechanicLabel,
  interventionMethodLabel,
  type InterventionAudience,
  type InterventionMechanic,
  type InterventionEvent,
  type InterventionMethod,
} from './intervention';

/**
 * **How you coach** — the coach's own style, across a term rather than a session.
 *
 * Everything else in this app mirrors one Tuesday back at the coach. This is the same data
 * asked a longer question: *what do I do, week after week, without noticing?* The FA's Five
 * Pillars are a repertoire, and the useful thing a coach cannot see from inside the habit is
 * which one they reach for every single time.
 *
 * ---
 *
 * **The measurement problem, stated up front, because it decides what this may claim.**
 *
 * `✋ Intervene` is one tap and pre-fills method, mechanic and audience from the phase plan —
 * which is exactly right for logging under time pressure, and useless as evidence. A style
 * mix built from those events is the coach's own *plan* read back to them wearing the clothes
 * of an observation.
 *
 * So `InterventionEvent.styleChosen` separates the two, and every sentence here is scoped to
 * what it can actually support:
 *
 * - **Ball rolling time is measured.** It comes from real clock stops, so it is stated flatly.
 * - **The style mix is split.** Chosen events are reported as what the coach did; the rest are
 *   reported as what they planned, and the two are never silently added together.
 * - **There is no correct style.** The Five Pillars are five tools, not a ranking, and this
 *   module never suggests reaching for a different one. Same discipline as `practice/mix.ts`.
 */

export interface CoachingStyle {
  readonly sessions: number;
  readonly interventions: number;
  /** Events where the coach set the style in the moment rather than taking the plan's. */
  readonly chosen: number;
  readonly countByMethod: Record<InterventionMethod, number>;
  readonly countByMechanic: Partial<Record<InterventionMechanic, number>>;
  readonly countByAudience: Record<InterventionAudience, number>;
  /** Methods never once used. Named, never recommended. */
  readonly untouchedMethods: InterventionMethod[];
  /** A method holding more than half of everything logged, if there is one. */
  readonly dominantMethod: InterventionMethod | null;
  readonly dominantMechanic: InterventionMechanic | null;
  /** Measured, not estimated — the share of phase time the ball was actually rolling. */
  readonly ballRollingRatio: number;
  /** Interventions per session, to one decimal. */
  readonly perSession: number;
}

/** More than half of everything logged is a habit worth showing a coach. */
const DOMINANT_THRESHOLD = 0.5;

/**
 * Below this the report stays quiet.
 *
 * Twelve interventions is roughly three sessions of a coach who intervenes at all. Naming
 * somebody's coaching style off one wet Tuesday is how a coach learns to ignore the app.
 */
export const MIN_INTERVENTIONS_FOR_STYLE = 12;

export interface CoachingStyleInput {
  readonly sessions: number;
  readonly events: readonly InterventionEvent[];
  /** Summed across the term, from the same measured clock ball-rolling time already uses. */
  readonly ballRollingMs: number;
  readonly elapsedMs: number;
}

export function coachingStyle(input: CoachingStyleInput): CoachingStyle {
  const countByMethod: Record<InterventionMethod, number> = {
    command: 0,
    question_and_answer: 0,
    observation_feedback: 0,
    guided_discovery: 0,
    trial_and_error: 0,
  };
  const countByAudience: Record<InterventionAudience, number> = {
    individual: 0,
    unit: 0,
    team: 0,
  };
  const countByMechanic: Partial<Record<InterventionMechanic, number>> = {};

  let chosen = 0;
  for (const event of input.events) {
    countByMethod[event.method] += 1;
    countByAudience[event.audience] += 1;
    countByMechanic[event.mechanic] = (countByMechanic[event.mechanic] ?? 0) + 1;
    if (event.styleChosen) chosen += 1;
  }

  const total = input.events.length;
  const dominantOf = <T extends string>(counts: Partial<Record<T, number>>, keys: readonly T[]) =>
    keys.find((key) => total > 0 && (counts[key] ?? 0) / total > DOMINANT_THRESHOLD) ?? null;

  const mechanics = Object.keys(countByMechanic) as InterventionMechanic[];

  return {
    sessions: input.sessions,
    interventions: total,
    chosen,
    countByMethod,
    countByMechanic,
    countByAudience,
    untouchedMethods: INTERVENTION_METHODS.filter((method) => countByMethod[method] === 0),
    dominantMethod: dominantOf(countByMethod, INTERVENTION_METHODS),
    dominantMechanic: dominantOf(countByMechanic, mechanics),
    ballRollingRatio: input.elapsedMs === 0 ? 1 : input.ballRollingMs / input.elapsedMs,
    perSession: input.sessions === 0 ? 0 : total / input.sessions,
  };
}

export const hasEnoughForStyle = (style: CoachingStyle): boolean =>
  style.interventions >= MIN_INTERVENTIONS_FOR_STYLE;

/**
 * *"48 interventions across 8 sessions — 6.0 a session. Mostly Command, mostly in the flow.
 * Nothing on guided discovery or trial & error. Ball rolling time 74%."*
 *
 * Counts and one measured percentage. No target, no grade, no suggestion to try another
 * pillar — the FA teaches five tools, not a ranking, and which one a session needed is a
 * judgement the app is in no position to make.
 */
export function describeCoachingStyle(style: CoachingStyle): string {
  if (style.interventions === 0) {
    return style.sessions === 0
      ? 'No sessions to look at yet.'
      : `${style.sessions} session${style.sessions === 1 ? '' : 's'}, and you never stopped to coach. That is a style too.`;
  }

  const parts = [
    `${style.interventions} intervention${style.interventions === 1 ? '' : 's'} across ${style.sessions} session${style.sessions === 1 ? '' : 's'} — ${style.perSession.toFixed(1)} a session.`,
  ];

  const habits: string[] = [];
  if (style.dominantMethod) habits.push(`mostly ${interventionMethodLabel(style.dominantMethod)}`);
  if (style.dominantMechanic) {
    habits.push(`mostly ${interventionMechanicLabel(style.dominantMechanic).toLowerCase()}`);
  }
  if (habits.length > 0) {
    parts.push(`${habits.join(', ').replace(/^m/, 'M')}.`);
  }

  // Name the pillars that never came up. An observation about the term, not a gap to fill.
  if (
    style.untouchedMethods.length > 0 &&
    style.untouchedMethods.length < INTERVENTION_METHODS.length
  ) {
    const names = style.untouchedMethods.map((method) => interventionMethodLabel(method));
    parts.push(`Nothing on ${listWords(names)}.`);
  }

  parts.push(`Ball rolling time ${Math.round(style.ballRollingRatio * 100)}%.`);
  return parts.join(' ');
}

/**
 * *"9 of 48 were a style you picked in the moment; the other 39 followed your plan."*
 *
 * The sentence that stops the line above being a lie. Returns null only when every event was
 * chosen, which is the one case where the mix needs no qualifying.
 */
export function describeStyleEvidence(style: CoachingStyle): string | null {
  if (style.interventions === 0) return null;

  const inherited = style.interventions - style.chosen;
  if (inherited === 0) return null;

  if (style.chosen === 0) {
    return `Every one of these took the style from your plan — tap and hold ✋ Intervene to record what you actually did instead.`;
  }

  return `${style.chosen} of ${style.interventions} were a style you picked in the moment; the other ${inherited} followed your plan.`;
}

/** `a, b or c` — the same joining every other report line uses. */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}
