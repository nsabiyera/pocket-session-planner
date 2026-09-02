import type { MethodologyId } from '@/domain/ids';
import type { Methodology } from '@/domain/methodology';
import { METHODOLOGY_PRESETS } from '@/domain/presets';
import type { CatalogEntry, MethodologyPrefs } from './ports/data-store';

/**
 * Merging built-in presets with the coach's custom methodologies, shared by both adapters so
 * the fake and the real store cannot disagree about catalogue order.
 *
 * Presets first, then custom rows — with favourites lifted to the top of each group, because
 * a coach who has favourited Constraints-Led wants it under their thumb, not third.
 */
export function buildCatalog(
  custom: readonly Methodology[],
  prefs: ReadonlyMap<string, MethodologyPrefs>,
  options: { includeHidden?: boolean } = {},
): CatalogEntry[] {
  const entries: CatalogEntry[] = [
    ...METHODOLOGY_PRESETS.map((methodology) => toEntry(methodology, true, prefs)),
    ...custom
      .filter((methodology) => methodology.deletedAt === undefined)
      .map((methodology) => toEntry(methodology, false, prefs)),
  ];

  const visible = options.includeHidden ? entries : entries.filter((entry) => !entry.hidden);

  // A stable sort keyed only on favourite: within builtins and within custom rows the
  // authored order is meaningful (the grassroots default is first for a reason).
  return visible
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.isBuiltin !== b.entry.isBuiltin) return a.entry.isBuiltin ? -1 : 1;
      if (a.entry.favourite !== b.entry.favourite) return a.entry.favourite ? -1 : 1;
      const orderA = explicitOrder(a.entry, prefs);
      const orderB = explicitOrder(b.entry, prefs);
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

function toEntry(
  methodology: CatalogEntry['methodology'],
  isBuiltin: boolean,
  prefs: ReadonlyMap<string, MethodologyPrefs>,
): CatalogEntry {
  const pref = prefs.get(methodology.id);
  return {
    methodology,
    isBuiltin,
    hidden: pref?.hidden ?? false,
    favourite: pref?.favourite ?? false,
  };
}

function explicitOrder(entry: CatalogEntry, prefs: ReadonlyMap<string, MethodologyPrefs>): number {
  return prefs.get(entry.methodology.id)?.order ?? Number.MAX_SAFE_INTEGER;
}

/** Resolves an id against the code-resident presets first, then the coach's own rows. */
export function resolveMethodology(
  id: MethodologyId,
  custom: readonly Methodology[],
): CatalogEntry['methodology'] | undefined {
  const preset = METHODOLOGY_PRESETS.find((methodology) => methodology.id === id);
  if (preset) return preset;
  return custom.find((methodology) => methodology.id === id && methodology.deletedAt === undefined);
}
