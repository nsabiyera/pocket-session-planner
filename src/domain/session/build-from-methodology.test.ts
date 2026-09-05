import { describe, expect, it } from 'vitest';
import {
  autoTitle,
  buildSessionFromMethodology,
  rescaleSessionPhases,
} from './build-from-methodology';
import { CONSTRAINTS_LED, PLAY_PRACTICE_PLAY, WHOLE_PART_WHOLE } from '../presets';
import { cloneMethodology } from '../methodology-clone';
import { resolvePhaseIntervention } from '../intervention';
import { phasesInOrder, totalPlannedPhaseMin } from '../session';
import { isoDateTime } from '../primitives';
import { FakeIdGenerator } from '@/lib/fake-id-generator';
import { aSquad, T0 } from '@/test/builders';

const objective = { text: 'Playing out from the back', successCriteria: [], sourceActionId: null };

const build = (methodology = PLAY_PRACTICE_PLAY, over = {}) =>
  buildSessionFromMethodology(methodology, {
    squad: aSquad(),
    objective,
    now: T0,
    ids: new FakeIdGenerator(),
    ...over,
  });

describe('buildSessionFromMethodology', () => {
  it('produces a valid draft with no run', () => {
    const session = build();
    expect(session.status).toBe('draft');
    expect(session.run).toBeNull();
    expect(session.reviewId).toBeNull();
  });

  it('defaults the length to the squad setting and hits it exactly', () => {
    const session = build();
    expect(session.plannedDurationMin).toBe(60);
    expect(totalPlannedPhaseMin(session)).toBe(60);
  });

  it('honours an explicit length', () => {
    const session = build(PLAY_PRACTICE_PLAY, { totalMin: 45 });
    expect(session.plannedDurationMin).toBe(45);
    expect(totalPlannedPhaseMin(session)).toBe(45);
  });

  it('freezes a methodology snapshot rather than a reference', () => {
    const session = build(CONSTRAINTS_LED);
    expect(session.methodology).toEqual({
      methodologyId: 'constraints-led',
      name: 'Constraints-Led',
      coachStance: 'hands_off',
      version: 1,
      originKind: 'builtin',
      referenceDurationMin: 60,
      coachPrompt: 'Design the constraint so the behaviour is the winning behaviour.',
      capturedAt: T0,
    });
  });

  it('seeds the session intervention from the methodology, untouched', () => {
    const session = build(CONSTRAINTS_LED);
    expect(session.intervention).toEqual(CONSTRAINTS_LED.defaultIntervention);
    expect(session.interventionTouched).toBe(false);
  });

  it('marks the intervention touched when the caller supplies one', () => {
    const session = build(CONSTRAINTS_LED, {
      intervention: { ...CONSTRAINTS_LED.defaultIntervention, maxPerPhase: 9 },
    });
    expect(session.interventionTouched).toBe(true);
    expect(session.intervention.maxPerPhase).toBe(9);
  });

  it('carries each template intervention down as a phase override', () => {
    const session = build(PLAY_PRACTICE_PLAY);
    const finalPlay = session.phases.find((p) => p.title.startsWith('PLAY — game'));
    expect(finalPlay?.intervention?.maxPerPhase).toBe(0);
    expect(resolvePhaseIntervention(session, finalPlay!).mechanic).toBe('none');

    // A phase with no template override inherits at read time rather than being copied.
    const water = session.phases.find((p) => p.kind === 'water_break');
    expect(water?.intervention).toBeNull();
    expect(resolvePhaseIntervention(session, water!)).toEqual(session.intervention);
  });

  it('converts default coaching points, marked as coming from the methodology', () => {
    const session = build(WHOLE_PART_WHOLE);
    const part = session.phases.find((p) => p.title.startsWith('PART'));
    expect(part?.coachingPoints.map((c) => c.text)).toEqual([
      'Technique under no pressure first',
      'Add pressure once it is clean',
    ]);
    for (const point of part?.coachingPoints ?? []) {
      expect(point.source).toBe('methodology');
      expect(point.delivered).toBe(false);
    }
  });

  it('copies coach prompts through for Do mode', () => {
    const session = build(WHOLE_PART_WHOLE);
    const whole = session.phases.find((p) => p.title.startsWith('WHOLE — play'));
    expect(whole?.coachPrompts).toContain('Pick ONE problem to take into the PART.');
  });

  it('records template provenance on every phase', () => {
    const session = build(CONSTRAINTS_LED);
    expect(session.phases.map((p) => p.fromTemplateId)).toEqual([
      'cla-arrival',
      'cla-game-a',
      'cla-freeze',
      'cla-game-b',
      'cla-free-game',
    ]);
  });

  it('numbers phases contiguously from zero, in methodology order', () => {
    const session = build(CONSTRAINTS_LED);
    expect(session.phases.map((p) => p.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('can drop optional phases, and re-scales the rest to fill the gap', () => {
    const withBreak = build(PLAY_PRACTICE_PLAY);
    const withoutBreak = build(PLAY_PRACTICE_PLAY, { includeOptionalPhases: false });

    expect(withBreak.phases).toHaveLength(4);
    expect(withoutBreak.phases).toHaveLength(3);
    expect(totalPlannedPhaseMin(withoutBreak)).toBe(60);
  });

  it('accepts focus players and reminders from carry-forward', () => {
    const session = build(PLAY_PRACTICE_PLAY, {
      reminders: ['Bring the bibs'],
      seededFromActionIds: [],
    });
    expect(session.reminders).toEqual(['Bring the bibs']);
  });

  it('builds from a cloned custom methodology just as happily', () => {
    const ids = new FakeIdGenerator('bbbb');
    const custom = cloneMethodology(WHOLE_PART_WHOLE, { name: 'My WPW', now: T0, ids });
    const session = build(custom, { ids: new FakeIdGenerator('cccc') });

    expect(session.methodology.originKind).toBe('custom');
    expect(session.methodology.name).toBe('My WPW');
    expect(totalPlannedPhaseMin(session)).toBe(60);
  });
});

describe('autoTitle', () => {
  it('reads as "{Objective} · {short date}"', () => {
    expect(autoTitle('Playing out from the back', T0)).toBe('Playing out from the back · 31 Aug');
  });

  it('truncates a long objective rather than overflowing the 80-char cap', () => {
    const long = 'A'.repeat(120);
    const title = autoTitle(long, T0);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('… · 31 Aug')).toBe(true);
  });

  it('formats the date in UTC so a title does not shift with the device timezone', () => {
    expect(autoTitle('Pressing', isoDateTime('2026-01-05T23:30:00.000Z'))).toBe('Pressing · 5 Jan');
  });
});

describe('rescaleSessionPhases', () => {
  it('preserves proportions and hits the new total exactly', () => {
    const session = build(WHOLE_PART_WHOLE);
    const before = session.phases.map((p) => p.plannedDurationMin);
    const after = rescaleSessionPhases(session, 90);

    expect(after.reduce((total, p) => total + p.plannedDurationMin, 0)).toBe(90);

    // Order is preserved: a phase that was longer than another is never re-scaled into
    // being shorter than it. Stated pairwise rather than by index, because equal-length
    // phases are common and which of them absorbs a spare step is not meaningful.
    const afterMinutes = after.map((p) => p.plannedDurationMin);
    for (let i = 0; i < before.length; i += 1) {
      for (let j = 0; j < before.length; j += 1) {
        if ((before[i] ?? 0) > (before[j] ?? 0)) {
          expect(afterMinutes[i] ?? 0).toBeGreaterThanOrEqual(afterMinutes[j] ?? 0);
        }
      }
    }
  });

  it('renumbers order contiguously, which is what makes phase insertion safe', () => {
    const session = build(CONSTRAINTS_LED);
    const shuffled = { ...session, phases: [...session.phases].reverse() };
    expect(rescaleSessionPhases(shuffled, 60).map((p) => p.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('leaves a session with no phases alone rather than dividing by zero', () => {
    const session = { ...build(), phases: [] };
    expect(rescaleSessionPhases(session, 60)).toEqual([]);
  });
});

describe('practice design', () => {
  it('carries the template spectrum onto the phase, so it costs no taps', () => {
    const session = build(PLAY_PRACTICE_PLAY);
    const spectrums = phasesInOrder(session).map((phase) => phase.spectrum);

    // Play-Practice-Play: game, overload, game — plus a null for the water break.
    expect(spectrums.filter((s) => s !== null)).toEqual(['matched_up', 'overloaded', 'matched_up']);
  });

  it('leaves a huddle or a water break off the spectrum entirely', () => {
    const session = build(PLAY_PRACTICE_PLAY);
    for (const phase of phasesInOrder(session)) {
      if (phase.kind !== 'water_break') continue;
      expect(phase.spectrum).toBeNull();
    }
  });

  it('never guesses the space or the numbers', () => {
    // A preset has no idea how many turned up or how big the pitch is. Inventing a 20×20
    // here would put a number the coach never chose into a season report.
    for (const phase of phasesInOrder(build(PLAY_PRACTICE_PLAY))) {
      expect(phase.area).toBeNull();
      expect(phase.groupSize).toBeNull();
    }
  });
});
