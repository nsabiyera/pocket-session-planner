'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Empty, Loading, Screen, ScreenHead } from '../../_components/ui';
import { showToast } from '../../_components/toast-host';
import { PeriodizationOff } from '../../_components/periodization-off';
import { getServiceContext, periodizationEnabled, useAppState } from '@/modules/app/app-store';
import {
  addPrinciple,
  editPrinciple,
  getGameModel,
  removePrinciple,
  setIdentity,
} from '@/modules/planning/game-model-service';
import {
  MOMENTS,
  MOMENT_FORMAL_LABELS,
  MOMENT_LABELS,
  PRINCIPLE_LEVEL_LABELS,
  childrenOf,
  describeGameModel,
  macroPrinciples,
  type GameModel,
  type Moment,
  type Principle,
  type PrincipleLevel,
} from '@/domain/game-model';
import { coverageOf, describeCoverage } from '@/domain/game-model/coverage';
import { isErr } from '@/lib/result';
import type { PrincipleId } from '@/domain/ids';

/**
 * The game model — a squad's intended way of playing.
 *
 * Phase 1 of the tactical periodization roadmap, and the spine everything after it hangs off:
 * "specificity" means nothing without a model to be specific *to*.
 *
 * **The app ships no principles.** Two canonical sources publish the framework and withhold the
 * enumeration, and in any case the principles *are* this coach's model — a shipped list would
 * be somebody else's idea of how this team plays. So the screen is an authoring surface, and
 * the only opinion it holds is the tree: a principle hangs off the one above it, in the same
 * moment. That is the fractal the sources describe, and it is enforced rather than suggested.
 *
 * It also names what the app is **not** doing, per ADR 0007 — there is no load periodization
 * here, and a coach who knows the methodology should be able to see that immediately rather
 * than infer it.
 */
export default function GameModelPage() {
  const state = useAppState();
  const [model, setModel] = useState<GameModel | null | undefined>(undefined);
  const [identity, setIdentityText] = useState('');
  const [busy, setBusy] = useState(false);

  const squadId = state.squad?.id;

  const reload = useCallback(async () => {
    if (!squadId) return;
    const found = await getGameModel(getServiceContext(), squadId);
    setModel(found ?? null);
    setIdentityText(found?.identity ?? '');
  }, [squadId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!periodizationEnabled(state)) return <PeriodizationOff title="Game model" />;

  if (model === undefined) {
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
          Create a squad first
        </Link>
      </Screen>
    );
  }

  const squad = state.squad;

  const saveIdentity = async () => {
    const text = identity.trim();
    if (text === '' || busy) return;
    setBusy(true);
    try {
      const result = await setIdentity(getServiceContext(), squad.id, text);
      if (isErr(result)) {
        showToast('Could not save that.', { tone: 'stop' });
        return;
      }
      await reload();
      showToast('Game model saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHead eyebrow="Game model" title={squad.name} />

      <div className="field">
        <label htmlFor="identity">How do you play?</label>
        <textarea
          id="identity"
          value={identity}
          maxLength={200}
          placeholder="We build from the back and attack through the middle"
          onChange={(event) => setIdentityText(event.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={busy || identity.trim() === ''}
        onClick={saveIdentity}
      >
        {model === null ? 'Start the game model' : 'Save'}
      </button>

      {model === null ? (
        <Empty>
          One line is enough to start. Principles come after, and only ever from you — the app ships
          none, because they are your model rather than a template.
        </Empty>
      ) : (
        <>
          <p className="banner banner--signal">{describeGameModel(model)}</p>

          {/*
            What the sessions actually trained, against what the model says. The first thing in
            this feature that can falsify the coach's own plan rather than record it — and the
            reason the principle link on a session is worth asking for.
          */}
          <CoveragePanel model={model} sessions={state.recentSessions} />

          {MOMENTS.map((moment) => (
            <MomentSection
              key={moment}
              model={model}
              moment={moment}
              squadId={squad.id}
              onChanged={reload}
            />
          ))}
        </>
      )}

      <details className="card card--sunk">
        <summary>What this is, and what it is not</summary>
        <p className="card-meta">
          The game model and its principles come from tactical periodization (Vítor Frade). This app
          implements the principles half: the four moments, the hierarchy, and the rule that a
          principle must hang off the one above it.
        </p>
        <p className="card-meta">
          <strong>It does no load periodization.</strong> There is no tension, duration or velocity
          classification here and no intensity prescription, so this is not a morphocycle. The
          sources disagree about the day-to-quality mapping and the canonical one declines to
          publish it, so the app declines to invent it.
        </p>
        <p className="card-meta">
          Nor is any of this England Football guidance — the FA 4 Corner Model and the FA practice
          spectrum elsewhere in the app are. This is a framework you have chosen.
        </p>
      </details>
    </Screen>
  );
}

/**
 * Sessions against the model.
 *
 * Silent below four linked sessions, in the spirit of the corner-balance report's eight
 * observations: a report that accuses a coach of neglecting a moment after one Tuesday is a
 * report they learn to ignore.
 */
function CoveragePanel({
  model,
  sessions,
}: {
  model: GameModel;
  sessions: readonly {
    objective: { principleId: PrincipleId | null; text: string };
    scheduledFor: string;
  }[];
}) {
  const report = coverageOf(model, sessions);
  const sentence = describeCoverage(report);
  if (sentence === null) return null;

  const trained = report.principles.filter((entry) => entry.sessions > 0);

  return (
    <section className="stack">
      <h2>What you have actually trained</h2>
      <p className="banner banner--signal">{sentence}</p>
      <ul className="stack stack--tight">
        {trained.map((entry) => (
          <li key={entry.principle.id} className="card-meta">
            {entry.principle.text} — {entry.sessions} session{entry.sessions === 1 ? '' : 's'}
          </li>
        ))}
      </ul>
      <p className="card-meta">
        From your last {sessions.length} completed session{sessions.length === 1 ? '' : 's'}. No
        target and no judgement — it reports the record.
      </p>
    </section>
  );
}

/** One moment, with its macro principles and whatever hangs beneath them. */
function MomentSection({
  model,
  moment,
  squadId,
  onChanged,
}: {
  model: GameModel;
  moment: Moment;
  squadId: GameModel['squadId'];
  onChanged: () => Promise<void>;
}) {
  const macros = macroPrinciples(model, moment);

  return (
    <section className="stack">
      <h2>{MOMENT_LABELS[moment]}</h2>
      <p className="card-meta">{MOMENT_FORMAL_LABELS[moment]}</p>

      {macros.length === 0 ? (
        <p className="card-meta">Nothing said about this moment yet.</p>
      ) : (
        macros.map((macro) => (
          <PrincipleBranch
            key={macro.id}
            model={model}
            principle={macro}
            squadId={squadId}
            onChanged={onChanged}
          />
        ))
      )}

      <AddPrinciple
        squadId={squadId}
        moment={moment}
        level="macro"
        onChanged={onChanged}
        label={`Add to ${MOMENT_LABELS[moment].toLowerCase()}`}
      />
    </section>
  );
}

/**
 * A principle and its descendants, indented by level.
 *
 * Recursive because the hierarchy is, and capped by the schema at four levels — so this
 * terminates without needing a depth guard.
 */
function PrincipleBranch({
  model,
  principle,
  squadId,
  onChanged,
}: {
  model: GameModel;
  principle: Principle;
  squadId: GameModel['squadId'];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(principle.text);
  const children = childrenOf(model, principle.id);
  const childLevel = nextLevelOf(principle.level);

  const save = async () => {
    const result = await editPrinciple(getServiceContext(), squadId, principle.id, text.trim());
    if (isErr(result)) {
      showToast('Could not save that.', { tone: 'stop' });
      return;
    }
    setEditing(false);
    await onChanged();
  };

  const remove = async () => {
    const result = await removePrinciple(getServiceContext(), squadId, principle.id);
    if (isErr(result)) {
      showToast('Could not remove that.', { tone: 'stop' });
      return;
    }
    await onChanged();
    // Says how many, because cascading is the only honest option and a coach who removed a
    // macro should know the four lines beneath it went with it.
    showToast(
      result.value.removed === 1 ? 'Removed' : `Removed ${result.value.removed} principles`,
    );
  };

  return (
    <div className={`principle principle--${principle.level}`}>
      <span className="eyebrow">{PRINCIPLE_LEVEL_LABELS[principle.level]}</span>

      {editing ? (
        <div className="stack stack--tight">
          <div className="field">
            <label htmlFor={`edit-${principle.id}`}>Principle</label>
            <input
              id={`edit-${principle.id}`}
              type="text"
              value={text}
              maxLength={160}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={save}>
              Save
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setText(principle.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="principle__text">{principle.text}</p>
          <div className="row row--wrap">
            <button type="button" className="btn btn--quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="btn btn--quiet" onClick={remove}>
              Remove
            </button>
          </div>
        </>
      )}

      {children.map((child) => (
        <PrincipleBranch
          key={child.id}
          model={model}
          principle={child}
          squadId={squadId}
          onChanged={onChanged}
        />
      ))}

      {childLevel === null ? null : (
        <AddPrinciple
          squadId={squadId}
          moment={principle.moment}
          level={childLevel}
          parentId={principle.id}
          onChanged={onChanged}
          label={`Add ${PRINCIPLE_LEVEL_LABELS[childLevel].toLowerCase()}`}
        />
      )}
    </div>
  );
}

function AddPrinciple({
  squadId,
  moment,
  level,
  parentId,
  onChanged,
  label,
}: {
  squadId: GameModel['squadId'];
  moment: Moment;
  level: PrincipleLevel;
  parentId?: PrincipleId;
  onChanged: () => Promise<void>;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn--quiet" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  const add = async () => {
    if (text.trim() === '' || busy) return;
    setBusy(true);
    try {
      const result = await addPrinciple(getServiceContext(), {
        squadId,
        moment,
        level,
        text: text.trim(),
        ...(parentId ? { parentId } : {}),
      });
      if (isErr(result)) {
        // The tree rule speaks for itself, so the service's own message is the right one.
        showToast(result.error.kind === 'invalid' ? result.error.message : 'Could not add that.', {
          tone: 'stop',
        });
        return;
      }
      setText('');
      setOpen(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack stack--tight">
      <div className="field">
        <label htmlFor={`add-${parentId ?? moment}-${level}`}>
          {PRINCIPLE_LEVEL_LABELS[level]}
        </label>
        <input
          id={`add-${parentId ?? moment}-${level}`}
          type="text"
          value={text}
          maxLength={160}
          placeholder={PLACEHOLDERS[level]}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={add}>
          Add
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Illustrations of the *grain* of each level, not suggestions of content. */
const PLACEHOLDERS: Record<PrincipleLevel, string> = {
  macro: 'Build from the back',
  meso: 'Through the pivot, not down the line',
  micro: 'The pivot drops between the centre-backs',
  sub: 'Open body shape to receive',
};

/** The level below this one, or null at the bottom of the tree. */
function nextLevelOf(level: PrincipleLevel): PrincipleLevel | null {
  if (level === 'macro') return 'meso';
  if (level === 'meso') return 'micro';
  if (level === 'micro') return 'sub';
  return null;
}
