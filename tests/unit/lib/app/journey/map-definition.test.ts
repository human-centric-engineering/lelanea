/**
 * The journey map definition, derived from the real structure file.
 *
 * No mocks: what matters is that the graph the seed publishes agrees with the
 * module registry and the content API, and only the real file proves that. The
 * framework's own validation chain is run over the result — Zod shape, static
 * referential integrity, graph invariants — because "publishable" is the
 * property the seed depends on, and a green Zod parse alone does not prove it.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam, not a mock
 * ---------------------------------------------------------------------------
 * The counts and keys below are Lelañea's five tiers and seventeen modules. A
 * fork with a different journey pins its own; a fork with no `content/` has no
 * map to publish and should delete this file with `map-definition.ts`.
 *
 * @see lib/app/journey/map-definition.ts
 */

import { describe, it, expect } from 'vitest';
import { getJourneyStructure } from '@/lib/app/content';
import { getModuleDefinitions, LELANEA_MODULE_COUNT } from '@/lib/app/modules/definitions';
import {
  JOURNEY_MAP_SLUG,
  buildJourneyMapDefinition,
  regionKeyForTier,
} from '@/lib/app/journey/map-definition';
import { mapDefinitionSchema } from '@/lib/framework/facilitation/map/schema';
import { validateMapFormat } from '@/lib/framework/facilitation/map/validate';
import { validateGraphInvariants } from '@/lib/framework/facilitation/engine/invariants';
import { validatePublishableMap } from '@/lib/framework/facilitation/map/version-service';

const definition = buildJourneyMapDefinition();
const structure = getJourneyStructure();
const regions = definition.nodes.filter((n) => n.type === 'region');
const places = definition.nodes.filter((n) => n.type === 'module');

describe('buildJourneyMapDefinition', () => {
  it('has a stable slug the journey API and journeys key on', () => {
    expect(JOURNEY_MAP_SLUG).toBe('lelanea-journey');
  });

  it('has five regions and seventeen modules, and nothing else', () => {
    expect(structure.tiers).toHaveLength(5);
    expect(regions).toHaveLength(5);
    expect(places).toHaveLength(LELANEA_MODULE_COUNT);
    expect(definition.nodes).toHaveLength(5 + LELANEA_MODULE_COUNT);
  });

  it('module node keys ARE the registered module slugs, in numbered order', () => {
    const slugs = getModuleDefinitions().map((d) => d.slug);
    expect(places.map((n) => n.key)).toEqual(slugs);
    expect(places.map((n) => n.moduleSlug)).toEqual(slugs);
  });

  it('regions are keyed by prefixed tier id, so "onboarding" the tier and "onboarding" the module never collide', () => {
    expect(regionKeyForTier('onboarding')).toBe('tier:onboarding');
    expect(regions.map((n) => n.key)).toEqual([
      'tier:onboarding',
      'tier:foundations',
      'tier:inner_authority',
      'tier:embodied_relationship',
      'tier:integration_and_expansion',
    ]);
    expect(new Set(definition.nodes.map((n) => n.key)).size).toBe(definition.nodes.length);
  });

  it('every module sits in its tier’s region, matching the structure file', () => {
    const tierOf = new Map(structure.modules.map((m) => [m.number, m.tier]));
    for (const node of places) {
      const number = (node.meta as { number: number }).number;
      expect(node.region, node.key).toBe(regionKeyForTier(tierOf.get(number)!));
    }
    // Onboarding is in its own tier, not folded into foundations.
    expect(places[0]?.region).toBe('tier:onboarding');
    expect(regions.filter((r) => places.some((p) => p.region === r.key))).toHaveLength(5);
  });

  it('the spine is sixteen related_to edges along the numbered order — and nothing locks', () => {
    expect(definition.edges).toHaveLength(LELANEA_MODULE_COUNT - 1);
    expect(definition.edges.every((e) => e.type === 'related_to')).toBe(true);
    expect(definition.edges.every((e) => e.condition === undefined)).toBe(true);

    const keys = places.map((n) => n.key);
    definition.edges.forEach((edge, i) => {
      expect(edge.from).toBe(keys[i]);
      expect(edge.to).toBe(keys[i + 1]);
    });
    expect(definition.edges[0]).toMatchObject({ from: 'onboarding', to: 'values' });
    expect(definition.edges.at(-1)).toMatchObject({ from: 'dogma-of-reality', to: 'oneness' });
  });

  it('carries structure only — no titles or intents for the drawer to read from two places', () => {
    for (const node of definition.nodes) {
      expect(Object.keys(node.meta ?? {})).toEqual(node.type === 'region' ? ['order'] : ['number']);
    }
  });

  it('is returned with the framework’s defaults materialised, so a deep-equal against a stored version is meaningful', () => {
    expect(definition.nodes.every((n) => n.completionMode === 'once')).toBe(true);
    expect(mapDefinitionSchema.parse(definition)).toEqual(definition);
  });

  it('passes the framework’s whole publish chain: shape, referential integrity, graph invariants', () => {
    expect(mapDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(validateMapFormat(definition)).toEqual({ ok: true, errors: [] });
    expect(validateGraphInvariants(definition)).toEqual({ ok: true, errors: [] });
    expect(() => validatePublishableMap(definition)).not.toThrow();
  });

  it('the chain it passes would refuse a broken graph — the check is not decoration', () => {
    const broken = {
      ...definition,
      edges: [...definition.edges, { from: 'oneness', to: 'nowhere', type: 'related_to' }],
    };
    expect(() => validatePublishableMap(broken)).toThrow(/referential/);
  });

  it('is built once and shared', () => {
    expect(buildJourneyMapDefinition()).toBe(definition);
  });
});
