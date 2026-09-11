'use client';

import { useState } from 'react';
import { Empty, Sheet } from './ui';
import { showToast } from './toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import {
  archiveSquad,
  createSquad,
  restoreSquad,
  switchSquad,
  updateSquad,
} from '@/modules/squad/squad-service';
import { compareSquads, type Squad } from '@/domain/squad';
import { isErr } from '@/lib/result';

/**
 * Several teams, managed from Settings (ADR 0010).
 *
 * It lives here rather than on `/squad` because that screen is *about* the current squad — its
 * roster, its game model, its practice mix — and a control that changes which squad that is
 * does not belong inside the thing it changes. Settings is also where the coach already goes
 * for the answers to "how is this app set up for me", which is exactly the question a second
 * team is.
 *
 * The panel is shown on a one-squad install too, with `Add another squad` as its only action.
 * A switcher that appears out of nowhere the moment a second squad exists is a switcher nobody
 * knows they can have — and this is the one feature a coach has to be told about before they
 * can use it, because the alternative is running two teams through one roster.
 */
export function SquadsPanel() {
  const state = useAppState();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<Squad | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [archived, setArchived] = useState<Squad[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status !== 'ready') return null;

  const squads = [...state.squads].sort(compareSquads);
  const currentId = state.squad?.id ?? null;

  const loadArchived = async () => {
    const all = await getServiceContext().store.squads.list({ includeArchived: true });
    setArchived(all.filter((squad) => squad.archivedAt !== undefined).sort(compareSquads));
  };

  /** Re-reads the archived list only if it is already on screen, so Restore updates in place. */
  const refreshAll = async () => {
    await refresh();
    if (archived !== null) await loadArchived();
  };

  const addSquad = async () => {
    const name = newName.trim();
    if (name.length === 0 || busy) return;
    setBusy(true);
    try {
      const ctx = getServiceContext();
      const created = await createSquad(ctx, { name });
      /*
       * Created, then switched to as a second step — because switching is the half that can be
       * refused (mid-run), and a coach whose squad was created but not switched to needs to be
       * told which of the two happened.
       */
      const switched = await switchSquad(ctx, created.id);
      setNewName('');
      setAddOpen(false);
      await refreshAll();
      showToast(
        isErr(switched)
          ? `${created.name} added — finish your session to switch to it`
          : `${created.name} added, and you are on it now`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h2>Squads</h2>
      <p className="card-meta">
        One per team you coach. Sessions, players, observations and reviews all belong to a single
        squad — the one you are on now is the one every other screen is about.
      </p>

      <ul className="stack stack--tight">
        {squads.map((squad) => {
          const current = squad.id === currentId;
          return (
            <li key={squad.id} className="card" aria-current={current ? 'true' : undefined}>
              <div className="row row--between">
                <span className="card-title">{squad.name}</span>
                {current ? <span className="pill pill--carried">Current</span> : null}
              </div>
              {squad.ageGroup !== undefined || squad.season !== undefined ? (
                <span className="card-meta">
                  {[squad.ageGroup, squad.season].filter(Boolean).join(' · ')}
                </span>
              ) : null}

              <div className="row row--wrap">
                {current ? null : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await switchSquad(getServiceContext(), squad.id);
                        if (isErr(result)) {
                          showToast(describeSwitch(result.error), { tone: 'stop' });
                          return;
                        }
                        await refreshAll();
                        showToast(`Now on ${squad.name}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Switch to
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    setRenaming(squad);
                    setRenameTo(squad.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await archiveSquad(getServiceContext(), squad.id);
                      if (isErr(result)) {
                        showToast(describeArchive(result.error, squad.name), { tone: 'stop' });
                        return;
                      }
                      await refreshAll();
                      showToast(`${squad.name} archived — nothing was deleted`, {
                        action: {
                          label: 'Undo',
                          run: async () => {
                            await restoreSquad(getServiceContext(), squad.id);
                            await refreshAll();
                          },
                        },
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Archive
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="btn btn--block"
        onClick={() => {
          setNewName('');
          setAddOpen(true);
        }}
      >
        {squads.length === 0 ? 'Add a squad' : 'Add another squad'}
      </button>

      {archived === null ? (
        <button
          type="button"
          className="btn btn--quiet btn--block"
          onClick={() => void loadArchived()}
        >
          Show archived squads
        </button>
      ) : (
        <div className="stack stack--tight">
          <h3>Archived</h3>
          {archived.length === 0 ? (
            <Empty>No squads archived.</Empty>
          ) : (
            <ul className="stack stack--tight">
              {archived.map((squad) => (
                <li key={squad.id} className="card card--sunk">
                  <div className="row row--between">
                    <span>{squad.name}</span>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={async () => {
                        await restoreSquad(getServiceContext(), squad.id);
                        await refreshAll();
                        showToast(`${squad.name} is back — switch to it when you want it`);
                      }}
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Sheet open={addOpen} title="Add a squad" onClose={() => setAddOpen(false)}>
        <p className="card-meta">
          It starts empty, and becomes the squad you are on. Nothing about the squad you are leaving
          changes.
        </p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void addSquad();
          }}
        >
          <div className="field">
            <label htmlFor="new-squad-name">Squad name</label>
            <input
              id="new-squad-name"
              type="text"
              value={newName}
              autoComplete="off"
              placeholder="U14 Greens"
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={busy || newName.trim().length === 0}
          >
            Add it
          </button>
        </form>
      </Sheet>

      <Sheet
        open={renaming !== null}
        title={`Rename ${renaming?.name ?? 'squad'}`}
        onClose={() => setRenaming(null)}
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const squad = renaming;
            const name = renameTo.trim();
            if (!squad || name.length === 0 || busy) return;
            setBusy(true);
            try {
              await updateSquad(getServiceContext(), squad.id, { name });
              setRenaming(null);
              await refreshAll();
              showToast(`Renamed to ${name}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="rename-squad">Squad name</label>
            <input
              id="rename-squad"
              type="text"
              value={renameTo}
              autoComplete="off"
              onChange={(event) => setRenameTo(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={busy || renameTo.trim().length === 0}
          >
            Save the name
          </button>
        </form>
      </Sheet>
    </section>
  );
}

/**
 * The refusals, in the coach's terms.
 *
 * Each one says what to do next rather than what went wrong — a coach reading
 * *"session_running"* on a touchline learns nothing they can act on.
 */
function describeSwitch(error: { kind: string; sessionTitle?: string }): string {
  if (error.kind === 'session_running') {
    return `Finish or abandon ${error.sessionTitle ?? 'your session'} before switching squads.`;
  }
  if (error.kind === 'squad_archived') return 'Restore that squad before switching to it.';
  return 'That squad is no longer here.';
}

function describeArchive(error: { kind: string; sessionTitle?: string }, name: string): string {
  if (error.kind === 'last_squad') {
    return `${name} is your only squad. Add another before archiving this one.`;
  }
  if (error.kind === 'session_running') {
    return `${error.sessionTitle ?? 'A session'} is still running for ${name}.`;
  }
  return 'That squad is no longer here.';
}
