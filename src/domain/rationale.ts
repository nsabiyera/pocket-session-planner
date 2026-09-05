/**
 * **Why am I seeing this?**
 *
 * The app makes a couple of dozen judgements at the coach — corner bias, ball rolling time, a
 * point that has run for three sessions — and every one of them shipped as a bare one-liner.
 * A coach who disagreed with a number, or who simply wanted to learn, had nowhere to go.
 * `CarryForwardProposal.trigger` was written for exactly this affordance ("for tests and for
 * the 'why am I seeing this' affordance"); this is the other half of it.
 *
 * Three rules hold the text below honest, and they matter more than the wording:
 *
 * 1. **Describe the app's own reasoning, not the literature.** Every entry says what this app
 *    actually did with the coach's data. Where a threshold is ours rather than the FA's, it
 *    says so — the 70% ball-rolling target is the clearest case.
 * 2. **FA vocabulary yes, academic jargon no.** "4 Corner Model" is a phrase the coach met on
 *    their course. "Contextual interference" is not, and never appears.
 * 3. **Say what the data cannot support.** Same precedent as *"Deception isn't taggable
 *    yet."* — the app is better off naming a blind spot than papering over it.
 *
 * Nothing here is persisted, so there is no schema and no migration. It is a lookup table of
 * prose, keyed by strings the rest of the app already produces.
 */

/** Long enough for two sentences, short enough to read on a wet phone between drills. */
export const MAX_RATIONALE_WHY = 240;

export interface Rationale {
  readonly id: RationaleId;
  /** The framework this judgement comes from, shown as the disclosure's eyebrow. */
  readonly framework: string;
  /** Plain English, no jargon, at most {@link MAX_RATIONALE_WHY} characters. */
  readonly why: string;
  /** For the curious. Optional, because some entries are the app's own reasoning only. */
  readonly source?: string;
}

const FOUR_CORNERS = 'FA 4 Corner Model';
const CAPABILITIES = 'FA six core capabilities';
const COACH_BEHAVIOUR = 'Coach behaviour';
const INTENDED_OUTCOMES = 'Intended outcomes';
const PRACTICE_DESIGN = 'Practice design';
const CHALLENGE_POINT = 'Challenge Point';
const PRACTICE_SPECTRUM = 'FA practice spectrum';
const STEP = 'STEP';
const PLAYER_ENGAGEMENT = 'Player engagement';

const FOUR_CORNER_SOURCE =
  'https://learn.englandfootball.com/articles-and-resources/coaching/resources/2023/What-is-the-4-Corner-Model';
const CAPABILITIES_SOURCE =
  'https://learn.englandfootball.com/articles-and-resources/coaching/resources/2023/What-are-The-FAs-six-core-capabilities';
const PLANNING_MODEL_SOURCE =
  'https://learn.englandfootball.com/articles-and-resources/coaching/resources/2025/The-coach-planning-and-reflective-model';
const CHALLENGE_POINT_SOURCE = 'https://en.wikipedia.org/wiki/Challenge_point_framework';
const PRACTICE_DESIGN_SOURCE =
  'https://learn.englandfootball.com/articles-and-resources/coaching/resources/2024/How-to-design-football-practices';
const MIXED_PRACTICE_SOURCE =
  'https://www.sciencedirect.com/science/article/abs/pii/S1747938X23000301';
const REPRESENTATIVE_DESIGN_SOURCE = 'https://journals.sagepub.com/doi/10.1177/17479541221138680';
const FIVE_PILLARS_SOURCE =
  'https://learn.englandfootball.com/articles-and-resources/coaching/resources/2023/The-five-pillars-of-coaching';
const AUTONOMY_SOURCE = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8394926/';
const STEP_SOURCE =
  'https://learn.englandfootball.com/articles-and-resources/coaching/resources/2022/make-coaching-personal-with-the-step-framework';

/**
 * The registry.
 *
 * The first block is keyed by the `trigger` strings `deriveCarryForwardProposals` already
 * produces, verbatim — which is why a carry-forward chip needs no new plumbing to know which
 * explanation belongs to it. The `report:` block covers the lines the app derives and asserts
 * on its own; those have no trigger, because nothing proposes them.
 */
const RATIONALES = {
  // ---------------------------------------------------- carry-forward triggers
  'objective:unmet': {
    framework: INTENDED_OUTCOMES,
    why: 'You said the objective was not fully met, so it comes back carrying only the criteria you did not tick. Carrying the met ones too would make next week look like no progress at all.',
    source: PLANNING_MODEL_SOURCE,
  },
  'objective:met': {
    framework: INTENDED_OUTCOMES,
    why: 'You met it, so this is offered as a progression rather than a repeat. It arrives unticked on purpose: a met objective often means it is time to move on to something else entirely.',
    source: PLANNING_MODEL_SOURCE,
  },
  'focus-player:no-progress': {
    framework: INTENDED_OUTCOMES,
    why: 'You marked this player as no change or went back. One session is not a verdict, so the app keeps them in focus next week rather than drawing any conclusion about them.',
  },
  'focus-player:next-step': {
    framework: INTENDED_OUTCOMES,
    why: 'You typed a next step for this player. This only moves it into next session, filed against the kind of phase where most of their observations actually happened.',
  },
  'observation:struggled': {
    framework: FOUR_CORNERS,
    why: 'You rated a development note 1 or 2 for a named player. The app has no view on whether they struggled — it is handing back what you logged, as a coaching point for next time.',
    source: FOUR_CORNER_SOURCE,
  },
  'intervention:ball-rolling': {
    framework: COACH_BEHAVIOUR,
    why: 'Ball rolling time came in under 70%, or a phase went past its intervention budget. 70% is this app’s working target rather than an FA standard, so read it as a mirror, not a pass mark.',
    source: PLANNING_MODEL_SOURCE,
  },
  'intervention:unused-plan': {
    framework: COACH_BEHAVIOUR,
    why: 'You planned to coach in a command style and then never stopped play. Worth a look either way: the plan may have been wrong, or the session may have been. Offered unticked.',
    source: PLANNING_MODEL_SOURCE,
  },
  'four-corners:neglected': {
    framework: FOUR_CORNERS,
    why: 'Across the whole term one corner of this player has far fewer observations than the rest. The gap is in your notes, not necessarily in the player — the app only sees what you tagged.',
    source: FOUR_CORNER_SOURCE,
  },
  'phase:run-again': {
    framework: PRACTICE_DESIGN,
    why: 'You said you would run this phase again, or you rated it 1 or 2 and it did not go as planned. It comes forward as a frozen copy with its coaching points reset to undelivered.',
    source: PLANNING_MODEL_SOURCE,
  },
  'coaching-point:undelivered': {
    framework: PRACTICE_DESIGN,
    why: 'This point was planned and never marked delivered. It may simply not have been needed on the night, which is why it is low priority and arrives unticked.',
    source: PLANNING_MODEL_SOURCE,
  },
  'review:what-didnt': {
    framework: INTENDED_OUTCOMES,
    why: 'Straight from what you typed under "What didn’t". The app is not interpreting it — it is keeping it somewhere you will meet it again while planning next week.',
    source: PLANNING_MODEL_SOURCE,
  },

  // ------------------------------------------------------ derived report lines
  'report:challenge-summary': {
    framework: CHALLENGE_POINT,
    why: 'How the challenges you set were settled. Counted sightings and your verdicts stay separate: a tally that reached its target is not the same as you saying the player met it.',
    source: CHALLENGE_POINT_SOURCE,
  },
  'report:intervention': {
    framework: COACH_BEHAVIOUR,
    why: 'Ball rolling time is the share of each phase’s clock that was not inside one of your interventions. It is measured from when you tapped, not estimated, so it is as good as your tapping.',
    source: PLANNING_MODEL_SOURCE,
  },
  'report:corner-coverage': {
    framework: FOUR_CORNERS,
    why: 'Which corners you looked at this session, taken from the tags on your observations. It describes your attention, not the players: an empty corner means you did not tag one.',
    source: FOUR_CORNER_SOURCE,
  },
  'report:capability-coverage': {
    framework: CAPABILITIES,
    why: 'Which of the FA’s six your observations map onto. The FA publishes the six, not a crosswalk to this app’s attribute list — that mapping is ours, and deliberately sparse.',
    source: CAPABILITIES_SOURCE,
  },
  'report:moment-coverage': {
    framework: CAPABILITIES,
    why: 'Whether you were watching before, as, or after the player received the ball. Only observations where you set the moment count, and setting it is optional — so an empty view is a choice.',
    source: CAPABILITIES_SOURCE,
  },
  'report:corner-balance': {
    framework: FOUR_CORNERS,
    why: 'Four bars across everything logged for this player, all term. Evenness is a spread score and not a grade: the FA sets no target for it, and a lopsided term may be exactly right.',
    source: FOUR_CORNER_SOURCE,
  },
  'report:neglected-corner': {
    framework: FOUR_CORNERS,
    why: 'Held back until eight tagged observations, so "you never look at social" is never said off the back of three notes. It is simply the corner with the least in it, offered as somewhere to look.',
    source: FOUR_CORNER_SOURCE,
  },
  'report:practice-spectrum': {
    framework: PRACTICE_SPECTRUM,
    why: 'The FA’s four practice types, from no defender at all to the full game. Your methodology already answered it for this phase — change it if the practice you actually ran was different.',
    source: PRACTICE_DESIGN_SOURCE,
  },
  'report:relative-playing-area': {
    framework: PRACTICE_SPECTRUM,
    why: 'Area ÷ players, in metres. No "small" or "large" attached: the FA publishes no figures and the research disagrees with itself by a factor of three, so the number is yours to judge.',
    source: PRACTICE_DESIGN_SOURCE,
  },
  'report:session-shape': {
    framework: PRACTICE_SPECTRUM,
    why: 'Your practices in order, from least to most game-like. It describes the shape and stops — there is no right one, and a technical block after the game can be exactly the point.',
    source: PRACTICE_DESIGN_SOURCE,
  },
  'report:practice-adjustments': {
    framework: CHALLENGE_POINT,
    why: 'How often you made the practice harder or easier, and how many of the changes you wrote down went unused. A count, not a target — there is no right number of adjustments.',
    source: CHALLENGE_POINT_SOURCE,
  },
  'challenge:pitched-wrong': {
    framework: CHALLENGE_POINT,
    why: 'The same ask has been set and missed three sessions running. That is usually evidence about the difficulty of the ask rather than about the player — so this offers to change it.',
    source: CHALLENGE_POINT_SOURCE,
  },
  'report:step-coverage': {
    framework: STEP,
    why: 'Which of the FA\u2019s four levers you actually pulled. Most coaches reach for the same one every week and cannot see it from inside the habit \u2014 STEP is four places to look, not four boxes to tick.',
    source: STEP_SOURCE,
  },
  'report:practice-mix': {
    framework: PRACTICE_SPECTRUM,
    why: 'A count of what you have run lately, and nothing more. The case for varying practice is genuinely contested in sport \u2014 a 2023 review of the evidence calls the benefit a myth \u2014 so this suggests nothing.',
    source: MIXED_PRACTICE_SOURCE,
  },
  'report:player-choice': {
    framework: PLAYER_ENGAGEMENT,
    why: 'A count of the phases where you ticked that the players decided something. It records what you offered, not how the session felt to play in \u2014 the app cannot see that, and does not guess.',
    source: AUTONOMY_SOURCE,
  },
  'report:representativeness': {
    framework: PRACTICE_SPECTRUM,
    why: 'Your last practice next to an FA match at this age. The pitch sizes are the FA\u2019s; which age plays which format varies by league, so the format is printed \u2014 check it matches yours.',
    source: REPRESENTATIVE_DESIGN_SOURCE,
  },
  'report:reflection': {
    framework: PRACTICE_SPECTRUM,
    why: 'The FA\u2019s three-word prompt for looking back at a practice. Questions rather than scores: the app can count metres and players, but not whether the session mattered to the players in it.',
    source: PRACTICE_DESIGN_SOURCE,
  },
  'report:coaching-style': {
    framework: COACH_BEHAVIOUR,
    why: 'What you did across the term, not one night. The five methods are five tools rather than a ranking, so this counts them and stops \u2014 there is no style the app is steering you towards.',
    source: FIVE_PILLARS_SOURCE,
  },
  'report:style-evidence': {
    framework: COACH_BEHAVIOUR,
    why: 'One tap on Intervene takes the style straight from your plan, so those events show what you meant to do. Only a tap-and-hold records what you actually chose \u2014 hence the split.',
    source: PLANNING_MODEL_SOURCE,
  },
  'carry-forward:chain-stuck': {
    framework: CHALLENGE_POINT,
    why: 'This point has come forward three sessions running. When something will not stick, the practice around it is a likelier cause than the words — so change the task, not the point.',
    source: CHALLENGE_POINT_SOURCE,
  },
} as const satisfies Record<string, Omit<Rationale, 'id'>>;

export type RationaleId = keyof typeof RATIONALES;

export const RATIONALE_IDS = Object.keys(RATIONALES) as readonly RationaleId[];

export function rationaleFor(id: RationaleId): Rationale {
  return { id, ...RATIONALES[id] };
}

/**
 * The same lookup for a string that is only *probably* an id. `CarryForwardProposal.trigger`
 * is a `z.string()`, and an action stored by an older build can carry a trigger this registry
 * has never heard of. Missing means the `?` is simply not rendered, which is the right
 * failure: a disclosure with nothing behind it is worse than no disclosure at all.
 */
export function findRationale(id: string): Rationale | null {
  return Object.hasOwn(RATIONALES, id) ? rationaleFor(id as RationaleId) : null;
}
