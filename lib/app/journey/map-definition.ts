/**
 * The recommended spine, as a facilitation map.
 *
 * The sixteen numbered modules are ordered and the order carries meaning — it
 * is the sequence Lelañea recommends — but it is a spine, not a track: jumping
 * anywhere is a first-class action and nothing locks. Daybreak holds that
 * shape as a published `FacilitationGraph` version, authored in the database.
 * This module builds the definition that seed publishes, from the same
 * structure file the module registry and the content API read, so the three
 * cannot disagree.
 *
 * **Shape (decision A6).** Five `region` nodes, one per tier, onboarding
 * included. Seventeen `module` nodes whose keys ARE their module slugs, each
 * inside its tier's region. Sixteen `related_to` edges along the numbered
 * order — advisory only; the engine never consults `related_to` for
 * eligibility. No `prerequisite`, no `unlocks`, no conditions, so every node
 * is an entry node and the availability computation opens all of them.
 *
 * **Region keys are prefixed.** Node keys share one namespace, and `onboarding`
 * is both a tier id and a module slug. A region is `tier:<tier id>`; a module
 * is its bare slug (from `moduleSlugFromId`), because journey state keys on
 * the node key and the journey API addresses modules by slug.
 *
 * **What the graph carries, and what it does not.** Only structure: keys,
 * types, containment, order. Titles, intents and display numbers stay in the
 * content API — a copy here would be a second source for the drawer to read,
 * and the one it read would be the one that drifted. The `meta` bags hold the
 * two numbers a reader needs to sort without going back to content (`order` on
 * a region, `number` on a module).
 *
 * The seed (`prisma/seeds/app-lelanea/001-journey-map.ts`) publishes this and
 * hashes this file, so a change to the shape here re-runs it.
 *
 * @see lib/framework/facilitation/map/schema.ts — the shape being filled
 * @see lib/app/modules/definitions.ts — the slug rule the node keys follow
 */

import { getJourneyStructure } from '@/lib/app/content';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';
import {
  mapDefinitionSchema,
  type MapDefinition,
  type MapEdge,
  type MapNode,
} from '@/lib/framework/facilitation/map/schema';

/** The one map Lelañea publishes. Journeys and the map API key on it. */
export const JOURNEY_MAP_SLUG = 'lelanea-journey';

/** A region node's key for a tier id: `tier:foundations`. */
export function regionKeyForTier(tierId: string): string {
  return `tier:${tierId}`;
}

let definition: MapDefinition | null = null;

/**
 * The journey map definition: five regions, seventeen modules, sixteen spine
 * edges. Returned already parsed through the framework's own schema, so the
 * defaults it materialises (`completionMode: 'once'`) are present — which is
 * what makes a deep-equal against the stored published version meaningful.
 *
 * Built once per process; the structure it reads is memoised and frozen.
 */
export function buildJourneyMapDefinition(): MapDefinition {
  if (definition) return definition;

  const structure = getJourneyStructure();
  const tiers = [...structure.tiers].sort((a, b) => a.order - b.order);
  const modules = [...structure.modules].sort((a, b) => a.number - b.number);

  const regions: MapNode[] = tiers.map((tier) => ({
    key: regionKeyForTier(tier.id),
    type: 'region',
    completionMode: 'once',
    meta: { order: tier.order },
  }));

  const places: MapNode[] = modules.map((module) => {
    const slug = moduleSlugFromId(module.id);
    return {
      key: slug,
      type: 'module',
      moduleSlug: slug,
      region: regionKeyForTier(module.tier),
      completionMode: 'once',
      meta: { number: module.number },
    };
  });

  // The spine: each module relates to the next in the numbered order. Advisory
  // (A6) — the engine reads `related_to` for nothing, so nothing here locks.
  const spine: MapEdge[] = places.slice(1).map((next, index) => ({
    // `index` walks `places` from 0, one short of `next`'s position.
    from: places[index].key,
    to: next.key,
    type: 'related_to',
  }));

  definition = mapDefinitionSchema.parse({ nodes: [...regions, ...places], edges: spine });
  return definition;
}
