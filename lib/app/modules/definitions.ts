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
 * **Which modules exist is the roster's; what each is called is its row's**
 * (t-87). The slugs come from `lib/app/journey/roster.ts`, so the registry is
 * complete without a database. Each module's `name` and `description` come from
 * its `app_journey_module` and `app_journey_tier` rows, which own her words:
 * this module never holds a title of its own. Startup registers twice
 * (`lib/app/leaf-bootstrap.ts`): once from the roster alone, synchronously, then
 * again with the rows' text once they are read. `registerModule` is idempotent
 * by slug, so the second replaces the first. If the rows cannot be read, the
 * first registration stands, with a name spelled from the slug
 * ({@link fallbackModuleName}), and startup logs it.
 *
 * **Slugs.** The roster's ids are `module_NN_words_like_this`; the framework's
 * slug rule is lowercase alphanumeric with hyphens (`slugSchema` in
 * `lib/validations/common.ts`, enforced on every `[slug]` route param), so the
 * projection strips the numbered prefix and swaps `_` for `-`:
 * `module_11_curiosity_of_self` → `curiosity-of-self`. The number is dropped
 * because a slug is an identity, not a position. `moduleSlugFromId()` is the
 * single place that rule lives; the map definition and the journey API use it to
 * keep node keys equal to module slugs.
 *
 * **The module that asks the discovery questions owns them** (f-onboarding
 * t-101; `.context/app/building-with-daybreak.md`). Its definition declares one
 * data slot per question (`slotDefinitions`, scoped `module:<slug>` by
 * Daybreak) and the Core Set switch as its config (`configSchema`).
 *
 * **Every module carries its register** (f-registers t-125): guiding or
 * teaching, as one field of its config, so an admin sets it in the module's
 * own area (`lib/app/voice/register.ts`). Otherwise the modules keep an empty
 * interior until they are written.
 *
 * @see lib/app/journey/roster.ts — which modules exist
 * @see lib/app/content/journey-store.ts — `getJourneyStructure()`, their words
 * @see lib/framework/modules/definition.ts — the shape being filled
 */

import { z } from 'zod';
import type { ModuleDefinition } from '@/lib/framework/modules/definition';
import type { JourneyStructure } from '@/lib/app/content/journey-view';
import { JOURNEY_MODULES, type RosterModule } from '@/lib/app/journey/roster';
import {
  DISCOVERY_DEFAULT_MODULE_ID,
  discoveryConfigShape,
} from '@/lib/app/onboarding/discovery-config';
import { registerConfigField } from '@/lib/app/voice/register';
import type { SlotDefinitionInput } from '@/lib/framework/data-slots';

/**
 * The discovery questions as their module declares them: the module the set
 * names, and one slot per question. Absent when the set could not be read, in
 * which case the default module still carries the config schema, so its
 * Config tab and stored switch stay valid.
 */
export interface DiscoveryModuleSlots {
  moduleId: string;
  slotDefinitions: SlotDefinitionInput[];
}

/** How many modules the journey has. Pinned by tests against the roster. */
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
 * A name spelled from the slug, for a module whose row could not be read:
 * `curiosity-of-self` → `Curiosity of self`. Honest about where it came from —
 * it is the identity, readable, not a guess at her title.
 */
export function fallbackModuleName(slug: string): string {
  const words = slug.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The one-line description the admin sees: the module's subtitle where the
 * author gave one, then the tier and what the tier is for. A module with no
 * subtitle (fifteen of them, today) is described by its tier alone — that is
 * honest about how much is written, and it is still a sentence.
 */
function describe(
  module: JourneyStructure['modules'][number],
  tier: JourneyStructure['tiers'][number]
): string {
  const tierLine = `${tier.label}: ${tier.intent}`;
  return module.subtitle ? `${module.subtitle}. ${tierLine}` : tierLine;
}

function toDefinition(slug: string, name: string, description: string): ModuleDefinition {
  return {
    slug,
    name,
    description,
    // The register and nothing else, deliberately: the admin config form
    // renders one field. Strict, like every authored schema in
    // `lib/app/content/schemas.ts`: a plain `z.object({})` would strip unknown
    // keys and store `{}` for a body that said something, which reads as
    // saved. Each module grows its own fields when it is written.
    configSchema: z.strictObject({ register: registerConfigField(slug) }),
  };
}

/**
 * The discovery questions' interior on the module that asks them: their slots
 * and the Core Set switch. Any other module is returned as it was.
 */
function withDiscovery(
  moduleId: string,
  definition: ModuleDefinition,
  discovery: DiscoveryModuleSlots | undefined
): ModuleDefinition {
  const owner = discovery?.moduleId ?? DISCOVERY_DEFAULT_MODULE_ID;
  if (moduleId !== owner) return definition;
  return {
    ...definition,
    configSchema: z.strictObject({
      ...discoveryConfigShape,
      register: registerConfigField(definition.slug),
    }),
    ...(discovery ? { slotDefinitions: discovery.slotDefinitions } : {}),
  };
}

function fromRoster(module: RosterModule): ModuleDefinition {
  const slug = moduleSlugFromId(module.id);
  return toDefinition(slug, fallbackModuleName(slug), `Module ${module.number} of the journey.`);
}

/**
 * The seventeen module definitions, in the journey's numbered order — which is
 * the order they are registered, and so the order `getRegisteredModules()`
 * returns them.
 *
 * With no `structure`, from the roster alone: every slug, each named from its
 * slug. With the journey read from the database, each named and described by
 * its rows. The slugs and their order are the roster's either way, so the two
 * registrations cover exactly the same modules. `discovery` gives the module
 * that asks the discovery questions its slots; without it, that module has
 * the config schema and no slots.
 */
export function getModuleDefinitions(
  structure?: JourneyStructure,
  discovery?: DiscoveryModuleSlots
): readonly ModuleDefinition[] {
  const tiersById = new Map(structure?.tiers.map((tier) => [tier.id, tier]));
  const modulesById = new Map(structure?.modules.map((module) => [module.id, module]));
  return JOURNEY_MODULES.map((rosterModule) => {
    const entry = modulesById.get(rosterModule.id);
    const tier = tiersById.get(rosterModule.tier);
    // With a structure, `toJourneyStructure` builds both lists from the roster
    // and throws on a missing row, so these are present; the fallback is for no
    // structure, or one built some other way.
    const definition =
      entry && tier
        ? toDefinition(moduleSlugFromId(entry.id), entry.title, describe(entry, tier))
        : fromRoster(rosterModule);
    return withDiscovery(rosterModule.id, definition, discovery);
  });
}
