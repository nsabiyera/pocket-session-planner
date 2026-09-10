'use client';

import { Sheet } from './ui';
import { describeEmptyCard, type PlayerCard } from '@/domain/player-card';

/**
 * **What to tell them** — the player cards, in the huddle (ADR 0009 §4).
 *
 * The first thing this app has ever rendered for somebody other than the coach, so it follows
 * different rules from every other screen:
 *
 * - **Every line is a quote.** A challenge as written, a tag as tapped, a focus reason as
 *   carried from last week. There is no field here a summary could go in, which is what stops
 *   the card from ever producing *"well done today"*.
 * - **Nothing a player should not see.** No rating out of five, no observation count, no
 *   corner or capability label, no comparison with a teammate — see `domain/player-card.ts`
 *   for why each of those is absent.
 * - **One thing forward.** Exactly one *work on* line per player. A player given three things
 *   has been given none.
 *
 * **One sheet, a card each, rather than a card per screen.** The roadmap left this open and
 * called it a field-test question; the shape that survives contact with a wet Tuesday is the
 * one the coach can read down while twelve players stand in front of them. Do mode only logs
 * against focus players, so this is two or three cards, not twelve.
 *
 * It is read-only on purpose. There is nothing to tap, so there is nothing to mis-tap while
 * holding the phone at arm's length in front of a huddle.
 */
export function HuddleSheet({
  open,
  cards,
  onClose,
}: {
  open: boolean;
  cards: readonly PlayerCard[];
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="What to tell them" onClose={onClose}>
      {cards.length === 0 ? (
        <p className="card-meta">Nobody was set a challenge or made a focus player today.</p>
      ) : (
        <ul className="stack">
          {cards.map((card) => (
            <li key={card.playerId} className="card stack stack--tight player-card">
              <span className="card-title">{card.name}</span>

              {card.isEmpty ? (
                /*
                  Silence over invention. The same omission `/review` already flags for a focus
                  player nobody watched, said here where the coach can still do something about
                  it — and said plainly, because a coach who spent the session fixing a rondo
                  logged nothing about anybody and does not need a telling-off for it.
                */
                <p className="card-meta">{describeEmptyCard(card.name)}</p>
              ) : (
                <>
                  {/* Where am I going. */}
                  {card.ask ? (
                    <p className="player-card-line">
                      <span className="eyebrow">Your job</span>
                      <span>{card.ask}</span>
                      {card.challenge ? (
                        <span className="row">
                          <span className="pill tabular">{card.challenge.label}</span>
                          {card.challenge.verdict ? (
                            <span className="pill">{card.challenge.verdict}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </p>
                  ) : null}

                  {/*
                    Their own words, if they were asked. The only line here that is not the
                    coach's language, and therefore the safest thing on the card: reading a
                    player their own sentence back is a check rather than a judgement.
                  */}
                  {card.challenge?.said ? (
                    <p className="player-card-line">
                      <span className="eyebrow">You said</span>
                      <span className="player-card-quote">&ldquo;{card.challenge.said}&rdquo;</span>
                    </p>
                  ) : null}

                  {/* How am I going. */}
                  {card.wentWell ? (
                    <p className="player-card-line">
                      <span className="eyebrow">Went well</span>
                      <span>{card.wentWell.text}</span>
                    </p>
                  ) : null}

                  {/* Where to next — one thing, and the type cannot hold a second. */}
                  {card.workOn ? (
                    <p className="player-card-line">
                      <span className="eyebrow">Next</span>
                      <span>{card.workOn.text}</span>
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        Said out loud rather than implied by the layout. A coach reading this to a player should
        know the app is handing back their own words, not marking anybody.
      */}
      <p className="card-meta">
        Everything here is what you logged tonight, in your words. Nothing is a score.
      </p>
    </Sheet>
  );
}
