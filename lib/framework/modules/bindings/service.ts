/**
 * Module agent-binding service (f-module-bindings t-1) — the only module that
 * writes `framework_module_agent` rows.
 *
 * Binds an ordinary `AiAgent` into a module *seat* (spec §4.2, decision A6). The
 * seat (`role`) is validated against the *registered* module's declared
 * `agentRoles` — a code contract, read from the in-memory registry, not the DB row
 * (the row carries no roles; code does). At most one `isPrimary` seat per module is
 * kept. Agents are never owned: nothing here touches `AiAgent`.
 *
 * `agentId` has no Prisma relation (the X6 boundary keeps a reverse field off the
 * core `AiAgent` model), so the FK + `ON DELETE CASCADE` live in the migration SQL;
 * every write emits a `logAdminAction` audit entry (spec §7). Reads live in
 * `./queries` (they stitch the agent's display fields, which `include` can't).
 *
 * **A binding change now feeds knowledge access (t-4).** Since `resolveModuleKnowledgeForAgent`
 * derives a restricted agent's searchable documents from its module bindings and the
 * knowledge resolver caches that per-agent for 60s, `bindAgent` / `unbindAgent` must
 * evict the affected agent's cache — otherwise an unbound agent keeps the module's
 * knowledge until the TTL lapses (a fail-to-revoke window). `updateBinding` does not
 * change module membership, so it does not affect knowledge access and needs no eviction.
 */

import { Prisma } from '@prisma/client';
import type { ModuleAgentBinding } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { invalidateAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { mapPrismaWriteError } from '@/lib/framework/shared/prisma-errors';
import { getRegisteredModules } from '@/lib/framework/modules/registry';

const ENTITY_TYPE = 'module_agent_binding';

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Assert `role` is a declared seat of the *registered* module. The seat vocabulary
 * is code (`ModuleDefinition.agentRoles`), so an unregistered slug (code removed, or
 * never present) can't be validated — that's a `NotFoundError`, distinct from a real
 * module that simply doesn't declare the requested seat (a `ValidationError`).
 */
function assertModuleSeat(moduleSlug: string, role: string): void {
  const def = getRegisteredModules().find((m) => m.slug === moduleSlug);
  if (!def) {
    throw new NotFoundError(`Module "${moduleSlug}" is not registered`);
  }
  const roles = def.agentRoles ?? [];
  if (!roles.includes(role)) {
    throw new ValidationError(`Role "${role}" is not a declared seat of module "${moduleSlug}"`, {
      role: roles.length
        ? [`Must be one of: ${roles.join(', ')}`]
        : ['This module declares no agent seats'],
    });
  }
}

/** Resolve a module row id from its slug, or 404. */
async function loadModuleId(slug: string): Promise<string> {
  const row = await prisma.module.findFirst({ where: { slug }, select: { id: true } });
  if (!row) throw new NotFoundError(`Module "${slug}" not found`);
  return row.id;
}

/** Assert a bindable (active, not soft-deleted) agent exists. */
async function assertAgentExists(agentId: string): Promise<void> {
  const agent = await prisma.aiAgent.findFirst({
    where: { id: agentId, deletedAt: null },
    select: { id: true },
  });
  if (!agent) {
    throw new ValidationError('Agent not found', { agentId: [`No active agent "${agentId}"`] });
  }
}

/** Load a binding that must belong to the given module, or 404. */
async function loadBindingInModule(
  moduleId: string,
  bindingId: string
): Promise<Pick<ModuleAgentBinding, 'id' | 'agentId' | 'role'>> {
  const existing = await prisma.moduleAgentBinding.findFirst({
    where: { id: bindingId, moduleId },
    select: { id: true, agentId: true, role: true },
  });
  if (!existing) {
    throw new NotFoundError(`Binding "${bindingId}" not found for this module`);
  }
  return existing;
}

/**
 * Map a Prisma write error on `framework_module_agent` to a domain error, or
 * rethrow. Two constraint races are turned into clean 4xx instead of a raw 500:
 *   - **P2002** on the `framework_module_agent_single_primary` partial unique index
 *     (the DB backing for "≤ 1 primary seat per module") — two concurrent primary
 *     writes; the loser is rejected rather than leaving two lead seats.
 *   - **P2002** on the `(moduleId, agentId, role)` unique — the same agent bound to
 *     the same seat twice.
 *   - **P2025** — the binding was deleted between the belongs-to-module guard and
 *     the update/delete (a concurrent unbind); report it as the 404 the guard would.
 */
function rethrowBindingWriteError(
  err: unknown,
  ctx: { moduleSlug: string; agentId?: string; role?: string }
): never {
  mapPrismaWriteError(err, {
    onUnique: (target) => {
      // Two unique indexes back this table; the message depends on which was hit.
      if (target.includes('single_primary')) {
        throw new ValidationError(
          'Another agent was set as the primary seat for this module concurrently; retry',
          { isPrimary: ['Only one primary seat is allowed per module'] }
        );
      }
      throw new ValidationError('This agent is already bound to that seat', {
        role: [`"${ctx.agentId}" is already bound to module "${ctx.moduleSlug}" as "${ctx.role}"`],
      });
    },
    notFound: 'Binding was removed concurrently',
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface BindAgentArgs {
  moduleSlug: string;
  agentId: string;
  role: string;
  isPrimary?: boolean;
  config?: Record<string, unknown>;
  userId: string;
  clientIp?: string | null;
}

/**
 * Bind an agent into a module seat. Validates the seat against the module's declared
 * `agentRoles` and that the agent exists. When `isPrimary`, demotes any existing
 * primary seat first (≤ 1 per module) in the same transaction. A duplicate
 * (module, agent, role) is a `ValidationError`, not a raw Prisma constraint error.
 */
export async function bindAgent(args: BindAgentArgs): Promise<ModuleAgentBinding> {
  const { moduleSlug, agentId, role, isPrimary = false, config, userId, clientIp } = args;

  assertModuleSeat(moduleSlug, role);
  const moduleId = await loadModuleId(moduleSlug);
  await assertAgentExists(agentId);

  let binding: ModuleAgentBinding;
  try {
    binding = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.moduleAgentBinding.updateMany({
          where: { moduleId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.moduleAgentBinding.create({
        data: {
          moduleId,
          agentId,
          role,
          isPrimary,
          ...(config !== undefined ? { config: config as Prisma.InputJsonValue } : {}),
        },
      });
    });
  } catch (err) {
    rethrowBindingWriteError(err, { moduleSlug, agentId, role });
  }

  // The agent now inherits this module's knowledge scope — evict its cached access
  // set so the next search reflects it immediately (fail-closed either way).
  invalidateAgentAccess(agentId);

  logAdminAction({
    userId,
    action: 'module_agent_binding.create',
    entityType: ENTITY_TYPE,
    entityId: binding.id,
    entityName: `${moduleSlug}:${role}`,
    metadata: { moduleSlug, agentId, role, isPrimary },
    clientIp: clientIp ?? null,
  });

  return binding;
}

export interface UpdateBindingArgs {
  moduleSlug: string;
  bindingId: string;
  isPrimary?: boolean;
  /** `undefined` = leave unchanged; `null` = clear; object = set. */
  config?: Record<string, unknown> | null;
  userId: string;
  clientIp?: string | null;
}

/**
 * Update a binding's lead-seat flag and/or config. Promoting to primary demotes the
 * current primary (≤ 1 per module). The binding must belong to the named module.
 */
export async function updateBinding(args: UpdateBindingArgs): Promise<ModuleAgentBinding> {
  const { moduleSlug, bindingId, isPrimary, config, userId, clientIp } = args;

  const moduleId = await loadModuleId(moduleSlug);
  await loadBindingInModule(moduleId, bindingId);

  let binding: ModuleAgentBinding;
  try {
    binding = await prisma.$transaction(async (tx) => {
      if (isPrimary === true) {
        await tx.moduleAgentBinding.updateMany({
          where: { moduleId, isPrimary: true, id: { not: bindingId } },
          data: { isPrimary: false },
        });
      }
      return tx.moduleAgentBinding.update({
        where: { id: bindingId },
        data: {
          ...(isPrimary !== undefined ? { isPrimary } : {}),
          ...(config !== undefined
            ? { config: config === null ? Prisma.JsonNull : (config as Prisma.InputJsonValue) }
            : {}),
        },
      });
    });
  } catch (err) {
    // A concurrent primary-promote (single-primary index) or a concurrent unbind
    // (P2025) → clean 4xx instead of a raw 500.
    rethrowBindingWriteError(err, { moduleSlug });
  }

  logAdminAction({
    userId,
    action: 'module_agent_binding.update',
    entityType: ENTITY_TYPE,
    entityId: binding.id,
    entityName: `${moduleSlug}:${binding.role}`,
    metadata: { moduleSlug, bindingId, isPrimary, configChanged: config !== undefined },
    clientIp: clientIp ?? null,
  });

  return binding;
}

export interface UnbindAgentArgs {
  moduleSlug: string;
  bindingId: string;
  userId: string;
  clientIp?: string | null;
}

/** Remove a binding. The binding must belong to the named module (else 404). */
export async function unbindAgent(args: UnbindAgentArgs): Promise<void> {
  const { moduleSlug, bindingId, userId, clientIp } = args;

  const moduleId = await loadModuleId(moduleSlug);
  const existing = await loadBindingInModule(moduleId, bindingId);

  try {
    await prisma.moduleAgentBinding.delete({ where: { id: bindingId } });
  } catch (err) {
    // Concurrent unbind between the guard and the delete → 404, not a raw 500.
    rethrowBindingWriteError(err, { moduleSlug });
  }

  // The agent loses this module's knowledge scope — evict its cached access set now
  // so the revocation takes effect immediately, not after the 60s TTL.
  invalidateAgentAccess(existing.agentId);

  logAdminAction({
    userId,
    action: 'module_agent_binding.delete',
    entityType: ENTITY_TYPE,
    entityId: bindingId,
    entityName: `${moduleSlug}:${existing.role}`,
    metadata: { moduleSlug, agentId: existing.agentId, role: existing.role },
    clientIp: clientIp ?? null,
  });
}
