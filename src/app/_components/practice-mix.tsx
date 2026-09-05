'use client';

import { PRACTICE_SPECTRUM, spectrumShortLabel } from '@/domain/practice';
import { describePracticeMix, hasEnoughForMix, type PracticeMix } from '@/domain/practice/mix';
import { Why } from './why';

/**
 * What kind of practice this coach actually runs, over a term.
 *
 * Deliberately **not** `CornerBalancePanel` with different labels. That panel carries an
 * evenness percentage and a *"try looking at the social corner next session"* banner, because
 * the FA says the four corners are equally important and the app can stand behind the nudge.
 *
 * Nothing here says that. There is no evenness score, no suggestion, and no target mix — the
 * contextual-interference case for varying practice is contested in sport, so the app shows
 * the pattern and stops. See the module note in `domain/practice/mix.ts`, and the `Why?`,
 * which says the evidence is mixed rather than hiding it.
 */
export function PracticeMixPanel({ mix }: { mix: PracticeMix }) {
  if (!hasEnoughForMix(mix)) return null;

  const max = Math.max(1, ...PRACTICE_SPECTRUM.map((spectrum) => mix.countBySpectrum[spectrum]));

  return (
    <section className="stack">
      <h2>Your practice mix</h2>

      {/* The bar primitive is shared with `CornerBalancePanel`; only the label column differs. */}
      <ul className="corner-bars corner-bars--wide">
        {PRACTICE_SPECTRUM.map((spectrum) => {
          const count = mix.countBySpectrum[spectrum];
          return (
            <li key={spectrum} className="corner-bar">
              <span className="corner-bar-label">{spectrumShortLabel(spectrum)}</span>
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

      <div className="card-meta">
        {describePracticeMix(mix)}
        <Why id="report:practice-mix" />
      </div>
    </section>
  );
}
