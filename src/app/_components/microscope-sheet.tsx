'use client';

import { useState } from 'react';
import { Sheet } from './ui';
import {
  capabilityDescription,
  capabilityLabel,
  CORE_CAPABILITIES,
  type CoreCapability,
} from '@/domain/capabilities';
import {
  emptyCapabilityRatings,
  OBSERVED_SKILLS,
  skillLabel,
  type CapabilityEvidence,
  type CapabilityRatings,
  type CapabilityScan,
  type ObservedSkill,
} from '@/domain/capabilities/scan';

/**
 * **Under the microscope** — the deliberate half of the six core capabilities.
 *
 * One player, one skill, six ratings. Same restraint as the 4 Corner check: nothing is
 * required, and skipping a capability is better than guessing at one.
 *
 * The difference is the evidence column. Each row carries what this player's own logged
 * observations already say about that capability, so the coach is confirming or overruling
 * something rather than trying to remember a session that finished twenty minutes ago. It
 * never pre-fills a rating — the judgement is theirs, not the arithmetic's.
 */
export function MicroscopeSheet({
  open,
  playerName,
  skill,
  evidence,
  previous,
  onSkillChange,
  onClose,
  onSave,
}: {
  open: boolean;
  playerName: string;
  skill: ObservedSkill;
  evidence: Record<CoreCapability, CapabilityEvidence>;
  /** The last scan of this same skill, so each row can say what it was last time. */
  previous: CapabilityScan | null;
  onSkillChange: (skill: ObservedSkill) => void;
  onClose: () => void;
  onSave: (input: {
    ratings: CapabilityRatings;
    focusCapability: CoreCapability | null;
  }) => Promise<void>;
}) {
  const [ratings, setRatings] = useState<CapabilityRatings>(emptyCapabilityRatings());
  const [focusCapability, setFocusCapability] = useState<CoreCapability | null>(null);
  const [busy, setBusy] = useState(false);

  const rated = CORE_CAPABILITIES.filter((capability) => ratings[capability] !== null).length;

  return (
    <Sheet open={open} title={`Under the microscope — ${playerName}`} onClose={onClose}>
      {/*
        The skill comes first: the six capabilities mean nothing until the coach has said what
        the player was doing. Changing it reloads the evidence and the previous scan.
      */}
      <div className="field">
        <label id="scan-skill-label">Doing what?</label>
        <div className="row row--wrap" role="group" aria-labelledby="scan-skill-label">
          {OBSERVED_SKILLS.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              aria-pressed={skill === option}
              onClick={() => onSkillChange(option)}
            >
              {skillLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <p className="card-meta">Rate what you saw. Skipping one is better than guessing at it.</p>

      {CORE_CAPABILITIES.map((capability) => {
        const seen = evidence[capability];
        const was = previous?.ratings[capability] ?? null;

        return (
          <div key={capability} className="field capability-rating">
            <label id={`scan-${capability}`}>
              {capabilityLabel(capability)}
              {was !== null ? <span className="card-meta"> — was {was}</span> : null}
            </label>
            <span className="card-meta">{capabilityDescription(capability)}</span>

            {/* What the coach's own observations already say. Silent when there is nothing. */}
            {seen.count > 0 ? (
              <span className="card-meta tabular">
                {seen.count} logged
                {seen.strengths > 0 ? ` · ${seen.strengths} good` : ''}
                {seen.needsWork > 0 ? ` · ${seen.needsWork} to work on` : ''}
              </span>
            ) : null}

            <div className="rating" role="group" aria-labelledby={`scan-${capability}`}>
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  className="rating-dot"
                  aria-pressed={ratings[capability] === score}
                  aria-label={`${capabilityLabel(capability)}: ${score} out of 5`}
                  onClick={() =>
                    setRatings((current) => ({
                      ...current,
                      // Tapping the same score again clears it, so a mis-tap is recoverable
                      // without a separate "clear" affordance.
                      [capability]: current[capability] === score ? null : score,
                    }))
                  }
                >
                  {score}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* The bit that turns a profile into an intention — it is a challenge waiting to be set. */}
      <div className="field">
        <label id="focus-capability-label">Work on next</label>
        <div className="row row--wrap" role="group" aria-labelledby="focus-capability-label">
          {CORE_CAPABILITIES.map((capability) => (
            <button
              key={capability}
              type="button"
              className="chip"
              aria-pressed={focusCapability === capability}
              onClick={() =>
                setFocusCapability((current) => (current === capability ? null : capability))
              }
            >
              {capabilityLabel(capability)}
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
            await onSave({ ratings, focusCapability });
            setRatings(emptyCapabilityRatings());
            setFocusCapability(null);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save {rated} of 6
      </button>
    </Sheet>
  );
}
