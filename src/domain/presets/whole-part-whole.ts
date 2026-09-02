import { MethodologyPresetSchema, type MethodologyPreset } from '../methodology';

/**
 * Whole-Part-Whole. The discipline of this one is entirely in phase 4: it must be the
 * **same game** as phase 2, or there is no claim of transfer to make — only a claim that
 * they got better at the isolated drill, which nobody was asking about.
 */
export const WHOLE_PART_WHOLE: MethodologyPreset = MethodologyPresetSchema.parse({
  id: 'whole-part-whole',
  origin: { kind: 'builtin' },
  name: 'Whole-Part-Whole',
  summary:
    'Play the game, find the problem, isolate it with high repetitions, then play the same game again and look for the change.',
  coachStance: 'guided',
  version: 1,
  referenceDurationMin: 60,
  coachPrompt: 'Phase 4 must be the SAME game as phase 2, or you cannot claim transfer.',
  defaultIntervention: {
    method: 'observation_feedback',
    mechanic: 'natural_break',
    audience: 'team',
    maxPerPhase: 3,
  },
  phaseTemplates: [
    {
      id: 'wpw-warmup',
      order: 0,
      kind: 'warm_up',
      title: 'Warm-up with the ball',
      durationWeight: 0.15,
      intent: 'Bodies ready, balls moving. Nothing tactical yet.',
      coachPrompts: ['Everyone moving, everyone with a ball.'],
      defaultCoachingPoints: ['Quality of first touch'],
    },
    {
      id: 'wpw-whole-1',
      order: 1,
      kind: 'small_sided_game',
      title: 'WHOLE — play, and find the problem',
      durationWeight: 0.22,
      intent:
        'Play the real thing and watch. Do not coach yet — you are diagnosing. Write down the one problem worth isolating.',
      coachPrompts: [
        'Say almost nothing. You are diagnosing, not fixing.',
        'Pick ONE problem to take into the PART.',
      ],
      defaultCoachingPoints: [],
      defaultIntervention: {
        method: 'observation_feedback',
        mechanic: 'in_flow',
        audience: 'team',
        maxPerPhase: 1,
      },
    },
    {
      id: 'wpw-part',
      order: 2,
      kind: 'technical',
      title: 'PART — isolate it, high repetitions',
      durationWeight: 0.3,
      intent:
        'Strip the problem out of the game and drill it. This is the one phase where tight, directive correction is the right tool — the reps are the point.',
      coachPrompts: ['Reps, reps, reps.', 'Correct tightly here — you get to, in this phase only.'],
      defaultCoachingPoints: ['Technique under no pressure first', 'Add pressure once it is clean'],
      defaultIntervention: {
        method: 'command',
        mechanic: 'play_stop_play',
        audience: 'unit',
        maxPerPhase: 8,
      },
    },
    {
      id: 'wpw-whole-2',
      order: 3,
      kind: 'small_sided_game',
      title: 'WHOLE — the same game, look for the change',
      durationWeight: 0.28,
      intent:
        'The SAME game as phase 2. Same size, same rules, same teams. Anything else and you have measured nothing.',
      coachPrompts: ['Same game. Same size. Same rules.', 'Did the PART transfer? Be honest.'],
      defaultCoachingPoints: ['Look for the thing we drilled'],
      defaultIntervention: {
        method: 'observation_feedback',
        mechanic: 'in_flow',
        audience: 'team',
        maxPerPhase: 1,
      },
    },
    {
      id: 'wpw-review',
      order: 4,
      kind: 'player_review',
      title: 'Review huddle',
      durationWeight: 0.05,
      intent: 'Thirty seconds. What changed between the first game and the second?',
      coachPrompts: ['Let them tell you what changed.'],
      defaultCoachingPoints: ['What was different the second time?'],
      defaultIntervention: {
        method: 'question_and_answer',
        mechanic: 'play_stop_play',
        audience: 'team',
        maxPerPhase: 5,
      },
    },
  ],
});
