'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Empty, Loading, Screen, ScreenHead, Segmented, Stepper } from '../../_components/ui';
import { getServiceContext, refresh, useAppState } from '@/modules/app/app-store';
import { setIntervention } from '@/modules/planning/planning-service';
import {
  describeInterventionPlan,
  hasPhaseOverride,
  InterventionPlanSchema,
  interventionAudienceLabel,
  interventionMechanicLabel,
  interventionMethodLabel,
  resolvePhaseIntervention,
  type InterventionAudience,
  type InterventionMechanic,
  type InterventionMethod,
  type InterventionPlan,
} from '@/domain/intervention';
import { phasesInOrder, type SessionPhase } from '@/domain/session';

/**
 * Intervention configuration — an **optional detour**, never on the critical path.
 *
 * Three segmented controls and two steppers, then a per-phase list where each phase shows
 * what it has inherited and can override it. Most coaches will never open this screen, which
 * is the point: the methodology has already set all three axes sensibly.
 */

const METHODS: InterventionMethod[] = [
  'command',
  'question_and_answer',
  'observation_feedback',
  'guided_discovery',
  'trial_and_error',
];

const MECHANICS: InterventionMechanic[] = [
  'in_flow',
  'play_freeze_play',
  'play_stop_play',
  'stop_some_play_on',
  'individual_aside',
  'natural_break',
  'constraint_change',
  'none',
];

const AUDIENCES: InterventionAudience[] = ['individual', 'unit', 'team'];

export default function InterventionPage() {
  const state = useAppState();
  const router = useRouter();

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const session = state.activeSession;
  if (!session) {
    return (
      <Screen>
        <ScreenHead title="Nothing to configure" />
        <Empty>Plan a session first.</Empty>
        <Link href="/plan" className="btn btn--primary btn--block">
          Plan a session
        </Link>
      </Screen>
    );
  }

  const save = async (plan: InterventionPlan | null, phaseId?: SessionPhase['id']) => {
    await setIntervention(getServiceContext(), session.id, plan, phaseId);
    await refresh();
  };

  const patch = (changes: Partial<InterventionPlan>) =>
    save(InterventionPlanSchema.parse({ ...session.intervention, ...changes }));

  return (
    <Screen>
      <ScreenHead eyebrow="Intervention" title="How will you coach?" />

      <p className="card card--sunk">
        {session.methodology.name} sets this by default. Change it only where you disagree — the
        phase list below inherits everything you set here.
      </p>

      <Segmented
        legend="What you do"
        value={session.intervention.method}
        options={METHODS.map((method) => ({
          value: method,
          label: interventionMethodLabel(method),
        }))}
        onChange={(method) => void patch({ method })}
      />

      <Segmented
        legend="How play is interrupted"
        value={session.intervention.mechanic}
        options={MECHANICS.map((mechanic) => ({
          value: mechanic,
          label: interventionMechanicLabel(mechanic),
        }))}
        onChange={(mechanic) => void patch({ mechanic })}
      />

      <Segmented
        legend="Who it lands on"
        value={session.intervention.audience}
        options={AUDIENCES.map((audience) => ({
          value: audience,
          label: interventionAudienceLabel(audience),
        }))}
        onChange={(audience) => void patch({ audience })}
      />

      {/*
        The over-coaching guardrail. Making the intent explicit is what lets Review measure
        it afterwards — and "0" is a real, meaningful setting, not an unset one.
      */}
      <Stepper
        label="Max interventions per phase"
        value={session.intervention.maxPerPhase ?? 0}
        step={1}
        min={0}
        max={20}
        suffix={session.intervention.maxPerPhase === 0 ? '— let them play' : 'per phase'}
        onChange={(value) => void patch({ maxPerPhase: value })}
      />

      <Stepper
        label="Max seconds per stoppage"
        value={session.intervention.maxDurationSec ?? 30}
        step={5}
        min={5}
        max={300}
        suffix="sec"
        onChange={(value) => void patch({ maxDurationSec: value })}
      />

      <section className="stack">
        <h2>Per phase</h2>
        {phasesInOrder(session).map((phase) => {
          const resolved = resolvePhaseIntervention(session, phase);
          const overridden = hasPhaseOverride(phase);

          return (
            <div key={phase.id} className="card">
              <div className="row row--between">
                <span className="card-title">{phase.title}</span>
                {overridden ? <span className="pill pill--carried">override</span> : null}
              </div>
              <p className="card-meta">{describeInterventionPlan(resolved)}</p>

              <div className="row row--wrap">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={overridden && resolved.mechanic === 'in_flow'}
                  onClick={() =>
                    void save(
                      InterventionPlanSchema.parse({ ...resolved, mechanic: 'in_flow' }),
                      phase.id,
                    )
                  }
                >
                  Coach in flow
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={overridden && resolved.maxPerPhase === 0}
                  onClick={() =>
                    void save(
                      InterventionPlanSchema.parse({
                        ...resolved,
                        mechanic: 'none',
                        method: 'trial_and_error',
                        maxPerPhase: 0,
                      }),
                      phase.id,
                    )
                  }
                >
                  Say nothing
                </button>
                {overridden ? (
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => void save(null, phase.id)}
                  >
                    Reset to methodology default
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      <button
        type="button"
        className="btn btn--primary btn--xl btn--block"
        onClick={() => router.push('/plan/phases')}
      >
        Done
      </button>
    </Screen>
  );
}
