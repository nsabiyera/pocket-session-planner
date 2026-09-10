import { describe, expect, it } from 'vitest';
import {
  challengeVerdict,
  describeEmptyCard,
  playerCard,
  playerCards,
  type CardChallenge,
} from './player-card';
import { playerId } from '@/test/builders';
import type { Observation } from './observation';

const KAI = playerId('kai');
const MAYA = playerId('maya');
const MISCONCEPTION = 'They think playing out means never going long.';

type ObservationLike = Pick<Observation, 'ratingKind' | 'kind' | 'tags'>;

const logged = (
  ratingKind: ObservationLike['ratingKind'],
  tags: string[],
  kind: ObservationLike['kind'] = ratingKind === 'good' ? 'strength' : 'development',
): ObservationLike => ({ ratingKind, kind, tags });

const aChallengeCard = (over: Partial<CardChallenge> = {}): CardChallenge => ({
  text: 'Three forward passes',
  label: '2/3',
  status: 'open',
  verdict: null,
  said: '',
  ...over,
});

const cardFor = (over: Partial<Parameters<typeof playerCard>[0]> = {}) =>
  playerCard({
    playerId: KAI,
    name: 'Kai',
    focusReason: null,
    challenge: null,
    observations: [],
    misconception: MISCONCEPTION,
    ...over,
  });

describe("Hattie's three questions, in order", () => {
  it('answers where am I going with the challenge as written', () => {
    const card = cardFor({ challenge: aChallengeCard() });
    expect(card.ask).toBe('Three forward passes');
    expect(card.challenge?.label).toBe('2/3');
  });

  it('falls back to why they were a focus player, which is last week own next step', () => {
    // `FocusPlayerAssignment.reason` is carried verbatim from the previous review's next step,
    // so this is literally "where am I going" already written down.
    const card = cardFor({ focusReason: 'Scan before you receive' });
    expect(card.ask).toBe('Scan before you receive');
  });

  it('prefers the challenge over the focus reason — it is what they were asked today', () => {
    const card = cardFor({ challenge: aChallengeCard(), focusReason: 'Scan before you receive' });
    expect(card.ask).toBe('Three forward passes');
  });

  it('answers how am I going with one thing that worked', () => {
    const card = cardFor({
      observations: [logged('good', ['Head up before you receive'])],
    });
    expect(card.wentWell?.text).toBe('Head up before you receive');
  });

  it('answers where to next with exactly one thing', () => {
    const card = cardFor({
      observations: [
        logged('struggled', ['First touch']),
        logged('struggled', ['Body shape']),
        logged('working', ['Switching play']),
      ],
    });
    // One field, not a list. A player given three things has been given none, and the type
    // cannot hold a second one.
    expect(card.workOn?.text).toBe('Body shape');
  });
});

describe('the four rules the shape enforces', () => {
  it('quotes, and cannot summarise', () => {
    const card = cardFor({
      challenge: aChallengeCard({ text: 'Two touches in the middle' }),
      observations: [logged('good', ['Set and spin']), logged('struggled', [MISCONCEPTION])],
    });

    // Every string on the card came from something somebody typed or tapped.
    const strings = [card.ask, card.wentWell?.text, card.workOn?.text];
    expect(strings).toEqual(['Two touches in the middle', 'Set and spin', MISCONCEPTION]);
    // There is no field a phrase like this could occupy.
    expect(JSON.stringify(card)).not.toMatch(/well done|good effort|keep it up/i);
  });

  it('holds no rating, no count and no comparison', () => {
    const card = cardFor({
      observations: [logged('good', ['Scanning']), logged('struggled', ['First touch'])],
    });
    // Rule 3, as a shape assertion rather than a promise: there is nowhere for a five-point
    // rating, an observation count, a corner or another player's name to live.
    const keys = Object.keys(card).sort();
    expect(keys).toEqual(
      ['ask', 'challenge', 'isEmpty', 'name', 'playerId', 'wentWell', 'workOn'].sort(),
    );
    expect(JSON.stringify(card)).not.toMatch(/rating|corner|capability/i);
  });

  it('says nothing was logged rather than inventing something', () => {
    const card = cardFor({});
    expect(card.isEmpty).toBe(true);
    expect(card.wentWell).toBeNull();
    expect(card.workOn).toBeNull();
    expect(describeEmptyCard('Kai')).toBe('Nothing logged for Kai today.');
    // Not a rebuke. A coach who spent the session fixing a rondo logged nothing about anybody.
    expect(describeEmptyCard('Kai')).not.toMatch(/should|failed|forgot|missed/i);
  });

  it('is not empty when the player was asked something, even with nothing logged', () => {
    // There is still a card worth reading: the ask, and an honest silence after it.
    const card = cardFor({ challenge: aChallengeCard() });
    expect(card.isEmpty).toBe(false);
    expect(card.wentWell).toBeNull();
  });
});

describe('choosing which observation to read out', () => {
  it('skips an untagged observation, which would only say "you were good"', () => {
    const card = cardFor({
      observations: [logged('good', []), logged('struggled', ['  '])],
    });
    // The person-level praise rule 3 exists to prevent. Better to show nothing.
    expect(card.wentWell).toBeNull();
    expect(card.workOn).toBeNull();
  });

  it('reads out one tag, not the four the coach tapped', () => {
    const card = cardFor({
      observations: [logged('good', ['Scanning', 'Positioning', 'Balance', 'Timing'])],
    });
    expect(card.wentWell?.text).toBe('Scanning');
  });

  it('prefers the predicted misconception for the thing to work on', () => {
    const card = cardFor({
      observations: [
        logged('struggled', [MISCONCEPTION]),
        logged('struggled', ['Something else entirely']),
      ],
    });
    // Later in the session, but the predicted one wins: the coach called it in advance, so
    // they can explain it in one sentence. This is what phase 2 was for.
    expect(card.workOn?.text).toBe(MISCONCEPTION);
  });

  it('falls back to struggled, then to working', () => {
    expect(cardFor({ observations: [logged('working', ['Switching play'])] }).workOn?.text).toBe(
      'Switching play',
    );

    const both = cardFor({
      observations: [logged('working', ['Switching play']), logged('struggled', ['First touch'])],
    });
    expect(both.workOn?.text).toBe('First touch');
  });

  it('takes the most recent of equals, because the huddle is about the end of the session', () => {
    const card = cardFor({
      observations: [logged('good', ['Early scan']), logged('good', ['Late switch'])],
    });
    expect(card.wentWell?.text).toBe('Late switch');
  });

  /**
   * The roadmap asked for effort to be preferred, *"because effort is what a player can act on
   * next week"*. Nothing in this app has ever written an `effort` observation — the sheet
   * derives `kind` from the three tokens and none of them maps to it — so this is implemented
   * for an imported file and will never fire on data the app produced.
   */
  it('prefers an effort observation where one somehow exists', () => {
    const card = cardFor({
      observations: [
        logged('good', ['Late switch']),
        logged('good', ['Kept going after the mistake'], 'effort'),
      ],
    });
    expect(card.wentWell).toEqual({ text: 'Kept going after the mistake', aboutEffort: true });
  });

  it('marks an ability observation as not about effort', () => {
    const card = cardFor({ observations: [logged('good', ['Scanning'])] });
    expect(card.wentWell?.aboutEffort).toBe(false);
  });
});

describe("the player's own words", () => {
  it('rides the card verbatim, quotes and all', () => {
    const card = cardFor({
      challenge: aChallengeCard({ said: "I couldn't see the far side" }),
    });
    // Not summarised, not tidied, not sentence-cased. It is a quote (ADR 0009 phase 7).
    expect(card.challenge?.said).toBe("I couldn't see the far side");
  });

  it('is empty when they were not asked, and the card shows nothing', () => {
    expect(cardFor({ challenge: aChallengeCard() }).challenge?.said).toBe('');
  });
});

describe('the challenge verdict', () => {
  it('reads the coach ruling, and nothing at all while it is open', () => {
    expect(challengeVerdict('met')).toBe('Met');
    expect(challengeVerdict('partly')).toBe('Partly');
    expect(challengeVerdict('missed')).toBe('Missed');
    // `open` is a starting state, not a verdict. A card that showed "Open" to a player would
    // be reading the app's own bookkeeping out loud.
    expect(challengeVerdict('open')).toBeNull();
  });
});

describe('who gets a card', () => {
  const cards = (over: Partial<Parameters<typeof playerCards>[0]> = {}) =>
    playerCards({
      focusPlayers: [{ playerId: KAI, reason: 'Scan before you receive' }],
      challenges: [{ playerId: MAYA, card: aChallengeCard() }],
      observations: [],
      misconception: MISCONCEPTION,
      nameOf: (id) => (id === KAI ? 'Kai' : 'Maya'),
      ...over,
    });

  it('covers focus players and anyone holding a challenge, focus players first', () => {
    expect(cards().map((card) => card.name)).toEqual(['Kai', 'Maya']);
  });

  it('gives a player who is both only one card', () => {
    const one = cards({ challenges: [{ playerId: KAI, card: aChallengeCard() }] });
    expect(one).toHaveLength(1);
    // And the challenge still wins the ask line.
    expect(one[0]?.ask).toBe('Three forward passes');
  });

  it('files each observation against the right player', () => {
    const built = cards({
      observations: [
        { playerId: KAI, ...logged('good', ['Early scan']) },
        { playerId: MAYA, ...logged('struggled', ['First touch']) },
      ],
    });
    expect(built[0]?.wentWell?.text).toBe('Early scan');
    expect(built[0]?.workOn).toBeNull();
    expect(built[1]?.workOn?.text).toBe('First touch');
  });

  it('ignores a team-wide observation, which belongs to nobody', () => {
    const built = cards({
      observations: [{ ...logged('good', ['Great tempo']) }],
    });
    expect(built.every((card) => card.wentWell === null)).toBe(true);
  });

  it('produces nothing at all when nobody was watched', () => {
    // Which is what keeps the chip off the screen entirely — the floor, in place of a flag.
    expect(cards({ focusPlayers: [], challenges: [] })).toEqual([]);
  });
});
