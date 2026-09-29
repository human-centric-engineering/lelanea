/**
 * Map node-embedding sync (f-overlays t-1). Mocks the DB client, the published-map reader, the module
 * registry, the core embedder, and the audit logger. Proves the 404 gate, the per-node compose +
 * embed + upsert (keyed on graphSlug/nodeKey/version, with the `[..]::vector` payload + provenance),
 * the module-name signal, the empty-map no-op, and audit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: { $executeRawUnsafe: vi.fn() } }));
vi.mock('@/lib/framework/facilitation/map/version-service', () => ({ getPublishedMap: vi.fn() }));
vi.mock('@/lib/framework/modules/registry', () => ({ getRegisteredModule: vi.fn() }));
vi.mock('@/lib/orchestration/knowledge/embedder', () => ({ embedBatch: vi.fn() }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/tenancy/context', () => ({ requireOrgId: vi.fn(() => 'install') }));

import {
  syncMapNodeEmbeddings,
  autoEmbedAfterPublish,
} from '@/lib/framework/facilitation/overlays/embed-sync';
import { prisma } from '@/lib/db/client';
import { getPublishedMap } from '@/lib/framework/facilitation/map/version-service';
import { getRegisteredModule } from '@/lib/framework/modules/registry';
import { embedBatch } from '@/lib/orchestration/knowledge/embedder';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { logger } from '@/lib/logging';
import { NotFoundError } from '@/lib/api/errors';
import { requireOrgId } from '@/lib/tenancy/context';

/** Flush the fire-and-forget promise chain (all mocks resolve synchronously). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const mapNode = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  type: 'stage',
  completionMode: 'once',
  ...over,
});

const provenance = {
  model: 'text-embedding-3-small',
  provider: 'openai-compatible',
  dimensions: 1536,
  embeddedAt: new Date(0),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPublishedMap).mockResolvedValue({
    slug: 'primary',
    version: 4,
    definition: { nodes: [mapNode('a'), mapNode('b')], edges: [] },
  } as never);
  vi.mocked(getRegisteredModule).mockReturnValue(undefined);
  vi.mocked(embedBatch).mockResolvedValue({
    embeddings: [
      [0.1, 0.2],
      [0.3, 0.4],
    ],
    provenance,
  });
  vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1);
});

describe('syncMapNodeEmbeddings', () => {
  it('refuses before calling the embedding provider when the call has no org', async () => {
    vi.mocked(requireOrgId).mockImplementationOnce(() => {
      throw new Error('No org in the tenant context');
    });

    await expect(
      syncMapNodeEmbeddings({ slug: 'primary', actorUserId: 'admin-1' })
    ).rejects.toThrow('No org in the tenant context');
    // Nothing billed, nothing written.
    expect(embedBatch).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('embeds every node and upserts keyed on (orgId, graphSlug, nodeKey, version), then audits', async () => {
    const result = await syncMapNodeEmbeddings({ slug: 'primary', actorUserId: 'admin-1' });

    expect(result).toMatchObject({
      slug: 'primary',
      version: 4,
      nodeCount: 2,
      embeddedCount: 2,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });

    // One embedBatch call over the composed texts, as documents.
    expect(embedBatch).toHaveBeenCalledTimes(1);
    const [texts, , inputType] = vi.mocked(embedBatch).mock.calls[0];
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('Node: a');
    expect(inputType).toBe('document');

    // One upsert per node; args carry the natural key, the [..]::vector payload string, provenance.
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0];
    expect(firstCall[1]).toBe('primary'); // $1 graphSlug
    expect(firstCall[2]).toBe('a'); // $2 nodeKey
    expect(firstCall[3]).toBe(4); // $3 version
    expect(firstCall[4]).toBe('[0.1,0.2]'); // $4 embedding literal
    expect(firstCall[5]).toBe('text-embedding-3-small'); // $5 model
    expect(firstCall[7]).toBe(1536); // $7 dimension
    // The org is written explicitly (raw SQL is not stamped by the tenancy chokepoint) and the
    // conflict target is the per-org unique — the global (graphSlug, nodeKey, version) key is gone.
    expect(firstCall[9]).toBe('install'); // $9 orgId — the install org at single
    expect(firstCall[0]).toContain('"orgId", "graphSlug", "nodeKey", "version", embedding');
    expect(firstCall[0]).toContain('ON CONFLICT ("orgId", "graphSlug", "nodeKey", "version")');

    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'framework_node_embedding.sync', entityId: 'primary' })
    );
  });

  it('404s a map with no published version (no embedding, no write)', async () => {
    vi.mocked(getPublishedMap).mockResolvedValue(null);
    await expect(syncMapNodeEmbeddings({ slug: 'nope', actorUserId: 'a' })).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(embedBatch).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('composes the registered module name/description into a module node’s text', async () => {
    vi.mocked(getPublishedMap).mockResolvedValue({
      slug: 'primary',
      version: 1,
      definition: {
        nodes: [mapNode('intro', { type: 'module', moduleSlug: 'onboarding' })],
        edges: [],
      },
    } as never);
    vi.mocked(getRegisteredModule).mockReturnValue({
      slug: 'onboarding',
      name: 'Onboarding',
      description: 'Get oriented.',
    } as never);
    vi.mocked(embedBatch).mockResolvedValue({ embeddings: [[0.5]], provenance });

    await syncMapNodeEmbeddings({ slug: 'primary', actorUserId: 'a' });
    expect(getRegisteredModule).toHaveBeenCalledWith('onboarding');
    const [texts] = vi.mocked(embedBatch).mock.calls[0];
    expect(texts[0]).toContain('Module: Onboarding');
    expect(texts[0]).toContain('Get oriented.');
  });

  it('is a no-op for a published map with zero nodes (still audits)', async () => {
    vi.mocked(getPublishedMap).mockResolvedValue({
      slug: 'primary',
      version: 2,
      definition: { nodes: [], edges: [] },
    });
    const result = await syncMapNodeEmbeddings({ slug: 'primary', actorUserId: 'a' });
    expect(result).toMatchObject({ nodeCount: 0, embeddedCount: 0, model: null });
    expect(embedBatch).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'framework_node_embedding.sync' })
    );
  });
});

describe('autoEmbedAfterPublish (fire-and-forget, f-governance-plus t-4)', () => {
  it('runs the embed for the published map (does not throw synchronously)', async () => {
    expect(() => autoEmbedAfterPublish('primary', 'admin-1')).not.toThrow();
    await flush();
    expect(embedBatch).toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('threads a null actor through to the sync (system-driven auto-embed)', async () => {
    autoEmbedAfterPublish('primary', null);
    await flush();
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it('swallows a real failure — logs a warning, never throws', async () => {
    vi.mocked(embedBatch).mockRejectedValue(new Error('embedder down'));
    autoEmbedAfterPublish('primary', 'admin-1');
    await flush();
    expect(logger.warn).toHaveBeenCalledWith(
      'Auto-embed after publish failed (advisory, non-fatal)',
      expect.objectContaining({ slug: 'primary' })
    );
  });

  it('is silent on NotFoundError (nothing published to embed yet)', async () => {
    vi.mocked(getPublishedMap).mockResolvedValue(null);
    autoEmbedAfterPublish('primary', 'admin-1');
    await flush();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(embedBatch).not.toHaveBeenCalled();
  });
});
