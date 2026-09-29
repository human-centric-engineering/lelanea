/**
 * Module agent-binding read queries (f-module-bindings t-1) — the read side of
 * `framework_module_agent`, split from the writer (`./service`) the way f-map split
 * `queries.ts` from its version service.
 *
 * `ModuleAgentBinding.agentId` has no Prisma relation (the X6 boundary keeps a
 * reverse field off the core `AiAgent` model), so `include: { agent }` is not
 * available — the agent's display fields are STITCHED with one batched follow-up
 * query keyed on the collected agent ids (no per-row fetch, no N+1).
 */

import type { ModuleAgentBinding } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';
import { getRegisteredModule } from '@/lib/framework/modules/registry';

/** A binding enriched with the bound agent's display fields (or `null` if gone). */
export interface ModuleAgentBindingView extends ModuleAgentBinding {
  agent: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    /**
     * Tombstone marker: non-null ⇒ the agent was soft-deleted after being bound
     * (its slug is now `-deleted-{id}`). Surfaced so a consumer can distinguish a
     * *tombstoned* agent from a merely-*deactivated* one (`isActive: false`,
     * `deletedAt: null`) without re-querying `AiAgent` — the runtime resolver
     * (f-guidance) must filter these per the `AiAgent` read-path contract.
     */
    deletedAt: Date | null;
  } | null;
}

/**
 * List a module's agent bindings, primary seat first then by role, each stitched
 * with the bound agent's display fields. A soft-deleted (tombstoned) agent still
 * resolves (with `deletedAt` set) so a stale binding is visible for cleanup rather
 * than silently dropped; a hard-deleted agent's binding is already gone via the FK
 * cascade. Unknown module ⇒ 404 (not an empty list).
 */
/** Resolve a module's id from its slug, or 404 — the existence guard the reads here share. */
async function loadModuleIdBySlug(moduleSlug: string): Promise<string> {
  const row = await prisma.module.findFirst({
    where: { slug: moduleSlug },
    select: { id: true },
  });
  if (!row) throw new NotFoundError(`Module "${moduleSlug}" not found`);
  return row.id;
}

export async function listModuleBindings(moduleSlug: string): Promise<ModuleAgentBindingView[]> {
  const moduleId = await loadModuleIdBySlug(moduleSlug);

  const bindings = await prisma.moduleAgentBinding.findMany({
    where: { moduleId },
    orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
  });
  if (bindings.length === 0) return [];

  const agentIds = [...new Set(bindings.map((b) => b.agentId))];
  const agents = await prisma.aiAgent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, slug: true, isActive: true, deletedAt: true },
  });
  const byId = new Map(agents.map((a) => [a.id, a]));

  return bindings.map((b) => ({ ...b, agent: byId.get(b.agentId) ?? null }));
}

/** The agent seats a module declares in code, plus whether its code is still registered. */
export interface ModuleAgentRoles {
  /** false ⇒ the module's code is removed, so it declares no bindable seats right now. */
  registered: boolean;
  /** The `agentRoles` the registered `ModuleDefinition` declares (the bindable seats). */
  roles: string[];
}

/**
 * The bindable agent seats of a module — read from the in-memory code registry
 * (`ModuleDefinition.agentRoles`), the same source the bind service validates a role
 * against, NOT the DB row (which carries no roles). Backs the Agents tab's role picker.
 * An unknown module slug is a 404 (consistent with the other module reads); a module whose
 * code was removed resolves to `{ registered: false, roles: [] }` (its row exists, but there
 * are no seats to bind until the code returns).
 */
export async function getModuleAgentRoles(moduleSlug: string): Promise<ModuleAgentRoles> {
  await loadModuleIdBySlug(moduleSlug); // existence guard (404); the seats come from the registry
  const def = getRegisteredModule(moduleSlug);
  return { registered: def !== undefined, roles: def?.agentRoles ?? [] };
}
