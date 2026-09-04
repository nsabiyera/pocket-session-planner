import { err, ok, type Result } from '@/lib/result';
import {
  asCapabilityScanId,
  type CapabilityScanId,
  type PlayerId,
  type SessionId,
} from '@/domain/ids';
import type { CoreCapability } from '@/domain/capabilities';
import {
  capabilityDeltas,
  capabilityEvidence,
  CapabilityScanSchema,
  emptyCapabilityNotes,
  emptyCapabilityRatings,
  scanExtremes,
  type CapabilityDelta,
  type CapabilityEvidence,
  type CapabilityNotes,
  type CapabilityRatings,
  type CapabilityScan,
  type ObservedSkill,
} from '@/domain/capabilities/scan';
import { CURRENT_SCHEMA_VERSION } from '@/domain/primitives';
import { now, type ServiceContext } from '../context';

/**
 * The six core capabilities, as the coach actually meets them — the same two halves as the 4
 * Corner Model, and deliberately the same difference in cost:
 *
 *  - **Coverage is free.** Derived from observations already logged, it answers *which part
 *    of the action was I even watching*.
 *  - **A scan is deliberate.** Six taps on one player doing one thing, to record the
 *    judgement the observations cannot make on their own: *what can they do, and what do they
 *    need help with.*
 */

export type ScanError = { kind: 'player_not_found' } | { kind: 'scan_not_found' };

export interface RecordScanInput {
  playerId: PlayerId;
  skill: ObservedSkill;
  ratings?: Partial<CapabilityRatings>;
  notes?: Partial<CapabilityNotes>;
  focusCapability?: CoreCapability | null;
  sessionId?: SessionId | null;
}

export async function recordScan(
  ctx: ServiceContext,
  input: RecordScanInput,
): Promise<Result<CapabilityScan, ScanError>> {
  const player = await ctx.store.players.get(input.playerId);
  if (!player) return err({ kind: 'player_not_found' });

  const at = now(ctx);
  const scan = CapabilityScanSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    id: asCapabilityScanId(ctx.ids.uuid()),
    playerId: player.id,
    squadId: player.squadId,
    skill: input.skill,
    scannedAt: at,
    // Half a scan is still worth keeping: a coach who could only see three of the six in a
    // nine-minute rondo should not be forced to invent the other three.
    ratings: { ...emptyCapabilityRatings(), ...input.ratings },
    notes: { ...emptyCapabilityNotes(), ...input.notes },
    focusCapability: input.focusCapability ?? null,
    sessionId: input.sessionId ?? null,
  });

  await ctx.store.scans.put(scan);
  return ok(scan);
}

export async function updateScan(
  ctx: ServiceContext,
  scanId: CapabilityScanId,
  changes: {
    ratings?: Partial<CapabilityRatings>;
    notes?: Partial<CapabilityNotes>;
    focusCapability?: CoreCapability | null;
  },
): Promise<Result<CapabilityScan, ScanError>> {
  const current = await ctx.store.scans.get(scanId);
  if (!current) return err({ kind: 'scan_not_found' });

  const next = CapabilityScanSchema.parse({
    ...current,
    ratings: { ...current.ratings, ...changes.ratings },
    notes: { ...current.notes, ...changes.notes },
    focusCapability:
      changes.focusCapability === undefined ? current.focusCapability : changes.focusCapability,
    updatedAt: now(ctx),
  });

  await ctx.store.scans.put(next);
  return ok(next);
}

/** Everything the microscope screen needs for one player and one skill, in one round trip. */
export interface MicroscopeView {
  readonly skill: ObservedSkill;
  /**
   * What this player's observations already say, per capability. The screen puts this beside
   * each question so the coach is confirming or overruling evidence rather than trying to
   * remember a session that finished twenty minutes ago.
   */
  readonly evidence: Record<CoreCapability, CapabilityEvidence>;
  /** The most recent scan of **this skill**, if there is one. */
  readonly latest: CapabilityScan | null;
  readonly previous: CapabilityScan | null;
  /** What moved between the two most recent scans of this skill. Empty without a pair. */
  readonly deltas: CapabilityDelta[];
  readonly history: CapabilityScan[];
  /** *"Strongest: techniques. Needs help: scanning."* from the latest scan. */
  readonly extremes: { strongest: CoreCapability; weakest: CoreCapability } | null;
}

export async function loadMicroscopeView(
  ctx: ServiceContext,
  playerId: PlayerId,
  skill: ObservedSkill,
): Promise<MicroscopeView> {
  const [observations, history] = await Promise.all([
    ctx.store.observations.listByPlayer(playerId, { limit: 500 }),
    ctx.store.scans.listByPlayerSkill(playerId, skill, { limit: 20 }),
  ]);

  const latest = history[0] ?? null;
  const previous = history[1] ?? null;

  return {
    skill,
    evidence: capabilityEvidence(observations),
    latest,
    previous,
    deltas: latest && previous ? capabilityDeltas(previous, latest) : [],
    history,
    extremes: latest ? scanExtremes(latest) : null,
  };
}

/**
 * Every skill this player has ever been scanned on, newest first.
 *
 * Drives the skill picker: a coach returning to Kai wants "turning, three weeks ago" offered
 * rather than an alphabetical list of six they have to remember their way through.
 */
export async function listScannedSkills(
  ctx: ServiceContext,
  playerId: PlayerId,
): Promise<Array<{ skill: ObservedSkill; scannedAt: CapabilityScan['scannedAt'] }>> {
  const scans = await ctx.store.scans.listByPlayer(playerId, { limit: 50 });
  const seen = new Set<ObservedSkill>();

  return scans.flatMap((scan) => {
    if (seen.has(scan.skill)) return [];
    seen.add(scan.skill);
    return [{ skill: scan.skill, scannedAt: scan.scannedAt }];
  });
}
