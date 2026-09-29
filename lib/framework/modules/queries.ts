/**
 * Module read queries — the read side of the `framework_module` table.
 *
 * Separated from `sync.ts` (the boot-time write side) so admin/ops read surfaces
 * have a single, testable data function to call, mirroring how Sunrise's admin
 * routes delegate reads to a lib function (e.g. `getAllFlags`). The `Module` type
 * comes straight from the generated Prisma client — a framework model, imported
 * here rather than re-exported through core `types/prisma.ts` (which stays free of
 * framework vocabulary per the X6 boundary).
 */

import type { Module } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';

/**
 * List every framework module row, ordered by slug. Includes rows flagged
 * `isRegistered = false` (code removed but retained for audit) — the read surface
 * shows the full picture and lets the caller filter. Errors propagate to the
 * caller's standard error handling (the admin guard formats them); this does not
 * swallow failures into an empty list.
 */
export async function listModules(): Promise<Module[]> {
  return prisma.module.findMany({ orderBy: { slug: 'asc' } });
}

/**
 * Whether a `framework_module` row exists for `slug`. A minimal `id`-only existence
 * probe — the cheap guard a write path uses to reject an unknown slug (e.g. the feedback
 * endpoint, so an arbitrary slug can't inject junk into the engagement stream) without
 * over-fetching the settings columns `getModuleSettings` returns.
 */
export async function moduleExists(slug: string): Promise<boolean> {
  const row = await prisma.module.findFirst({ where: { slug }, select: { id: true } });
  return row !== null;
}

/**
 * The operator-editable settings of one module — the read backing `GET /modules/[slug]`
 * and the shared load step for the write service (`updateModuleSettings` / `deleteModule`
 * both start here). Selects only the settings-relevant columns (the potentially-large
 * `config` blob is read via the `/config` endpoint, not here), keyed off `slug`. Throws
 * `NotFoundError` — a missing module is a 404, not a swallowed empty. The `id` and `name`
 * are included so a write caller can address the row and name it in the audit log without
 * a second read.
 */
export interface ModuleSettings {
  id: string;
  slug: string;
  name: string;
  status: string;
  audience: string;
  featureFlagName: string | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
  isRegistered: boolean;
  updatedAt: Date;
}

/** The column set backing {@link ModuleSettings} — shared by the read and the write path. */
export const MODULE_SETTINGS_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  audience: true,
  featureFlagName: true,
  availableFrom: true,
  availableUntil: true,
  isRegistered: true,
  updatedAt: true,
} as const;

export async function getModuleSettings(slug: string): Promise<ModuleSettings> {
  const row = await prisma.module.findFirst({
    where: { slug },
    select: MODULE_SETTINGS_SELECT,
  });
  if (!row) throw new NotFoundError(`Module "${slug}" not found`);
  return row;
}
