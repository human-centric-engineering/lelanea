/**
 * The seventeen module definitions: which exist is the code roster's, what
 * each is called is its row's (f-content-seeds t-87).
 *
 * No store mock: the journey is the rows the real seed writes from the real
 * structure file, read back through the real projection. The point is that the
 * registry can never disagree with the content API about how many modules there
 * are or what they are called. Each case says which property of the derivation
 * it pins and why reverting it would matter.
 *
 * **One owner for a module's title.** It is the `app_journey_module` row. The
 * definition's `name` is derived from it, and the case "takes its name from the
 * row" is what shows it: an edited row renames the definition.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real roster and journey seed, not a fixture
 * ---------------------------------------------------------------------------
 * The slug list, the count and the descriptions below are Lelañea's seventeen
 * modules.
 * A fork of THIS leaf with a different journey should rewrite the pinned
 * values, not the derivation — and a fork with no `content/` at all has no
 * modules to register and should delete this file with `definitions.ts`.
 *
 * @see lib/app/modules/definitions.ts
 */

import { describe, it, expect } from 'vitest';
import { toJourneyStructure } from '@/lib/app/content/journey-view';
import {
  fallbackModuleName,
  getModuleDefinitions,
  moduleSlugFromId,
  LELANEA_MODULE_COUNT,
} from '@/lib/app/modules/definitions';
import { slugSchema } from '@/lib/validations/common';
import { seededJourneyRows } from '@/tests/helpers/app/content-stores';

/** The journey as the store serves it from the seeded rows, optionally edited. */
function journey(edit?: (rows: ReturnType<typeof seededJourneyRows>) => void) {
  const rows = seededJourneyRows();
  edit?.(rows);
  return toJourneyStructure(rows.journey, rows.tiers, rows.modules);
}

/** The framework's slug rule, as every `[slug]` admin route enforces it. */
const FRAMEWORK_SLUG = slugSchema;

describe('moduleSlugFromId', () => {
  it('strips the numbered prefix and hyphenates', () => {
    expect(moduleSlugFromId('module_00_onboarding')).toBe('onboarding');
    expect(moduleSlugFromId('module_01_values')).toBe('values');
    expect(moduleSlugFromId('module_11_curiosity_of_self')).toBe('curiosity-of-self');
    expect(moduleSlugFromId('module_13_consciousness_hawkins_scale')).toBe(
      'consciousness-hawkins-scale'
    );
  });

  it('refuses an id it cannot derive a slug from, rather than guessing', () => {
    expect(() => moduleSlugFromId('values')).toThrow(/module_NN_words/);
    expect(() => moduleSlugFromId('module_1_values')).toThrow(/module_NN_words/);
    expect(() => moduleSlugFromId('module_01_')).toThrow(/module_NN_words/);
  });
});

describe('getModuleDefinitions', () => {
  const structure = journey();
  const definitions = getModuleDefinitions(structure);

  it('yields exactly seventeen, one per module in the structure file', () => {
    expect(structure.modules).toHaveLength(LELANEA_MODULE_COUNT);
    expect(definitions).toHaveLength(LELANEA_MODULE_COUNT);
  });

  it('pins the slugs, in the numbered order the spine will follow', () => {
    expect(definitions.map((d) => d.slug)).toEqual([
      'onboarding',
      'values',
      'boundaries',
      'standards',
      'the-self',
      'kindness-vs-nice',
      'discernment-vs-judgment',
      'morals-and-integrity',
      'my-lotus-of-life',
      'nervous-system',
      'capacity',
      'curiosity-of-self',
      'communication',
      'consciousness-hawkins-scale',
      'shadow-work',
      'dogma-of-reality',
      'oneness',
    ]);
  });

  it('every slug satisfies the framework slug rule, so every admin route can address it', () => {
    for (const definition of definitions) {
      expect(FRAMEWORK_SLUG.safeParse(definition.slug).success, definition.slug).toBe(true);
    }
  });

  it('slugs are unique — a collision would make registration silently drop a module', () => {
    expect(new Set(definitions.map((d) => d.slug)).size).toBe(LELANEA_MODULE_COUNT);
  });

  it('names are the authored module titles, verbatim', () => {
    const byNumber = new Map(structure.modules.map((m) => [m.number, m]));
    definitions.forEach((definition, index) => {
      expect(definition.name).toBe(byNumber.get(index)?.title);
    });
    expect(definitions[7]?.name).toBe('Morals & Integrity');
  });

  it('describes each module by its tier and intent, with the subtitle first where one is authored', () => {
    const values = definitions.find((d) => d.slug === 'values');
    expect(values?.description).toBe(
      'From inherited definitions to an embodied, consciously chosen inner compass. ' +
        'Foundations: Establish the inner compass, the lines that protect it, the bar it is held to, and who is holding it.'
    );

    const oneness = definitions.find((d) => d.slug === 'oneness');
    expect(oneness?.description).toBe(
      "Integration & Expansion: The Spiritual Oneness arc, where Lelañea's own original frameworks emerge."
    );
  });

  it('declares an empty interior: a config schema accepting {} and nothing else', () => {
    for (const definition of definitions) {
      expect(definition.configSchema.safeParse({}).success).toBe(true);
      // Strict: a body with a key is refused (400 at the admin config route),
      // not stripped to `{}` and stored as if it had been saved.
      expect(definition.configSchema.safeParse({ anything: 1 }).success).toBe(false);
      expect(definition.slotDefinitions).toBeUndefined();
      expect(definition.agentRoles).toBeUndefined();
      expect(definition.capabilities).toBeUndefined();
    }
  });

  it('takes its name from the row: an edited title renames the definition (t-87)', () => {
    const edited = getModuleDefinitions(
      journey((rows) => {
        const values = rows.modules.find((row) => row.id === 'module_01_values')!;
        values.title = 'Values, as she renamed it';
        const foundations = rows.tiers.find((row) => row.id === 'foundations')!;
        foundations.intent = 'An edited intent.';
      })
    );

    expect(edited.find((d) => d.slug === 'values')?.name).toBe('Values, as she renamed it');
    expect(edited.find((d) => d.slug === 'boundaries')?.description).toBe(
      'Foundations: An edited intent.'
    );
    // The slug is the roster's: renaming the module does not move it.
    expect(edited.map((d) => d.slug)).toEqual(definitions.map((d) => d.slug));
  });
});

describe('getModuleDefinitions() from the roster alone — no database', () => {
  const fromRoster = getModuleDefinitions();

  it('registers exactly the same slugs, in the same order, as the rows do', () => {
    expect(fromRoster.map((d) => d.slug)).toEqual(
      getModuleDefinitions(journey()).map((d) => d.slug)
    );
  });

  it('names each from its slug, holding no title of its own', () => {
    expect(fromRoster.find((d) => d.slug === 'curiosity-of-self')?.name).toBe('Curiosity of self');
    expect(fromRoster.find((d) => d.slug === 'values')?.name).toBe('Values');
    expect(fallbackModuleName('the-self')).toBe('The self');
    // Not her title: that is on the row, and this is what shows without one.
    expect(fromRoster[11]?.name).not.toBe(journey().modules[11]?.title);
  });

  it('keeps the same empty interior', () => {
    for (const definition of fromRoster) {
      expect(definition.configSchema.safeParse({}).success).toBe(true);
      expect(definition.configSchema.safeParse({ anything: 1 }).success).toBe(false);
    }
  });
});
