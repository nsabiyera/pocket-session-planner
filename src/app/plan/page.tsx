'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Loading, Screen, ScreenHead, Segmented, Stepper } from '../_components/ui';
import { CarryForwardChips } from '../_components/carry-forward-chips';
import { showToast } from '../_components/toast-host';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import { startDraft } from '@/modules/planning/planning-service';
import { applyActionsToDraft } from '@/modules/review/review-service';
import {
  objectiveUsageFrom,
  OBJECTIVE_LIBRARY,
  orderObjectives,
  type ObjectiveTemplate,
} from '@/domain/objectives';
import { describeInterventionPlan } from '@/domain/intervention';
import type { MethodologyId, PlayerId } from '@/domain/ids';
import { shortPlayerName } from '@/domain/player';
import { isErr } from '@/lib/result';
import type { CarryForwardAction } from '@/domain/carry-forward';

/**
 * The composer. **Four taps, zero typing.**
 *
 * Everything on this screen is already answered except the objective: the methodology is
 * preselected to last-used, the duration to the squad default, the focus players to whoever
 * carry-forward nominated, and the intervention is inherited from the methodology and shown
 * read-only. The coach taps an objective chip and then `Build session`.
 */
export default function PlanPage() {
  const state = useAppState();
  const router = useRouter();

  const [objectiveId, setObjectiveId] = useState<string | null>(null);
  const [customObjective, setCustomObjective] = useState('');
  const [methodologyId, setMethodologyId] = useState<MethodologyId | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [focusIds, setFocusIds] = useState<Set<PlayerId>>(new Set());
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Recents-first, ordered by frequency then recency. A coach works on the same three or
  // four themes for weeks, so the objective they want is nearly always one they have used.
  const objectives = useMemo(
    () => orderObjectives(OBJECTIVE_LIBRARY, objectiveUsageFrom(state.recentSessions)),
    [state.recentSessions],
  );

  const lastUsedMethodology =
    state.recentSessions[0]?.methodology.methodologyId ??
    (state.catalog[0]?.methodology.id as MethodologyId | undefined) ??
    null;
  const chosenMethodologyId = methodologyId ?? lastUsedMethodology;
  const chosenMethodology = state.catalog.find(
    (entry) => entry.methodology.id === chosenMethodologyId,
  )?.methodology;

  const chosenDuration = durationMin ?? state.squad?.defaultSessionDurationMin ?? 60;
  const objective = objectives.find((candidate) => candidate.id === objectiveId);
  const objectiveText = objective?.text ?? customObjective.trim();

  if (state.status !== 'ready')
    return (
      <Screen>
        <Loading />
      </Screen>
    );
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

  const build = async () => {
    if (objectiveText.length === 0 || busy) return;
    setBusy(true);
    try {
      const ctx = getServiceContext();
      const created = await startDraft(ctx, {
        squadId: squad.id,
        objectiveText,
        ...(objective ? { objectiveTemplateId: objective.id } : {}),
        ...(chosenMethodologyId ? { methodologyId: chosenMethodologyId } : {}),
        totalMin: chosenDuration,
        focusPlayerIds: [...focusIds],
      });

      if (isErr(created)) {
        showToast('Could not build that session.', { tone: 'stop' });
        return;
      }

      if (selectedActions.size > 0) {
        const applied = await applyActionsToDraft(ctx, squad.id, [
          ...selectedActions,
        ] as CarryForwardAction['id'][]);
        if (!isErr(applied) && applied.value.skipped.length > 0) {
          showToast(`${applied.value.skipped.length} carried item(s) did not fit.`);
        }
      }

      await refresh();
      router.push('/plan/phases');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHead eyebrow="New session" title={squad.name} />

      {/* Carried actions sit *above* the objective, because the objective usually is one. */}
      <CarryForwardChips
        actions={state.openActions}
        selectedIds={selectedActions}
        onToggle={(action) =>
          setSelectedActions((current) => {
            const next = new Set(current);
            if (next.has(action.id)) next.delete(action.id);
            else next.add(action.id);
            return next;
          })
        }
      />

      <section className="stack">
        <h2>What are you working on?</h2>
        <ObjectiveGrid
          objectives={objectives}
          selectedId={objectiveId}
          onSelect={(id) => {
            setObjectiveId(id);
            setCustomObjective('');
          }}
        />
        <details className="card card--sunk">
          <summary>Something else</summary>
          <div className="field">
            <label htmlFor="custom-objective">Objective</label>
            <input
              id="custom-objective"
              type="text"
              value={customObjective}
              placeholder="Defending corners"
              onChange={(event) => {
                setCustomObjective(event.target.value);
                setObjectiveId(null);
              }}
            />
          </div>
        </details>
      </section>

      <Segmented
        legend="How will you coach it?"
        value={(chosenMethodologyId ?? '') as string}
        options={state.catalog.map((entry) => ({
          value: entry.methodology.id as string,
          label: entry.methodology.name,
        }))}
        onChange={(value) => setMethodologyId(value as MethodologyId)}
      />

      {/*
        Intervention costs **zero taps** on the default path: it is inherited from the
        methodology and shown as one read-only line, with an Edit link into the detour.
      */}
      {chosenMethodology ? (
        <div className="card card--sunk">
          <div className="row row--between">
            <span className="eyebrow">Intervention</span>
            <Link href="/plan/intervention" className="btn btn--quiet">
              Edit
            </Link>
          </div>
          <p>{describeInterventionPlan(chosenMethodology.defaultIntervention)}</p>
          {chosenMethodology.coachPrompt ? (
            <p className="card-meta">{chosenMethodology.coachPrompt}</p>
          ) : null}
        </div>
      ) : null}

      <Stepper
        label="How long?"
        value={chosenDuration}
        min={20}
        max={150}
        onChange={setDurationMin}
      />

      {state.players.length > 0 ? (
        <section className="stack">
          <h2>Focus players</h2>
          <div className="row row--wrap">
            {state.players.map((player) => {
              const on = focusIds.has(player.id);
              return (
                <button
                  key={player.id}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() =>
                    setFocusIds((current) => {
                      const next = new Set(current);
                      if (next.has(player.id)) next.delete(player.id);
                      else next.add(player.id);
                      return next;
                    })
                  }
                >
                  {shortPlayerName(player, state.players)}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        disabled={busy || objectiveText.length === 0}
        onClick={build}
      >
        Build session
      </button>
    </Screen>
  );
}

function ObjectiveGrid({
  objectives,
  selectedId,
  onSelect,
}: {
  objectives: readonly ObjectiveTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="chip-grid">
      {objectives.map((objective) => (
        <button
          key={objective.id}
          type="button"
          className="chip chip--lg objective-chip"
          aria-pressed={objective.id === selectedId}
          onClick={() => onSelect(objective.id)}
        >
          {objective.text}
        </button>
      ))}
    </div>
  );
}
