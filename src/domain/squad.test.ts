import { describe, expect, it } from 'vitest';
import { compareSquads, isArchived, SquadSchema } from './squad';
import { aSquad, T0 } from '@/test/builders';

describe('compareSquads', () => {
  it('orders by name, not by when the squad was last touched', () => {
    // The repository sorts by `updatedAt`, which is right for the export and wrong for a list
    // a coach picks from twice a week: renaming a team would move it under their thumb.
    const squads = [
      aSquad({ name: 'U14 Greens', updatedAt: T0 }),
      aSquad({ name: 'First Team' }),
      aSquad({ name: 'U12 Reds' }),
    ];

    expect([...squads].sort(compareSquads).map((squad) => squad.name)).toEqual([
      'First Team',
      'U12 Reds',
      'U14 Greens',
    ]);
  });

  it('ignores case, so a lower-cased team does not sort to the end', () => {
    const squads = [aSquad({ name: 'reserves' }), aSquad({ name: 'First Team' })];

    expect([...squads].sort(compareSquads).map((squad) => squad.name)).toEqual([
      'First Team',
      'reserves',
    ]);
  });
});

describe('isArchived', () => {
  it('is false until the coach archives the squad', () => {
    expect(isArchived(aSquad())).toBe(false);
    expect(isArchived(aSquad({ archivedAt: T0 }))).toBe(true);
  });
});

describe('the schema', () => {
  it('defaults a squad to youth and an hour, which are the safe answers', () => {
    const squad = SquadSchema.parse({
      schemaVersion: 1,
      createdAt: T0,
      updatedAt: T0,
      id: aSquad().id,
      name: 'U12 Reds',
    });

    // Youth gates the adult load-management vocabulary off (ADR 0007).
    expect(squad).toMatchObject({ level: 'youth', defaultSessionDurationMin: 60 });
    expect(squad.archivedAt).toBeUndefined();
  });
});
