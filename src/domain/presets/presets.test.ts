import { describe, expect, it } from 'vitest';
import { METHODOLOGY_PRESETS, DEFAULT_METHODOLOGY_ID, findPreset, isPresetId } from './index';
import { MethodologyPresetSchema, orderedTemplates } from '../methodology';
import { resolvePhaseIntervention } from '../intervention';
import { scalePhaseDurations, scaledTotal } from '../session/phase-scaling';

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
