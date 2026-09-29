/**
 * Module knowledge-scope service (f-module-bindings t-4).
 *
 * Grant/revoke of documents and tags against a stateful in-memory Prisma fake, plus
 * the two behaviours the feature hinges on: a real P2002 duplicate maps to a
 * ValidationError, and every mutation invalidates the resolver cache for the module's
 * currently-bound agents (so their next search reflects the change).
 *
 * @see lib/framework/modules/knowledge/service.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { prismaFake, store, resetStore } = vi.hoisted(() => {
  const store = {
    modules: new Map<string, any>(),
    documents: new Set<string>(),
    tags: new Set<string>(),
    moduleDocs: [] as Array<{ moduleId: string; documentId: string }>,
    moduleTags: [] as Array<{ moduleId: string; tagId: string }>,
    bindings: [] as Array<{ moduleId: string; agentId: string }>,
  };

  const prismaFake: any = {
    module: {
      findFirst: async ({ where }: any) => {
        for (const m of store.modules.values()) if (m.slug === where.slug) return { ...m };
        return null;
      },
    },
    aiKnowledgeDocument: {
      findUnique: async ({ where }: any) =>
        store.documents.has(where.id) ? { id: where.id } : null,
    },
    knowledgeTag: {
      findUnique: async ({ where }: any) => (store.tags.has(where.id) ? { id: where.id } : null),
    },
    moduleKnowledgeDocument: {
      create: async ({ data }: any) => {
        if (
          store.moduleDocs.some(
            (d) => d.moduleId === data.moduleId && d.documentId === data.documentId
          )
        ) {
          throw new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: 'framework_module_knowledge_document_moduleId_documentId_key' },
          });
        }
        store.moduleDocs.push({ moduleId: data.moduleId, documentId: data.documentId });
        return { id: 'x', ...data };
      },
      deleteMany: async ({ where }: any) => {
        const before = store.moduleDocs.length;
        store.moduleDocs = store.moduleDocs.filter(
          (d) => !(d.moduleId === where.moduleId && d.documentId === where.documentId)
        );
        return { count: before - store.moduleDocs.length };
      },
    },
    moduleKnowledgeTag: {
      create: async ({ data }: any) => {
        if (store.moduleTags.some((t) => t.moduleId === data.moduleId && t.tagId === data.tagId)) {
          throw new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: 'framework_module_knowledge_tag_moduleId_tagId_key' },
          });
        }
        store.moduleTags.push({ moduleId: data.moduleId, tagId: data.tagId });
        return { id: 'x', ...data };
      },
      deleteMany: async ({ where }: any) => {
        const before = store.moduleTags.length;
        store.moduleTags = store.moduleTags.filter(
          (t) => !(t.moduleId === where.moduleId && t.tagId === where.tagId)
        );
        return { count: before - store.moduleTags.length };
      },
    },
    moduleAgentBinding: {
      findMany: async ({ where }: any) =>
        store.bindings.filter((b) => b.moduleId === where.moduleId).map((b) => ({ ...b })),
    },
  };

  return {
    prismaFake,
    store,
    resetStore: () => {
      store.modules.clear();
      store.documents.clear();
      store.tags.clear();
      store.moduleDocs = [];
      store.moduleTags = [];
      store.bindings = [];
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAgentAccess: vi.fn(),
}));

import {
  grantModuleDocument,
  revokeModuleDocument,
  grantModuleTag,
  revokeModuleTag,
} from '@/lib/framework/modules/knowledge/service';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { invalidateAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { NotFoundError, ValidationError } from '@/lib/api/errors';

const USER = 'admin-1';

function seedModule(slug: string): void {
  store.modules.set(`m-${slug}`, { id: `m-${slug}`, slug });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('grantModuleDocument', () => {
  it('grants a document, audits, and invalidates the module’s bound agents', async () => {
    seedModule('reading');
    store.documents.add('doc-1');
    store.bindings.push(
      { moduleId: 'm-reading', agentId: 'a1' },
      { moduleId: 'm-reading', agentId: 'a2' }
    );

    await grantModuleDocument({ moduleSlug: 'reading', documentId: 'doc-1', userId: USER });

    expect(store.moduleDocs).toEqual([{ moduleId: 'm-reading', documentId: 'doc-1' }]);
    expect(invalidateAgentAccess).toHaveBeenCalledWith('a1');
    expect(invalidateAgentAccess).toHaveBeenCalledWith('a2');
    expect(invalidateAgentAccess).toHaveBeenCalledTimes(2);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_knowledge_grant.grant_document' })
    );
  });

  it('404s an unknown module (no write, no invalidation)', async () => {
    store.documents.add('doc-1');
    await expect(
      grantModuleDocument({ moduleSlug: 'ghost', documentId: 'doc-1', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(store.moduleDocs).toHaveLength(0);
    expect(invalidateAgentAccess).not.toHaveBeenCalled();
  });

  it('rejects an unknown document with a ValidationError', async () => {
    seedModule('reading');
    await expect(
      grantModuleDocument({ moduleSlug: 'reading', documentId: 'nope', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.moduleDocs).toHaveLength(0);
  });

  it('maps a duplicate grant to a ValidationError (not a raw P2002)', async () => {
    seedModule('reading');
    store.documents.add('doc-1');
    await grantModuleDocument({ moduleSlug: 'reading', documentId: 'doc-1', userId: USER });
    await expect(
      grantModuleDocument({ moduleSlug: 'reading', documentId: 'doc-1', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.moduleDocs).toHaveLength(1);
  });
});

describe('revokeModuleDocument', () => {
  it('revokes a granted document, audits, and invalidates bound agents', async () => {
    seedModule('reading');
    store.documents.add('doc-1');
    store.bindings.push({ moduleId: 'm-reading', agentId: 'a1' });
    await grantModuleDocument({ moduleSlug: 'reading', documentId: 'doc-1', userId: USER });
    vi.clearAllMocks();

    await revokeModuleDocument({ moduleSlug: 'reading', documentId: 'doc-1', userId: USER });

    expect(store.moduleDocs).toHaveLength(0);
    expect(invalidateAgentAccess).toHaveBeenCalledWith('a1');
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_knowledge_grant.revoke_document' })
    );
  });

  it('404s when the document is not in the module’s scope', async () => {
    seedModule('reading');
    await expect(
      revokeModuleDocument({ moduleSlug: 'reading', documentId: 'doc-1', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(invalidateAgentAccess).not.toHaveBeenCalled();
  });
});

describe('grantModuleTag / revokeModuleTag', () => {
  it('grants and revokes a tag with invalidation and audit', async () => {
    seedModule('reading');
    store.tags.add('tag-1');
    store.bindings.push({ moduleId: 'm-reading', agentId: 'a1' });

    await grantModuleTag({ moduleSlug: 'reading', tagId: 'tag-1', userId: USER });
    expect(store.moduleTags).toEqual([{ moduleId: 'm-reading', tagId: 'tag-1' }]);
    expect(invalidateAgentAccess).toHaveBeenCalledWith('a1');

    await revokeModuleTag({ moduleSlug: 'reading', tagId: 'tag-1', userId: USER });
    expect(store.moduleTags).toHaveLength(0);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_knowledge_grant.revoke_tag' })
    );
  });

  it('rejects an unknown tag with a ValidationError', async () => {
    seedModule('reading');
    await expect(
      grantModuleTag({ moduleSlug: 'reading', tagId: 'nope', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps a duplicate tag grant to a ValidationError', async () => {
    seedModule('reading');
    store.tags.add('tag-1');
    await grantModuleTag({ moduleSlug: 'reading', tagId: 'tag-1', userId: USER });
    await expect(
      grantModuleTag({ moduleSlug: 'reading', tagId: 'tag-1', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.moduleTags).toHaveLength(1);
  });

  it('404s revoking a tag not in the scope', async () => {
    seedModule('reading');
    await expect(
      revokeModuleTag({ moduleSlug: 'reading', tagId: 'tag-1', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
