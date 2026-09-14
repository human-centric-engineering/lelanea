/**
 * The journey map as the shell reads it: the published graph, joined with the
 * authored structure.
 *
 * The only path from the framework's published-map reader to the app shell.
 * `GET /api/v1/app/journey/map` is this function's HTTP face and what the map
 * drawer fetches; a server page reads it directly. Nothing under `app/(lelanea)`
 * or `components/app` imports `@/lib/framework` — the day Daybreak reshapes the
 * map, this file is where it is followed.
 *
 * **The graph is the source of structure; the content API decorates it.** Which
 * tiers exist, which modules, in what order and inside which tier all come from
 * the published `FacilitationGraph` version: a module's `tier` is the region
 * node it sits in, `number` is its position in the graph, and the lists are in
 * the graph's node order. Labels, intents, titles and the authored display
 * number come from `getJourneyStructure()` — the map deliberately carries none
 * of them (see `map-definition.ts`), so there is one place they can drift from,
 * and it is the authored file. The first draft of this file took tier and order
 * from the content while claiming the opposite; review caught it.
 *
 * **State is always `open` this phase.** Jumping anywhere is first-class and no
 * per-user journey exists yet; the field is on the shape now so the drawer and
 * the module page do not grow a second contract when `done` and `current`
 * arrive with per-user journeys.
 *
 * **A module the code does not register is reported, not dropped.** A map node
 * whose `moduleSlug` has no `ModuleDefinition` means the seed ran against newer
 * content than the running code, or the other way round. Silently omitting it
 * would render a sixteen-module map and nobody would notice; this throws an
 * `APIError` naming the slugs, which the route returns as a 500 envelope with
 * the list in `details` and logs.
 *
 * @see lib/app/journey/map-definition.ts — what the seed publishes
 * @see app/api/v1/app/journey/map/route.ts — the HTTP face
 */

import { APIError } from '@/lib/api/errors';
import { getJourneyStructure } from '@/lib/app/content';
import type { ModuleTier } from '@/lib/app/content/schemas';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';
import { getRegisteredModule } from '@/lib/framework/modules/registry';
import { getPublishedMap } from '@/lib/framework/facilitation/map/version-service';
import { JOURNEY_MAP_SLUG, tierIdForRegionKey } from '@/lib/app/journey/map-definition';

/** The one state a module can be in this phase. Widens with per-user journeys. */
export type JourneyModuleState = 'open';

export interface JourneyMapTier {
  id: ModuleTier;
  /** The authored label — `Inner Authority`. */
  label: string;
  /** The authored sentence saying what the tier is for. */
  intent: string;
  /** Position in the graph, from 0. */
  order: number;
}

export interface JourneyMapModule {
  /** The registered module slug, and the map node key. */
  slug: string;
  /** Position in the graph, from 0 — the spine's order. */
  number: number;
  /** `00` … `16`, as authored — a label, not the position. */
  displayNumber: string;
  title: string;
  tier: ModuleTier;
  state: JourneyModuleState;
}

export interface JourneyMapView {
  slug: string;
  /** The published version this view was projected from. */
  version: number;
  /** In map order. */
  tiers: JourneyMapTier[];
  /** In map order, which is the numbered order. */
  modules: JourneyMapModule[];
}

/** The error code the route returns when the map names a module the code does not register. */
export const JOURNEY_MAP_INCONSISTENT = 'JOURNEY_MAP_INCONSISTENT';

/**
 * The published map, projected for the shell — or `null` when no version is
 * published yet (a fresh database before `db:seed`), which the route turns into
 * a 404 and the drawer into its honest note.
 */
export async function getJourneyMap(): Promise<JourneyMapView | null> {
  const published = await getPublishedMap(JOURNEY_MAP_SLUG);
  if (!published) return null;

  const structure = getJourneyStructure();
  const tiersById = new Map(structure.tiers.map((tier) => [tier.id as string, tier]));
  const modulesBySlug = new Map(structure.modules.map((m) => [moduleSlugFromId(m.id), m]));

  const problems: string[] = [];
  const tiers: JourneyMapTier[] = [];
  const modules: JourneyMapModule[] = [];

  // Two passes, because a module's tier is the region it sits in and the
  // regions have to be known first. Order within each list is the graph's own
  // node order — the seed writes regions by tier order and modules by number,
  // and an editor that reorders them has reordered the map.
  const nodes = published.definition.nodes;
  const tierByRegionKey = new Map<string, JourneyMapTier>();
  for (const node of nodes) {
    if (node.type !== 'region') continue;
    const tierId = tierIdForRegionKey(node.key);
    const tier = tierId === null ? undefined : tiersById.get(tierId);
    if (!tier) {
      problems.push(`region "${node.key}" is not an authored tier`);
      continue;
    }
    const view = { id: tier.id, label: tier.label, intent: tier.intent, order: tiers.length };
    tiers.push(view);
    tierByRegionKey.set(node.key, view);
  }

  for (const node of nodes) {
    if (node.type !== 'module') continue;

    // Three things must agree: the code registers the slug (or the admin, the
    // atlas and every bound agent have nothing to point at); the authored
    // structure knows it (or there is no title to show); and the node sits in
    // a region that projected (or no tier in the drawer would list it — the
    // silent drop this function exists to refuse).
    const slug = node.moduleSlug ?? node.key;
    const authored = modulesBySlug.get(slug);
    const tier = node.region === undefined ? undefined : tierByRegionKey.get(node.region);
    if (!getRegisteredModule(slug)) problems.push(`module "${slug}" is not registered`);
    if (!authored) problems.push(`module "${slug}" is not in the authored structure`);
    if (!tier)
      problems.push(`module "${slug}" is in no projected region (${node.region ?? 'none'})`);
    if (!authored || !tier) continue;
    modules.push({
      slug,
      number: modules.length,
      displayNumber: authored.displayNumber,
      title: authored.title,
      tier: tier.id,
      state: 'open',
    });
  }

  if (problems.length > 0) {
    throw new APIError(
      'The published journey map does not agree with the running code',
      JOURNEY_MAP_INCONSISTENT,
      500,
      { map: JOURNEY_MAP_SLUG, version: published.version, problems }
    );
  }

  return { slug: published.slug, version: published.version, tiers, modules };
}
