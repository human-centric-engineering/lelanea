/**
 * Facilitation map version service (f-map t-2).
 *
 * Exercises the real create/draft/publish/rollback/read logic against a small
 * STATEFUL in-memory Prisma fake — `create`/`update` mutate a store and the
 * finders read it back, so version monotonicity, published-pointer moves, and
 * draft clearing are proven for real rather than asserted call-by-call (house
 * style: no live DB in vitest). The HTTP contract over these functions is t-3.
 *
 * The real `@prisma/client` is NOT mocked — the service's `Prisma.DbNull`
 * sentinel and `PrismaClientKnownRequestError` (the P2002 path) must be genuine.
 *
 * @see lib/framework/facilitation/map/version-service.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// ─── Stateful in-memory Prisma fake ──────────────────────────────────────────
const { prismaFake, resetStore } = vi.hoisted(() => {
  const store = {
    graphs: new Map<string, any>(),
    versions: new Map<string, any>(),
    seq: 0,
  };
  const id = (p: string) => `${p}${(store.seq += 1)}`;

  function findGraph(where: any): any {
    if (where.id) return store.graphs.get(where.id) ?? null;
    if (where.slug) {
      for (const g of store.graphs.values()) if (g.slug === where.slug) return g;
    }
    return null;
  }

  function findVersion(where: any): any {
    if (where.id) return store.versions.get(where.id) ?? null;
    if (where.graphId_version) {
      const { graphId, version } = where.graphId_version;
      for (const v of store.versions.values())
        if (v.graphId === graphId && v.version === version) return v;
    }
    return null;
  }

  const graph = {
    create: async ({ data }: any) => {
      for (const g of store.graphs.values()) {
        if (g.slug === data.slug) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
      }
      const row = {
        id: id('g'),
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        draftDefinition: data.draftDefinition ?? null,
        publishedVersionId: data.publishedVersionId ?? null,
        createdBy: data.createdBy ?? null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      store.graphs.set(row.id, row);
      return { ...row };
    },
    // `findUnique` (id-keyed reads) and `findFirst` (the per-org slug reads §107 —
    // `facilitationGraph.slug` is no longer globally unique) share one lookup: the
    // fake's `findGraph` already branches on which key the `where` carries.
    findUnique: async ({ where, include }: any) => {
      const row = findGraph(where);
      if (!row) return null;
      if (include?.publishedVersion) {
        return {
          ...row,
          publishedVersion: row.publishedVersionId
            ? (store.versions.get(row.publishedVersionId) ?? null)
            : null,
        };
      }
      return { ...row };
    },
    findFirst: async (args: any) => graph.findUnique(args),
    findUniqueOrThrow: async ({ where }: any) => {
      const row = findGraph(where);
      if (!row) throw new Error('not found');
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = findGraph(where);
      if (!row) throw new Error('not found');
      if ('draftDefinition' in data) {
        row.draftDefinition = data.draftDefinition === Prisma.DbNull ? null : data.draftDefinition;
      }
      if ('publishedVersionId' in data) row.publishedVersionId = data.publishedVersionId;
      return { ...row };
    },
  };

  const version = {
    create: async ({ data }: any) => {
      const row = { id: id('v'), createdAt: new Date(0), changeSummary: null, ...data };
      store.versions.set(row.id, row);
      return { ...row };
    },
    findFirst: async ({ where, orderBy }: any) => {
      let rows = [...store.versions.values()].filter((v) => v.graphId === where.graphId);
      if (orderBy?.version === 'desc') rows = rows.sort((a, b) => b.version - a.version);
      return rows[0] ? { ...rows[0] } : null;
    },
    findUnique: async ({ where }: any) => {
      const row = findVersion(where);
      return row ? { ...row } : null;
    },
    findMany: async ({ where, orderBy, take, cursor, skip }: any) => {
      let rows = [...store.versions.values()].filter((v) => v.graphId === where.graphId);
      if (orderBy?.version === 'desc') rows = rows.sort((a, b) => b.version - a.version);
      if (cursor) {
        const idx = rows.findIndex((r) => r.id === cursor.id);
        if (idx >= 0) rows = rows.slice(idx + (skip ?? 0));
      }
      if (take) rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    },
  };

  const prismaFake = {
    facilitationGraph: graph,
    facilitationGraphVersion: version,
    // The service only opens single-map transactions; run the callback against
    // the same fake so its writes land in the shared store.
    $transaction: async (fn: any) => fn(prismaFake),
  };

  return {
    prismaFake,
    resetStore: () => {
      store.graphs.clear();
      store.versions.clear();
      store.seq = 0;
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction: vi.fn() }));
// Post-publish hook seam (f-governance-plus t-4) — mock it so the version tests don't fire real
// listeners (auto-embed), and so we can assert every publish path notifies it.
vi.mock('@/lib/framework/facilitation/map/publish-hooks', () => ({
  notifyMapPublished: vi.fn(),
}));

import {
  createGraph,
  saveDraft,
  discardDraft,
  publishDraft,
  publishDefinition,
  rollback,
  getPublishedMap,
  getPublishedMapVersion,
  listVersions,
  getVersion,
  validatePublishableMap,
} from '@/lib/framework/facilitation/map/version-service';
import { mapDefinitionSchema } from '@/lib/framework/facilitation/map/schema';
import type { MapDefinition } from '@/lib/framework/facilitation/map/schema';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { notifyMapPublished } from '@/lib/framework/facilitation/map/publish-hooks';
import { NotFoundError, ValidationError } from '@/lib/api/errors';

const USER = 'user-1';

/** A valid, referentially-sound map (parsed to the MapDefinition output type). */
function validMap(moduleSlug = 'reading'): MapDefinition {
  return mapDefinitionSchema.parse({
    nodes: [
      { key: 'start', type: 'milestone' },
      { key: 'lesson', type: 'module', moduleSlug },
    ],
    edges: [{ from: 'start', to: 'lesson', type: 'prerequisite' }],
  });
}

/** Schema-valid but referentially broken (dangling edge endpoint). */
function danglingMap(): MapDefinition {
  return mapDefinitionSchema.parse({
    nodes: [{ key: 'start', type: 'milestone' }],
    edges: [{ from: 'start', to: 'ghost', type: 'unlocks' }],
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('validatePublishableMap', () => {
  it('returns the parsed definition for a valid map', () => {
    expect(validatePublishableMap(validMap())).toMatchObject({ nodes: expect.any(Array) });
  });

  it('throws ValidationError on a malformed (non-schema) blob', () => {
    expect(() => validatePublishableMap({ nope: true })).toThrow(ValidationError);
  });

  it('throws ValidationError on a referentially broken map', () => {
    try {
      validatePublishableMap(danglingMap());
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toMatch(/referential/i);
    }
  });

  it('throws ValidationError on a graph-invariant violation (f-engine t-4 stage)', () => {
    // A prerequisite cycle passes schema + referential checks but fails the appended
    // graph-invariant stage — the seam f-engine filled.
    const cyclic = mapDefinitionSchema.parse({
      nodes: [
        { key: 'a', type: 'milestone' },
        { key: 'b', type: 'milestone' },
      ],
      edges: [
        { from: 'a', to: 'b', type: 'prerequisite' },
        { from: 'b', to: 'a', type: 'prerequisite' },
      ],
    });
    try {
      validatePublishableMap(cyclic);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toMatch(/invariant/i);
    }
  });
});

describe('createGraph', () => {
  it('creates an empty map (no version, no draft) and audits', async () => {
    const graph = await createGraph({ slug: 'main', name: 'Main', userId: USER });
    expect(graph.slug).toBe('main');
    expect(graph.publishedVersionId).toBeNull();
    expect((await listVersions('main')).versions).toHaveLength(0);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'facilitation_graph.create' })
    );
  });

  it('publishes v1 atomically when an initial definition is given', async () => {
    const graph = await createGraph({
      slug: 'main',
      name: 'Main',
      definition: validMap(),
      userId: USER,
    });
    expect(graph.publishedVersionId).not.toBeNull();
    const published = await getPublishedMap('main');
    expect(published?.version).toBe(1);
  });

  it('rejects an invalid initial definition before writing anything', async () => {
    await expect(
      createGraph({ slug: 'main', name: 'Main', definition: danglingMap(), userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(getPublishedMap('main')).resolves.toBeNull();
  });

  it('maps a duplicate slug to a ValidationError, not a raw Prisma error', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    await expect(createGraph({ slug: 'main', name: 'Other', userId: USER })).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

describe('saveDraft / discardDraft', () => {
  it('saves a draft without validating it, then discards it', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    // A referentially broken map is fine as a draft (no publish validation).
    const withDraft = await saveDraft({ slug: 'main', definition: danglingMap(), userId: USER });
    expect(withDraft.draftDefinition).not.toBeNull();
    const cleared = await discardDraft({ slug: 'main', userId: USER });
    expect(cleared.draftDefinition).toBeNull();
  });

  it('throws NotFoundError for an unknown map', async () => {
    await expect(
      saveDraft({ slug: 'ghost', definition: validMap(), userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('publishDraft', () => {
  it('promotes the draft to a new version, moves the pointer, and clears the draft', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    await saveDraft({ slug: 'main', definition: validMap(), userId: USER });

    const { graph, version } = await publishDraft({ slug: 'main', userId: USER });
    expect(version.version).toBe(1);
    expect(graph.publishedVersionId).toBe(version.id);
    expect(graph.draftDefinition).toBeNull();

    // A second publish increments to v2.
    await saveDraft({ slug: 'main', definition: validMap('writing'), userId: USER });
    const second = await publishDraft({ slug: 'main', userId: USER, changeSummary: 'v2' });
    expect(second.version.version).toBe(2);
    expect((await getPublishedMap('main'))?.version).toBe(2);
  });

  it('throws ValidationError when there is no draft', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    await expect(publishDraft({ slug: 'main', userId: USER })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('throws ValidationError when the draft fails referential validation', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    await saveDraft({ slug: 'main', definition: danglingMap(), userId: USER });
    await expect(publishDraft({ slug: 'main', userId: USER })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('throws NotFoundError for an unknown map', async () => {
    await expect(publishDraft({ slug: 'ghost', userId: USER })).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('publishDefinition (the f-emergence proposal-publish primitive)', () => {
  it('publishes a definition as a new version, preserving the author, without touching the draft', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER }); // v1
    await saveDraft({ slug: 'main', definition: validMap('writing'), userId: USER }); // a real WIP draft

    const { graph, version } = await publishDefinition({
      slug: 'main',
      definition: validMap('reading'),
      createdBy: 'agent:onboarding', // agent authorship (F17)
      actorUserId: 'admin-9',
    });

    expect(version.version).toBe(2); // monotonic after v1
    expect(version.createdBy).toBe('agent:onboarding'); // author preserved, not the actor
    expect(graph.publishedVersionId).toBe(version.id); // pinned
    expect(graph.draftDefinition).not.toBeNull(); // the WIP draft is left intact (unlike publishDraft)
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'facilitation_graph.publish', userId: 'admin-9' })
    );
  });

  it('publishes v1 when the map has no published version yet (author = user)', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER }); // no definition → no published version
    const { version } = await publishDefinition({
      slug: 'main',
      definition: validMap(),
      createdBy: USER,
      actorUserId: USER,
    });
    expect(version.version).toBe(1);
  });

  it('re-validates the definition (a broken definition is refused)', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER });
    await expect(
      publishDefinition({
        slug: 'main',
        definition: danglingMap(),
        createdBy: USER,
        actorUserId: USER,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('404s an unknown map', async () => {
    await expect(
      publishDefinition({
        slug: 'ghost',
        definition: validMap(),
        createdBy: USER,
        actorUserId: USER,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('publishes when expectedBaseVersion matches the current published version', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER }); // v1
    const { version } = await publishDefinition({
      slug: 'main',
      definition: validMap('x'),
      createdBy: USER,
      actorUserId: USER,
      expectedBaseVersion: 1,
    });
    expect(version.version).toBe(2);
  });

  it('aborts when the map moved from expectedBaseVersion (conflict re-check inside the tx)', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER }); // v1
    await expect(
      publishDefinition({
        slug: 'main',
        definition: validMap('x'),
        createdBy: USER,
        actorUserId: USER,
        expectedBaseVersion: 99,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('rollback', () => {
  it('creates a new version copying the target and re-pins to it', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER }); // v1
    await saveDraft({ slug: 'main', definition: validMap('writing'), userId: USER });
    await publishDraft({ slug: 'main', userId: USER }); // v2

    const { version } = await rollback({ slug: 'main', targetVersion: 1, userId: USER });
    expect(version.version).toBe(3); // history is never rewritten
    // v3's snapshot equals v1's module node.
    const published = await getPublishedMap('main');
    expect(published?.version).toBe(3);
    expect(published?.definition.nodes.find((n) => n.type === 'module')?.moduleSlug).toBe(
      'reading'
    );
  });

  it('throws NotFoundError for a version that does not exist', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER });
    await expect(
      rollback({ slug: 'main', targetVersion: 99, userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getPublishedMap', () => {
  it('returns null for an unknown map and for a map with no published version', async () => {
    await expect(getPublishedMap('ghost')).resolves.toBeNull();
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    await expect(getPublishedMap('main')).resolves.toBeNull();
  });

  it('returns the typed published definition', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER });
    const published = await getPublishedMap('main');
    expect(published).toMatchObject({ slug: 'main', version: 1 });
    expect(published?.definition.nodes).toHaveLength(2);
  });
});

describe('getPublishedMapVersion', () => {
  it('returns null for an unknown map and for a map with no published version', async () => {
    await expect(getPublishedMapVersion('ghost')).resolves.toBeNull();
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    await expect(getPublishedMapVersion('main')).resolves.toBeNull();
  });

  it('returns the live published version number, tracking republishes', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER }); // v1
    await expect(getPublishedMapVersion('main')).resolves.toBe(1);
    await saveDraft({ slug: 'main', definition: validMap('a'), userId: USER });
    await publishDraft({ slug: 'main', userId: USER }); // v2
    await expect(getPublishedMapVersion('main')).resolves.toBe(2);
  });
});

describe('listVersions / getVersion', () => {
  async function seedThreeVersions() {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER }); // v1
    await saveDraft({ slug: 'main', definition: validMap('a'), userId: USER });
    await publishDraft({ slug: 'main', userId: USER }); // v2
    await saveDraft({ slug: 'main', definition: validMap('b'), userId: USER });
    await publishDraft({ slug: 'main', userId: USER }); // v3
  }

  it('lists versions newest-first and paginates by cursor', async () => {
    await seedThreeVersions();
    const page1 = await listVersions('main', { limit: 2 });
    expect(page1.versions.map((v) => v.version)).toEqual([3, 2]);
    expect(page1.nextCursor).not.toBeNull();
    // The live version (the newest, v3) is flagged so a consumer needn't refetch.
    expect(page1.publishedVersionId).toBe(page1.versions[0]?.id);

    const page2 = await listVersions('main', { limit: 2, cursor: page1.nextCursor! });
    expect(page2.versions.map((v) => v.version)).toEqual([1]);
    expect(page2.nextCursor).toBeNull();
  });

  it('gets a single version by number, and throws NotFoundError otherwise', async () => {
    await seedThreeVersions();
    expect((await getVersion('main', 2)).version).toBe(2);
    await expect(getVersion('main', 99)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('auto-embed-on-publish (f-governance-plus t-4)', () => {
  it('notifies the publish hook after createGraph publishes a v1 (non-empty initial map)', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER });
    expect(notifyMapPublished).toHaveBeenCalledWith('main', USER);
  });

  it('does NOT notify the hook for an empty create (nothing published)', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    expect(notifyMapPublished).not.toHaveBeenCalled();
  });

  it('notifies the publish hook after publishDraft', async () => {
    await createGraph({ slug: 'main', name: 'Main', userId: USER });
    await saveDraft({ slug: 'main', definition: validMap(), userId: USER });
    vi.mocked(notifyMapPublished).mockClear();
    await publishDraft({ slug: 'main', userId: USER });
    expect(notifyMapPublished).toHaveBeenCalledWith('main', USER);
  });

  it('notifies the publish hook after publishDefinition, threading a null actor unchanged', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER });
    vi.mocked(notifyMapPublished).mockClear();
    await publishDefinition({
      slug: 'main',
      definition: validMap(),
      createdBy: 'agent:onboarding',
      actorUserId: null, // auto-approved publish → system actor flows to the embed
    });
    expect(notifyMapPublished).toHaveBeenCalledWith('main', null);
  });

  it('notifies the publish hook after rollback', async () => {
    await createGraph({ slug: 'main', name: 'Main', definition: validMap(), userId: USER }); // v1
    await publishDefinition({
      slug: 'main',
      definition: validMap(),
      createdBy: USER,
      actorUserId: USER,
    }); // v2
    vi.mocked(notifyMapPublished).mockClear();
    await rollback({ slug: 'main', targetVersion: 1, userId: USER });
    expect(notifyMapPublished).toHaveBeenCalledWith('main', USER);
  });
});
