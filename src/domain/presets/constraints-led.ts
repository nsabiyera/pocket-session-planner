import { MethodologyPresetSchema, type MethodologyPreset } from '../methodology';

/**
 * The Constraints-Led Approach. The coach's real intervention is changing the practice, not
 * talking — hence a session default of `trial_and_error` + `constraint_change`, and a budget
 * of two spoken interventions per phase.
 *
 * Structured around the FA's 3 Rs of constraints: **restrict**, **reward**, **relate**.
 */
export const CONSTRAINTS_LED: MethodologyPreset = MethodologyPresetSchema.parse({
  id: 'constraints-led',
  origin: { kind: 'builtin' },
  name: 'Constraints-Led',
  summary:
    'Design the practice so the behaviour you want is the behaviour that wins. Change the constraint, not the coaching point.',
  coachStance: 'hands_off',
  version: 1,
  referenceDurationMin: 60,
  coachPrompt: 'Design the constraint so the behaviour is the winning behaviour.',
  defaultIntervention: {
    method: 'trial_and_error',
    mechanic: 'constraint_change',
    audience: 'team',
    maxPerPhase: 2,
  },
  phaseTemplates: [
    {
      id: 'cla-arrival',
      order: 0,
      defaultConstraints: [{ letter: 'task', text: 'Head up between touches' }],
      defaultSpectrum: 'overloaded',
      defaultProgressions: ['Into the rondo sooner', 'Two touches in the rondo'],
      defaultRegressions: ['Add a neutral', 'Make the rondo bigger'],
      kind: 'arrival',
      title: 'Arrival — ball each, then rondo',
      durationWeight: 0.13,
      intent:
        'Everyone touching a ball from the moment they arrive. No queues, no line-ups, no waiting for the last car.',
      coachPrompts: ['Are they all busy?', 'Can a late arrival join without stopping anything?'],
      defaultCoachingPoints: ['Head up between touches', 'First touch out of your feet'],
    },
    {
      id: 'cla-game-a',
      order: 1,
      defaultConstraints: [{ letter: 'task', text: 'Two touches maximum' }],
      defaultSpectrum: 'matched_up',
      defaultProgressions: ['Take another touch away', 'Shrink the pitch'],
      defaultRegressions: ['Give a touch back', 'Widen it out'],
      kind: 'conditioned_game',
      title: 'Constrained game A — restrict',
      durationWeight: 0.27,
      intent:
        'The first constraint. Take something away — touches, space, a direction — so the target behaviour becomes the easiest way to succeed.',
      coachPrompts: ['Is the constraint doing the coaching for you?', 'Who has solved it already?'],
      defaultCoachingPoints: ['Find the free player', 'Move before the ball arrives'],
    },
    {
      id: 'cla-freeze',
      order: 2,
      defaultConstraints: [],
      defaultSpectrum: null,
      defaultProgressions: [],
      defaultRegressions: [],
      kind: 'huddle',
      title: 'Freeze — ask, then change one thing',
      durationWeight: 0.07,
      intent:
        'The single permitted stoppage. Freeze the picture, ask what they see, then change exactly one constraint. One.',
      coachPrompts: ['Ask before you tell.', 'Change ONE thing. Not three.'],
      defaultCoachingPoints: ['What did you see?', 'What would make that easier?'],
      defaultIntervention: {
        method: 'guided_discovery',
        mechanic: 'play_freeze_play',
        audience: 'team',
        maxPerPhase: 2,
      },
    },
    {
      id: 'cla-game-b',
      order: 3,
      defaultConstraints: [{ letter: 'task', text: 'A first-time finish counts double' }],
      defaultSpectrum: 'matched_up',
      defaultProgressions: [
        'Raise what the reward costs them',
        'Reward only if everyone is over halfway',
      ],
      defaultRegressions: ['Make the reward bigger', 'Count it even when it is half-done'],
      kind: 'conditioned_game',
      title: 'Same game — reward and relate',
      durationWeight: 0.27,
      intent:
        'Same game, second constraint. Reward the behaviour (extra goal, bonus point) or relate it to the real thing.',
      coachPrompts: [
        'Same game — do not invent a new one.',
        'Is the reward big enough to change behaviour?',
      ],
      defaultCoachingPoints: ['Take the reward when it is on', 'Recognise when it is not on'],
    },
    {
      id: 'cla-free-game',
      order: 4,
      defaultConstraints: [],
      defaultSpectrum: 'matched_up',
      defaultProgressions: [],
      defaultRegressions: [],
      kind: 'game',
      title: 'Free game — does it transfer?',
      durationWeight: 0.26,
      intent:
        'Constraints off. If the behaviour survives without them, the design worked. If it vanishes, the design did the work and the players did not.',
      coachPrompts: ['Say nothing. Watch for it.', 'Does it survive with the constraint removed?'],
      defaultCoachingPoints: [],
      defaultIntervention: {
        method: 'trial_and_error',
        mechanic: 'none',
        audience: 'team',
        maxPerPhase: 0,
      },
    },
  ],
});
