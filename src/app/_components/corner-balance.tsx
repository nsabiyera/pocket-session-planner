'use client';

import {
  cornerLabel,
  cornerShortLabel,
  cornerSlug,
  FOUR_CORNERS,
  type FourCorner,
} from '@/domain/four-corners';
import {
  describeCornerBalance,
  hasEnoughForBalance,
  type CornerBalance,
} from '@/domain/four-corners/balance';
import { Why } from './why';

/**
 * The FA 4 Corner balance panel.
 *
 * > "Each of these 'corners' is equally important, and no one corner works in isolation."
 *
 * Four bars and one sentence. The bars are the pattern; the sentence is the point. A corner
 * with nothing in it gets a visible empty track and the word "none" rather than simply being
 * absent — an invisible gap is exactly the gap this whole feature exists to surface.
 */
export function CornerBalancePanel({
  balance,
  subject,
  suggestion,
}: {
  balance: CornerBalance;
  subject: string;
  suggestion?: FourCorner | null;
}) {
  const max = Math.max(1, ...FOUR_CORNERS.map((corner) => balance.countByCorner[corner]));

  return (
    <section className="stack">
      <div className="row row--between">
        <h2>4 Corner balance</h2>
        {balance.classified > 0 ? (
          <span className="card-meta tabular">{Math.round(balance.evenness * 100)}% even</span>
        ) : null}
      </div>

      <ul className="corner-bars">
        {FOUR_CORNERS.map((corner) => {
          const count = balance.countByCorner[corner];
          return (
            <li key={corner} className="corner-bar" data-corner={cornerSlug(corner)}>
              <span className="corner-bar-label">{cornerShortLabel(corner)}</span>
              <span className="corner-bar-track">
                <span
                  className="corner-bar-fill"
                  style={{ width: `${Math.round((count / max) * 100)}%` }}
                />
              </span>
              {/* "none" in words, not just an empty bar — colour and length alone would be
                  invisible to a screen reader and easy to miss in glare. */}
              <span className="corner-bar-count tabular">{count === 0 ? 'none' : count}</span>
            </li>
          );
        })}
      </ul>

      {/*
        A `<div>` rather than a `<p>`: `<details>` is flow content and a paragraph takes only
        phrasing, so the browser would close the `<p>` early and hydration would mismatch.
      */}
      <div className="card-meta">
        {describeCornerBalance(balance, subject)}
        <Why id="report:corner-balance" />
      </div>

      {balance.unclassified > 0 ? (
        <p className="card-meta">
          {balance.unclassified} observation{balance.unclassified === 1 ? '' : 's'} with no tag, so
          not counted above.
        </p>
      ) : null}

      {suggestion && hasEnoughForBalance(balance) ? (
        <div className="banner banner--signal">
          Try looking at the {cornerLabel(suggestion).toLowerCase()} corner next session.
          <Why id="report:neglected-corner" />
        </div>
      ) : null}
    </section>
  );
}
