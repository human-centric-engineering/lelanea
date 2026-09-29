/**
 * Map node-embedding sync (f-overlays t-1, spec §5.4, F9) — embeds every node of a map's PUBLISHED
 * version and upserts the vectors into `framework_node_embedding`, so guidance can suggest advisory
 * "related places" (t-2). Reuses the Sunrise-core embedder (`embedBatch`, which self-logs cost); this
 * is the framework adapter that composes node text and stores the vectors keyed on
 * `(graphSlug, nodeKey, version)`.
 *
 * Triggered two ways: on-demand (an admin route — the manual repair/backfill path) and, since
 * f-governance-plus t-3, automatically after every map publish via `autoEmbedAfterPublish` (fire-and-
 * forget, below). Idempotent: re-running upserts by the natural key. Staleness is safe by construction
 * — the key includes the published `version`, so after a republish the current version simply has no
 * rows until re-embedded and the advisory result degrades to empty (F9).
 */

import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { NotFoundError } from '@/lib/api/errors';
import { logger } from '@/lib/logging';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { embedBatch } from '@/lib/orchestration/knowledge/embedder';
import { getPublishedMap } from '@/lib/framework/facilitation/map/version-service';
import { getRegisteredModule } from '@/lib/framework/modules/registry';
import { composeNodeText } from '@/lib/framework/facilitation/overlays/node-text';

const ENTITY_TYPE = 'framework_node_embedding';

export interface SyncMapNodeEmbeddingsArgs {
  slug: string;
  /** The actor — the admin triggering the sync, or `null` for a system-driven auto-embed (a publish
   *  whose actor was itself null, e.g. an auto-approved `publishDefinition`). Audit actor only. */
  actorUserId: string | null;
  clientIp?: string | null;
}

export interface SyncMapNodeEmbeddingsResult {
  slug: string;
  /** The published version the embeddings were generated for. */
  version: number;
  /** Nodes in the published map. */
  nodeCount: number;
  /** Rows upserted (equals `nodeCount` on success). */
  embeddedCount: number;
  model: string | null;
  dimensions: number | null;
}

/**
 * Embed every node of `slug`'s published map version and upsert the vectors. Throws `NotFoundError`
 * when the map has no published version. A map with zero nodes is a no-op (returns `embeddedCount: 0`).
 */
export async function syncMapNodeEmbeddings(
  args: SyncMapNodeEmbeddingsArgs
): Promise<SyncMapNodeEmbeddingsResult> {
  const { slug, actorUserId, clientIp } = args;

  const map = await getPublishedMap(slug);
  if (!map) throw new NotFoundError(`Map "${slug}" has no published version to embed`);

  const nodes = map.definition.nodes;

  if (nodes.length === 0) {
    logAdminAction({
      userId: actorUserId,
      action: 'framework_node_embedding.sync',
      entityType: ENTITY_TYPE,
      entityId: slug,
      entityName: slug,
      metadata: { slug, version: map.version, nodeCount: 0, embeddedCount: 0 },
      clientIp: clientIp ?? null,
    });
    return {
      slug,
      version: map.version,
      nodeCount: 0,
      embeddedCount: 0,
      model: null,
      dimensions: null,
    };
  }

  // Compose the source text per node; module nodes pull name/description from the code registry.
  const texts = nodes.map((node) => {
    const moduleDef =
      node.type === 'module' && node.moduleSlug ? getRegisteredModule(node.moduleSlug) : undefined;
    return composeNodeText(
      node,
      moduleDef ? { name: moduleDef.name, description: moduleDef.description } : undefined
    );
  });

  // Raw SQL is not stamped by the tenancy chokepoint, so the upsert below writes the org itself:
  // the org this call runs in (the install org at single). Resolved BEFORE the embedding call, so a
  // caller with no org fails before the provider is billed, not after.
  const orgId = requireOrgId();
  const { embeddings, provenance } = await embedBatch(texts, undefined, 'document');

  // Upsert one row per node, keyed on (orgId, graphSlug, nodeKey, version) — the per-org unique
  // (§34 / Sunrise §107). Sequential over a bounded map (F8 — ≤ low-hundreds of nodes); each
  // upsert is idempotent, so a partial failure is fixed on re-run.
  let embeddedCount = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const embeddingStr = `[${embeddings[i].join(',')}]`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO framework_node_embedding (
         id, "orgId", "graphSlug", "nodeKey", "version", embedding,
         "embeddingModel", "embeddingProvider", "embeddingDimension", "sourceText", "updatedAt"
       )
       VALUES (gen_random_uuid(), $9, $1, $2, $3, $4::vector, $5, $6, $7, $8, NOW())
       ON CONFLICT ("orgId", "graphSlug", "nodeKey", "version") DO UPDATE
         SET embedding = $4::vector,
             "embeddingModel" = $5,
             "embeddingProvider" = $6,
             "embeddingDimension" = $7,
             "sourceText" = $8,
             "updatedAt" = NOW()`,
      slug,
      nodes[i].key,
      map.version,
      embeddingStr,
      provenance.model,
      provenance.provider,
      provenance.dimensions,
      texts[i],
      orgId
    );
    embeddedCount += 1;
  }

  logAdminAction({
    userId: actorUserId,
    action: 'framework_node_embedding.sync',
    entityType: ENTITY_TYPE,
    entityId: slug,
    entityName: slug,
    metadata: {
      slug,
      version: map.version,
      nodeCount: nodes.length,
      embeddedCount,
      model: provenance.model,
      dimensions: provenance.dimensions,
    },
    clientIp: clientIp ?? null,
  });

  return {
    slug,
    version: map.version,
    nodeCount: nodes.length,
    embeddedCount,
    model: provenance.model,
    dimensions: provenance.dimensions,
  };
}

/**
 * Fire-and-forget re-embed after a map publish (f-governance-plus t-3). Called by the map version
 * service AFTER the publish transaction commits — NEVER inside it: embedding hits the network and
 * must not fail or extend the publish. Embeddings are advisory (degrade to empty per F9) and the
 * natural-key upsert makes re-runs idempotent, so a swallowed failure is safe — the on-demand route
 * stays the manual repair/backfill path. A `NotFoundError` (nothing published to embed, e.g. an empty
 * initial map) is benign and silent; any other failure is logged, not thrown.
 */
export function autoEmbedAfterPublish(slug: string, actorUserId: string | null): void {
  void syncMapNodeEmbeddings({ slug, actorUserId }).catch((err: unknown) => {
    if (err instanceof NotFoundError) return; // nothing to embed yet — benign
    logger.warn('Auto-embed after publish failed (advisory, non-fatal)', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
