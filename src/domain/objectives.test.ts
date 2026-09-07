import { describe, expect, it } from 'vitest';
import {
  findObjectiveTemplate,
  objectiveUsageFrom,
  OBJECTIVE_LIBRARY,
  OBJECTIVE_THEMES,
  momentOf,
  orderObjectives,
  type ObjectiveTemplate,
} from './objectives';
import { FOUR_CORNERS } from './four-corners';
import { MOMENTS } from './game-model';

describe('the objective library', () => {
  it('ships fourteen objectives — enough to cover a season, few enough to scan', () => {
    expect(OBJECTIVE_LIBRARY).toHaveLength(14);
  });

  it('gives every objective a usable set of canned coaching points', () => {
    for (const objective of OBJECTIVE_LIBRARY) {
      expect(objective.coachingPoints.length).toBeGreaterThanOrEqual(4);
      expect(objective.coachingPoints.length).toBeLessThanOrEqual(6);
      expect(objective.successCriteria.length).toBeGreaterThan(0);
      expect(objective.text.length).toBeLessThanOrEqual(140);
    }
  });

  it('files every objective under a primary corner', () => {
    // "Mainly", not "only" — the model's own position is that no corner works in isolation.
    // This is what lets the planner notice six technical objectives in a row.
    for (const objective of OBJECTIVE_LIBRARY) {
      expect(FOUR_CORNERS).toContain(objective.primaryCorner);
    }
  });

  it('covers more than one corner across the library', () => {
    const corners = new Set(OBJECTIVE_LIBRARY.map((o) => o.primaryCorner));
    // A library where every objective is technical would quietly make the whole feature
    // impossible to act on.
    expect(corners.size).toBeGreaterThanOrEqual(3);
  });

  it('uses unique ids and a known theme', () => {
    const ids = OBJECTIVE_LIBRARY.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const objective of OBJECTIVE_LIBRARY) {
      expect(OBJECTIVE_THEMES[objective.theme]).toBeTruthy();
    }
  });

  it('resolves by id, and reports a stranger', () => {
    expect(findObjectiveTemplate('playing-out-from-the-back')?.text).toBe(
      'Playing out from the back',
    );
    expect(findObjectiveTemplate('nope')).toBeUndefined();
  });
});

describe('orderObjectives', () => {
  const objective = (id: string): ObjectiveTemplate => ({
    id,
    text: id,
    theme: 'offensive_organisation',
    successCriteria: ['x'],
    coachingPoints: ['a', 'b', 'c', 'd'],
    preferredPhaseKind: 'skill_practice',
    primaryCorner: 'technical_tactical',
  });

  const library = ['alpha', 'bravo', 'charlie', 'delta'].map((id) => objective(id));

  it('keeps the authored order when nothing has been used', () => {
    expect(orderObjectives(library, new Map()).map((o) => o.id)).toEqual([
      'alpha',
      'bravo',
      'charlie',
      'delta',
    ]);
  });

  it('puts the most-used objectives first', () => {
    const usage = new Map([
      ['charlie', { count: 5, lastUsedAt: '2026-01-01T00:00:00.000Z' }],
      ['bravo', { count: 2, lastUsedAt: '2026-08-01T00:00:00.000Z' }],
    ]);
    expect(orderObjectives(library, usage).map((o) => o.id)).toEqual([
      'charlie',
      'bravo',
      'alpha',
      'delta',
    ]);
  });

  it('breaks a frequency tie on recency', () => {
    const usage = new Map([
      ['alpha', { count: 3, lastUsedAt: '2026-01-01T00:00:00.000Z' }],
      ['delta', { count: 3, lastUsedAt: '2026-08-01T00:00:00.000Z' }],
    ]);
    expect(
      orderObjectives(library, usage)
        .map((o) => o.id)
        .slice(0, 2),
    ).toEqual(['delta', 'alpha']);
  });

  it('is stable enough to build muscle memory — the same input gives the same grid', () => {
    // Frequency first rather than pure recency, precisely so the layout does not reshuffle
    // after every session.
    const usage = new Map([['bravo', { count: 4, lastUsedAt: '2026-08-01T00:00:00.000Z' }]]);
    const first = orderObjectives(library, usage).map((o) => o.id);
    for (let i = 0; i < 3; i += 1) {
      expect(orderObjectives(library, usage).map((o) => o.id)).toEqual(first);
    }
  });
});

describe('objectiveUsageFrom', () => {
  it('counts uses and keeps the most recent date', () => {
    const usage = objectiveUsageFrom([
      { objective: { text: 'Pressing' }, scheduledFor: '2026-03-01T00:00:00.000Z' },
      { objective: { text: 'Pressing' }, scheduledFor: '2026-05-01T00:00:00.000Z' },
      { objective: { text: 'Finishing' }, scheduledFor: '2026-04-01T00:00:00.000Z' },
    ]);

    expect(usage.get('Pressing')).toEqual({
      count: 2,
      lastUsedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(usage.get('Finishing')?.count).toBe(1);
  });

  it('does not let an out-of-order history move the last-used date backwards', () => {
    const usage = objectiveUsageFrom([
      { objective: { text: 'Pressing' }, scheduledFor: '2026-05-01T00:00:00.000Z' },
      { objective: { text: 'Pressing' }, scheduledFor: '2026-03-01T00:00:00.000Z' },
    ]);
    expect(usage.get('Pressing')?.lastUsedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('is empty for a squad with no history', () => {
    expect(objectiveUsageFrom([]).size).toBe(0);
  });
});

describe('the four moments, split', () => {
  /**
   * The two transitions were one `transition` value until Phase 2. They map in opposite
   * directions and neither is ambiguous — which is what made the split cheap.
   */
  it('files counter-attacking as the attacking transition', () => {
    expect(findObjectiveTemplate('counter-attacking')?.theme).toBe('transition_to_attack');
  });

  it('files reacting to losing the ball as the defensive transition', () => {
    expect(findObjectiveTemplate('reaction-to-losing-the-ball')?.theme).toBe(
      'transition_to_defence',
    );
  });

  it('speaks the same moment vocabulary as the game model', () => {
    // One enum, not two that happen to agree. Phase 3 links an objective to a principle by
    // moment, and a second spelling would drift the first time either was edited.
    for (const objective of OBJECTIVE_LIBRARY) {
      const moment = momentOf(objective.theme);
      if (moment !== null) expect(MOMENTS).toContain(moment);
    }
  });

  it('returns no moment for an individual objective, rather than guessing one', () => {
    // "First touch out of your feet" is not offensive organisation, and filing it there to
    // fit a four-moments scheme would be the app inventing a fact.
    expect(momentOf('individual')).toBeNull();
    expect(momentOf(findObjectiveTemplate('first-touch')!.theme)).toBeNull();
  });

  it('covers every moment at least once', () => {
    const covered = new Set(
      OBJECTIVE_LIBRARY.map((objective) => momentOf(objective.theme)).filter(
        (moment): moment is (typeof MOMENTS)[number] => moment !== null,
      ),
    );
    expect([...covered].sort()).toEqual([...MOMENTS].sort());
  });

  it('is thin on the transitions, which is worth knowing before Phase 3', () => {
    // Two of fourteen, against half the moments in the methodology. Recorded as a fact so a
    // coach authoring principles knows the library will not carry that weight for them.
    const transitions = OBJECTIVE_LIBRARY.filter((objective) =>
      objective.theme.startsWith('transition_'),
    );
    expect(transitions).toHaveLength(2);
  });

  it('labels every theme, moments included', () => {
    for (const objective of OBJECTIVE_LIBRARY) {
      expect(OBJECTIVE_THEMES[objective.theme]).toBeTruthy();
    }
    expect(OBJECTIVE_THEMES.individual).toBe('Individual');
  });
});
