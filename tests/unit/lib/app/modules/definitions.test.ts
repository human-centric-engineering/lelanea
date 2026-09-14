/**
 * The seventeen module definitions, derived from the real structure file.
 *
 * No mocks: the point is that the registry can never disagree with the content
 * API about how many modules there are or what they are called, and only the
 * real file proves that. Each case says which property of the derivation it
 * pins and why reverting it would matter.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam, not a mock
 * ---------------------------------------------------------------------------
 * The whole point is the derivation from the real structure file: the slug
 * list, the count and the descriptions below are Lelañea's seventeen modules.
 * A fork of THIS leaf with a different journey should rewrite the pinned
 * values, not the derivation — and a fork with no `content/` at all has no
 * modules to register and should delete this file with `definitions.ts`.
 *
 * @see lib/app/modules/definitions.ts
 */

import { describe, it, expect } from 'vitest';
import { getJourneyStructure } from '@/lib/app/content';
import {
  getModuleDefinitions,
  moduleSlugFromId,
  LELANEA_MODULE_COUNT,
} from '@/lib/app/modules/definitions';
import { slugSchema } from '@/lib/validations/common';

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
  const definitions = getModuleDefinitions();
  const structure = getJourneyStructure();

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
      expect(definition.slotDefinitions).toBeUndefined();
      expect(definition.agentRoles).toBeUndefined();
      expect(definition.capabilities).toBeUndefined();
    }
  });

  it('is built once and shared', () => {
    expect(getModuleDefinitions()).toBe(definitions);
  });
});
