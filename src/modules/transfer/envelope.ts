import { z } from 'zod';
import { CarryForwardActionSchema } from '@/domain/carry-forward';
import { MethodologySchema } from '@/domain/methodology';
import { ObservationSchema } from '@/domain/observation';
import { PlayerSchema } from '@/domain/player';
import { CapabilityScanSchema } from '@/domain/capabilities/scan';
import { PlayerAssessmentSchema } from '@/domain/player-assessment';
import { CURRENT_SCHEMA_VERSION, IsoDateTimeSchema } from '@/domain/primitives';
import { SessionReviewSchema } from '@/domain/review';
import { SessionSchema } from '@/domain/session';
import { SquadSchema } from '@/domain/squad';

/**
 * The export envelope.
 *
 * With no backend this file is the **only** bridge between devices, and the only backup a
 * coach has, so it has to be boring and safe: a plain readable JSON document that a person
 * could open and understand, and that a strict parser can reject wholesale.
 *
 * Built-in methodologies deliberately do **not** travel. They are code-resident, so a file
 * exported from v1.0 and imported into v1.7 picks up the improved presets rather than
 * restoring stale copies of them. That is the export payoff of the code-resident design.
 */

export const EXPORT_FORMAT = 'pocket-session-planner';
export const EXPORT_FORMAT_VERSION = 1;

export const TransferDataSchema = z.object({
  squads: z.array(SquadSchema).default([]),
  players: z.array(PlayerSchema).default([]),
  /** **Custom methodologies only.** */
  methodologies: z.array(MethodologySchema).default([]),
  sessions: z.array(SessionSchema).default([]),
  observations: z.array(ObservationSchema).default([]),
  reviews: z.array(SessionReviewSchema).default([]),
  actions: z.array(CarryForwardActionSchema).default([]),
  /** FA 4 Corner profiles. Added alongside the v2 store. */
  assessments: z.array(PlayerAssessmentSchema).default([]),
  /** Six-capability scans — one player under the microscope. Added with the v3 store. */
  scans: z.array(CapabilityScanSchema).default([]),
});
export type TransferData = z.infer<typeof TransferDataSchema>;

export const TransferCountsSchema = z.object({
  squads: z.number().int().min(0),
  players: z.number().int().min(0),
  methodologies: z.number().int().min(0),
  sessions: z.number().int().min(0),
  observations: z.number().int().min(0),
  reviews: z.number().int().min(0),
  actions: z.number().int().min(0),
  /**
   * Optional so a file written before 4 Corner support still parses. Without this default an
   * older export would be rejected as malformed — which is precisely the failure the
   * migration ladder exists to prevent.
   */
  assessments: z.number().int().min(0).default(0),
  /** Optional for the same reason: a file written before the microscope must still parse. */
  scans: z.number().int().min(0).default(0),
});
export type TransferCounts = z.infer<typeof TransferCountsSchema>;

export const TransferEnvelopeSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.number().int().min(1),
  appVersion: z.string().max(30),
  docSchemaVersion: z.number().int().min(1),
  exportedAt: IsoDateTimeSchema,
  scope: z.enum(['all', 'squad']),
  counts: TransferCountsSchema,
  data: TransferDataSchema,
});
export type TransferEnvelope = z.infer<typeof TransferEnvelopeSchema>;

export function countData(data: TransferData): TransferCounts {
  return {
    squads: data.squads.length,
    players: data.players.length,
    methodologies: data.methodologies.length,
    sessions: data.sessions.length,
    observations: data.observations.length,
    reviews: data.reviews.length,
    actions: data.actions.length,
    assessments: data.assessments.length,
    scans: data.scans.length,
  };
}

export const CURRENT_DOC_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

/** `psp-u12-reds-2026-08-31.json` — legible in a Files app, sortable in a folder. */
export function exportFilename(squadName: string | null, exportedAt: string): string {
  const slug = (squadName ?? 'all')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const date = exportedAt.slice(0, 10);
  return `psp-${slug || 'all'}-${date}.json`;
}
