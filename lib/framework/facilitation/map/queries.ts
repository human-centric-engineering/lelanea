/**
 * Map read queries (f-map t-3) — list + detail reads for the admin surfaces.
 *
 * Separated from `version-service.ts` (the version-centric writer/readers) the
 * way f-module-core split `queries.ts` from `sync.ts`: a single, testable place
 * for the "list the maps" / "one map with its published version" reads the admin
 * routes need. Does not swallow errors.
 */

import type { FacilitationGraph, FacilitationGraphVersion } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';

export type FacilitationGraphWithPublished = FacilitationGraph & {
  publishedVersion: FacilitationGraphVersion | null;
};

/** Every facilitation map, ordered by slug. Empty on a fresh fork. */
export async function listGraphs(): Promise<FacilitationGraph[]> {
  return prisma.facilitationGraph.findMany({ orderBy: { slug: 'asc' } });
}

/** Whether a map row exists (a cheap id-only probe, mirroring `moduleExists`). Lets a
 *  route 404 an unknown map before running an aggregate, without over-fetching the row. */
export async function graphExists(slug: string): Promise<boolean> {
  const row = await prisma.facilitationGraph.findFirst({ where: { slug }, select: { id: true } });
  return row !== null;
}

/** One map (with its published version) by slug; throws `NotFoundError` if absent. */
export async function getGraphDetail(slug: string): Promise<FacilitationGraphWithPublished> {
  const graph = await prisma.facilitationGraph.findFirst({
    where: { slug },
    include: { publishedVersion: true },
  });
  if (!graph) throw new NotFoundError(`Facilitation map "${slug}" not found`);
  return graph;
}
