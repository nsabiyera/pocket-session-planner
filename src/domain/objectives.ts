import { MOMENT_LABELS, type Moment } from './game-model';
import type { FourCorner } from './four-corners';
import type { PhaseKind } from './methodology';

/**
 * The curated objective library.
 *
 * This is the single biggest typing-eliminator in the app. Step 2 of the create flow is
 * *"tap an objective chip"*, and each chip already carries the coaching points a coach would
 * otherwise write out — so `Build session` produces a plan with real content in it rather
 * than five empty phases.
 *
 * Fourteen entries, deliberately. Enough to cover most grassroots sessions; few enough to
 * scan in a two-column grid without scrolling past the fold.
 */
export interface ObjectiveTemplate {
  readonly id: string;
  readonly text: string;
  readonly theme: ObjectiveTheme;
  readonly successCriteria: readonly string[];
  readonly coachingPoints: readonly string[];
  /** Where the points belong when carry-forward has to place them. */
  readonly preferredPhaseKind: PhaseKind;
  /**
   * The FA 4 Corner Model corner this objective mainly develops.
   *
   * *Mainly* is doing real work here: the model's own position is that "no one corner works
   * in isolation", and a possession objective plainly has psychological and social content
   * too. This records the primary corner so the planner can show a coach that their last six
   * objectives were all technical — not to claim the others are untouched.
   */
  readonly primaryCorner: FourCorner;
}

/**
 * What an objective is about: one of the four moments, or the player rather than the team.
 *
 * **The moments come from `game-model.ts` rather than being spelled again here.** One
 * vocabulary, because Phase 3 links an objective to a principle *by moment* — two enums that
 * happened to agree would drift the first time either was edited.
 *
 * `individual` is deliberately not a moment. Four of the fourteen objectives are about a
 * player rather than a phase of the game, and forcing them into a four-moments scheme would
 * file *"first touch out of your feet"* under offensive organisation, which is not what it is
 * about. `momentOf` returns null for them, and callers that need a moment skip them rather
 * than being handed a guess.
 */
export type ObjectiveTheme = Moment | 'individual';

export const OBJECTIVE_THEMES: Record<ObjectiveTheme, string> = {
  ...MOMENT_LABELS,
  individual: 'Individual',
};

/** The moment an objective trains, or null when it is about the player rather than the team. */
export function momentOf(theme: ObjectiveTheme): Moment | null {
  return theme === 'individual' ? null : theme;
}

export const OBJECTIVE_LIBRARY: readonly ObjectiveTemplate[] = [
  {
    id: 'playing-out-from-the-back',
    text: 'Playing out from the back',
    theme: 'offensive_organisation',
    successCriteria: [
      'We keep the ball past the first line of pressure',
      'The keeper is an option',
    ],
    coachingPoints: [
      'Split the centre-backs wide of the box',
      'Keeper plays to the free side',
      'Midfielder shows on the half-turn',
      'Head up before you receive',
      'If it is not on, go long and win the second ball',
    ],
    preferredPhaseKind: 'phase_of_play',
    primaryCorner: 'technical_tactical',
  },
  {
    id: 'creating-width',
    text: 'Creating and using width',
    theme: 'offensive_organisation',
    successCriteria: ['We switch the play at least once per attack', 'Wingers stay high and wide'],
    coachingPoints: [
      'Stay on the touchline until the ball travels',
      'Switch it when the far side is free',
      'Receive on the back foot to face forward',
      'One player in behind every time we go wide',
    ],
    preferredPhaseKind: 'small_sided_game',
    primaryCorner: 'technical_tactical',
  },
  {
    id: 'combination-play',
    text: 'Combination play in tight areas',
    theme: 'offensive_organisation',
    successCriteria: [
      'Three-player combinations break a line',
      'Fewer than two touches under pressure',
    ],
    coachingPoints: [
      'Angle your support, do not stand square',
      'Set and spin',
      'Third player runs before the second pass',
      'Disguise the pass with your body shape',
    ],
    preferredPhaseKind: 'skill_practice',
    primaryCorner: 'technical_tactical',
  },
  {
    id: 'finishing',
    text: 'Finishing in the box',
    theme: 'offensive_organisation',
    successCriteria: ['Shots are on target', 'Someone attacks the near post every cross'],
    coachingPoints: [
      'Near post, far post, edge of the box — fill all three',
      'Side-foot across the keeper',
      'Follow the shot in',
      'Take the first-time option when it is on',
    ],
    preferredPhaseKind: 'skill_practice',
    primaryCorner: 'technical_tactical',
  },
  {
    id: 'scanning',
    text: 'Scanning before receiving',
    theme: 'individual',
    successCriteria: ['Players look over their shoulder before the ball arrives'],
    coachingPoints: [
      'Look before it comes, not when it comes',
      'Two scans between passes',
      'Open your body to see more of the pitch',
      'Say what you saw before you played it',
    ],
    preferredPhaseKind: 'skill_practice',
    primaryCorner: 'technical_tactical',
  },
  {
    id: 'first-touch',
    text: 'First touch out of your feet',
    theme: 'individual',
    successCriteria: ['First touch goes into space, not under the body'],
    coachingPoints: [
      'Touch away from the pressure',
      'Use the far foot',
      'Cushion it, do not stop it dead',
      'Touch and go in one movement',
    ],
    preferredPhaseKind: 'technical',
    primaryCorner: 'technical_tactical',
  },
  {
    id: 'one-v-one-attacking',
    text: '1v1 attacking',
    theme: 'individual',
    successCriteria: ['Players attack the defender rather than passing backwards'],
    coachingPoints: [
      'Run at the front foot',
      'Change of pace beats change of direction',
      'Commit the defender before you go',
      'It is fine to lose it — go again',
    ],
    preferredPhaseKind: 'skill_practice',
    primaryCorner: 'psychological',
  },
  {
    id: 'pressing-as-a-unit',
    text: 'Pressing as a unit',
    theme: 'defensive_organisation',
    successCriteria: ['The press is triggered together', 'We win the ball in their half'],
    coachingPoints: [
      'First player sets the angle, everyone follows',
      'Press the backwards pass',
      'Squeeze up behind the presser',
      'If the first press is beaten, drop together',
    ],
    preferredPhaseKind: 'phase_of_play',
    primaryCorner: 'physical',
  },
  {
    id: 'defending-one-v-one',
    text: 'Defending 1v1',
    theme: 'defensive_organisation',
    successCriteria: ['Defenders delay rather than dive in'],
    coachingPoints: [
      'Close the distance while the ball travels',
      'Sideways-on, show them one way',
      'Small steps, do not cross your feet',
      'Win it when their touch is heavy',
    ],
    preferredPhaseKind: 'skill_practice',
    primaryCorner: 'technical_tactical',
  },
  {
    id: 'compact-defensive-shape',
    text: 'Staying compact',
    theme: 'defensive_organisation',
    successCriteria: ['No gaps between the lines', 'The far winger tucks in'],
    coachingPoints: [
      'Ball side, goal side',
      'The back line moves as one',
      'Far side tucks in when the ball is wide',
      'Talk — the ones behind can see it',
    ],
    preferredPhaseKind: 'phase_of_play',
    primaryCorner: 'social',
  },
  {
    id: 'counter-attacking',
    text: 'Counter-attacking',
    // We have just won it. This is the attacking transition.
    theme: 'transition_to_attack',
    successCriteria: ['We get forward within five seconds of winning it'],
    coachingPoints: [
      'First pass forward if it is on',
      'Run beyond, not towards',
      'Two players commit, the rest hold the shape',
      'Finish the attack — do not slow it down',
    ],
    preferredPhaseKind: 'small_sided_game',
    primaryCorner: 'physical',
  },
  {
    id: 'reaction-to-losing-the-ball',
    text: 'Reacting to losing the ball',
    // We have just lost it. The defensive transition — the counter-press.
    theme: 'transition_to_defence',
    successCriteria: ['The nearest player presses immediately'],
    coachingPoints: [
      'Nearest player presses, everyone else recovers',
      'Five seconds to win it back',
      'Block the forward pass first',
      'Do not stand and watch the loss',
    ],
    preferredPhaseKind: 'small_sided_game',
    primaryCorner: 'psychological',
  },
  {
    id: 'communication',
    text: 'Communication and leadership',
    theme: 'individual',
    successCriteria: ['Players give information before receiving'],
    coachingPoints: [
      'Say a name, then the information',
      '"Man on", "time", "turn" — say it early',
      'The player who can see it is the player who talks',
      'Encourage after a mistake, not before',
    ],
    preferredPhaseKind: 'small_sided_game',
    primaryCorner: 'social',
  },
  {
    id: 'game-understanding',
    text: 'When to keep it and when to go',
    theme: 'offensive_organisation',
    successCriteria: ['Fewer forced forward passes', 'We recycle rather than lose it'],
    coachingPoints: [
      'If the forward pass is not on, keep it',
      'Go back to go forward',
      'Recognise the moment — do not force it',
      'One touch to escape, two to settle',
    ],
    preferredPhaseKind: 'small_sided_game',
    primaryCorner: 'psychological',
  },
];

const BY_ID = new Map(OBJECTIVE_LIBRARY.map((objective) => [objective.id, objective]));

export function findObjectiveTemplate(id: string): ObjectiveTemplate | undefined {
  return BY_ID.get(id);
}

export interface ObjectiveUsage {
  /** How many sessions used this objective text. */
  count: number;
  /** The most recent use, as an ISO string. */
  lastUsedAt: string | null;
}

/**
 * **Recents-first, ordered by frequency then recency.**
 *
 * A coach works on the same three or four themes for weeks at a time, so the objective they
 * want is almost always one they have used before. Sorting purely by recency would shuffle
 * the grid after every session; sorting by frequency first keeps the layout stable enough to
 * build muscle memory, which is what actually makes the tap fast.
 */
export function orderObjectives(
  library: readonly ObjectiveTemplate[],
  usage: ReadonlyMap<string, ObjectiveUsage>,
): ObjectiveTemplate[] {
  return [...library]
    .map((objective, index) => ({ objective, index, use: usage.get(objective.text) }))
    .sort((a, b) => {
      const countA = a.use?.count ?? 0;
      const countB = b.use?.count ?? 0;
      if (countA !== countB) return countB - countA;

      const lastA = a.use?.lastUsedAt ?? '';
      const lastB = b.use?.lastUsedAt ?? '';
      if (lastA !== lastB) return lastB.localeCompare(lastA);

      return a.index - b.index;
    })
    .map(({ objective }) => objective);
}

/** Builds the usage map from a squad's session history. */
export function objectiveUsageFrom(
  sessions: readonly { objective: { text: string }; scheduledFor: string }[],
): Map<string, ObjectiveUsage> {
  const usage = new Map<string, ObjectiveUsage>();
  for (const session of sessions) {
    const current = usage.get(session.objective.text) ?? { count: 0, lastUsedAt: null };
    usage.set(session.objective.text, {
      count: current.count + 1,
      lastUsedAt:
        current.lastUsedAt === null || session.scheduledFor > current.lastUsedAt
          ? session.scheduledFor
          : current.lastUsedAt,
    });
  }
  return usage;
}
