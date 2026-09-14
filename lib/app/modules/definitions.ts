/**
 * The seventeen modules, as the framework sees them.
 *
 * Every module of the journey is a real place in Daybreak's module registry —
 * a `ModuleDefinition` with a stable slug, a name and a one-line description —
 * and nothing more. Fifteen of the sixteen numbered modules have a title and no
 * interior yet, and the skeleton must be visible without pretending otherwise,
 * so each definition declares an **empty** interior on purpose: an empty config
 * schema, no data-slots, no agent seats, no capabilities. Those arrive one
 * module at a time, as each is written.
 *
 * **Derived, not authored.** The definitions are projected from the journey
 * structure file through `getJourneyStructure()` — the one way in to Lelañea's
 * authored content — so the registry can never disagree with the map drawer or
 * the module pages about how many modules there are, what they are called, or
 * which tier holds them. Adding a module is an edit to the structure file, and
 * this list follows.
 *
 * **Slugs.** The structure file's ids are `module_NN_words_like_this`; the
 * framework's slug rule is lowercase alphanumeric with hyphens (`slugSchema`
 * in `lib/validations/common.ts`, enforced on every `[slug]` route param), so
 * the projection strips the numbered prefix and swaps `_` for `-`:
 * `module_11_curiosity_of_self` → `curiosity-of-self`. The number is dropped
 * because a slug is an identity, not a position — the recommended spine is the
 * published map's business, and the drawer takes the number from the content
 * API. `moduleSlugFromId()` is the single place that rule lives; the map seed
 * and the journey API use it to keep node keys equal to module slugs.
 *
 * Registered from `initLeafApp()` (`lib/app/leaf-bootstrap.ts`), which must
 * stay a pure, synchronous registration: this module reads a bundled JSON
 * through a memoised Zod parse and touches nothing else.
 *
 * @see lib/app/content/index.ts — `getJourneyStructure()`, the source
 * @see lib/framework/modules/definition.ts — the shape being filled
 */

import { z } from 'zod';
import type { ModuleDefinition } from '@/lib/framework/modules/definition';
import {
  getJourneyStructure,
  type JourneyModuleView,
  type JourneyTierView,
} from '@/lib/app/content';

/** How many modules the journey has. Pinned by tests against the structure file. */
export const LELANEA_MODULE_COUNT = 17;

/**
 * A structure-file module id (`module_01_values`) → a framework module slug
 * (`values`).
 *
 * Throws on an id that does not carry the `module_NN_` prefix: every id in the
 * structure file does, and a silent fallback here would register a module under
 * a slug nothing else can compute.
 */
export function moduleSlugFromId(id: string): string {
  const match = /^module_\d{2}_([a-z0-9_]+)$/.exec(id);
  if (!match?.[1]) {
    throw new Error(`Journey module id "${id}" is not of the form module_NN_words`);
  }
  return match[1].replaceAll('_', '-');
}

/**
 * The one-line description the admin sees: the module's subtitle where the
 * author gave one, then the tier and what the tier is for. A module with no
 * subtitle (fifteen of them, today) is described by its tier alone — that is
 * honest about how much is written, and it is still a sentence.
 */
function describe(module: JourneyModuleView, tier: JourneyTierView): string {
  const tierLine = `${tier.label}: ${tier.intent}`;
  return module.subtitle ? `${module.subtitle}. ${tierLine}` : tierLine;
}

function toDefinition(module: JourneyModuleView, tier: JourneyTierView): ModuleDefinition {
  return {
    slug: moduleSlugFromId(module.id),
    name: module.title,
    description: describe(module, tier),
    // An empty interior, deliberately: the admin config form renders no fields
    // and the API accepts `{}`. Each module grows its own schema when it is
    // written.
    configSchema: z.object({}),
  };
}

let definitions: readonly ModuleDefinition[] | null = null;

/**
 * The seventeen module definitions, in the journey's numbered order — which is
 * the order they are registered, and so the order `getRegisteredModules()`
 * returns them.
 *
 * Built once per process; the structure it reads is itself memoised and frozen.
 */
export function getModuleDefinitions(): readonly ModuleDefinition[] {
  if (definitions) return definitions;

  const structure = getJourneyStructure();
  const tiersById = new Map(structure.tiers.map((tier) => [tier.id, tier]));

  definitions = [...structure.modules]
    .sort((a, b) => a.number - b.number)
    .map((module) => {
      // Non-null: the structure schema's referential check guarantees every
      // module's tier is one of the declared tiers.
      const tier = tiersById.get(module.tier)!;
      return toDefinition(module, tier);
    });
  return definitions;
}
