'use client';

import { useEffect, useState } from 'react';
import { Sheet } from './ui';
import { shortPlayerName } from '@/domain/player';
import type { Player } from '@/domain/player';
import type { PlayerId } from '@/domain/ids';
import type { Session, SessionPhase } from '@/domain/session';

/**
 * Who was on the pitch for this period.
 *
 * The whole minutes report rests on this one interaction, so it is deliberately the cheapest
 * thing on the Do screen: the squad as chips, tapped, once a period. A coach managing rolling
 * substitutions has both hands full — asking them to stamp every change would produce precise
 * numbers nobody actually entered, and a report that looked more exact than it was.
 *
 * It opens **pre-filled with the previous period's players**, because most of a team stays on.
 * The common case is then two or three taps for the subs, and a coach who makes no changes
 * confirms rather than re-picks eleven names.
 */
export function PeriodPresenceBar({
  session,
  phase,
  players,
  onSave,
}: {
  session: Session;
  phase: SessionPhase;
  players: readonly Player[];
  onSave: (playerIds: PlayerId[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const recorded = session.match?.presence.find((entry) => entry.phaseId === phase.id);
  const count = recorded?.playerIds.length ?? 0;

  return (
    <>
      <button
        type="button"
        className={`btn btn--block ${count === 0 ? 'btn--warn' : ''}`}
        onClick={() => setOpen(true)}
      >
        {count === 0 ? 'Who is on?' : `${count} on the pitch`}
      </button>

      <PresenceSheet
        open={open}
        session={session}
        phase={phase}
        players={players}
        onClose={() => setOpen(false)}
        onSave={async (ids) => {
          await onSave(ids);
          setOpen(false);
        }}
      />
    </>
  );
}

function PresenceSheet({
  open,
  session,
  phase,
  players,
  onClose,
  onSave,
}: {
  open: boolean;
  session: Session;
  phase: SessionPhase;
  players: readonly Player[];
  onClose: () => void;
  onSave: (playerIds: PlayerId[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<PlayerId>>(new Set());
  const [busy, setBusy] = useState(false);

  // Seeded when the sheet opens, not on every render, so a coach's taps are never overwritten
  // by a re-render arriving from the timer.
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(seedFor(session, phase)));
  }, [open, session, phase]);

  return (
    <Sheet open={open} title={phase.title} onClose={onClose}>
      <p className="card-meta">
        Tap everyone who played any part of this {phase.title.toLowerCase()}. Minutes are counted to
        the nearest period.
      </p>

      <div className="row row--wrap">
        {players.map((player) => (
          <button
            key={player.id}
            type="button"
            className="chip chip--lg"
            aria-pressed={picked.has(player.id)}
            onClick={() =>
              setPicked((current) => {
                const next = new Set(current);
                if (next.has(player.id)) next.delete(player.id);
                else next.add(player.id);
                return next;
              })
            }
          >
            {shortPlayerName(player, players)}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="btn btn--primary btn--lg btn--block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave([...picked]);
          } finally {
            setBusy(false);
          }
        }}
      >
        {picked.size === 0 ? 'Nobody yet' : `Save ${picked.size} on`}
      </button>
    </Sheet>
  );
}

/**
 * What the sheet opens with.
 *
 * This period's own record if it has one — a coach reopening it is correcting, not starting
 * again. Otherwise the previous period's players, because most of a team stays on and
 * re-picking the whole eleven every quarter is exactly the friction that stops the record
 * being kept at all.
 */
function seedFor(session: Session, phase: SessionPhase): readonly PlayerId[] {
  const presence = session.match?.presence ?? [];
  const own = presence.find((entry) => entry.phaseId === phase.id);
  if (own) return own.playerIds;

  const ordered = [...session.phases].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((candidate) => candidate.id === phase.id);

  for (let i = index - 1; i >= 0; i -= 1) {
    const earlier = presence.find((entry) => entry.phaseId === ordered[i]?.id);
    if (earlier) return earlier.playerIds;
  }
  return [];
}
