/**
 * The journey's structure: which modules exist, their number, and the tier each
 * sits in (f-content-seeds t-87).
 *
 * **Code, not content, on purpose.** Her words about the journey are in the
 * database: tier labels and intents, module titles, subtitles and phases
 * (`app_journey_tier`, `app_journey_module`), and an admin can edit them
 * (t-91). What is here is identity. Daybreak treats a module as code-first
 * (`lib/framework/modules/definition.ts`): its slug is registered at startup,
 * synchronously and before anything can touch a database. So the list of
 * modules has to be known without one, and this is where it is known.
 *
 * **One owner per field.** The roster owns ids, numbers and tier membership.
 * The rows own the text, including each module's title. The registered
 * `ModuleDefinition.name` is derived from the row
 * (`lib/app/modules/definitions.ts`), and the published map is built from this
 * roster (`lib/app/journey/map-definition.ts`), which carries no titles at all.
 * The journal decision "Module titles (t-87)" records the ruling.
 *
 * Adding a module is an edit here, a migration that inserts its text row, and a
 * re-publish of the map (seed `001-journey-map` re-runs when this file changes).
 * `tests/unit/lib/app/journey/roster.test.ts` pins this list against the
 * structure file the seed reads, so the two cannot drift before the seed runs.
 *
 * @see lib/app/content/journey-store.ts — where the roster and the rows are joined
 */

import type { ModuleTier } from '@/lib/app/content/schemas';

/** One tier: its id and its position in the journey, from 0. */
export interface RosterTier {
  id: ModuleTier;
  order: number;
}

/** One module: its authored id, its number, and its tier. */
export interface RosterModule {
  /** `module_NN_words`. The slug is derived from it by `moduleSlugFromId`. */
  id: string;
  /** 0 for onboarding, then 1–16 along the recommended spine. */
  number: number;
  tier: ModuleTier;
}

/** The five tiers, in journey order. Onboarding is 0. */
export const JOURNEY_TIERS: readonly RosterTier[] = Object.freeze([
  { id: 'onboarding', order: 0 },
  { id: 'foundations', order: 1 },
  { id: 'inner_authority', order: 2 },
  { id: 'embodied_relationship', order: 3 },
  { id: 'integration_and_expansion', order: 4 },
]);

/** The seventeen modules, in numbered order. */
export const JOURNEY_MODULES: readonly RosterModule[] = Object.freeze([
  { id: 'module_00_onboarding', number: 0, tier: 'onboarding' },
  { id: 'module_01_values', number: 1, tier: 'foundations' },
  { id: 'module_02_boundaries', number: 2, tier: 'foundations' },
  { id: 'module_03_standards', number: 3, tier: 'foundations' },
  { id: 'module_04_the_self', number: 4, tier: 'foundations' },
  { id: 'module_05_kindness_vs_nice', number: 5, tier: 'inner_authority' },
  { id: 'module_06_discernment_vs_judgment', number: 6, tier: 'inner_authority' },
  { id: 'module_07_morals_and_integrity', number: 7, tier: 'inner_authority' },
  { id: 'module_08_my_lotus_of_life', number: 8, tier: 'inner_authority' },
  { id: 'module_09_nervous_system', number: 9, tier: 'embodied_relationship' },
  { id: 'module_10_capacity', number: 10, tier: 'embodied_relationship' },
  { id: 'module_11_curiosity_of_self', number: 11, tier: 'embodied_relationship' },
  { id: 'module_12_communication', number: 12, tier: 'embodied_relationship' },
  { id: 'module_13_consciousness_hawkins_scale', number: 13, tier: 'integration_and_expansion' },
  { id: 'module_14_shadow_work', number: 14, tier: 'integration_and_expansion' },
  { id: 'module_15_dogma_of_reality', number: 15, tier: 'integration_and_expansion' },
  { id: 'module_16_oneness', number: 16, tier: 'integration_and_expansion' },
]);
