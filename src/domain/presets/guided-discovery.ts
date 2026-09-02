import { MethodologyPresetSchema, type MethodologyPreset } from '../methodology';

/**
 * Guided Discovery. The coach sets a problem and lets the players find the answer, then
 * makes them run *their own* adjustment — which is the step most sessions skip, and the step
 * that makes the discovery stick.
 */
export const GUIDED_DISCOVERY: MethodologyPreset = MethodologyPresetSchema.parse({
  id: 'guided-discovery',
  origin: { kind: 'builtin' },
  name: 'Guided Discovery',
  summary:
    'Pose the problem, ask questions, let them find the answer — then play with the answer they found.',
  coachStance: 'guided',
  version: 1,
  referenceDurationMin: 60,
  coachPrompt: 'Ask, do not tell — count to five before you speak.',
  defaultIntervention: {
    method: 'guided_discovery',
    mechanic: 'in_flow',
    audience: 'team',
    maxPerPhase: 4,
  },
  phaseTemplates: [
    {
      id: 'gd-arrival',
      order: 0,
      kind: 'arrival',
      title: 'Arrival — pose the problem',
      durationWeight: 0.13,
      intent:
        'Warm up with the ball, and plant the question you want them chewing on for the next hour.',
      coachPrompts: ['Ask the question once, then leave it alone.'],
      defaultCoachingPoints: ['Look up before your first touch'],
    },
    {
      id: 'gd-problem',
      order: 1,
      kind: 'skill_practice',
      title: 'Problem-setting practice',
      durationWeight: 0.23,
      intent:
        'A practice they cannot beat by doing what they already do. The failure is the point — it is what makes the huddle worth having.',
      coachPrompts: [
        'Let them fail at it. That is the lesson.',
        'Note who is closest to solving it.',
      ],
      defaultCoachingPoints: ['Try something different if it is not working'],
    },
    {
      id: 'gd-huddle',
      order: 2,
      kind: 'huddle',
      title: 'Huddle — open questions only',
      durationWeight: 0.09,
      intent:
        'Bring them in. Ask what they tried, what worked, what they would change. Their words, not yours. Leave with one agreed adjustment.',
      coachPrompts: [
        'What did you try? What happened? What next?',
        'Whoever answers last usually needed it most.',
      ],
      defaultCoachingPoints: ['What was stopping you?', 'What would you change?'],
      defaultIntervention: {
        method: 'question_and_answer',
        mechanic: 'play_stop_play',
        audience: 'team',
        maxPerPhase: 6,
      },
    },
    {
      id: 'gd-apply',
      order: 3,
      kind: 'skill_practice',
      title: 'Practice with their adjustment',
      durationWeight: 0.28,
      intent:
        'Run the practice again with the change they chose — even if you would have chosen a different one. Ownership is the mechanism.',
      coachPrompts: ['Run THEIR adjustment, not yours.', 'Name it back to them when it works.'],
      defaultCoachingPoints: ['Stick with the plan you agreed'],
    },
    {
      id: 'gd-test',
      order: 4,
      kind: 'game',
      title: 'Game — test the discovery',
      durationWeight: 0.27,
      intent: 'Does it hold up in a real game? Watch, say very little, and feed back at breaks.',
      coachPrompts: ['Watch for it. Feed back at the next natural break.'],
      defaultCoachingPoints: [],
      defaultIntervention: {
        method: 'observation_feedback',
        mechanic: 'natural_break',
        audience: 'team',
        maxPerPhase: 2,
      },
    },
  ],
});
