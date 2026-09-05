import { describe, expect, it } from 'vitest';
import { describeChoice, hasEnoughForChoice, type ChoiceSummary } from './engagement';

const summary = (phasesWithChoice: number, phasesConsidered: number): ChoiceSummary => ({
  phasesWithChoice,
  phasesConsidered,
});

describe('describeChoice', () => {
  it('is the roadmap sentence', () => {
    expect(describeChoice(summary(1, 3))).toBe('Players chose something in 1 phase of 3.');
  });

  it('gets the plural right', () => {
    expect(describeChoice(summary(2, 5))).toBe('Players chose something in 2 phases of 5.');
  });

  it('describes the record, not the players, when nothing was recorded', () => {
    // The toggle defaults to off, so zero means "not recorded" at least as often as it means
    // "not offered". Saying "players chose nothing" would be a verdict drawn from a box
    // nobody tapped.
    expect(describeChoice(summary(0, 5))).toBe('No player choices recorded, across 5 phases.');
    expect(describeChoice(summary(0, 5))).not.toContain('Players chose nothing');
    expect(describeChoice(summary(0, 1))).toBe('No player choices recorded, across 1 phase.');
  });

  it('handles a session with nothing to look at', () => {
    expect(describeChoice(summary(0, 0))).toBe('No phases to look at.');
  });

  it('never uses the theory’s own vocabulary', () => {
    // Rule 1 of the module: this records a coach's intention, not a player's experience.
    // Saying "autonomy" would claim the second from evidence for the first.
    const banned = ['autonomy', 'motivation', 'commitment', 'self-determination', 'engagement'];
    for (const [chosen, total] of [
      [0, 1],
      [0, 5],
      [1, 3],
      [4, 4],
    ]) {
      const line = describeChoice(summary(chosen!, total!)).toLowerCase();
      for (const word of banned) expect(line, `"${line}"`).not.toContain(word);
    }
  });

  it('never scolds a session with no choice in it', () => {
    // A coach who never offers a choice is told the count and nothing else. Rule 3.
    const line = describeChoice(summary(0, 6));
    expect(line).not.toMatch(/should|try|ought|need|why not|consider|more|let them/i);
  });

  it('never grades or sets a target', () => {
    for (let chosen = 0; chosen <= 5; chosen += 1) {
      const line = describeChoice(summary(chosen, 5));
      expect(line).not.toMatch(/good|poor|low|high|only|just|enough|target/i);
    }
  });
});

describe('hasEnoughForChoice', () => {
  it('stays quiet for a session with one phase', () => {
    // Restating the toggle back at the coach is not a report.
    expect(hasEnoughForChoice(summary(0, 1))).toBe(false);
    expect(hasEnoughForChoice(summary(1, 1))).toBe(false);
  });

  it('speaks once there are two phases to compare', () => {
    expect(hasEnoughForChoice(summary(0, 2))).toBe(true);
  });
});

describe('what this module deliberately does not do', () => {
  it('models relatedness not at all', async () => {
    // The honest answer is that a session plan cannot see whether a player feels they belong.
    // A proxy built from attendance or observation counts would look like evidence and would
    // not be one, so there is nothing here to import.
    const module = await import('./engagement');
    const names = Object.keys(module).join(' ').toLowerCase();
    expect(names).not.toContain('related');
    expect(names).not.toContain('belong');
  });

  it('does not re-measure competence, which is already derivable', async () => {
    // Challenge verdicts (`challengePointSignals`) and scan deltas (`capabilityDeltas`)
    // already answer it. A third, weaker number would just disagree with them.
    const module = await import('./engagement');
    expect(Object.keys(module).join(' ').toLowerCase()).not.toContain('competence');
  });
});
