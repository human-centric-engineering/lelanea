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
 * @see lib/app/journey/roster.ts — which modules exist
 * @see lib/app/content/journey-store.ts — `getJourneyStructure()`, their words
 * @see lib/framework/modules/definition.ts — the shape being filled
 */

import { z } from 'zod';
import type { ModuleDefinition } from '@/lib/framework/modules/definition';
import type { JourneyStructure } from '@/lib/app/content/journey-view';
import { JOURNEY_MODULES, type RosterModule } from '@/lib/app/journey/roster';

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
    // An empty interior, deliberately: the admin config form renders no fields
    // and the API accepts `{}` and nothing else. Strict, like every authored
    // schema in `lib/app/content/schemas.ts`: a plain `z.object({})` would
    // strip unknown keys and store `{}` for a body that said something, which
    // reads as saved. Each module grows its own schema when it is written.
    configSchema: z.strictObject({}),
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
 * registrations cover exactly the same modules.
 */
export function getModuleDefinitions(structure?: JourneyStructure): readonly ModuleDefinition[] {
  if (!structure) return JOURNEY_MODULES.map(fromRoster);

  const tiersById = new Map(structure.tiers.map((tier) => [tier.id, tier]));
  const modulesById = new Map(structure.modules.map((module) => [module.id, module]));
  return JOURNEY_MODULES.map((rosterModule) => {
    const entry = modulesById.get(rosterModule.id);
    const tier = tiersById.get(rosterModule.tier);
    // `toJourneyStructure` builds both lists from the roster and throws on a
    // missing row, so these are present; the fallback is for a caller that
    // hands in a structure built some other way.
    if (!entry || !tier) return fromRoster(rosterModule);
    return toDefinition(moduleSlugFromId(entry.id), entry.title, describe(entry, tier));
  });
}
