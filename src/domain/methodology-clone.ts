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
 *
 * **Which is exactly why `pairsWith` has to be remapped.** A `structuredClone` carries the
 * source's pairing verbatim, pointing at a slug the clone does not contain — so the write
 * would be rejected by `refineTemplates`, and a coach saving their own version of
 * Whole-Part-Whole would get an error naming a field they have never seen. The old → new map
 * below is built before anything is parsed, for that one field.
 */
export function cloneMethodology(
  source: Methodology | MethodologyPreset,
  options: { name: string; now: IsoDateTime; ids: IdGenerator },
): Methodology {
  const { name, now, ids } = options;

  /*
    Generated before the templates so the id sequence is unchanged from when this function
    built the methodology id inline — `FakeIdGenerator` is deterministic and several tests
    assert the uuids it hands out, so reordering the calls would be a silent test rewrite.
  */
  const methodologyId = asMethodologyId(ids.uuid());
  const newIdByOldId = new Map(
    source.phaseTemplates.map((template) => [template.id, asPhaseTemplateId(ids.uuid())] as const),
  );

  return MethodologySchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    id: methodologyId,
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
      id: newIdByOldId.get(template.id)!,
      // Null stays null. A pairing that somehow does not resolve becomes null rather than a
      // dangling id: the clone loses its comparison, which is recoverable, instead of being
      // unsaveable, which is not.
      pairsWith:
        template.pairsWith === null ? null : (newIdByOldId.get(template.pairsWith) ?? null),
    })),
  });
}
