/**
 * Slot-definition read queries — the read side of `framework_slot_definition`.
 *
 * Separated from `sync.ts` (the boot-time write side) so admin/ops read surfaces
 * share one testable data function, mirroring `modules/queries.ts`. `SlotDefinition`
 * comes straight from the generated Prisma client — a framework model, not
 * re-exported through core `types/prisma.ts` (which stays free of framework
 * vocabulary per the X6 boundary).
 */

import type { SlotDefinition } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * List every slot definition, ordered by slug. Includes rows flagged
 * `isActive = false` (code removed but retained for audit) — the read surface shows
 * the full picture and lets the caller filter. Errors propagate to the caller's
 * standard error handling; this does not swallow failures into an empty list.
 */
export async function listSlotDefinitions(): Promise<SlotDefinition[]> {
  return prisma.slotDefinition.findMany({ orderBy: { slug: 'asc' } });
}

/**
 * One slot definition by its (unique) slug, or `null` if none is declared — the
 * targeted-vs-open decision `fill_slot` keys on (a defined slug is targeted; an
 * undefined slug is an open-mode mint). Returns inactive rows too, so the caller can
 * distinguish "retired" from "never declared".
 */
export async function getSlotDefinition(slug: string): Promise<SlotDefinition | null> {
  return prisma.slotDefinition.findFirst({ where: { slug } });
}

/** A slot's group/scope — the two axes a per-agent exposure allowlist gates on (t-4). */
export type SlotGroupScope = Pick<SlotDefinition, 'slug' | 'group' | 'scope'>;

/**
 * The `group`/`scope` of each named slug that has a definition — the batch join
 * `get_state` needs to filter a user's heads against an agent's read allowlist (t-4,
 * decision 8). Only queried when an allowlist is actually configured (the permissive
 * common path skips it). Slugs with no definition (open mints) are simply absent from the
 * result, so the caller treats them as having no group/scope. An empty input short-circuits.
 */
export async function getSlotGroupsScopes(slugs: string[]): Promise<SlotGroupScope[]> {
  if (slugs.length === 0) return [];
  return prisma.slotDefinition.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, group: true, scope: true },
  });
}
