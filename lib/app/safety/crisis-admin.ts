/**
 * The admin's side of the crisis resource: read the tables as stored, and
 * change them (f-safety t-63).
 *
 * The only writer after the seed. Every write here:
 *
 * - **returns what it changed**, so the route can put the before and after in
 *   the admin audit log — who edited and who signed off live there, not on the
 *   row;
 * - **sends the edited part back to `draft`** and bumps its version, when
 *   anything actually changed. A save that changes nothing is not an edit: it
 *   neither resets a sign-off nor moves the version;
 * - **drops the resolver's cache** in this instance, so the next crisis turn
 *   here shows the edit (`resources-store.ts`).
 *
 * **Nothing is written before the seed has run.** While the copy row is absent
 * the bundled file is served, and a lone admin-created row would make the
 * tables the source with every other region missing — so each write refuses
 * 409 instead, naming the seed.
 *
 * A sign-off names the version the admin read. If someone edited in between, it
 * is refused 409 — nobody signs off words they did not see.
 *
 * @see lib/app/safety/resources-store.ts — how the turn reads what this writes
 * @see .context/app/safety.md — "The resource"
 */

import type { AppCrisisCopy, AppCrisisRegion } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { isRecord } from '@/lib/utils';
import {
  CRISIS_COPY_SLUG,
  invalidateCrisisContentCache,
  type CrisisContentStatus,
} from '@/lib/app/safety/resources-store';
import {
  crisisServicesSchema,
  type CrisisCopyUpdate,
  type CrisisRegionCreate,
  type CrisisRegionUpdate,
  type CrisisService,
} from '@/lib/validations/app-crisis-resources';

export const NOT_SEEDED_MESSAGE =
  'The crisis resource tables have not been seeded, so the bundled file is being served. Run `npm run db:seed` before editing here.';

export interface CrisisCopyRow extends CrisisCopyUpdate {
  status: CrisisContentStatus;
  version: number;
  signedOffAt: Date | null;
  updatedAt: Date;
}

export interface CrisisRegionRow {
  region: string;
  emergencyNumber: string;
  services: CrisisService[];
  /**
   * The stored services failed validation — a hand edit. The resolver serves
   * the bundled file while any row is malformed, so the page says so; saving the
   * region repairs it.
   */
  malformed: boolean;
  status: CrisisContentStatus;
  version: number;
  signedOffAt: Date | null;
  updatedAt: Date;
}

export interface CrisisAdminView {
  /** Whether the tables are the source. `false` means the bundled file is served. */
  seeded: boolean;
  copy: CrisisCopyRow | null;
  regions: CrisisRegionRow[];
}

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

const COPY_FIELDS = [
  'hardIntro',
  'softIntro',
  'emergency',
  'keptMessage',
  'internationalName',
  'internationalContact',
  'internationalUrl',
  'internationalHours',
] as const satisfies ReadonlyArray<keyof CrisisCopyUpdate>;

function toCopyRow(row: AppCrisisCopy): CrisisCopyRow {
  return {
    hardIntro: row.hardIntro,
    softIntro: row.softIntro,
    emergency: row.emergency,
    keptMessage: row.keptMessage,
    internationalName: row.internationalName,
    internationalContact: row.internationalContact,
    internationalUrl: row.internationalUrl,
    internationalHours: row.internationalHours,
    status: row.status,
    version: row.version,
    signedOffAt: row.signedOffAt,
    updatedAt: row.updatedAt,
  };
}

function toRegionRow(row: AppCrisisRegion): CrisisRegionRow {
  const services = crisisServicesSchema.safeParse(row.services);
  return {
    region: row.region,
    emergencyNumber: row.emergencyNumber,
    services: services.success ? services.data : [],
    malformed: !services.success,
    status: row.status,
    version: row.version,
    signedOffAt: row.signedOffAt,
    updatedAt: row.updatedAt,
  };
}

async function requireSeeded(): Promise<AppCrisisCopy> {
  const copy = await prisma.appCrisisCopy.findUnique({ where: { slug: CRISIS_COPY_SLUG } });
  if (!copy) throw new ConflictError(NOT_SEEDED_MESSAGE, { reason: 'not_seeded' });
  return copy;
}

async function requireRegion(region: string): Promise<AppCrisisRegion> {
  const row = await prisma.appCrisisRegion.findUnique({ where: { region } });
  if (!row) throw new NotFoundError(`No crisis resource is listed for ${region}`);
  return row;
}

function versionMoved(what: string, current: number, read: number): ConflictError {
  return new ConflictError(
    `${what} was changed since you read it (version ${read}, now ${current}). Reload and read it again before signing off.`,
    { reason: 'version_moved', currentVersion: current }
  );
}

/** Everything as stored, for the admin page. Two reads. */
export async function getCrisisAdminView(): Promise<CrisisAdminView> {
  const [copy, regions] = await Promise.all([
    prisma.appCrisisCopy.findUnique({ where: { slug: CRISIS_COPY_SLUG } }),
    prisma.appCrisisRegion.findMany({ orderBy: { region: 'asc' } }),
  ]);
  return {
    seeded: copy !== null,
    copy: copy ? toCopyRow(copy) : null,
    regions: regions.map(toRegionRow),
  };
}

/** Replace the shared copy and directory. Back to `draft` if anything changed. */
export async function updateCrisisCopy(
  update: CrisisCopyUpdate
): Promise<{ copy: CrisisCopyRow; changes: FieldChanges }> {
  const before = await requireSeeded();

  const changes: FieldChanges = {};
  for (const field of COPY_FIELDS) {
    if (before[field] !== update[field])
      changes[field] = { from: before[field], to: update[field] };
  }
  if (Object.keys(changes).length === 0) return { copy: toCopyRow(before), changes };

  const row = await prisma.appCrisisCopy.update({
    where: { slug: CRISIS_COPY_SLUG },
    data: { ...update, status: 'draft', signedOffAt: null, version: { increment: 1 } },
  });
  invalidateCrisisContentCache();
  return { copy: toCopyRow(row), changes };
}

/** Sign the shared copy off, at the version the admin read. */
export async function signOffCrisisCopy(version: number): Promise<CrisisCopyRow> {
  const before = await requireSeeded();
  const { count } = await prisma.appCrisisCopy.updateMany({
    where: { slug: CRISIS_COPY_SLUG, version },
    data: { status: 'signed_off', signedOffAt: new Date() },
  });
  if (count === 0) throw versionMoved('The shared wording', before.version, version);

  invalidateCrisisContentCache();
  return toCopyRow(await requireSeeded());
}

/** List a new region, as a draft. 409 if it is already listed. */
export async function createCrisisRegion(data: CrisisRegionCreate): Promise<CrisisRegionRow> {
  await requireSeeded();
  try {
    const row = await prisma.appCrisisRegion.create({
      data: {
        region: data.region,
        emergencyNumber: data.emergencyNumber,
        services: data.services,
        status: 'draft',
      },
    });
    invalidateCrisisContentCache();
    return toRegionRow(row);
  } catch (err) {
    // Unique violation: listed between nobody-had-it and our insert. Checked by
    // shape, the way `lib/app/waitlist/service.ts` does (no runtime Prisma here).
    if (isRecord(err) && err.code === 'P2002') {
      throw new ConflictError(`${data.region} is already listed. Edit it instead.`, {
        reason: 'exists',
      });
    }
    throw err;
  }
}

/** Replace one region's number and services. Back to `draft` if anything changed. */
export async function updateCrisisRegion(
  region: string,
  update: CrisisRegionUpdate
): Promise<{ region: CrisisRegionRow; changes: FieldChanges }> {
  await requireSeeded();
  const before = await requireRegion(region);

  const changes: FieldChanges = {};
  if (before.emergencyNumber !== update.emergencyNumber) {
    changes.emergencyNumber = { from: before.emergencyNumber, to: update.emergencyNumber };
  }
  if (JSON.stringify(before.services) !== JSON.stringify(update.services)) {
    changes.services = { from: before.services, to: update.services };
  }
  if (Object.keys(changes).length === 0) return { region: toRegionRow(before), changes };

  const row = await prisma.appCrisisRegion.update({
    where: { region },
    data: {
      emergencyNumber: update.emergencyNumber,
      services: update.services,
      status: 'draft',
      signedOffAt: null,
      version: { increment: 1 },
    },
  });
  invalidateCrisisContentCache();
  return { region: toRegionRow(row), changes };
}

/** Sign one region off, at the version the admin read. */
export async function signOffCrisisRegion(
  region: string,
  version: number
): Promise<CrisisRegionRow> {
  await requireSeeded();
  const before = await requireRegion(region);
  if (toRegionRow(before).malformed) {
    throw new ConflictError(
      `${region}'s stored services are malformed, so they are not being shown. Save the region to repair it, then sign it off.`,
      { reason: 'malformed' }
    );
  }
  const { count } = await prisma.appCrisisRegion.updateMany({
    where: { region, version },
    data: { status: 'signed_off', signedOffAt: new Date() },
  });
  if (count === 0) throw versionMoved(`${region}`, before.version, version);

  invalidateCrisisContentCache();
  return toRegionRow(await requireRegion(region));
}

/**
 * Stop listing a region. People there then get the directory and the local
 * emergency line, as for any unlisted region. Returns what was removed, for the
 * audit log.
 */
export async function removeCrisisRegion(region: string): Promise<CrisisRegionRow> {
  await requireSeeded();
  const before = await requireRegion(region);
  // `deleteMany`, so a second admin removing it at the same moment is a 404, not a 500.
  const { count } = await prisma.appCrisisRegion.deleteMany({ where: { region } });
  if (count === 0) throw new NotFoundError(`No crisis resource is listed for ${region}`);
  invalidateCrisisContentCache();
  return toRegionRow(before);
}
