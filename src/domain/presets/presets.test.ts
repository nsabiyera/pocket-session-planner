import { describe, expect, it } from 'vitest';
import { METHODOLOGY_PRESETS, DEFAULT_METHODOLOGY_ID, findPreset, isPresetId } from './index';
import { MethodologyPresetSchema, orderedTemplates } from '../methodology';
import { resolvePhaseIntervention } from '../intervention';
import { scalePhaseDurations, scaledTotal } from '../session/phase-scaling';
import {
  describeSessionShape,
  MAX_ADJUSTMENT_TEXT,
  MAX_ADJUSTMENTS_PER_PHASE,
  MAX_CONSTRAINTS_PER_PHASE,
  PRACTICE_SPECTRUM,
  STEP_LETTERS,
} from '../practice';
import type { PhaseKind } from '../methodology';

/**
 * Presets are data, so the test is a data audit: everything parses, the weights are honest,
 * every phase resolves an intervention, and each one scales to a plan a coach would accept.
 */
describe('methodology presets', () => {
  it('ships exactly the five documented presets, with the grassroots default first', () => {
    expect(METHODOLOGY_PRESETS.map((p) => p.id)).toEqual([
      'play-practice-play',
      'constraints-led',
      'guided-discovery',
      'whole-part-whole',
      'command-direct',
    ]);
    expect(DEFAULT_METHODOLOGY_ID).toBe('play-practice-play');
  });

  it.each(METHODOLOGY_PRESETS)('$name re-parses against its own schema', (preset) => {
    expect(MethodologyPresetSchema.safeParse(preset).success).toBe(true);
  });

  it.each(METHODOLOGY_PRESETS)('$name weights sum to 1 within tolerance', (preset) => {
    const sum = preset.phaseTemplates.reduce((total, t) => total + t.durationWeight, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.001);
  });

  it.each(METHODOLOGY_PRESETS)('$name has unique, contiguous phase order', (preset) => {
    const orders = orderedTemplates(preset).map((t) => t.order);
    expect(orders).toEqual(orders.map((_, index) => index));
  });

  it.each(METHODOLOGY_PRESETS)('$name is authored against a 60-minute session', (preset) => {
    expect(preset.referenceDurationMin).toBe(60);
  });

  it.each(METHODOLOGY_PRESETS)('every phase of $name resolves an intervention', (preset) => {
    for (const template of preset.phaseTemplates) {
      const resolved = resolvePhaseIntervention(
        { intervention: preset.defaultIntervention },
        { intervention: template.defaultIntervention },
      );
      expect(resolved.method).toBeTruthy();
      expect(resolved.mechanic).toBeTruthy();
    }
  });

  it.each(METHODOLOGY_PRESETS)('$name scales to exactly 60 minutes in round steps', (preset) => {
    const durations = scalePhaseDurations(preset.phaseTemplates, 60);
    expect(scaledTotal(durations)).toBe(60);
    for (const minutes of durations.values()) {
      expect(minutes % 5).toBe(0);
      expect(minutes).toBeGreaterThan(0);
    }
  });

  it.each([45, 60, 75, 90])('every preset scales to exactly %i minutes', (totalMin) => {
    for (const preset of METHODOLOGY_PRESETS) {
      const durations = scalePhaseDurations(preset.phaseTemplates, totalMin);
      expect({ preset: preset.id, total: scaledTotal(durations) }).toEqual({
        preset: preset.id,
        total: totalMin,
      });
    }
  });

  it('never lets a heavily weighted phase end up shorter than a light one', () => {
    // The regression this guards: rounding each phase independently and dumping the error on
    // the heaviest turns Command's 30% conditioned game into the joint-shortest phase.
    for (const preset of METHODOLOGY_PRESETS) {
      const durations = scalePhaseDurations(preset.phaseTemplates, 60);
      const scaled = preset.phaseTemplates.filter((t) => t.durationWeight > 0);
      const heaviest = scaled.reduce((a, b) => (b.durationWeight > a.durationWeight ? b : a));
      const longest = Math.max(...scaled.map((t) => durations.get(t.id) ?? 0));
      expect({ preset: preset.id, minutes: durations.get(heaviest.id) }).toEqual({
        preset: preset.id,
        minutes: longest,
      });
    }
  });

  it('keeps the Play-Practice-Play water break at a fixed five minutes, unscaled', () => {
    const preset = findPreset('play-practice-play');
    const water = preset?.phaseTemplates.find((t) => t.kind === 'water_break');
    expect(water?.durationWeight).toBe(0);
    expect(water?.isOptional).toBe(true);

    for (const total of [40, 60, 90]) {
      const durations = scalePhaseDurations(preset?.phaseTemplates ?? [], total);
      expect(durations.get(water?.id ?? ('' as never))).toBe(5);
    }
  });

  it('holds the coach to "let them play" in the final Play-Practice-Play game', () => {
    const preset = findPreset('play-practice-play');
    const finalPlay = preset?.phaseTemplates.find((t) => t.id === 'ppp-play-2');
    expect(finalPlay?.defaultIntervention?.maxPerPhase).toBe(0);
    expect(finalPlay?.defaultIntervention?.mechanic).toBe('none');
  });

  it('gives the Constraints-Led freeze phase the only stoppage in the session', () => {
    const preset = findPreset('constraints-led');
    expect(preset?.defaultIntervention.mechanic).toBe('constraint_change');
    const freeze = preset?.phaseTemplates.find((t) => t.id === 'cla-freeze');
    expect(freeze?.defaultIntervention).toMatchObject({
      method: 'guided_discovery',
      mechanic: 'play_freeze_play',
    });
  });

  it('lets Whole-Part-Whole correct tightly in the PART and barely speak in the WHOLEs', () => {
    const preset = findPreset('whole-part-whole');
    const part = preset?.phaseTemplates.find((t) => t.id === 'wpw-part');
    expect(part?.defaultIntervention).toMatchObject({
      method: 'command',
      mechanic: 'play_stop_play',
    });
    for (const id of ['wpw-whole-1', 'wpw-whole-2']) {
      const whole = preset?.phaseTemplates.find((t) => t.id === id);
      expect(whole?.defaultIntervention).toMatchObject({ mechanic: 'in_flow', maxPerPhase: 1 });
    }
  });

  it('relaxes Command / Direct to in-flow coaching once the game starts', () => {
    const preset = findPreset('command-direct');
    expect(preset?.defaultIntervention).toMatchObject({
      method: 'command',
      mechanic: 'play_stop_play',
    });
    const game = preset?.phaseTemplates.find((t) => t.id === 'cmd-game');
    expect(game?.defaultIntervention?.mechanic).toBe('in_flow');
  });

  it('resolves preset ids and rejects strangers', () => {
    expect(findPreset('constraints-led')?.name).toBe('Constraints-Led');
    expect(findPreset('nope')).toBeUndefined();
    expect(isPresetId('whole-part-whole')).toBe(true);
    expect(isPresetId('whole-part')).toBe(false);
  });
});

/**
 * The practice spectrum, per preset.
 *
 * Authored per template rather than mapped from `PhaseKind`, because the kind genuinely does
 * not determine it: Play-Practice-Play's PRACTICE (`skill_practice`) is an overload while
 * Whole-Part-Whole's PART (`technical`) is unopposed, and only the methodology knows which.
 * That freedom is exactly why it needs a guard.
 */
describe('preset practice design', () => {
  /** Not a practice. Nobody is playing, so there is nothing to place on the spectrum. */
  const NOT_A_PRACTICE: ReadonlySet<PhaseKind> = new Set<PhaseKind>([
    'huddle',
    'player_review',
    'water_break',
  ]);

  it.each(METHODOLOGY_PRESETS)('$name never puts a huddle on the spectrum', (preset) => {
    for (const template of preset.phaseTemplates) {
      if (!NOT_A_PRACTICE.has(template.kind)) continue;
      expect(template.defaultSpectrum, `${template.id} is a ${template.kind}`).toBeNull();
    }
  });

  it.each(METHODOLOGY_PRESETS)('$name only ever uses the FA four', (preset) => {
    for (const template of preset.phaseTemplates) {
      if (template.defaultSpectrum === null) continue;
      expect(PRACTICE_SPECTRUM).toContain(template.defaultSpectrum);
    }
  });

  it.each(METHODOLOGY_PRESETS)('$name gives a session enough to have a shape', (preset) => {
    // Two is the floor for `describeSessionShape`. A preset that classified one phase and
    // shrugged at the rest would put the field in the schema and nothing on the screen.
    const spectrums = orderedTemplates(preset)
      .map((template) => template.defaultSpectrum)
      .filter((spectrum) => spectrum !== null);

    expect(spectrums.length).toBeGreaterThanOrEqual(2);
    expect(describeSessionShape(spectrums)).not.toBeNull();
  });

  it('shapes each methodology the way it describes itself', () => {
    const shapeOf = (id: string) => {
      const preset = METHODOLOGY_PRESETS.find((candidate) => candidate.id === id)!;
      return orderedTemplates(preset)
        .map((template) => template.defaultSpectrum)
        .filter((spectrum) => spectrum !== null);
    };

    // Play-Practice-Play and Whole-Part-Whole both dip away from the game and come back —
    // that return trip *is* the methodology, and the data now says so.
    expect(shapeOf('play-practice-play')).toEqual(['matched_up', 'overloaded', 'matched_up']);
    expect(shapeOf('whole-part-whole')).toEqual([
      'unopposed',
      'matched_up',
      'unopposed',
      'matched_up',
    ]);

    // Command-Direct is the textbook ladder: no opposition, then some, then the game.
    expect(shapeOf('command-direct')).toEqual([
      'unopposed',
      'unopposed',
      'overloaded',
      'matched_up',
    ]);
    expect(describeSessionShape(shapeOf('command-direct'))).toContain('more game-like');

    // Constraints-Led runs the same game over and over, changing one thing each time.
    expect(shapeOf('constraints-led').slice(1)).toEqual(['matched_up', 'matched_up', 'matched_up']);
  });
});

/**
 * Progressions and regressions, per preset.
 *
 * The prose already existed — in `intent`, in `coachPrompts`, in `defaultCoachingPoints` —
 * so the audit is that it landed somewhere Do mode can act on, and that the phases which
 * ship **empty** are the ones that mean it.
 */
describe('preset progressions and regressions', () => {
  it.each(METHODOLOGY_PRESETS)('$name keeps every adjustment thumb-sized', (preset) => {
    for (const template of preset.phaseTemplates) {
      for (const text of [...template.defaultProgressions, ...template.defaultRegressions]) {
        expect(text.trim()).toBe(text);
        expect(text.length).toBeLessThanOrEqual(MAX_ADJUSTMENT_TEXT);
        // Read aloud at 7:40 in the rain. A sentence with a full stop is a paragraph.
        expect(text).not.toContain('. ');
      }
      expect(template.defaultProgressions.length).toBeLessThanOrEqual(MAX_ADJUSTMENTS_PER_PHASE);
      expect(template.defaultRegressions.length).toBeLessThanOrEqual(MAX_ADJUSTMENTS_PER_PHASE);
    }
  });

  it.each(METHODOLOGY_PRESETS)('$name never puts adjustments on a non-practice', (preset) => {
    const NOT_A_PRACTICE = new Set(['huddle', 'player_review', 'water_break']);
    for (const template of preset.phaseTemplates) {
      if (!NOT_A_PRACTICE.has(template.kind)) continue;
      expect(template.defaultProgressions, template.id).toEqual([]);
      expect(template.defaultRegressions, template.id).toEqual([]);
    }
  });

  it.each(METHODOLOGY_PRESETS)('$name gives its main practice both directions', (preset) => {
    // The phase a coach is most likely to need to change mid-session must arrive with a way
    // to make it harder *and* a way to rescue it. One direction is half a tool.
    const practices = preset.phaseTemplates.filter(
      (template) => template.defaultProgressions.length > 0,
    );
    expect(practices.length).toBeGreaterThan(0);
    for (const template of practices) {
      expect(template.defaultRegressions.length, `${template.id} has no way back`).toBeGreaterThan(
        0,
      );
    }
  });

  it('ships the phases that must not change with nothing to change them by', () => {
    const templateOf = (presetId: string, templateId: string) =>
      METHODOLOGY_PRESETS.find((p) => p.id === presetId)!.phaseTemplates.find(
        (t) => t.id === templateId,
      )!;

    // Whole-Part-Whole's claim is that the two WHOLE games are identical. Adjusting either
    // destroys the before-and-after comparison the whole methodology exists to make.
    for (const id of ['wpw-whole-1', 'wpw-whole-2']) {
      const template = templateOf('whole-part-whole', id);
      expect(template.defaultProgressions, id).toEqual([]);
      expect(template.defaultRegressions, id).toEqual([]);
    }

    // Constraints-Led's free game is the test of whether the behaviour survives with the
    // constraints off. Planning a constraint for it would be missing the point entirely.
    const free = templateOf('constraints-led', 'cla-free-game');
    expect(free.defaultProgressions).toEqual([]);
    expect(free.defaultRegressions).toEqual([]);
  });
});

describe('preset STEP constraints', () => {
  it.each(METHODOLOGY_PRESETS)('$name only ever uses the FA four letters', (preset) => {
    for (const template of preset.phaseTemplates) {
      for (const constraint of template.defaultConstraints) {
        expect(STEP_LETTERS).toContain(constraint.letter);
        expect(constraint.text.trim()).toBe(constraint.text);
        expect(constraint.text.length).toBeGreaterThan(0);
      }
      expect(template.defaultConstraints.length).toBeLessThanOrEqual(MAX_CONSTRAINTS_PER_PHASE);
    }
  });

  it.each(METHODOLOGY_PRESETS)('$name never constrains a huddle', (preset) => {
    const NOT_A_PRACTICE = new Set(['huddle', 'player_review', 'water_break']);
    for (const template of preset.phaseTemplates) {
      if (!NOT_A_PRACTICE.has(template.kind)) continue;
      expect(template.defaultConstraints, template.id).toEqual([]);
    }
  });

  it('moves the Constraints-Led method out of the phase titles and into data', () => {
    // The whole reason this field exists. "Constrained game A — restrict" said what to do in
    // a *title*; now the condition is something Review can count.
    const cla = METHODOLOGY_PRESETS.find((preset) => preset.id === 'constraints-led')!;
    const at = (id: string) => cla.phaseTemplates.find((t) => t.id === id)!;

    expect(at('cla-game-a').defaultConstraints).toEqual([
      { letter: 'task', text: 'Two touches maximum' },
    ]);
    expect(at('cla-game-b').defaultConstraints).toHaveLength(1);

    // Constraints off is the entire claim of the free game, and the report can now show it.
    expect(at('cla-free-game').defaultConstraints).toEqual([]);
  });

  it('spreads its own letters across the five presets', () => {
    // A preset bank that only ever said Task would teach the habit it is meant to reveal.
    const used = new Set(
      METHODOLOGY_PRESETS.flatMap((preset) =>
        preset.phaseTemplates.flatMap((template) =>
          template.defaultConstraints.map((constraint) => constraint.letter),
        ),
      ),
    );
    expect([...used].sort()).toEqual(['equipment', 'people', 'space', 'task']);
  });
});

describe('preset player choice', () => {
  const choiceTemplates = (presetId: string) =>
    METHODOLOGY_PRESETS.find((preset) => preset.id === presetId)!.phaseTemplates.filter(
      (template) => template.defaultPlayerChoice,
    );

  it('hands the decision to the players only where the methodology actually does', () => {
    // Guided Discovery's method *is* the players' decision: "Run the practice again with the
    // change they chose - even if you would have chosen a different one."
    expect(choiceTemplates('guided-discovery').map((t) => t.id)).toEqual(['gd-huddle', 'gd-apply']);
  });

  it('leaves Command-Direct at none, because that is the methodology', () => {
    // Not an oversight. A preset bank that claimed player choice everywhere would make the
    // report meaningless the day it shipped.
    expect(choiceTemplates('command-direct')).toEqual([]);
  });

  it.each(METHODOLOGY_PRESETS)('$name never offers a choice in a water break', (preset) => {
    for (const template of preset.phaseTemplates) {
      if (template.kind !== 'water_break') continue;
      expect(template.defaultPlayerChoice, template.id).toBe(false);
    }
  });

  it('differs across the five, so the report has something to show', () => {
    const counts = METHODOLOGY_PRESETS.map((preset) => choiceTemplates(preset.id).length);
    expect(Math.max(...counts)).toBeGreaterThan(0);
    expect(Math.min(...counts)).toBe(0);
  });
});
