/**
 * The crisis resource as a file: export it, and import one with a preview
 * (f-content-seeds t-92).
 *
 * The page's editor (`crisis-admin.ts`) is still the way to change one region
 * or one line. This is how a set that has been read and signed off in one
 * environment moves to another without retyping it.
 *
 * ## Nothing signed off crosses
 *
 * **Every row an import creates or changes arrives as `draft`,** whatever the
 * file says about itself. Signing off is an act a person performs on THIS
 * environment's rows, having read them here: a sign-off carried in a file would
 * vouch for a helpline number nobody in this environment has looked at, and
 * the person who meets it is someone in crisis. The file's `provenance` block
 * is not read at all. A row the file leaves exactly as it is keeps its status,
 * because nothing about it changed.
 *
 * ## Keep by default
 *
 * A region stored here that the file leaves out is kept unless the import is
 * asked to remove it (the owner's ruling, 2026-09-24). Removal matters more
 * here than anywhere else in the admin: crisis regions keep no revision
 * history, so a removed region comes back only by being typed in again. The
 * audit entry keeps its words.
 *
 * Every write validates through the same schemas the turn reads with
 * (`crisisResourcesFileSchema` is built from them), so an import cannot store a
 * row a crisis turn would then refuse to serve. The cache is dropped after the
 * commit, as every admin write does.
 *
 * @see lib/app/safety/crisis-admin.ts — the page's editor, and the sign-off
 * @see lib/app/safety/resources-store.ts — what a crisis turn reads
 */

import type { AppCrisisCopy, AppCrisisRegion } from '@prisma/client';

import { ConflictError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { CRISIS_COPY_SLUG, invalidateCrisisContentCache } from '@/lib/app/safety/resources-store';
import {
  CRISIS_RESOURCES_FILE_ID,
  crisisResourcesFileSchema,
  crisisServicesSchema,
  type CrisisResourcesFile,
  type CrisisService,
} from '@/lib/validations/app-crisis-resources';
import {
  changedFieldsOf,
  planKeyedImport,
  type KeyedPlan,
} from '@/lib/app/content/admin/keyed-import';
import {
  importRefused,
  parseContentFile,
  sectionsWriteNothing,
  toPlanSection,
  type ContentImportPlan,
  type ImportPlanSection,
} from '@/lib/app/content/admin/shared';

const COPY_FIELDS = [
  'hardIntro',
  'softIntro',
  'emergency',
  'keptMessage',
  'internationalName',
  'internationalContact',
  'internationalUrl',
  'internationalHours',
] as const;

type CopyFields = Pick<AppCrisisCopy, (typeof COPY_FIELDS)[number]>;

interface RegionFields {
  emergencyNumber: string;
  /** As stored. A malformed row's services are whatever the column holds, so any file differs from them. */
  services: unknown;
}

const REGION_FIELDS = ['emergencyNumber', 'services'] as const;

function copyFieldsOf(row: CopyFields): CopyFields {
  return Object.fromEntries(COPY_FIELDS.map((field) => [field, row[field]])) as CopyFields;
}

function copyFieldsFromFile(file: CrisisResourcesFile): CopyFields {
  return {
    ...file.copy,
    internationalName: file.international.name,
    internationalContact: file.international.contact,
    internationalUrl: file.international.url,
    internationalHours: file.international.hours,
  };
}

/** A region's services compared field by field and in order, as `crisis-admin.ts` compares them. */
function regionFieldsOf(row: AppCrisisRegion): RegionFields {
  const services = crisisServicesSchema.safeParse(row.services);
  return {
    emergencyNumber: row.emergencyNumber,
    services: services.success
      ? services.data.map(({ name, contact, hours }) => ({ name, contact, hours }))
      : row.services,
  };
}

// ─── Export ─────────────────────────────────────────────────────────────────

export function crisisExportFilename(now: Date): string {
  return `lelanea-crisis-resources-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * The tables as the seed's file. The header carries only the file's identity:
 * its title, version, notes and provenance describe the drafted file, are not
 * stored, and are left out rather than invented — and a sign-off status is
 * this environment's fact, not the file's.
 */
export async function exportCrisisFile(): Promise<CrisisResourcesFile> {
  const [copy, regions] = await Promise.all([
    prisma.appCrisisCopy.findUnique({ where: { slug: CRISIS_COPY_SLUG } }),
    prisma.appCrisisRegion.findMany({ orderBy: { region: 'asc' } }),
  ]);
  if (!copy) {
    throw new ConflictError(
      'There is nothing to export: the crisis resource tables have not been seeded.',
      { reason: 'nothing_to_export' }
    );
  }
  const file = {
    resources: { id: CRISIS_RESOURCES_FILE_ID },
    copy: {
      hardIntro: copy.hardIntro,
      softIntro: copy.softIntro,
      emergency: copy.emergency,
      keptMessage: copy.keptMessage,
    },
    international: {
      name: copy.internationalName,
      contact: copy.internationalContact,
      url: copy.internationalUrl,
      hours: copy.internationalHours,
    },
    regions: regions.map((row) => ({
      region: row.region,
      emergencyNumber: row.emergencyNumber,
      services: row.services,
    })),
  };
  const parsed = crisisResourcesFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new ConflictError(
      `The stored crisis resource cannot be written as a file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
        .join('; ')}. Repair it on this page first.`,
      { reason: 'unexportable' }
    );
  }
  return parsed.data;
}

// ─── Import ─────────────────────────────────────────────────────────────────

interface StoredCrisis {
  copy: AppCrisisCopy | null;
  regions: readonly AppCrisisRegion[];
}

interface CrisisImport {
  plan: ContentImportPlan;
  copyChanged: (typeof COPY_FIELDS)[number][];
  copyAfter: CopyFields;
  regions: KeyedPlan<RegionFields>;
}

/**
 * What a crisis resources file would do. Pure. The file's provenance is not
 * read: nothing it says about a sign-off reaches a row.
 */
export function planCrisisImport(
  file: CrisisResourcesFile,
  stored: StoredCrisis,
  removeAbsent: boolean
): CrisisImport {
  const refusals: string[] = [];
  if (!stored.copy) {
    refusals.push(
      'The crisis resource tables have not been seeded, so there is nothing to import into. Run `npm run db:migrate:deploy` first.'
    );
  }

  const copyAfter = copyFieldsFromFile(file);
  const copyChanged = stored.copy
    ? changedFieldsOf(copyFieldsOf(stored.copy), copyAfter, COPY_FIELDS)
    : [];

  const regions = planKeyedImport<RegionFields, RegionFields>({
    incoming: file.regions.map((region) => ({
      key: region.region,
      value: { emergencyNumber: region.emergencyNumber, services: region.services },
    })),
    stored: stored.regions.map((row) => ({
      key: row.region,
      fields: regionFieldsOf(row),
      revision: row.version,
    })),
    diff: (before, after) => changedFieldsOf(before, after, REGION_FIELDS),
    allFields: REGION_FIELDS,
    toCreate: (value) => value,
    toUpdate: (_before, value) => value,
    onAbsent: removeAbsent ? () => null : 'keep',
  });

  const sections: ImportPlanSection[] = [
    toPlanSection('region', 'Regions', regions, 'delete', true),
  ];
  if (copyChanged.length > 0) {
    sections.unshift({
      entity: 'copy',
      label: 'Shared wording and directory',
      creates: [],
      updates: [{ key: CRISIS_COPY_SLUG, changedFields: copyChanged }],
      removals: [],
      removalKind: 'delete',
      unchanged: [],
      skippedRetired: [],
    });
  }

  return {
    plan: {
      collection: 'crisis resources',
      sections,
      refusals,
      writesNothing: sectionsWriteNothing(sections),
    },
    copyChanged,
    copyAfter,
    regions,
  };
}

async function readStored(
  client: Pick<typeof prisma, 'appCrisisCopy' | 'appCrisisRegion'>
): Promise<StoredCrisis> {
  const [copy, regions] = await Promise.all([
    client.appCrisisCopy.findUnique({ where: { slug: CRISIS_COPY_SLUG } }),
    client.appCrisisRegion.findMany({ orderBy: { region: 'asc' } }),
  ]);
  return { copy, regions };
}

function parseCrisisFile(raw: unknown): CrisisResourcesFile {
  return parseContentFile(crisisResourcesFileSchema, raw, 'crisis resources');
}

export async function previewCrisisImport(
  raw: unknown,
  removeAbsent: boolean
): Promise<ContentImportPlan> {
  return planCrisisImport(parseCrisisFile(raw), await readStored(prisma), removeAbsent).plan;
}

/**
 * Apply a crisis resources file. Re-planned in the transaction; idempotent.
 * Everything it writes is a draft. Returns the plan that ran and, for the
 * audit entry, the words of every region it removed.
 */
export async function applyCrisisImport(
  raw: unknown,
  removeAbsent: boolean
): Promise<{ plan: ContentImportPlan; removed: Record<string, RegionFields> }> {
  const file = parseCrisisFile(raw);
  const outcome = await executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planCrisisImport(file, stored, removeAbsent);
      if (planned.plan.refusals.length > 0)
        throw importRefused('crisis resources', planned.plan.refusals);
      const removed: Record<string, RegionFields> = {};
      if (planned.plan.writesNothing) return { plan: planned.plan, removed };

      if (planned.copyChanged.length > 0) {
        await tx.appCrisisCopy.update({
          where: { slug: CRISIS_COPY_SLUG },
          data: {
            ...planned.copyAfter,
            status: 'draft',
            signedOffAt: null,
            version: { increment: 1 },
          },
        });
      }
      for (const change of planned.regions.removals) {
        removed[change.key] = change.before!;
        await tx.appCrisisRegion.delete({ where: { region: change.key } });
      }
      for (const change of planned.regions.creates) {
        await tx.appCrisisRegion.create({
          data: {
            region: change.key,
            emergencyNumber: change.after!.emergencyNumber,
            services: change.after!.services as CrisisService[],
            status: 'draft',
          },
        });
      }
      for (const change of planned.regions.updates) {
        await tx.appCrisisRegion.update({
          where: { region: change.key },
          data: {
            emergencyNumber: change.after!.emergencyNumber,
            services: change.after!.services as CrisisService[],
            status: 'draft',
            signedOffAt: null,
            version: { increment: 1 },
          },
        });
      }
      return { plan: planned.plan, removed };
    },
    { timeout: 30_000 }
  );
  if (!outcome.plan.writesNothing) invalidateCrisisContentCache();
  return outcome;
}
