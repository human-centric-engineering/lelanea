/**
 * Module knowledge-scope read queries (f-module-bindings t-4) — the read side of the
 * module knowledge pivots, split from the writer (`./service`).
 *
 * `documentId` / `tagId` have no Prisma relation (X6 keeps reverse fields off the core
 * models), so `include` isn't available — the document/tag display fields are STITCHED
 * with one batched follow-up query per kind (no per-row fetch, no N+1), the same shape
 * as the t-1 / t-3 binding queries.
 */

import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';

export interface ModuleKnowledgeDocumentView {
  documentId: string;
  createdAt: Date;
  /** Display fields, or `null` if the document was removed (grant already FK-cascaded). */
  document: { id: string; name: string; slug: string; status: string } | null;
}

export interface ModuleKnowledgeTagView {
  tagId: string;
  createdAt: Date;
  tag: { id: string; name: string; slug: string } | null;
}

export interface ModuleKnowledgeScope {
  documents: ModuleKnowledgeDocumentView[];
  tags: ModuleKnowledgeTagView[];
}

/**
 * The module's knowledge scope: its granted documents and tags, each stitched with
 * display fields, newest first. Unknown module ⇒ 404 (not an empty scope).
 */
export async function listModuleKnowledge(moduleSlug: string): Promise<ModuleKnowledgeScope> {
  const moduleRow = await prisma.module.findFirst({
    where: { slug: moduleSlug },
    select: { id: true },
  });
  if (!moduleRow) throw new NotFoundError(`Module "${moduleSlug}" not found`);

  const [docGrants, tagGrants] = await Promise.all([
    prisma.moduleKnowledgeDocument.findMany({
      where: { moduleId: moduleRow.id },
      orderBy: [{ createdAt: 'desc' }],
      select: { documentId: true, createdAt: true },
    }),
    prisma.moduleKnowledgeTag.findMany({
      where: { moduleId: moduleRow.id },
      orderBy: [{ createdAt: 'desc' }],
      select: { tagId: true, createdAt: true },
    }),
  ]);

  const documentIds = [...new Set(docGrants.map((g) => g.documentId))];
  const tagIds = [...new Set(tagGrants.map((g) => g.tagId))];

  const [documents, tags] = await Promise.all([
    documentIds.length === 0
      ? []
      : prisma.aiKnowledgeDocument.findMany({
          where: { id: { in: documentIds } },
          select: { id: true, name: true, slug: true, status: true },
        }),
    tagIds.length === 0
      ? []
      : prisma.knowledgeTag.findMany({
          where: { id: { in: tagIds } },
          select: { id: true, name: true, slug: true },
        }),
  ]);
  const docById = new Map(documents.map((d) => [d.id, d]));
  const tagById = new Map(tags.map((t) => [t.id, t]));

  return {
    documents: docGrants.map((g) => ({
      documentId: g.documentId,
      createdAt: g.createdAt,
      document: docById.get(g.documentId) ?? null,
    })),
    tags: tagGrants.map((g) => ({
      tagId: g.tagId,
      createdAt: g.createdAt,
      tag: tagById.get(g.tagId) ?? null,
    })),
  };
}
