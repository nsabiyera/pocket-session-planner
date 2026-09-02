'use client';

import { useState } from 'react';
import { Sheet } from './ui';
import { cornerLabel, cornerSlug, FOUR_CORNERS, type FourCorner } from '@/domain/four-corners';
import {
  emptyCornerRatings,
  type CornerRatings,
  type PlayerAssessment,
} from '@/domain/player-assessment';

/**
 * The deliberate half of the 4 Corner Model: four taps to say where a player is now.
 *
 * Ratings only, notes deferred behind a disclosure, and **nothing required** — a coach with a
 * view on two corners today records two. A profiling ritual that demands twenty minutes per
 * player is a ritual that happens exactly once.
 */
export function AssessmentSheet({
  open,
  playerName,
  previous,
  onClose,
  onSave,
}: {
  open: boolean;
  playerName: string;
  previous: PlayerAssessment | null;
  onClose: () => void;
  onSave: (input: { ratings: CornerRatings; focusCorner: FourCorner | null }) => Promise<void>;
}) {
  const [ratings, setRatings] = useState<CornerRatings>(emptyCornerRatings());
  const [focusCorner, setFocusCorner] = useState<FourCorner | null>(null);
  const [busy, setBusy] = useState(false);

  const rated = FOUR_CORNERS.filter((corner) => ratings[corner] !== null).length;

  return (
    <Sheet open={open} title={`4 Corner check — ${playerName}`} onClose={onClose}>
      <p className="card-meta">
        Rate what you can. Skipping a corner is better than guessing at one.
      </p>

      {FOUR_CORNERS.map((corner) => (
        <div key={corner} className="field corner-rating" data-corner={cornerSlug(corner)}>
          <label id={`rating-${corner}`}>
            {cornerLabel(corner)}
            {previous && previous.ratings[corner] !== null ? (
              <span className="card-meta"> — was {previous.ratings[corner]}</span>
            ) : null}
          </label>
          <div className="rating" role="group" aria-labelledby={`rating-${corner}`}>
            {[1, 2, 3, 4, 5].map((score) => (
              <button
                key={score}
                type="button"
                className="rating-dot"
                aria-pressed={ratings[corner] === score}
                aria-label={`${cornerLabel(corner)}: ${score} out of 5`}
                onClick={() =>
                  setRatings((current) => ({
                    ...current,
                    // Tapping the same score again clears it, so a mis-tap is recoverable
                    // without a separate "clear" affordance.
                    [corner]: current[corner] === score ? null : score,
                  }))
                }
              >
                {score}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="field">
        <label id="focus-corner-label">Work on next</label>
        <div className="row row--wrap" role="group" aria-labelledby="focus-corner-label">
          {FOUR_CORNERS.map((corner) => (
            <button
              key={corner}
              type="button"
              className="chip"
              aria-pressed={focusCorner === corner}
              onClick={() => setFocusCorner((current) => (current === corner ? null : corner))}
            >
              {cornerLabel(corner)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="btn btn--primary btn--lg btn--block"
        disabled={busy || rated === 0}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave({ ratings, focusCorner });
            setRatings(emptyCornerRatings());
            setFocusCorner(null);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save {rated} of 4
      </button>
    </Sheet>
  );
}
