'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  Empty,
  Loading,
  Screen,
  ScreenHead,
  formatLongDate,
  formatShortDate,
} from '../../_components/ui';
import { CornerBalancePanel } from '../../_components/corner-balance';
import { AssessmentSheet } from '../../_components/assessment-sheet';
import { MicroscopeSheet } from '../../_components/microscope-sheet';
import { showToast } from '../../_components/toast-host';
import { getServiceContext, useAppState } from '@/modules/app/app-store';
import {
  loadCornerProfile,
  recordAssessment,
  type CornerProfile,
} from '@/modules/squad/assessment-service';
import { loadMicroscopeView, recordScan, type MicroscopeView } from '@/modules/squad/scan-service';
import { capabilityLabel, CORE_CAPABILITIES, type CoreCapability } from '@/domain/capabilities';
import {
  skillLabel,
  type CapabilityEvidence,
  type ObservedSkill,
} from '@/domain/capabilities/scan';
import { asPlayerId } from '@/domain/ids';
import { cornerLabel, cornerShortLabel, cornerSlug, FOUR_CORNERS } from '@/domain/four-corners';
import { cornerOfObservation } from '@/domain/four-corners/balance';
import { overallRating } from '@/domain/player-assessment';
import { isErr } from '@/lib/result';
import type { Observation } from '@/domain/observation';
import type { CarryForwardAction } from '@/domain/carry-forward';

/**
 * A player's profile and observation timeline.
 *
 * One of only two screens that carry an id in the URL (ADR 0003) — a cold, browsable screen
 * where a miss is recoverable and no timer is running. The id is read client-side, so the
 * host still only ever serves one static file.
 */
export default function PlayerPage() {
  return (
    <Suspense
      fallback={
        <Screen>
          <Loading />
        </Screen>
      }
    >
      <PlayerProfile />
    </Suspense>
  );
}

function PlayerProfile() {
  const state = useAppState();
  const params = useSearchParams();
  const playerId = params.get('p');

  const [observations, setObservations] = useState<Observation[]>([]);
  const [actions, setActions] = useState<CarryForwardAction[]>([]);
  const [profile, setProfile] = useState<CornerProfile | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [scanning, setScanning] = useState(false);
  /**
   * Which skill the microscope is pointed at. `turning` to start with because it is the one
   * every age group does, and the screen has to open on *something* — the coach changes it in
   * the sheet, and the view reloads around their choice.
   */
  const [scanSkill, setScanSkill] = useState<ObservedSkill>('turning');
  const [microscope, setMicroscope] = useState<MicroscopeView | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!playerId || state.status !== 'ready') return;
    let cancelled = false;
    const ctx = getServiceContext();
    const id = asPlayerId(playerId);

    void Promise.all([
      ctx.store.observations.listByPlayer(id, { limit: 100 }),
      ctx.store.actions.listByPlayer(id),
      loadCornerProfile(ctx, id),
      loadMicroscopeView(ctx, id, scanSkill),
    ]).then(([rows, playerActions, cornerProfile, microscopeView]) => {
      if (cancelled) return;
      setObservations(rows);
      setActions(playerActions.filter((action) => action.status === 'open'));
      setProfile(cornerProfile);
      setMicroscope(microscopeView);
    });

    return () => {
      cancelled = true;
    };
  }, [playerId, state.status, reloadKey, scanSkill]);

  if (state.status !== 'ready') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return (
      <Screen>
        <ScreenHead title="Player not found" />
        <Empty>They may have been archived.</Empty>
        <Link href="/squad" className="btn btn--primary btn--block">
          Back to the squad
        </Link>
      </Screen>
    );
  }

  const strengths = observations.filter((observation) => observation.kind === 'strength').length;
  const development = observations.filter(
    (observation) => observation.kind === 'development',
  ).length;

  return (
    <Screen>
      <ScreenHead eyebrow="Player" title={player.name} />

      <div className="card card--sunk">
        <div className="row row--between">
          <span>{observations.length} observations</span>
          <span className="card-meta">
            {strengths} strengths · {development} to work on
          </span>
        </div>
      </div>

      {profile ? (
        <CornerBalancePanel
          balance={profile.balance}
          subject={player.name.split(/\s+/)[0] ?? player.name}
          suggestion={profile.suggestion}
        />
      ) : null}

      <section className="stack">
        <div className="row row--between">
          <h2>4 Corner check</h2>
          <button type="button" className="btn btn--quiet" onClick={() => setAssessing(true)}>
            New check
          </button>
        </div>

        {profile?.latest ? (
          <div className="card">
            <div className="row row--between">
              <span className="card-title">
                {formatShortDate(profile.latest.assessedAt)}
                {overallRating(profile.latest) !== null
                  ? ` · ${overallRating(profile.latest)?.toFixed(1)} avg`
                  : ''}
              </span>
              {profile.latest.focusCorner ? (
                <span className="pill pill--carried">
                  next: {cornerShortLabel(profile.latest.focusCorner)}
                </span>
              ) : null}
            </div>

            <ul className="corner-scores">
              {FOUR_CORNERS.map((corner) => {
                const score = profile.latest?.ratings[corner] ?? null;
                const delta = profile.deltas.find((d) => d.corner === corner);
                return (
                  <li key={corner} data-corner={cornerSlug(corner)}>
                    <span className="corner-score-label">{cornerShortLabel(corner)}</span>
                    <span className="corner-score tabular">{score ?? '–'}</span>
                    {delta && delta.change !== 0 ? (
                      <span className={delta.change > 0 ? 'pill' : 'pill pill--over'}>
                        {delta.change > 0 ? `+${delta.change}` : delta.change}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <Empty>
            No 4 Corner check yet. Four taps records where {player.name.split(/\s+/)[0]} is across
            all four corners, so the same question in three months has something to compare against.
          </Empty>
        )}
      </section>

      {/*
        Under the microscope — the six core capabilities on one skill. Sits after the 4 Corner
        check because it is the finer-grained question: not "where is this player" but "what
        happens when they turn".
      */}
      <section className="stack">
        <div className="row row--between">
          <h2>Under the microscope</h2>
          <button type="button" className="btn btn--quiet" onClick={() => setScanning(true)}>
            New scan
          </button>
        </div>

        {microscope?.latest ? (
          <div className="card">
            <div className="row row--between">
              <span className="card-title">
                {skillLabel(microscope.latest.skill)} ·{' '}
                {formatShortDate(microscope.latest.scannedAt)}
              </span>
              {microscope.latest.focusCapability ? (
                <span className="pill pill--carried">
                  next: {capabilityLabel(microscope.latest.focusCapability).toLowerCase()}
                </span>
              ) : null}
            </div>

            {microscope.extremes ? (
              <span className="card-meta">
                Strongest: {capabilityLabel(microscope.extremes.strongest).toLowerCase()} · Needs
                help: {capabilityLabel(microscope.extremes.weakest).toLowerCase()}
              </span>
            ) : null}

            <ul className="corner-scores capability-scores">
              {CORE_CAPABILITIES.map((capability) => {
                const score = microscope.latest?.ratings[capability] ?? null;
                const delta = microscope.deltas.find((d) => d.capability === capability);
                return (
                  <li key={capability}>
                    <span className="corner-score-label">{capabilityLabel(capability)}</span>
                    <span className="corner-score tabular">{score ?? '–'}</span>
                    {delta && delta.change !== 0 ? (
                      <span className={delta.change > 0 ? 'pill' : 'pill pill--over'}>
                        {delta.change > 0 ? `+${delta.change}` : delta.change}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <Empty>
            No scan of {skillLabel(scanSkill).toLowerCase()} yet. Six taps records what{' '}
            {player.name.split(/\s+/)[0]} can do and what they need help with, across the FA&apos;s
            six core capabilities.
          </Empty>
        )}
      </section>

      {actions.length > 0 ? (
        <section className="stack">
          <h2>Open points</h2>
          <ul className="stack stack--tight">
            {actions.map((action) => (
              <li key={action.id} className="card">
                <span className="card-title">{action.title}</span>
                {action.chainDepth >= 2 ? (
                  <span className="pill pill--over">{action.chainDepth + 1} sessions running</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack">
        <h2>Timeline</h2>
        {observations.length === 0 ? (
          <Empty>Nothing logged yet. Make them a focus player in your next session.</Empty>
        ) : (
          <ul className="stack stack--tight">
            {observations.map((observation) => (
              <li key={observation.id} className="card">
                <div className="row row--between">
                  <span className="card-title">
                    {observation.ratingKind ? labelFor(observation.ratingKind) : 'Note'}
                  </span>
                  <span className="card-meta">{formatLongDate(observation.at)}</span>
                </div>
                {(() => {
                  const corner = cornerOfObservation(observation);
                  return corner ? (
                    <span className="pill" data-corner={cornerSlug(corner)}>
                      {cornerLabel(corner)}
                    </span>
                  ) : null;
                })()}
                {observation.tags.length > 0 ? (
                  <span className="row row--wrap">
                    {observation.tags.map((tag) => (
                      <span key={tag} className="pill">
                        {tag}
                      </span>
                    ))}
                  </span>
                ) : null}
                {observation.text ? <p>{observation.text}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <AssessmentSheet
        open={assessing}
        playerName={player.name}
        previous={profile?.latest ?? null}
        onClose={() => setAssessing(false)}
        onSave={async ({ ratings, focusCorner }) => {
          const result = await recordAssessment(getServiceContext(), {
            playerId: player.id,
            ratings,
            focusCorner,
          });
          setAssessing(false);
          if (isErr(result)) {
            showToast('Could not save that check.', { tone: 'stop' });
            return;
          }
          setReloadKey((key) => key + 1);
          showToast('4 Corner check saved');
        }}
      />
      <MicroscopeSheet
        open={scanning}
        playerName={player.name}
        skill={scanSkill}
        evidence={microscope?.evidence ?? emptyEvidence()}
        previous={microscope?.latest ?? null}
        onSkillChange={setScanSkill}
        onClose={() => setScanning(false)}
        onSave={async ({ ratings, focusCapability }) => {
          const result = await recordScan(getServiceContext(), {
            playerId: player.id,
            skill: scanSkill,
            ratings,
            focusCapability,
          });
          setScanning(false);
          if (isErr(result)) {
            showToast('Could not save that scan.', { tone: 'stop' });
            return;
          }
          setReloadKey((key) => key + 1);
          showToast(`${skillLabel(scanSkill)} scan saved`);
        }}
      />
    </Screen>
  );
}

/** A zeroed evidence set, for the first render before the player's observations have loaded. */
function emptyEvidence(): Record<CoreCapability, CapabilityEvidence> {
  const empty = {} as Record<CoreCapability, CapabilityEvidence>;
  for (const capability of CORE_CAPABILITIES) {
    empty[capability] = { count: 0, strengths: 0, needsWork: 0, meanValue: null };
  }
  return empty;
}

function labelFor(kind: NonNullable<Observation['ratingKind']>): string {
  return { good: 'Good', working: 'Working on it', struggled: 'Struggled' }[kind];
}
