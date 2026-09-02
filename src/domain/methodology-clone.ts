import type { IdGenerator } from '@/lib/id';
import { asMethodologyId, asPhaseTemplateId } from './ids';
import { MethodologySchema, type Methodology, type MethodologyPreset } from './methodology';
import { CURRENT_SCHEMA_VERSION, type IsoDateTime } from './primitives';

/**
 * **Custom methodologies clone, never inherit.**
 *
 * Inheritance would mean a preset improvement in a later release silently rewrites a
 * methodology a coach has spent a season tuning. So editing a built-in in the UI offers
 * *"Save as my own version of…"* — copy-on-write — and this is that copy.
 *
 * Every phase template gets a fresh UUID, because the source ids are stable preset slugs and
 * two methodologies sharing template ids would make `fromTemplateId` provenance ambiguous.
 */
export function cloneMethodology(
  source: Methodology | MethodologyPreset,
  options: { name: string; now: IsoDateTime; ids: IdGenerator },
): Methodology {
  const { name, now, ids } = options;

  return MethodologySchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    id: asMethodologyId(ids.uuid()),
    origin: {
      kind: 'custom',
      clonedFrom: source.id,
      clonedFromVersion: source.version,
    },
    name,
    summary: source.summary,
    coachStance: source.coachStance,
    // A clone starts its own version history at 1. The source's version is recorded in
    // `origin.clonedFromVersion`, which is what a future "the preset has moved on" prompt
    // would compare against.
    version: 1,
    referenceDurationMin: source.referenceDurationMin,
    defaultIntervention: structuredClone(source.defaultIntervention),
    ...(source.coachPrompt !== undefined ? { coachPrompt: source.coachPrompt } : {}),
    phaseTemplates: source.phaseTemplates.map((template) => ({
      ...structuredClone(template),
      id: asPhaseTemplateId(ids.uuid()),
    })),
  });
}
