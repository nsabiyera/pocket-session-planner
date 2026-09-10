'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Empty, Loading, Screen, ScreenHead, Segmented, Sheet, Stepper } from '../_components/ui';
import { showToast } from '../_components/toast-host';
import {
  getServiceContext,
  periodizationEnabled,
  refresh,
  useAppState,
} from '@/modules/app/app-store';
import { PracticeMixPanel } from '../_components/practice-mix';
import { practiceMix } from '@/domain/practice/mix';
import { mainPracticeSpectrums } from '@/domain/session/selectors';
import {
  addPlayer,
  addPlayersFromList,
  archivePlayer,
  deletePlayerIfUnreferenced,
  restorePlayer,
  updateSquad,
} from '@/modules/squad/squad-service';
import { comparePlayers, type Player } from '@/domain/player';
import { SQUAD_LEVEL_LABELS, type SquadLevel } from '@/domain/squad';

/**
 * The roster. The simplest complete vertical slice, and the one screen where typing is
 * unavoidable — so it accepts a whole pasted team list rather than making the coach add
 * fourteen players one at a time on a phone.
 */
export default function SquadPage() {
  const state = useAppState();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<Player[]>([]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!state.squad) {
    return (
      <Screen>
        <ScreenHead title="No squad yet" />
        <Link href="/" className="btn btn--primary btn--block">
          Create a squad
        </Link>
      </Screen>
    );
  }

  const squad = state.squad;
  const players = [...state.players].sort(comparePlayers);

  const loadArchived = async () => {
    const all = await getServiceContext().store.players.listBySquad(squad.id, {
      includeArchived: true,
    });
    setArchived(all.filter((player) => player.archivedAt !== undefined));
    setShowArchived(true);
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Squad" title={squad.name} />

      <Stepper
        label="Default session length"
        value={squad.defaultSessionDurationMin}
        min={20}
        max={150}
        onChange={async (value) => {
          await updateSquad(getServiceContext(), squad.id, { defaultSessionDurationMin: value });
          await refresh();
        }}
      />

      <form
        className="row"
        onSubmit={async (event) => {
          event.preventDefault();
          if (name.trim().length === 0) return;
          await addPlayer(getServiceContext(), { squadId: squad.id, name: name.trim() });
          setName('');
          await refresh();
        }}
      >
        <div className="field spacer">
          <label htmlFor="player-name">Add a player</label>
          <input
            id="player-name"
            type="text"
            value={name}
            placeholder="7 Kai Roberts"
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn--primary" disabled={name.trim().length === 0}>
          Add
        </button>
      </form>

      <button type="button" className="btn btn--quiet btn--block" onClick={() => setBulkOpen(true)}>
        Paste a whole team list
      </button>

      {/*
        The coach's own pattern, from the sessions already in state - `recentSessions` is the
        last ten completed, so this costs no read at all. Sits above the roster because it is
        about the coach, not about any one player, and renders nothing until there is enough.
      */}
      <PracticeMixPanel mix={practiceMix(mainPracticeSpectrums(state.recentSessions))} />

      {/*
        Everything from the tactical periodization roadmap, behind its flag (ADR 0008). Off,
        Squad is the roster and the coach's own practice mix — which is the whole of what the
        user manual describes.

        `Squad level` lives inside the gate rather than beside it: its only job is the
        safeguarding decision about effort labelling on The week (ADR 0007), so with the week
        hidden it is a control over nothing. The stored value is untouched either way.
      */}
      {periodizationEnabled(state) ? (
        <>
          {/*
            The game model belongs to the squad rather than to any session, so this is its home.
            A quiet link: most weeks a coach opens Squad for the roster, and the model is edited
            in pre-season and then rarely.
          */}
          <Link href="/squad/game-model" className="btn btn--block">
            Game model
          </Link>

          <Link href="/plan/week" className="btn btn--block">
            The week
          </Link>

          {/*
            The safeguarding gate from ADR 0007, and the reason it is a squad field rather than a
            setting: a professional club runs an academy on this same app, and one global switch
            would put adult load concepts in front of a coach planning for eleven-year-olds.
            Defaults to youth, and the coach opts in.
          */}
          <Segmented<SquadLevel>
            legend="Squad level"
            value={squad.level}
            onChange={async (level) => {
              await updateSquad(getServiceContext(), squad.id, { level });
              await refresh();
              showToast(
                level === 'senior'
                  ? 'Senior — effort labelling is available on The week.'
                  : 'Youth — no effort labelling.',
              );
            }}
            options={[
              { value: 'youth', label: SQUAD_LEVEL_LABELS.youth },
              { value: 'senior', label: SQUAD_LEVEL_LABELS.senior },
            ]}
          />
        </>
      ) : null}

      <section className="stack">
        <h2>
          {players.length} player{players.length === 1 ? '' : 's'}
        </h2>

        {players.length === 0 ? (
          <Empty>No players yet. Add them one at a time, or paste the whole list.</Empty>
        ) : (
          <ul className="stack stack--tight">
            {players.map((player) => (
              <li key={player.id} className="card">
                <div className="row row--between">
                  <Link href={`/squad/player/?p=${player.id}`} className="card-title">
                    {player.shirtNumber !== undefined ? (
                      <span className="pill tabular">{player.shirtNumber}</span>
                    ) : null}{' '}
                    {player.name}
                  </Link>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={async () => {
                      const ctx = getServiceContext();
                      // Try a clean removal first: a name typed twice seconds ago is not
                      // history. Anything with observations behind it archives instead.
                      const removed = await deletePlayerIfUnreferenced(ctx, player.id);
                      if (removed.deleted) {
                        await refresh();
                        showToast(`${player.name} removed`);
                        return;
                      }
                      await archivePlayer(ctx, player.id);
                      await refresh();
                      showToast(`${player.name} archived — their history is kept`, {
                        action: {
                          label: 'Undo',
                          run: async () => {
                            await restorePlayer(ctx, player.id);
                            await refresh();
                          },
                        },
                      });
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showArchived ? (
        <section className="stack">
          <h2>Archived</h2>
          {archived.length === 0 ? (
            <Empty>Nobody archived.</Empty>
          ) : (
            <ul className="stack stack--tight">
              {archived.map((player) => (
                <li key={player.id} className="card">
                  <div className="row row--between">
                    <span>{player.name}</span>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={async () => {
                        await restorePlayer(getServiceContext(), player.id);
                        await refresh();
                        await loadArchived();
                      }}
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <button
          type="button"
          className="btn btn--quiet btn--block"
          onClick={() => void loadArchived()}
        >
          Show archived players
        </button>
      )}

      <Sheet open={bulkOpen} title="Paste a team list" onClose={() => setBulkOpen(false)}>
        <p className="card-meta">
          One per line. A leading number becomes the shirt number — <code>7 Kai Roberts</code>.
        </p>
        <div className="field">
          <label htmlFor="bulk-players">Players</label>
          <textarea
            id="bulk-players"
            value={bulkText}
            rows={8}
            onChange={(event) => setBulkText(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          onClick={async () => {
            const added = await addPlayersFromList(getServiceContext(), squad.id, bulkText);
            setBulkText('');
            setBulkOpen(false);
            await refresh();
            showToast(`${added.length} player${added.length === 1 ? '' : 's'} added`);
          }}
        >
          Add them
        </button>
      </Sheet>
    </Screen>
  );
}
