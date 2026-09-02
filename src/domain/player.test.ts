import { describe, expect, it } from 'vitest';
import { comparePlayers, isActivePlayer, shortPlayerName } from './player';
import { aPlayer, T0 } from '@/test/builders';

describe('isActivePlayer', () => {
  it('is true only for a player who is neither archived nor deleted', () => {
    expect(isActivePlayer(aPlayer('kai'))).toBe(true);
    expect(isActivePlayer(aPlayer('kai', { archivedAt: T0 }))).toBe(false);
    expect(isActivePlayer(aPlayer('kai', { deletedAt: T0 }))).toBe(false);
  });
});

describe('comparePlayers', () => {
  const sortedNames = (players: ReturnType<typeof aPlayer>[]) =>
    [...players].sort(comparePlayers).map((p) => p.name);

  it('sorts by shirt number when both players have one', () => {
    expect(
      sortedNames([
        aPlayer('kai', { shirtNumber: 9 }),
        aPlayer('maya', { shirtNumber: 2 }),
        aPlayer('sam', { shirtNumber: 7 }),
      ]),
    ).toEqual(['Maya', 'Sam', 'Kai']);
  });

  it('puts numbered players before unnumbered ones', () => {
    expect(
      sortedNames([aPlayer('alice'), aPlayer('kai', { shirtNumber: 9 }), aPlayer('bob')]),
    ).toEqual(['Kai', 'Alice', 'Bob']);
  });

  it('falls back to name for two unnumbered players, and for a shirt-number tie', () => {
    expect(sortedNames([aPlayer('zoe'), aPlayer('adam')])).toEqual(['Adam', 'Zoe']);
    expect(
      sortedNames([aPlayer('zoe', { shirtNumber: 7 }), aPlayer('adam', { shirtNumber: 7 })]),
    ).toEqual(['Adam', 'Zoe']);
  });
});

describe('shortPlayerName', () => {
  it('is the first name when nothing clashes — chips have about ten characters', () => {
    const roster = [
      aPlayer('kai', { name: 'Kai Roberts' }),
      aPlayer('maya', { name: 'Maya Okafor' }),
    ];
    expect(shortPlayerName(roster[0]!, roster)).toBe('Kai');
  });

  it('adds a surname initial only when two first names clash', () => {
    const roster = [
      aPlayer('kai1', { name: 'Kai Roberts' }),
      aPlayer('kai2', { name: 'Kai Nowak' }),
      aPlayer('maya', { name: 'Maya Okafor' }),
    ];
    expect(shortPlayerName(roster[0]!, roster)).toBe('Kai R');
    expect(shortPlayerName(roster[1]!, roster)).toBe('Kai N');
    expect(shortPlayerName(roster[2]!, roster)).toBe('Maya');
  });

  it('leaves a one-word name alone even when it clashes', () => {
    const roster = [aPlayer('a', { name: 'Kai' }), aPlayer('b', { name: 'Kai Roberts' })];
    expect(shortPlayerName(roster[0]!, roster)).toBe('Kai');
  });

  it('uses the last name part, so a middle name does not become the initial', () => {
    const roster = [
      aPlayer('a', { name: 'Kai John Roberts' }),
      aPlayer('b', { name: 'Kai Nowak' }),
    ];
    expect(shortPlayerName(roster[0]!, roster)).toBe('Kai R');
  });
});
