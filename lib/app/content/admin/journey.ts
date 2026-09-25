/**
 * The journey's text, edited in the admin (f-content-seeds t-91): the journey's
 * title, each tier's label and intent, and each module's title, subtitle and
 * phases.
 *
 * **Text only, never structure.** Which modules exist, their numbers and their
 * tiers are the code roster's (`lib/app/journey/roster.ts`, t-87), so nothing
 * here creates or deletes a tier or a module, and an import whose structure
 * differs from the roster is refused. What "removing" means for this collection
 * is clearing a module's optional text (its subtitle or chart title), which the
 * editor offers. A tier's label and intent are required, because the drawer
 * shows both and the file format needs both.
 *
 * ## An edit reaches the AI as well as the pages
 *
 * The pages, the drawer and the public API read the rows per request, and the
 * API's ETag covers each record's `revision`. The one copy that is NOT read per
 * request is the registered `ModuleDefinition`: startup names each from its row
 * (`lib/app/leaf-bootstrap.ts`), and the AI's module context and the map-node
 * embeddings read that. So every write here re-registers the definitions from
 * the rows it just wrote (`refreshModuleDefinitions`).
 *
 * That reaches the process that handled the save. Another server instance keeps
 * its registered names until it next starts, which on the current deployment
 * (one long-lived web container) is the same process. **Revisit if** the app
 * runs on more than one instance: the registry would then want re-reading per
 * turn rather than at boot.
 *
 * **`framework_module.name` is not written.** It is Daybreak's operator label,
 * copied from the definition once when the framework creates the row, and
 * nothing of hers reads it (t-87's ruling). The editor says the title is hers
 * and that label is Daybreak's, rather than keeping two copies in step.
 *
 * @see lib/app/content/journey-store.ts — the reads every surface makes
 */

import type {
  AppJourneyModule,
  AppJourneyModuleRevision,
  AppJourneyTier,
  AppJourneyTierRevision,
} from '@prisma/client';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { logger } from '@/lib/logging';
import { DB_NULL } from '@/lib/app-db/json-null';
import { registerModule } from '@/lib/framework/modules/registry';
import { journeyStructureFileSchema, type JourneyStructureFile } from '@/lib/app/content/schemas';
import {
  getJourneyStructure,
  MODULE_SNAPSHOT_FIELDS,
  TIER_SNAPSHOT_FIELDS,
} from '@/lib/app/content/journey-store';
import {
  parseModuleJson,
  type JourneyModuleRow,
  type JourneyStructure,
  type JourneyTierRow,
} from '@/lib/app/content/journey-view';
import { journeyFileFromStructure, journeySeedFromFile } from '@/lib/app/content/content-files';
import { getModuleDefinitions } from '@/lib/app/modules/definitions';
import { JOURNEY_MODULES, JOURNEY_TIERS } from '@/lib/app/journey/roster';
import {
  changedFieldsOf,
  planKeyedImport,
  type KeyedPlan,
} from '@/lib/app/content/admin/keyed-import';
import {
  type ContentImportPlan,
  IMPORT_TX_TIMEOUT_MS,
  importRefused,
  parseContentFile,
  type RevisionEntry,
  revisionMoved,
  revisionMovedNow,
  sectionsWriteNothing,
  staleRow,
  toChanges,
  toHistory,
  toPlanSection,
} from '@/lib/app/content/admin/shared';
import type { FieldChanges } from '@/lib/app/content/admin/documents';
import type { JourneyEdit, ModuleEdit, TierEdit } from '@/lib/app/content/admin/validation';

export type TierFields = Omit<JourneyTierRow, 'id' | 'revision'>;
export type ModuleFields = ReturnType<typeof moduleFieldsOf>;
type ModuleField = (typeof MODULE_SNAPSHOT_FIELDS)[number];

export interface JourneyAdminView {
  seeded: boolean;
  /** The journey as every surface reads it, or null before the seed. */
  structure: JourneyStructure | null;
  /** The journey row's lock. */
  updatedAt: string | null;
}

export interface JourneyWriteResult {
  changed: string[];
  changes: FieldChanges;
  revision: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tierFieldsOf(row: Pick<AppJourneyTier, 'label' | 'intent'>): TierFields {
  return { label: row.label, intent: row.intent };
}

/** A module row's text, with its JSON validated. */
function moduleFieldsOf(row: Omit<JourneyModuleRow, 'revision'>) {
  const { phases, phaseTiers, produces } = parseModuleJson(row);
  return {
    displayNumber: row.displayNumber,
    title: row.title,
    subtitle: row.subtitle,
    chartTitle: row.chartTitle,
    phases,
    phaseTiers,
    produces,
  };
}

/**
 * Re-register every module definition from the rows, so the AI's module
 * context names what the drawer names. Best-effort, like startup's own pass: a
 * failed read keeps the names already registered and says so.
 */
export async function refreshModuleDefinitions(): Promise<void> {
  try {
    const structure = await getJourneyStructure();
    for (const definition of getModuleDefinitions(structure)) registerModule(definition);
  } catch (error) {
    logger.warn('Journey edit saved, but the module definitions were not re-registered', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getJourneyAdminView(): Promise<JourneyAdminView> {
  const journey = await prisma.appJourney.findFirst({
    select: { updatedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!journey) return { seeded: false, structure: null, updatedAt: null };
  return {
    seeded: true,
    structure: await getJourneyStructure(),
    updatedAt: journey.updatedAt.toISOString(),
  };
}

export async function listTierHistory(id: string): Promise<RevisionEntry<TierFields>[]> {
  const [tier, revisions] = await Promise.all([
    prisma.appJourneyTier.findUnique({ where: { id }, select: { id: true } }),
    prisma.appJourneyTierRevision.findMany({
      where: { tierId: id },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!tier) throw new NotFoundError(`There is no journey tier "${id}".`);
  return toHistory(revisions, (row: AppJourneyTierRevision) => tierFieldsOf(row));
}

export async function listModuleHistory(id: string): Promise<RevisionEntry<ModuleFields>[]> {
  const [module, revisions] = await Promise.all([
    prisma.appJourneyModule.findUnique({ where: { id }, select: { id: true } }),
    prisma.appJourneyModuleRevision.findMany({
      where: { moduleId: id },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!module) throw new NotFoundError(`There is no journey module "${id}".`);
  return toHistory(revisions, (row: AppJourneyModuleRevision) =>
    moduleFieldsOf({ ...row, id: row.moduleId })
  );
}

// ─── Writes ─────────────────────────────────────────────────────────────────

async function writeTier(
  id: string,
  toNext: (before: TierFields) => TierFields,
  revisionRead: number,
  editorId: string
): Promise<JourneyWriteResult> {
  const result = await executeTransaction(async (tx) => {
    const row = await tx.appJourneyTier.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`There is no journey tier "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`The tier "${row.label}"`, row.revision, revisionRead);

    const before = tierFieldsOf(row);
    const next = toNext(before);
    const changed = changedFieldsOf(before, next, TIER_SNAPSHOT_FIELDS);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };

    const revision = row.revision + 1;
    const { count } = await tx.appJourneyTier.updateMany({
      where: { id, revision: revisionRead },
      data: { ...next, revision },
    });
    if (count === 0)
      throw await revisionMovedNow(
        `The tier "${row.label}"`,
        revisionRead,
        tx.appJourneyTier.findUnique({ where: { id }, select: { revision: true } })
      );
    await tx.appJourneyTierRevision.create({
      data: { tierId: id, revision, ...next, changedFields: changed, origin: 'admin', editorId },
    });
    return { changed, changes: toChanges(before, next, changed), revision };
  });
  if (result.changed.length > 0) await refreshModuleDefinitions();
  return result;
}

async function writeModule(
  id: string,
  toNext: (before: ModuleFields) => ModuleFields,
  revisionRead: number,
  editorId: string
): Promise<JourneyWriteResult> {
  const result = await executeTransaction(async (tx) => {
    const row = await tx.appJourneyModule.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`There is no journey module "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`"${row.title}"`, row.revision, revisionRead);

    const before = moduleFieldsOf(row);
    const next = toNext(before);
    // The same check the read path makes, so nothing is saved that every
    // surface would then refuse to render (a phase tier naming a phase the
    // module does not have).
    moduleFieldsOf({ id, ...next });
    const changed: ModuleField[] = changedFieldsOf(before, next, MODULE_SNAPSHOT_FIELDS);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };

    const revision = row.revision + 1;
    const data = toModuleData(next);
    const { count } = await tx.appJourneyModule.updateMany({
      where: { id, revision: revisionRead },
      data: { ...data, revision },
    });
    if (count === 0)
      throw await revisionMovedNow(
        `"${row.title}"`,
        revisionRead,
        tx.appJourneyModule.findUnique({ where: { id }, select: { revision: true } })
      );
    await tx.appJourneyModuleRevision.create({
      data: { moduleId: id, revision, ...data, changedFields: changed, origin: 'admin', editorId },
    });
    return { changed, changes: toChanges(before, next, changed), revision };
  });
  if (result.changed.length > 0) await refreshModuleDefinitions();
  return result;
}

/**
 * A module's fields as Prisma writes them. A JSON column cannot hold a bare
 * `null` through the client (it means "no value" there), so a cleared
 * `phaseTiers` or `produces` is written as the database null the seed writes.
 */
function toModuleData(fields: ModuleFields) {
  return {
    displayNumber: fields.displayNumber,
    title: fields.title,
    subtitle: fields.subtitle,
    chartTitle: fields.chartTitle,
    phases: fields.phases,
    phaseTiers: fields.phaseTiers ?? DB_NULL,
    produces: fields.produces ?? DB_NULL,
  };
}

export function updateTier(
  id: string,
  edit: TierEdit,
  revisionRead: number,
  editorId: string
): Promise<JourneyWriteResult> {
  return writeTier(id, () => ({ ...edit }), revisionRead, editorId);
}

export function updateModule(
  id: string,
  edit: ModuleEdit,
  revisionRead: number,
  editorId: string
): Promise<JourneyWriteResult> {
  return writeModule(id, () => ({ ...edit }), revisionRead, editorId);
}

export async function restoreTierRevision(
  id: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<JourneyWriteResult> {
  const past = await prisma.appJourneyTierRevision.findUnique({
    where: { tierId_revision: { tierId: id, revision } },
  });
  if (!past) throw new NotFoundError(`The tier "${id}" has no revision ${revision}.`);
  return writeTier(id, () => tierFieldsOf(past), revisionRead, editorId);
}

export async function restoreModuleRevision(
  id: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<JourneyWriteResult> {
  const past = await prisma.appJourneyModuleRevision.findUnique({
    where: { moduleId_revision: { moduleId: id, revision } },
  });
  if (!past) throw new NotFoundError(`The module "${id}" has no revision ${revision}.`);
  return writeModule(id, () => moduleFieldsOf({ ...past, id }), revisionRead, editorId);
}

/** Save the journey row's own text. It has no history; its lock is `updatedAt`. */
export async function updateJourney(
  edit: JourneyEdit,
  updatedAtRead: string
): Promise<{ changed: string[]; changes: FieldChanges }> {
  return executeTransaction(async (tx) => {
    const journey = await tx.appJourney.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!journey) throw new NotFoundError('The journey has not been seeded yet.');
    if (journey.updatedAt.toISOString() !== updatedAtRead) throw staleRow('The journey');

    const before = {
      title: journey.title,
      subtitle: journey.subtitle,
      version: journey.version,
      locale: journey.locale,
    };
    const changed = changedFieldsOf(before, edit, ['title', 'subtitle', 'version', 'locale']);
    if (changed.length === 0) return { changed, changes: {} };
    const { count } = await tx.appJourney.updateMany({
      where: { id: journey.id, updatedAt: journey.updatedAt },
      data: edit,
    });
    if (count === 0) throw staleRow('The journey');
    return { changed, changes: toChanges(before, edit, changed) };
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

export function journeyExportFilename(now: Date): string {
  return `lelanea-module-structure-${now.toISOString().slice(0, 10)}.json`;
}

/** The stored journey as a module structure file, checked with the seed's schema. */
export async function exportJourneyFile(): Promise<JourneyStructureFile> {
  const { structure } = await getJourneyAdminView();
  if (!structure) {
    throw new ConflictError('There is nothing to export: the journey has not been seeded.', {
      reason: 'nothing_to_export',
    });
  }
  const parsed = journeyStructureFileSchema.safeParse(journeyFileFromStructure(structure));
  if (!parsed.success) {
    throw new ConflictError(
      `The stored journey cannot be written as a file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
        .join('; ')}.`,
      { reason: 'unexportable' }
    );
  }
  return parsed.data;
}

// ─── Import ─────────────────────────────────────────────────────────────────

interface StoredJourney {
  journey: { id: string; title: string; subtitle: string; version: string; locale: string } | null;
  tiers: readonly AppJourneyTier[];
  modules: readonly AppJourneyModule[];
}

interface JourneyImport {
  plan: ContentImportPlan;
  journeyChanged: string[];
  journeyAfter: { title: string; subtitle: string; version: string; locale: string };
  tiers: KeyedPlan<TierFields>;
  modules: KeyedPlan<ModuleFields>;
}

/**
 * What a module structure file would do to these rows. Pure.
 *
 * Structure must match the roster exactly, so there are only updates: every
 * tier and module in the file is one the roster has, and every one the roster
 * has is in the file.
 */
export function planJourneyImport(
  file: JourneyStructureFile,
  stored: StoredJourney
): JourneyImport {
  const refusals: string[] = [];
  let seed: ReturnType<typeof journeySeedFromFile> | null = null;
  try {
    seed = journeySeedFromFile(file);
  } catch (error) {
    refusals.push(error instanceof Error ? error.message : String(error));
  }
  if (!stored.journey)
    refusals.push('The journey has not been seeded, so there is nothing to import into.');
  else if (seed && seed.journey.id !== stored.journey.id) {
    refusals.push(
      `This file is for "${seed.journey.id}", and this database holds "${stored.journey.id}".`
    );
  }

  const keep = <F>(): KeyedPlan<F> => ({
    creates: [],
    updates: [],
    removals: [],
    unchanged: [],
    skippedRetired: [],
    absentFromFile: [],
  });
  const tiers = seed
    ? planKeyedImport<Omit<JourneyTierRow, 'revision'>, TierFields>({
        incoming: seed.tiers.map((tier) => ({ key: tier.id, value: tier })),
        stored: stored.tiers.map((row) => ({
          key: row.id,
          fields: tierFieldsOf(row),
          revision: row.revision,
        })),
        diff: (before, after) => changedFieldsOf(before, after, TIER_SNAPSHOT_FIELDS),
        allFields: TIER_SNAPSHOT_FIELDS,
        toCreate: (tier) => tierFieldsOf(tier),
        toUpdate: (_before, tier) => tierFieldsOf(tier),
        onAbsent: 'keep',
      })
    : keep<TierFields>();
  const modules = seed
    ? planKeyedImport<Omit<JourneyModuleRow, 'revision'>, ModuleFields>({
        incoming: seed.modules.map((entry) => ({ key: entry.id, value: entry })),
        stored: stored.modules.map((row) => ({
          key: row.id,
          fields: moduleFieldsOf(row),
          revision: row.revision,
        })),
        diff: (before, after) => changedFieldsOf(before, after, MODULE_SNAPSHOT_FIELDS),
        allFields: MODULE_SNAPSHOT_FIELDS,
        toCreate: (entry) => moduleFieldsOf(entry),
        toUpdate: (_before, entry) => moduleFieldsOf(entry),
        onAbsent: 'keep',
      })
    : keep<ModuleFields>();

  // The roster check above makes these unreachable from a valid file against a
  // seeded database; they are here so a database missing a roster row is
  // reported rather than half-written.
  for (const change of [...tiers.creates, ...modules.creates]) {
    refusals.push(`"${change.key}" is in the roster but has no row here. Run the seed.`);
  }

  const journeyAfter = seed
    ? {
        title: seed.journey.title,
        subtitle: seed.journey.subtitle,
        version: seed.journey.version,
        locale: seed.journey.locale,
      }
    : { title: '', subtitle: '', version: '', locale: '' };
  const journeyChanged =
    seed && stored.journey
      ? changedFieldsOf(
          {
            title: stored.journey.title,
            subtitle: stored.journey.subtitle,
            version: stored.journey.version,
            locale: stored.journey.locale,
          },
          journeyAfter,
          ['title', 'subtitle', 'version', 'locale']
        )
      : [];

  const sections = [
    toPlanSection('tier', 'Tiers', tiers, 'delete'),
    toPlanSection('module', 'Modules', modules, 'delete'),
  ];
  if (journeyChanged.length > 0 && stored.journey) {
    sections.unshift({
      entity: 'journey',
      label: 'Journey',
      creates: [],
      updates: [{ key: stored.journey.id, changedFields: journeyChanged }],
      removals: [],
      removalKind: 'delete',
      unchanged: [],
      skippedRetired: [],
    });
  }

  return {
    plan: {
      collection: 'journey',
      sections,
      refusals,
      writesNothing: sectionsWriteNothing(sections),
    },
    journeyChanged,
    journeyAfter,
    tiers,
    modules,
  };
}

async function readStored(
  client: Pick<typeof prisma, 'appJourney' | 'appJourneyTier' | 'appJourneyModule'>
): Promise<StoredJourney> {
  const [journey, tiers, modules] = await Promise.all([
    client.appJourney.findFirst({ orderBy: { createdAt: 'asc' } }),
    client.appJourneyTier.findMany(),
    client.appJourneyModule.findMany(),
  ]);
  const tierOrder = new Map(JOURNEY_TIERS.map((tier, index) => [tier.id as string, index]));
  const moduleOrder = new Map(JOURNEY_MODULES.map((entry, index) => [entry.id, index]));
  return {
    journey,
    tiers: [...tiers].sort((a, b) => (tierOrder.get(a.id) ?? 0) - (tierOrder.get(b.id) ?? 0)),
    modules: [...modules].sort(
      (a, b) => (moduleOrder.get(a.id) ?? 0) - (moduleOrder.get(b.id) ?? 0)
    ),
  };
}

function parseJourneyFile(raw: unknown): JourneyStructureFile {
  return parseContentFile(journeyStructureFileSchema, raw, 'module structure');
}

export async function previewJourneyImport(raw: unknown): Promise<ContentImportPlan> {
  return planJourneyImport(parseJourneyFile(raw), await readStored(prisma)).plan;
}

/** Apply a module structure file. Re-planned in the transaction; idempotent. */
export async function applyJourneyImport(
  raw: unknown,
  editorId: string
): Promise<ContentImportPlan> {
  const file = parseJourneyFile(raw);
  const plan = await executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planJourneyImport(file, stored);
      if (planned.plan.refusals.length > 0)
        throw importRefused('module structure', planned.plan.refusals);
      if (planned.plan.writesNothing) return planned.plan;

      if (planned.journeyChanged.length > 0 && stored.journey) {
        await tx.appJourney.update({
          where: { id: stored.journey.id },
          data: planned.journeyAfter,
        });
      }
      for (const change of planned.tiers.updates) {
        await tx.appJourneyTier.update({
          where: { id: change.key },
          data: { ...change.after!, revision: change.revision },
        });
        await tx.appJourneyTierRevision.create({
          data: {
            tierId: change.key,
            revision: change.revision,
            ...change.after!,
            changedFields: change.changedFields,
            origin: 'admin',
            editorId,
          },
        });
      }
      for (const change of planned.modules.updates) {
        const data = toModuleData(change.after!);
        await tx.appJourneyModule.update({
          where: { id: change.key },
          data: { ...data, revision: change.revision },
        });
        await tx.appJourneyModuleRevision.create({
          data: {
            moduleId: change.key,
            revision: change.revision,
            ...data,
            changedFields: change.changedFields,
            origin: 'admin',
            editorId,
          },
        });
      }
      return planned.plan;
    },
    { timeout: IMPORT_TX_TIMEOUT_MS }
  );
  if (!plan.writesNothing) await refreshModuleDefinitions();
  return plan;
}
