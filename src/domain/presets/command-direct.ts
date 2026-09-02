import { MethodologyPresetSchema, type MethodologyPreset } from '../methodology';

/**
 * Command / Direct. Included without apology: there are things — a set-piece routine, a
 * goalkeeper's starting position, a safety point — where telling them is simply correct, and
 * a coach who needs this session should be able to plan it honestly rather than pretend.
 *
 * The conditioned game deliberately relaxes to `in_flow`, so even a directive session ends
 * with the ball rolling.
 */
export const COMMAND_DIRECT: MethodologyPreset = MethodologyPresetSchema.parse({
  id: 'command-direct',
  origin: { kind: 'builtin' },
  name: 'Command / Direct',
  summary:
    'Demonstrate it, rehearse it unopposed, add an opponent, then play. For the things where telling them is the right answer.',
  coachStance: 'directive',
  version: 1,
  referenceDurationMin: 60,
  coachPrompt: 'Be brief and be specific. Then get out of the way and let them rehearse it.',
  defaultIntervention: {
    method: 'command',
    mechanic: 'play_stop_play',
    audience: 'team',
    maxPerPhase: 6,
  },
  phaseTemplates: [
    {
      id: 'cmd-warmup',
      order: 0,
      kind: 'warm_up',
      title: 'Warm-up — ball mastery',
      durationWeight: 0.15,
      intent: 'Individual work with the ball. Bodies warm, touches banked.',
      coachPrompts: ['Both feet. All surfaces.'],
      defaultCoachingPoints: ['Small touches, head up'],
    },
    {
      id: 'cmd-demo',
      order: 1,
      kind: 'technical',
      title: 'Demonstration',
      durationWeight: 0.06,
      intent:
        'Show it, name it, show it once more. Under sixty seconds of talking — if it takes longer, it is too complicated to demonstrate.',
      coachPrompts: ['Show, do not describe.', 'Under a minute. Watch the clock.'],
      defaultCoachingPoints: ['Watch the standing foot', 'Watch where the eyes go first'],
      defaultIntervention: {
        method: 'command',
        mechanic: 'play_stop_play',
        audience: 'team',
        maxPerPhase: 3,
        maxDurationSec: 60,
      },
    },
    {
      id: 'cmd-unopposed',
      order: 2,
      kind: 'technical',
      title: 'Unopposed — groove it',
      durationWeight: 0.22,
      intent: 'No defenders, no decisions. Volume of correct repetitions is the only target.',
      coachPrompts: ['Count the reps, not the minutes.'],
      defaultCoachingPoints: ['Same technique every time', 'Speed comes after accuracy'],
    },
    {
      id: 'cmd-opposed',
      order: 3,
      kind: 'skill_practice',
      title: 'Opposed progression',
      durationWeight: 0.22,
      intent: 'Add a defender, add a decision. The technique now has to survive being rushed.',
      coachPrompts: ['Add pressure gradually — passive, then live.'],
      defaultCoachingPoints: ['Decide early', 'Protect the ball with your body'],
    },
    {
      id: 'cmd-game',
      order: 4,
      kind: 'conditioned_game',
      title: 'Conditioned game',
      durationWeight: 0.3,
      intent:
        'A game conditioned to keep asking for the technique — but coached in the flow. You have already told them; now let them use it.',
      coachPrompts: ['You have already told them. Coach on the run now.'],
      defaultCoachingPoints: ['Use it when it is on'],
      defaultIntervention: {
        method: 'observation_feedback',
        mechanic: 'in_flow',
        audience: 'team',
        maxPerPhase: 3,
      },
    },
    {
      id: 'cmd-debrief',
      order: 5,
      kind: 'huddle',
      title: 'Debrief',
      durationWeight: 0.05,
      intent: 'Name the thing once more, and name two players who did it.',
      coachPrompts: ['Name names. Specific praise sticks.'],
      defaultCoachingPoints: [],
    },
  ],
});
