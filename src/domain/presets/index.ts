import type { MethodologyId } from '../ids';
import type { MethodologyPreset } from '../methodology';
import { COMMAND_DIRECT } from './command-direct';
import { CONSTRAINTS_LED } from './constraints-led';
import { GUIDED_DISCOVERY } from './guided-discovery';
import { PLAY_PRACTICE_PLAY } from './play-practice-play';
import { WHOLE_PART_WHOLE } from './whole-part-whole';

/**
 * Built-in methodologies are **code-resident, not seeded into IndexedDB**.
 *
 * `MethodologyRepository.list()` merges these in at read time — presets first (minus any the
 * coach has hidden via a `methodology_prefs` row), then their custom rows.
 *
 * Seeding would write a copy that immediately drifts from the app, so every preset
 * improvement becomes a migration that has to guess whether the coach edited the row, and
 * "the coach deleted a built-in" becomes an unrepresentable state. Historical fidelity is
 * already guaranteed by `MethodologySnapshot`. As a bonus, only *custom* methodologies need
 * to travel in an export file.
 */
export const METHODOLOGY_PRESETS: readonly MethodologyPreset[] = [
  PLAY_PRACTICE_PLAY, // first: the grassroots default, and what `/plan` preselects
  CONSTRAINTS_LED,
  GUIDED_DISCOVERY,
  WHOLE_PART_WHOLE,
  COMMAND_DIRECT,
];

/** Bumped whenever a preset changes, so `app_meta` can record what the coach has seen. */
export const PRESET_CATALOG_VERSION = 1;

export const DEFAULT_METHODOLOGY_ID = PLAY_PRACTICE_PLAY.id;

const BY_ID = new Map<string, MethodologyPreset>(METHODOLOGY_PRESETS.map((p) => [p.id, p]));

export function findPreset(id: MethodologyId | string): MethodologyPreset | undefined {
  return BY_ID.get(id);
}

export function isPresetId(id: MethodologyId | string): boolean {
  return BY_ID.has(id);
}

export { COMMAND_DIRECT, CONSTRAINTS_LED, GUIDED_DISCOVERY, PLAY_PRACTICE_PLAY, WHOLE_PART_WHOLE };
