/**
 * Module knowledge-scope read query (f-module-bindings t-4).
 *
 * `listModuleKnowledge` stitches each granted document/tag with display fields via one
 * batched follow-up per kind (no @relation → no include, no N+1), 404s an unknown
 * module, and resolves a removed document/tag to `null`.
 *
 * @see lib/framework/modules/knowledge/queries.ts
 */

import { it, expect, beforeEach, vi } from 'vitest';

const { prismaFake, store, resetStore } = vi.hoisted(() => {
  const store = {
    modules: new Map<string, any>(),
    moduleDocs: [] as any[],
    moduleTags: [] as any[],
    documents: new Map<string, any>(),
    tags: new Map<string, any>(),
  };
  const prismaFake: any = {
    module: {
      findFirst: async ({ where }: any) => {
        for (const m of store.modules.values()) if (m.slug === where.slug) return { ...m };
        return null;
      },
    },
    moduleKnowledgeDocument: {
      findMany: async ({ where }: any) =>
        store.moduleDocs.filter((d) => d.moduleId === where.moduleId).map((d) => ({ ...d })),
    },
    moduleKnowledgeTag: {
      findMany: async ({ where }: any) =>
        store.moduleTags.filter((t) => t.moduleId === where.moduleId).map((t) => ({ ...t })),
    },
    aiKnowledgeDocument: {
      findMany: async ({ where }: any) =>
        [...store.documents.values()]
          .filter((d) => where.id.in.includes(d.id))
          .map((d) => ({ ...d })),
    },
    knowledgeTag: {
      findMany: async ({ where }: any) =>
        [...store.tags.values()].filter((t) => where.id.in.includes(t.id)).map((t) => ({ ...t })),
    },
  };
  return {
    prismaFake,
    store,
    resetStore: () => {
      store.modules.clear();
      store.moduleDocs = [];
      store.moduleTags = [];
      store.documents.clear();
      store.tags.clear();
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));

import { listModuleKnowledge } from '@/lib/framework/modules/knowledge/queries';
import { NotFoundError } from '@/lib/api/errors';

beforeEach(() => resetStore());

function seedModule(slug: string): void {
  store.modules.set(`m-${slug}`, { id: `m-${slug}`, slug });
}

it('404s an unknown module (not an empty scope)', async () => {
  await expect(listModuleKnowledge('ghost')).rejects.toBeInstanceOf(NotFoundError);
});

it('returns empty arrays for a module with no grants', async () => {
  seedModule('reading');
  expect(await listModuleKnowledge('reading')).toEqual({ documents: [], tags: [] });
});

it('stitches document and tag display fields', async () => {
  seedModule('reading');
  store.moduleDocs.push({ moduleId: 'm-reading', documentId: 'doc-1', createdAt: new Date(0) });
  store.moduleTags.push({ moduleId: 'm-reading', tagId: 'tag-1', createdAt: new Date(0) });
  store.documents.set('doc-1', { id: 'doc-1', name: 'Doc One', slug: 'doc-one', status: 'ready' });
  store.tags.set('tag-1', { id: 'tag-1', name: 'Reading', slug: 'reading' });

  const scope = await listModuleKnowledge('reading');
  expect(scope.documents[0]).toMatchObject({
    documentId: 'doc-1',
    document: { id: 'doc-1', name: 'Doc One', slug: 'doc-one', status: 'ready' },
  });
  expect(scope.tags[0]).toMatchObject({
    tagId: 'tag-1',
    tag: { id: 'tag-1', name: 'Reading', slug: 'reading' },
  });
});

it('resolves document/tag to null when the underlying row is gone', async () => {
  seedModule('reading');
  store.moduleDocs.push({ moduleId: 'm-reading', documentId: 'doc-gone', createdAt: new Date(0) });
  store.moduleTags.push({ moduleId: 'm-reading', tagId: 'tag-gone', createdAt: new Date(0) });

  const scope = await listModuleKnowledge('reading');
  expect(scope.documents[0].document).toBeNull();
  expect(scope.tags[0].tag).toBeNull();
});

it('batches one fetch per kind (no N+1)', async () => {
  seedModule('reading');
  store.moduleDocs.push(
    { moduleId: 'm-reading', documentId: 'd1', createdAt: new Date(0) },
    { moduleId: 'm-reading', documentId: 'd2', createdAt: new Date(1) }
  );
  store.documents.set('d1', { id: 'd1', name: 'D1', slug: 'd1', status: 'ready' });
  store.documents.set('d2', { id: 'd2', name: 'D2', slug: 'd2', status: 'ready' });
  const spy = vi.spyOn(prismaFake.aiKnowledgeDocument, 'findMany');

  const scope = await listModuleKnowledge('reading');
  expect(scope.documents).toHaveLength(2);
  expect(spy).toHaveBeenCalledTimes(1);
});
