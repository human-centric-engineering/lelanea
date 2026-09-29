/**
 * Module config version service (f-module-config t-1) — the only module that writes
 * `framework_module_version` rows or mutates `framework_module.config`.
 *
 * The **point-in-time** cousin of the f-map version service
 * (`lib/framework/facilitation/map/version-service.ts`): a module's live config is the
 * `Module.config` column, and every operator save both writes that column and snapshots
 * a `ModuleVersion` capturing the config *as of* the save (the `AiAgentVersion` model —
 * A10). So the newest version always equals the live config, and "rollback" is a
 * **restore**: copy a prior snapshot back onto `Module.config` and snapshot it forward
 * as a new version (history is never rewound). There is no draft buffer / published
 * pointer — config is a fill-and-save form (f-module-config.md reconciliation 1).
 *
 * A config write is validated against the **registered** module's `configSchema` (A4),
 * read from the in-memory registry by slug — so a module whose code was removed
 * (unregistered) cannot be edited (there is no schema to validate against), though its
 * history stays readable. `createdBy` has no Prisma relation (X6 keeps a reverse field
 * off the core `User` model), so its FK lives in the migration SQL. Every write emits a
 * `logAdminAction` audit entry (spec §7).
 */

import { Prisma } from '@prisma/client';
import type { ModuleVersion } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { mapPrismaWriteError } from '@/lib/framework/shared/prisma-errors';
import { getRegisteredModule } from '@/lib/framework/modules/registry';

type Tx = Prisma.TransactionClient;

const ENTITY_TYPE = 'module_config';

/**
 * A concurrent save/restore lost the race for the next version number (two writers both
 * computed N+1 under READ COMMITTED and one hit `@@unique([moduleId, version])`). Surfaced
 * as a clean retryable `ValidationError`, not a raw P2002 500. The realistic trigger is a
 * double-submitted config form.
 */
function throwConcurrentVersionConflict(): never {
  throw new ValidationError('Module config was updated concurrently — please retry', {
    config: ['A newer config version was written while this one was in flight'],
  });
}

/**
 * The caller's `expectedBaseVersion` no longer matches the module's live version (a save landed
 * since). Refuses the write so a stale-base save (e.g. an approve of an out-of-date proposal) can't
 * clobber the newer config. Distinct message from the unique-collision retry — this is a genuine
 * conflict, re-propose rather than blindly retry.
 */
function throwStaleBaseConflict(expected: number | null, actual: number | null): never {
  throw new ValidationError(
    'Module config changed since this change was based — please re-propose',
    {
      expectedBaseVersion: [
        `Based on version ${expected ?? 'none'}, but the module is now at ${actual ?? 'none'}`,
      ],
    }
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface ResolvedModule {
  id: string;
  name: string;
}

/** Resolve a module row (id, name) from its slug, or 404. */
async function loadModule(slug: string): Promise<ResolvedModule> {
  const row = await prisma.module.findFirst({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!row) throw new NotFoundError(`Module "${slug}" not found`);
  return row;
}

/**
 * Validate a config value against the registered module's `configSchema` (A4), or throw
 * `ValidationError`. A module with no registered definition (code removed) cannot be
 * validated, so editing it is rejected — the schema is the contract. Returns the parsed
 * value (Zod applies defaults / strips unknowns), which is what gets stored so the row
 * is always the schema's canonical form.
 */
function validateAgainstSchema(slug: string, config: unknown): Prisma.InputJsonValue {
  const def = getRegisteredModule(slug);
  if (!def) {
    throw new ValidationError('Module is not registered — its config cannot be edited', {
      slug: [`Module "${slug}" has no registered definition (code removed)`],
    });
  }
  const parsed = def.configSchema.safeParse(config);
  if (!parsed.success) {
    throw new ValidationError('Module config is invalid', {
      config: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  return parsed.data as Prisma.InputJsonValue;
}

/**
 * The module's highest existing version number, or `null` if it has none. The single source of the
 * "latest version" query — reused by `nextVersionNumber` (the write path) and
 * `getLatestModuleVersionNumber` (the emergence conflict base) so the two never drift. Accepts the
 * live client or a transaction client.
 */
async function latestVersionNumber(client: Tx, moduleId: string): Promise<number | null> {
  const row = await client.moduleVersion.findFirst({
    where: { moduleId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return row?.version ?? null;
}

/**
 * Highest existing version for a module + 1 (or 1 if none). Computed inside the write tx,
 * but note that under READ COMMITTED that does NOT serialise concurrent writers — two
 * overlapping saves can both read N and both try to create N+1. That collision is caught
 * at the `@@unique([moduleId, version])` index and mapped to a retryable error by the
 * callers (`throwConcurrentVersionConflict`), not prevented here.
 */
async function nextVersionNumber(client: Tx, moduleId: string): Promise<number> {
  return ((await latestVersionNumber(client, moduleId)) ?? 0) + 1;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface SaveModuleConfigArgs {
  slug: string;
  /** The operator's config values — validated against the module's `configSchema`. */
  config: unknown;
  userId: string;
  changeSummary?: string;
  clientIp?: string | null;
  /**
   * Optional optimistic-concurrency guard: the version the caller believes is current (or `null`
   * for "no versions yet"). When provided, the save is refused inside its transaction if the
   * module has moved since — the emergence proposal path passes its captured base so an approve of
   * a stale `module_config` proposal cannot silently clobber a concurrent save (mirrors the map
   * `publishDefinition` `expectedBaseVersion` re-check). Omit for a plain last-writer-wins save.
   */
  expectedBaseVersion?: number | null;
}

export interface SaveModuleConfigResult {
  version: ModuleVersion;
}

/**
 * Validate an operator's config against the registered module's schema, write it to
 * `Module.config`, and snapshot a new `ModuleVersion` — atomically. The first save is v1
 * (there is no lazy pre-edit seed: a module's pre-edit state is the empty `{}` boot-sync
 * default — not a meaningful, human-authored config like an agent's create-time snapshot —
 * so seeding it would fabricate an author and, for a schema with required fields, produce a
 * v1 that fails its own restore re-validation). Throws `ValidationError` when the module is
 * unregistered or the config fails its schema; `NotFoundError` when the slug is unknown.
 */
export async function saveModuleConfig(
  args: SaveModuleConfigArgs
): Promise<SaveModuleConfigResult> {
  const { slug, config, userId, changeSummary, clientIp, expectedBaseVersion } = args;
  const mod = await loadModule(slug);

  // Validate before opening the transaction — a bad config writes nothing.
  const validated = validateAgainstSchema(slug, config);

  let version: ModuleVersion;
  try {
    version = await prisma.$transaction(async (tx) => {
      const latest = await latestVersionNumber(tx, mod.id);
      // Optimistic-concurrency guard (when the caller passed a base): refuse a stale-base write
      // atomically, so a concurrent save committed since the base can't be silently overwritten.
      if (expectedBaseVersion !== undefined && latest !== expectedBaseVersion) {
        throwStaleBaseConflict(expectedBaseVersion, latest);
      }
      const next = (latest ?? 0) + 1;
      const created = await tx.moduleVersion.create({
        data: {
          moduleId: mod.id,
          version: next,
          snapshot: validated,
          changeSummary: changeSummary ?? null,
          createdBy: userId,
        },
      });
      await tx.module.update({ where: { id: mod.id }, data: { config: validated } });
      return created;
    });
  } catch (err) {
    mapPrismaWriteError(err, { onUnique: () => throwConcurrentVersionConflict() });
  }

  logAdminAction({
    userId,
    action: 'module_config.save',
    entityType: ENTITY_TYPE,
    entityId: mod.id,
    entityName: mod.name,
    changes: {
      config: { from: version.version > 1 ? version.version - 1 : null, to: version.version },
    },
    metadata: { slug, ...(changeSummary ? { changeSummary } : {}) },
    clientIp: clientIp ?? null,
  });

  return { version };
}

export interface RestoreModuleVersionArgs {
  slug: string;
  /** Version NUMBER to restore (not a row id). */
  version: number;
  userId: string;
  clientIp?: string | null;
}

/**
 * Restore a prior config version by re-validating its snapshot against the module's
 * *current* schema, writing it back to `Module.config`, and snapshotting it forward as a
 * new version — history is never rewound. Re-validation guards the case where the schema
 * changed since the snapshot was taken (an old shape that no longer parses is rejected
 * rather than reinstated). Throws `NotFoundError` for an unknown slug/version,
 * `ValidationError` when the module is unregistered or the snapshot no longer validates.
 */
export async function restoreModuleVersion(
  args: RestoreModuleVersionArgs
): Promise<SaveModuleConfigResult> {
  const { slug, version, userId, clientIp } = args;
  const mod = await loadModule(slug);

  const target = await prisma.moduleVersion.findUnique({
    where: { moduleId_version: { moduleId: mod.id, version } },
  });
  if (!target) {
    throw new NotFoundError(`Module "${slug}" has no version ${version}`);
  }

  // Re-validate the historical snapshot against the schema as it stands NOW. A config
  // valid when saved may be rejected by a since-tightened schema; restoring it raw would
  // write a config the current module code can't consume, so this fails closed — but with
  // a restore-specific message (the generic "config is invalid" would confuse an operator
  // who submitted no config), preserving the field-level detail.
  let validated: Prisma.InputJsonValue;
  try {
    validated = validateAgainstSchema(slug, target.snapshot);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new ValidationError(
        `Version ${version} can no longer be restored — it does not match the module's current config schema`,
        err.details
      );
    }
    throw err;
  }

  let created: ModuleVersion;
  try {
    created = await prisma.$transaction(async (tx) => {
      const next = await nextVersionNumber(tx, mod.id);
      const row = await tx.moduleVersion.create({
        data: {
          moduleId: mod.id,
          version: next,
          snapshot: validated,
          changeSummary: `Restore to v${version}`,
          createdBy: userId,
        },
      });
      await tx.module.update({ where: { id: mod.id }, data: { config: validated } });
      return row;
    });
  } catch (err) {
    mapPrismaWriteError(err, { onUnique: () => throwConcurrentVersionConflict() });
  }

  logAdminAction({
    userId,
    action: 'module_config.restore',
    entityType: ENTITY_TYPE,
    entityId: mod.id,
    entityName: mod.name,
    changes: { config: { from: created.version - 1, to: created.version } },
    metadata: { slug, restoredFromVersion: version },
    clientIp: clientIp ?? null,
  });

  return { version: created };
}

export interface ListModuleVersionsOptions {
  limit?: number;
  cursor?: string;
}

export interface ListModuleVersionsResult {
  versions: ModuleVersion[];
  nextCursor: string | null;
}

/**
 * Paginated version list, newest first. `cursor` is the id of the last version on the
 * previous page (versions are immutable, so an id cursor is stable). The newest version
 * is always the live config (no draft/published split), so a consumer flags `versions[0]`
 * as current without a pointer.
 */
export async function listModuleVersions(
  slug: string,
  opts: ListModuleVersionsOptions = {}
): Promise<ListModuleVersionsResult> {
  const mod = await loadModule(slug);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const versions = await prisma.moduleVersion.findMany({
    where: { moduleId: mod.id },
    orderBy: { version: 'desc' },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = versions.length > limit;
  const page = hasMore ? versions.slice(0, limit) : versions;
  return {
    versions: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Validate a config value against the registered module's `configSchema` and return its canonical
 * (Zod-parsed) form — the public face of the internal `validateAgainstSchema`, reused by the
 * emergence proposal pipeline so a `module_config` structure-change proposal validates through the
 * exact same schema contract as a direct save. Throws `ValidationError` when the module is
 * unregistered (code removed) or the config fails its schema.
 */
export function validateModuleConfig(slug: string, config: unknown): Prisma.InputJsonValue {
  return validateAgainstSchema(slug, config);
}

/**
 * The module's newest config version number (its live config), or `null` if it has never been
 * configured. Used as the emergence proposal's conflict-detection base for `module_config` subjects
 * (mirrors the map path reading the published version): a proposal captures this at submit time and
 * an approve refuses if the module has moved since. Throws `NotFoundError` for an unknown slug.
 */
export async function getLatestModuleVersionNumber(slug: string): Promise<number | null> {
  const mod = await loadModule(slug);
  return latestVersionNumber(prisma, mod.id);
}

/** A single immutable version by number, for diff / detail views. */
export async function getModuleVersion(slug: string, version: number): Promise<ModuleVersion> {
  const mod = await loadModule(slug);
  const row = await prisma.moduleVersion.findUnique({
    where: { moduleId_version: { moduleId: mod.id, version } },
  });
  if (!row) throw new NotFoundError(`Module "${slug}" has no version ${version}`);
  return row;
}
