import { MethodologyPresetSchema, type MethodologyPreset } from '../methodology';

/**
 * Play-Practice-Play — the grassroots default, and the default this app preselects.
 *
 * The final PLAY carries `maxPerPhase: 0`. That is the clearest example of why modelling
 * intervention separately earns its keep: *"let them play"* stops being a slogan in the
 * phase description and becomes a budget the app will hold the coach to.
 */
export const PLAY_PRACTICE_PLAY: MethodologyPreset = MethodologyPresetSchema.parse({
  id: 'play-practice-play',
  origin: { kind: 'builtin' },
  name: 'Play-Practice-Play',
  summary:
    'They play as they arrive, you practise the one thing in the middle, and they finish playing. Minimal coaching at both ends.',
  coachStance: 'guided',
  version: 1,
  referenceDurationMin: 60,
  coachPrompt: 'Let them play. Coach in the flow, or not at all.',
  defaultIntervention: {
    method: 'observation_feedback',
    mechanic: 'in_flow',
    audience: 'team',
    maxPerPhase: 3,
  },
  phaseTemplates: [
    {
      id: 'ppp-play-1',
      order: 0,
      kind: 'small_sided_game',
      title: 'PLAY — small-sided, as they arrive',
      durationWeight: 0.33,
      intent:
        'A game running from the first two players. No warm-up drill, no waiting. Late arrivals join in — this is the entire reason nobody stands around.',
      coachPrompts: [
        'Start with two players if that is who is here.',
        'Watch for the thing you planned to practise.',
      ],
      defaultCoachingPoints: [],
      defaultIntervention: {
        method: 'observation_feedback',
        mechanic: 'in_flow',
        audience: 'team',
        maxPerPhase: 2,
      },
    },
    {
      id: 'ppp-water',
      order: 1,
      kind: 'water_break',
      title: 'Water break',
      durationWeight: 0,
      defaultDurationMin: 5,
      intent: 'Drinks. Optional, but a fixed five minutes when you use it, never scaled away.',
      coachPrompts: ['Say the one thing you noticed in the first game. One thing.'],
      defaultCoachingPoints: [],
      isOptional: true,
    },
    {
      id: 'ppp-practice',
      order: 2,
      kind: 'skill_practice',
      title: 'PRACTICE — the one thing, then progress it',
      durationWeight: 0.34,
      intent:
        'The core activity, then a progression once it looks comfortable. This is where the session objective actually gets worked on.',
      coachPrompts: [
        'Question them rather than telling them.',
        'Progress it as soon as it looks easy.',
      ],
      defaultCoachingPoints: ['Head up before you receive', 'Open your body to see more'],
      defaultIntervention: {
        method: 'question_and_answer',
        mechanic: 'stop_some_play_on',
        audience: 'unit',
        maxPerPhase: 4,
      },
    },
    {
      id: 'ppp-play-2',
      order: 3,
      kind: 'game',
      title: 'PLAY — game, minimal coaching',
      durationWeight: 0.33,
      intent:
        'They finish playing. Watch for the thing you practised and say nothing about it. If it is there, it worked; if it is not, that is next week.',
      coachPrompts: ['Say nothing. Genuinely nothing.', 'Note who did it — that is the review.'],
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
