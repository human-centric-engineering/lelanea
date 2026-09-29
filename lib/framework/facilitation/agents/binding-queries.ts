/**
 * Facilitation agent-binding read queries (f-facilitation-agents t-1) — the read side of
 * `framework_facilitation_agent`, split from the writer (`./binding-service`) the way the
 * module bindings split their queries from the service.
 *
 * `FacilitationAgentBinding.agentId` has no Prisma relation (X6 boundary — no reverse field on
 * the core `AiAgent`), so `include: { agent }` is unavailable; the agent's display fields are
 * STITCHED with one batched follow-up query keyed on the collected agent ids (no N+1).
 */

import type { FacilitationAgentBinding } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/** A facilitation binding enriched with the bound agent's display fields (or `null` if gone). */
export interface FacilitationAgentBindingView extends FacilitationAgentBinding {
  agent: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    /** Tombstone marker: non-null ⇒ the agent was soft-deleted after being bound. Surfaced so
     *  the runtime resolver can filter it per the `AiAgent` read-path contract. */
    deletedAt: Date | null;
  } | null;
}

/**
 * List the facilitation seats and their bound agents, ordered by role, each stitched with the
 * bound agent's display fields (a tombstoned agent still resolves with `deletedAt` set so a
 * stale seat is visible for cleanup; a hard-deleted agent's binding is already gone via the FK
 * cascade). Flat — there is no parent to scope by, so this is the whole family.
 */
export async function listFacilitationBindings(): Promise<FacilitationAgentBindingView[]> {
  const bindings = await prisma.facilitationAgentBinding.findMany({ orderBy: { role: 'asc' } });
  if (bindings.length === 0) return [];

  const agentIds = [...new Set(bindings.map((b) => b.agentId))];
  const agents = await prisma.aiAgent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, slug: true, isActive: true, deletedAt: true },
  });
  const byId = new Map(agents.map((a) => [a.id, a]));

  return bindings.map((b) => ({ ...b, agent: byId.get(b.agentId) ?? null }));
}

/**
 * Resolve the single binding for one seat (`@@unique([role])` ⇒ at most one), stitched with its
 * bound agent's display fields, or `null` when nothing is bound to the role (including a role that
 * is not a declared seat — `findUnique` simply misses). The read side the facilitation surface
 * resolver keys on; same stitch as {@link listFacilitationBindings}, keyed instead of listed.
 */
export async function getFacilitationBindingByRole(
  role: string
): Promise<FacilitationAgentBindingView | null> {
  const binding = await prisma.facilitationAgentBinding.findFirst({ where: { role } });
  if (binding === null) return null;

  const agent = await prisma.aiAgent.findUnique({
    where: { id: binding.agentId },
    select: { id: true, name: true, slug: true, isActive: true, deletedAt: true },
  });
  return { ...binding, agent: agent ?? null };
}
