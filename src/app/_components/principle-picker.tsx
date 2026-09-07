'use client';

import { useEffect, useState } from 'react';
import { getServiceContext } from '@/modules/app/app-store';
import { getGameModel } from '@/modules/planning/game-model-service';
import {
  MOMENT_LABELS,
  PRINCIPLE_LEVEL_LABELS,
  principlesForMoment,
  type GameModel,
  type Moment,
  type Principle,
} from '@/domain/game-model';
import type { PrincipleId, SquadId } from '@/domain/ids';

/**
 * Which principle is this session training?
 *
 * The link that makes Phase 5 possible: without it the app can report what a coach *planned*
 * and never whether the week actually contained the game model.
 *
 * **Narrowed by the objective's moment.** Tapping *"Playing out from the back"* offers only the
 * in-possession principles, because that is the only set that could be what this session is
 * training — and a picker showing all forty of a professional coach's principles is a picker
 * nobody uses. `momentOf` returns null for the four individual objectives, and then this
 * renders nothing rather than asking a coach to file *"first touch"* under a team moment.
 *
 * Renders nothing at all when there is no game model. A coach who has not authored one is not
 * nagged into it from the create flow.
 */
export function PrinciplePicker({
  squadId,
  moment,
  selectedId,
  onSelect,
}: {
  squadId: SquadId;
  /** Null for an individual objective, which belongs to no moment. */
  moment: Moment | null;
  selectedId: PrincipleId | null;
  onSelect: (principleId: PrincipleId | null) => void;
}) {
  const [model, setModel] = useState<GameModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getGameModel(getServiceContext(), squadId).then((found) => {
      if (!cancelled) setModel(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [squadId]);

  if (model === null || moment === null) return null;

  const candidates = principlesForMoment(model, moment);
  if (candidates.length === 0) {
    return (
      <p className="card-meta">
        Nothing in your game model about {MOMENT_LABELS[moment].toLowerCase()} yet.
      </p>
    );
  }

  return (
    <div className="stack stack--tight">
      <p className="eyebrow">Which principle is this training?</p>
      <div className="chip-grid">
        {candidates.map((principle) => (
          <button
            key={principle.id}
            type="button"
            className="chip"
            aria-pressed={principle.id === selectedId}
            // Tapping the selected one clears it — the same gesture both ways, as the
            // challenge and unit verdicts use.
            onClick={() => onSelect(principle.id === selectedId ? null : principle.id)}
          >
            {principle.text}
            <span className="chip-count">{levelInitial(principle)}</span>
          </button>
        ))}
      </div>
      <p className="card-meta">
        Optional. It is what lets the app check the week against your model.
      </p>
    </div>
  );
}

/** `H`, `D`, `C` — the level at a glance, without spending a line on the word. */
function levelInitial(principle: Principle): string {
  return PRINCIPLE_LEVEL_LABELS[principle.level].charAt(0);
}
