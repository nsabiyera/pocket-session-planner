import { describe, expect, it } from 'vitest';
import {
  challengePointSignals,
  describeChallengePoint,
  MIN_MISSES_FOR_SIGNAL,
  type SettledChallenge,
} from './point';
import { playerId } from '@/test/builders';
import type { ChallengeStatus } from '../challenge';

const kai = playerId('kai');
const maya = playerId('maya');

/** Oldest first, which is the order `challengePointSignals` documents as its input. */
const at = (who: typeof kai, text: string, ...statuses: ChallengeStatus[]): SettledChallenge[] =>
  statuses.map((status) => ({ playerId: who, text, status }));

describe('challengePointSignals', () => {
  it('stays silent below three misses — one bad week is not a calibration', () => {
    expect(challengePointSignals(at(kai, 'Three forward passes', 'missed', 'missed'))).toEqual([]);
    expect(MIN_MISSES_FOR_SIGNAL).toBe(3);
  });

  it('fires on three misses of the same ask', () => {
    const signals = challengePointSignals(
      at(kai, 'Three forward passes', 'missed', 'missed', 'missed'),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]!.streak).toBe(3);
    expect(signals[0]!.playerId).toBe(kai);
  });

  it('counts consecutive misses, not cumulative ones', () => {
    // Missed three, then met it. The player has moved on, and an app that kept bringing it
    // up would look like it was holding a grudge.
    const signals = challengePointSignals(
      at(kai, 'Three forward passes', 'missed', 'missed', 'missed', 'met'),
    );
    expect(signals).toEqual([]);
  });

  it('resets the streak on a partial, not just a full met', () => {
    expect(
      challengePointSignals(at(kai, 'Three forward passes', 'missed', 'missed', 'partly')),
    ).toEqual([]);
  });

  it('skips unruled challenges rather than counting silence as failure', () => {
    // `open` means the coach never ruled. Treating that as a miss would invent evidence.
    const signals = challengePointSignals(
      at(kai, 'Three forward passes', 'missed', 'open', 'missed', 'open', 'missed'),
    );
    expect(signals[0]!.streak).toBe(3);
    expect(signals[0]!.attempts).toBe(3);
  });

  it('treats the same ask written differently as the same ask', () => {
    const history: SettledChallenge[] = [
      { playerId: kai, text: 'Three forward passes', status: 'missed' },
      { playerId: kai, text: 'three forward passes.', status: 'missed' },
      { playerId: kai, text: 'Three  forward passes!', status: 'missed' },
    ];
    expect(challengePointSignals(history)).toHaveLength(1);
  });

  it('keeps different players apart', () => {
    const history = [
      ...at(kai, 'Three forward passes', 'missed', 'missed'),
      ...at(maya, 'Three forward passes', 'missed'),
    ];
    // Two players, two misses and one miss. Neither reaches three.
    expect(challengePointSignals(history)).toEqual([]);
  });

  it('keeps different asks apart for the same player', () => {
    const history = [
      ...at(kai, 'Three forward passes', 'missed', 'missed'),
      ...at(kai, 'Press on the poor touch', 'missed'),
    ];
    expect(challengePointSignals(history)).toEqual([]);
  });

  it('shows the ask that has been wrong longest first', () => {
    const history = [
      ...at(kai, 'Three forward passes', 'missed', 'missed', 'missed'),
      ...at(kai, 'Play to the free side', 'missed', 'missed', 'missed', 'missed'),
    ];
    const signals = challengePointSignals(history);
    expect(signals.map((s) => s.streak)).toEqual([4, 3]);
    expect(signals[0]!.text).toBe('Play to the free side');
  });

  it('reports the text as most recently written', () => {
    const history: SettledChallenge[] = [
      { playerId: kai, text: 'three forward passes', status: 'missed' },
      { playerId: kai, text: 'three forward passes', status: 'missed' },
      { playerId: kai, text: 'Three forward passes', status: 'missed' },
    ];
    expect(challengePointSignals(history)[0]!.text).toBe('Three forward passes');
  });
});

describe('describeChallengePoint', () => {
  const signal = { playerId: kai, text: 'Three forward passes', streak: 3, attempts: 3 };

  it('names the ask and blames the ask', () => {
    expect(describeChallengePoint(signal, 'Kai')).toBe(
      'Kai has missed “Three forward passes” 3 sessions running. The ask may be pitched wrong, not the player.',
    );
  });

  it('never draws a conclusion about the player', () => {
    const line = describeChallengePoint(signal, 'Kai').toLowerCase();
    // Rule 2 of the module: the coach is always a candidate cause.
    expect(line).toContain('not the player');
    expect(line).not.toMatch(/struggling|weak|poor|cannot|unable|behind/);
  });

  it("never uses the framework's own jargon", () => {
    const line = describeChallengePoint(signal, 'Kai').toLowerCase();
    for (const phrase of ['challenge point', 'optimal', 'retention', 'task difficulty']) {
      expect(line).not.toContain(phrase);
    }
  });
});
