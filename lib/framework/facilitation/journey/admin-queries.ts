/**
 * Journey admin-surface reads (f-ops-views t-5a).
 *
 * The explorer's two enriched reads, kept OUT of `queries.ts` so that module stays
 * the pure `canRead`/`subjectScope`-gated primitive layer (`f-journey-state`). These
 * *compose* those primitives for the personal data (journey rows, node states,
 * timeline — all gated) and stitch in **authored, non-personal** map metadata
 * (`FacilitationGraph` name; the published structure) directly, since that is config,
 * not user data, and needs no per-subject gate.
 *
 * Both reads shape rows into the JSON wire views (`view.ts`) — ISO-string dates — so
 * the route just serialises. No N+1: the list stitches map names and node-state
 * counts with one batched query each over the already-scoped journey ids.
 */

import { prisma } from '@/lib/db/client';
import { mapDefinitionSchema, type MapDefinition } from '@/lib/framework/facilitation/map/schema';
import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import type { JourneyViewer, AccessScope } from '@/lib/framework/shared/access';
import {
  listJourneys,
  getJourneyById,
  getNodeStates,
  getJourneyTimeline,
} from '@/lib/framework/facilitation/journey/queries';
import type {
  JourneyListItem,
  JourneyDetailView,
  JourneyProgress,
} from '@/lib/framework/facilitation/journey/view';

/** Parse a stored published `definition` into typed nodes/edges; `null` if unparseable. */
function parseStructure(definition: unknown): MapDefinition | null {
  const parsed = mapDefinitionSchema.safeParse(definition);
  return parsed.success ? parsed.data : null;
}

/** An optional timestamp in wire form: ISO string, or `null` when unset. */
function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Pagination inputs for {@link listJourneysForAdmin} (already-validated, 1-based page). */
export interface ListJourneysParams {
  page: number;
  limit: number;
  graphSlug?: string;
}

/**
 * A page of the explorer picker: the journeys the viewer may see (newest first),
 * each stitched with its map's display name and a completed/total node count. The
 * two enrichment lookups are batched over the page's journey ids — no per-row query.
 */
export async function listJourneysForAdmin(
  viewer: JourneyViewer,
  params: ListJourneysParams,
  scope?: AccessScope
): Promise<{ items: JourneyListItem[]; total: number }> {
  const { page, limit, graphSlug } = params;
  const { journeys, total } = await listJourneys(
    viewer,
    { skip: (page - 1) * limit, limit, graphSlug },
    scope
  );

  if (journeys.length === 0) return { items: [], total };

  const slugs = [...new Set(journeys.map((j) => j.graphSlug))];
  const ids = journeys.map((j) => j.id);

  const [graphs, stateCounts] = await Promise.all([
    prisma.facilitationGraph.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, name: true },
    }),
    prisma.userNodeState.groupBy({
      by: ['journeyId', 'status'],
      where: { journeyId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const graphBySlug = new Map(graphs.map((g) => [g.slug, g]));
  const progressByJourney = new Map<string, JourneyProgress>();
  for (const row of stateCounts) {
    const p = progressByJourney.get(row.journeyId) ?? { total: 0, completed: 0 };
    p.total += row._count._all;
    if (row.status === NODE_STATE_STATUS.completed) p.completed += row._count._all;
    progressByJourney.set(row.journeyId, p);
  }

  const items: JourneyListItem[] = journeys.map((j) => {
    const graph = graphBySlug.get(j.graphSlug);
    return {
      id: j.id,
      userId: j.userId,
      graphSlug: j.graphSlug,
      contextKey: j.contextKey,
      startedAt: j.startedAt.toISOString(),
      graph: graph ? { name: graph.name, slug: graph.slug } : null,
      progress: progressByJourney.get(j.id) ?? { total: 0, completed: 0 },
    };
  });

  return { items, total };
}

/**
 * The full detail bundle for one journey (identity + published map structure +
 * current node states + full timeline), or `null` when the journey row is absent.
 * The personal-data reads go through the gated primitives (`getJourneyById` gates
 * the viewer, then `getNodeStates`/`getJourneyTimeline` re-gate on the owner); the
 * map structure is stitched directly and degrades to `null` when nothing is
 * published / the map is gone / the definition doesn't parse.
 */
export async function getJourneyDetailForAdmin(
  viewer: JourneyViewer,
  journeyId: string,
  scope?: AccessScope
): Promise<JourneyDetailView | null> {
  const journey = await getJourneyById(viewer, journeyId, scope);
  if (!journey) return null;

  const [graph, nodeStates, timeline] = await Promise.all([
    prisma.facilitationGraph.findFirst({
      where: { slug: journey.graphSlug },
      include: { publishedVersion: true },
    }),
    getNodeStates(viewer, { journeyId, subject: journey.userId }, scope),
    getJourneyTimeline(viewer, { journeyId, subject: journey.userId }, undefined, scope),
  ]);

  return {
    journey: {
      id: journey.id,
      userId: journey.userId,
      graphSlug: journey.graphSlug,
      contextKey: journey.contextKey,
      startedAt: journey.startedAt.toISOString(),
    },
    graph: graph
      ? {
          name: graph.name,
          slug: graph.slug,
          structure: graph.publishedVersion
            ? parseStructure(graph.publishedVersion.definition)
            : null,
        }
      : null,
    nodeStates: nodeStates.map((s) => ({
      nodeKey: s.nodeKey,
      status: s.status,
      timesCompleted: s.timesCompleted,
      firstEnteredAt: isoOrNull(s.firstEnteredAt),
      lastActiveAt: isoOrNull(s.lastActiveAt),
      completedAt: isoOrNull(s.completedAt),
    })),
    timeline: timeline.map((e) => ({
      id: e.id,
      type: e.type,
      nodeKey: e.nodeKey,
      moduleSlug: e.moduleSlug,
      occurredAt: e.occurredAt.toISOString(),
    })),
  };
}
