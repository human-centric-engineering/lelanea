/**
 * Module knowledge-scope service (f-module-bindings t-4) — the only module that writes
 * `framework_module_knowledge_document` / `framework_module_knowledge_tag` rows.
 *
 * A module owns a durable knowledge scope (spec §4.2): a set of documents and tags its
 * bound agents may search. Enforcement is NOT here and NOT materialised — the core
 * `resolveAgentDocumentAccess` resolver unions the module contributor's live output
 * into a restricted agent's set. This service only records the scope and, after every
 * change, invalidates the resolver cache for the module's currently-bound agents so the
 * next search reflects it.
 *
 * `documentId` / `tagId` have no Prisma relation (X6 keeps reverse fields off the core
 * `AiKnowledgeDocument` / `KnowledgeTag` models), so their FKs live in the migration
 * SQL. Every write emits a `logAdminAction` audit entry (spec §7).
 */

import { prisma } from '@/lib/db/client';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { invalidateAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { mapPrismaWriteError } from '@/lib/framework/shared/prisma-errors';

const ENTITY_TYPE = 'module_knowledge_grant';

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Resolve a module row id from its slug, or 404. */
async function loadModuleId(slug: string): Promise<string> {
  const row = await prisma.module.findFirst({ where: { slug }, select: { id: true } });
  if (!row) throw new NotFoundError(`Module "${slug}" not found`);
  return row.id;
}

/** Assert a knowledge document exists, or `ValidationError`. */
async function assertDocumentExists(documentId: string): Promise<void> {
  const doc = await prisma.aiKnowledgeDocument.findUnique({
    where: { id: documentId },
    select: { id: true },
  });
  if (!doc) {
    throw new ValidationError('Document not found', {
      documentId: [`No document "${documentId}"`],
    });
  }
}

/** Assert a knowledge tag exists, or `ValidationError`. */
async function assertTagExists(tagId: string): Promise<void> {
  const tag = await prisma.knowledgeTag.findUnique({ where: { id: tagId }, select: { id: true } });
  if (!tag) {
    throw new ValidationError('Tag not found', { tagId: [`No tag "${tagId}"`] });
  }
}

/**
 * Evict the resolver's cached access decision for every agent currently bound to the
 * module — the scope just changed, so their next search must recompute. New/unbound
 * agents need no eviction (the contributor is live: they pick up or drop the scope on
 * their own next resolve).
 */
async function invalidateModuleAgents(moduleId: string): Promise<void> {
  const bindings = await prisma.moduleAgentBinding.findMany({
    where: { moduleId },
    select: { agentId: true },
  });
  for (const agentId of new Set(bindings.map((b) => b.agentId))) {
    invalidateAgentAccess(agentId);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface GrantModuleDocumentArgs {
  moduleSlug: string;
  documentId: string;
  userId: string;
  clientIp?: string | null;
}

/** Add a document to the module's knowledge scope. Duplicate ⇒ `ValidationError`. */
export async function grantModuleDocument(args: GrantModuleDocumentArgs): Promise<void> {
  const { moduleSlug, documentId, userId, clientIp } = args;
  const moduleId = await loadModuleId(moduleSlug);
  await assertDocumentExists(documentId);

  try {
    await prisma.moduleKnowledgeDocument.create({ data: { moduleId, documentId } });
  } catch (err) {
    mapPrismaWriteError(err, {
      onUnique: () => {
        throw new ValidationError('This document is already in the module knowledge scope', {
          documentId: [`"${documentId}" is already granted to module "${moduleSlug}"`],
        });
      },
    });
  }

  await invalidateModuleAgents(moduleId);
  logAdminAction({
    userId,
    action: 'module_knowledge_grant.grant_document',
    entityType: ENTITY_TYPE,
    entityId: `${moduleId}:doc:${documentId}`,
    entityName: `${moduleSlug}:document`,
    metadata: { moduleSlug, documentId },
    clientIp: clientIp ?? null,
  });
}

export interface RevokeModuleDocumentArgs {
  moduleSlug: string;
  documentId: string;
  userId: string;
  clientIp?: string | null;
}

/** Remove a document from the module's knowledge scope. Not granted ⇒ 404. */
export async function revokeModuleDocument(args: RevokeModuleDocumentArgs): Promise<void> {
  const { moduleSlug, documentId, userId, clientIp } = args;
  const moduleId = await loadModuleId(moduleSlug);

  const { count } = await prisma.moduleKnowledgeDocument.deleteMany({
    where: { moduleId, documentId },
  });
  if (count === 0) {
    throw new NotFoundError(`Document "${documentId}" is not in module "${moduleSlug}"`);
  }

  await invalidateModuleAgents(moduleId);
  logAdminAction({
    userId,
    action: 'module_knowledge_grant.revoke_document',
    entityType: ENTITY_TYPE,
    entityId: `${moduleId}:doc:${documentId}`,
    entityName: `${moduleSlug}:document`,
    metadata: { moduleSlug, documentId },
    clientIp: clientIp ?? null,
  });
}

export interface GrantModuleTagArgs {
  moduleSlug: string;
  tagId: string;
  userId: string;
  clientIp?: string | null;
}

/** Add a tag to the module's knowledge scope. Duplicate ⇒ `ValidationError`. */
export async function grantModuleTag(args: GrantModuleTagArgs): Promise<void> {
  const { moduleSlug, tagId, userId, clientIp } = args;
  const moduleId = await loadModuleId(moduleSlug);
  await assertTagExists(tagId);

  try {
    await prisma.moduleKnowledgeTag.create({ data: { moduleId, tagId } });
  } catch (err) {
    mapPrismaWriteError(err, {
      onUnique: () => {
        throw new ValidationError('This tag is already in the module knowledge scope', {
          tagId: [`"${tagId}" is already granted to module "${moduleSlug}"`],
        });
      },
    });
  }

  await invalidateModuleAgents(moduleId);
  logAdminAction({
    userId,
    action: 'module_knowledge_grant.grant_tag',
    entityType: ENTITY_TYPE,
    entityId: `${moduleId}:tag:${tagId}`,
    entityName: `${moduleSlug}:tag`,
    metadata: { moduleSlug, tagId },
    clientIp: clientIp ?? null,
  });
}

export interface RevokeModuleTagArgs {
  moduleSlug: string;
  tagId: string;
  userId: string;
  clientIp?: string | null;
}

/** Remove a tag from the module's knowledge scope. Not granted ⇒ 404. */
export async function revokeModuleTag(args: RevokeModuleTagArgs): Promise<void> {
  const { moduleSlug, tagId, userId, clientIp } = args;
  const moduleId = await loadModuleId(moduleSlug);

  const { count } = await prisma.moduleKnowledgeTag.deleteMany({ where: { moduleId, tagId } });
  if (count === 0) {
    throw new NotFoundError(`Tag "${tagId}" is not in module "${moduleSlug}"`);
  }

  await invalidateModuleAgents(moduleId);
  logAdminAction({
    userId,
    action: 'module_knowledge_grant.revoke_tag',
    entityType: ENTITY_TYPE,
    entityId: `${moduleId}:tag:${tagId}`,
    entityName: `${moduleSlug}:tag`,
    metadata: { moduleSlug, tagId },
    clientIp: clientIp ?? null,
  });
}
