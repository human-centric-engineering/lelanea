/**
 * The slot-definition editor's reads and writes (f-slots t-71).
 *
 * t-70 put the taxonomy in `app_slot_definition` and gave it a version chain in
 * `app_slot_definition_revision`; the only writer was the seed. This module is
 * the other one — what an admin does to the taxonomy without a deploy.
 *
 * ## Why this is not in `taxonomy-store.ts`
 *
 * That module is the **provider**: one query, `isActive: true`, the columns the
 * framework sync needs and no more. Its `DEFINITION_SELECT` carries a comment
 * inviting t-71 to widen it and `StoredSlotDefinition` together — but widening
 * it would make the provider fetch `version`, `createdAt` and `updatedAt` on
 * every boot and every re-sync, and never read them, which is the exact
 * "a select that fetches a column no caller reads" the comment warns against.
 * The editor reads different rows (retired ones included) for a different
 * reason, so it gets its own select here and shares what is genuinely shared:
 * {@link SLOT_DEFINITION_FIELDS}, {@link StoredSlotDefinitionFields} and
 * {@link changedDefinitionFields}, which is the executable form of the change
 * rule in `.context/app/slots.md`.
 *
 * **And not `listSlotDefinitions()`.** `lib/framework/data-slots/queries.ts`
 * already exports that name through the framework barrel, and it reads
 * `framework_slot_definition` — the projection, with no history and no way to
 * tell our retirement from a deactivation. A leaf function by that name is one
 * import away from being the wrong one.
 *
 * ## The lock, re-derived rather than copied (`fp5`)
 *
 * The shape is the crisis-resources editor's (`lib/app/safety/crisis-admin.ts`):
 * an integer `version` the admin sends back, compared before the write and
 * again *in* the write via a conditional `updateMany`, so a save racing another
 * between the two is refused as well.
 *
 * The justification does not transfer unchanged, and is stronger here. There,
 * `version` exists for the lock. Here it is the **revision number** — the thing
 * `app_slot_definition_revision.version` records and the thing "what did this
 * slot mean when that answer was given?" is answered through. A lost update
 * would not just discard an admin's wording; it would leave the history
 * claiming a version whose text nothing stored ever had.
 *
 * One consequence worth stating, because it is the opposite of the precedent's:
 * **a save that changes nothing writes nothing at all** — no revision, no
 * version bump, no re-sync. `.context/app/slots.md` states that as the change
 * rule, and `changedDefinitionFields()` is what makes it true.
 *
 * ## Every write ends in a re-sync, and a failed one is reported, not thrown
 *
 * `app_slot_definition` is the source; `framework_slot_definition` is a
 * projection of it, and nothing else writes that projection. So an edit that
 * does not reach {@link syncGlobalSlotDefinitions} is an edit the agent is not
 * using — invisible, including to the admin who just made it (`HB9`).
 *
 * The sync runs **after** the transaction commits, and its failure is returned
 * rather than thrown. Throwing would surface a 500 on a request that did write,
 * telling the admin nothing happened when something did; the honest report is
 * "saved, and not yet projected", which is what {@link SlotSyncOutcome} carries
 * to the page. The remedy is already in the system (`HB10`): the pass is
 * idempotent and serialised, so saving again re-runs it, and a server boot runs
 * it regardless.
 *
 * @see lib/app/slots/taxonomy-store.ts — the provider the sync below reads
 * @see .context/app/slots.md
 */

import type { Prisma } from '@prisma/client';

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { logger } from '@/lib/logging';
import { slotTaxonomyFileSchema, type SlotTaxonomyFile } from '@/lib/app/content/slot-taxonomy';
import {
  SLOT_DEFINITION_FIELDS,
  changedDefinitionFields,
  type SlotDefinitionField,
  type StoredSlotDefinitionFields,
} from '@/lib/app/slots/taxonomy-store';
import { SLOT_MODE, syncGlobalSlotDefinitions } from '@/lib/framework/data-slots';
import type { GlobalSlotSyncResult } from '@/lib/framework/data-slots';
import type {
  SlotDefinitionCreate,
  SlotDefinitionUpdate,
  SlotUploadMode,
} from '@/lib/app/slots/validation';

/** A bulk apply writes one row per slot plus one revision each; 53 of both today. */
const UPLOAD_TX_TIMEOUT_MS = 30_000;

// ─── Shapes the routes and the page read ────────────────────────────────────

/** One definition as the editor reads it — the provider's columns, plus the version. */
export interface SlotDefinitionRow extends StoredSlotDefinitionFields {
  slug: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One past version of one definition. A full snapshot, not a diff. */
export interface SlotRevisionRow extends StoredSlotDefinitionFields {
  id: string;
  slotSlug: string;
  version: number;
  changedFields: string[];
  origin: string;
  editorId: string | null;
  editorEmail: string | null;
  changedAt: Date;
}

export interface SlotTaxonomyAdminView {
  definitions: SlotDefinitionRow[];
  /**
   * The group keys in use, sorted. The editor's picker is built from this
   * rather than from the bundled file's `groups` array: once seeded, the tables
   * are the taxonomy, and reading the file for a vocabulary would mean an admin
   * could move a slot into a group no stored row has, or fail to move it into
   * one an earlier upload introduced.
   *
   * Group *titles and descriptions* live only in the bundled file and are not
   * read back here — they were content decoration on a column that stores a key.
   */
  groups: string[];
  /** False before the seed has run: the editor has nothing to edit yet. */
  seeded: boolean;
}

/**
 * What the re-sync did.
 *
 * Two of these are ours. `failed` is the pass throwing — the edit is committed
 * and the projection is behind. `not_needed` is the pass never running, because
 * nothing changed; it is distinct from the framework's `empty`, which means the
 * pass DID run and the provider handed it nothing (every slot retired). The
 * page says different things about those two, so they cannot share a name.
 */
export type SlotSyncOutcome =
  GlobalSlotSyncResult | { status: 'failed'; message: string } | { status: 'not_needed' };

const DEFINITION_SELECT = {
  slug: true,
  group: true,
  description: true,
  visibility: true,
  mode: true,
  dataType: true,
  sensitivity: true,
  priorityWeight: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppSlotDefinitionSelect;

/**
 * What one write changed, as the audit log records it. Keyed by field, so an
 * entry says what the wording WAS as well as what it became — which is the half
 * a reader of the audit log cannot get from the definition row afterwards.
 */
export type SlotFieldChanges = Partial<Record<SlotDefinitionField, { from: unknown; to: unknown }>>;

function toFieldChanges(
  before: StoredSlotDefinitionFields,
  after: StoredSlotDefinitionFields,
  changed: readonly SlotDefinitionField[]
): SlotFieldChanges {
  return Object.fromEntries(
    changed.map((field) => [field, { from: before[field], to: after[field] }])
  );
}

/** The authored fields of a row, without the identity and bookkeeping around them. */
function fieldsOf(row: StoredSlotDefinitionFields): StoredSlotDefinitionFields {
  return {
    group: row.group,
    description: row.description,
    visibility: row.visibility,
    mode: row.mode,
    dataType: row.dataType,
    sensitivity: row.sensitivity,
    priorityWeight: row.priorityWeight,
    isActive: row.isActive,
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * Every definition an admin may act on — **retired ones included**.
 *
 * Deliberately not the provider's query. A retired slot is exactly what someone
 * comes here to restore, and hiding it would make a retirement look like a
 * deletion, which is the one thing this table never does.
 */
export async function getSlotTaxonomyAdminView(): Promise<SlotTaxonomyAdminView> {
  const definitions = await prisma.appSlotDefinition.findMany({
    select: DEFINITION_SELECT,
    orderBy: [{ group: 'asc' }, { slug: 'asc' }],
  });

  return {
    definitions,
    groups: [...new Set(definitions.map((row) => row.group))].sort(),
    seeded: definitions.length > 0,
  };
}

/**
 * Every past version of one definition, newest first.
 *
 * The editor's history view, and the read the whole revision table exists for.
 * `editorEmail` is resolved here rather than joined: `editorId` is a plain
 * scalar with no Prisma relation (a fork table must not add a reverse field to
 * Sunrise's `User`), so the join has to be a second query. A null email is the
 * ordinary case for a seed row and for an admin whose account has since been
 * erased — `origin` is what tells those apart.
 */
export async function listSlotDefinitionHistory(slug: string): Promise<SlotRevisionRow[]> {
  const [definition, revisions] = await Promise.all([
    prisma.appSlotDefinition.findUnique({ where: { slug }, select: { slug: true } }),
    prisma.appSlotDefinitionRevision.findMany({
      where: { slotSlug: slug },
      orderBy: { version: 'desc' },
    }),
  ]);

  if (!definition) throw notFound(slug);

  const editorIds = [...new Set(revisions.map((r) => r.editorId).filter((id) => id !== null))];
  const editors =
    editorIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: editorIds } },
          select: { id: true, email: true },
        });
  const emailById = new Map(editors.map((user) => [user.id, user.email]));

  return revisions.map((revision) => ({
    id: revision.id,
    slotSlug: revision.slotSlug,
    version: revision.version,
    group: revision.group,
    description: revision.description,
    visibility: revision.visibility,
    mode: revision.mode,
    dataType: revision.dataType,
    sensitivity: revision.sensitivity,
    priorityWeight: revision.priorityWeight,
    isActive: revision.isActive,
    changedFields: revision.changedFields,
    origin: revision.origin,
    editorId: revision.editorId,
    editorEmail: revision.editorId === null ? null : (emailById.get(revision.editorId) ?? null),
    changedAt: revision.changedAt,
  }));
}

// ─── The refusals ───────────────────────────────────────────────────────────

function notFound(slug: string): NotFoundError {
  return new NotFoundError(
    `There is no slot definition with the slug "${slug}". A slug is never renamed, so if you expected one here it was added under a different name.`
  );
}

/**
 * The stale-form refusal. `reason` is what distinguishes it from the other 409s
 * on these routes; the message is what the admin actually reads.
 */
function versionMoved(slug: string, current: number, read: number): ConflictError {
  return new ConflictError(
    `"${slug}" was changed by someone else since you opened it (version ${read}, now ${current}). Reload and read it again before saving.`,
    { reason: 'version_moved', currentVersion: current }
  );
}

// ─── The re-sync ────────────────────────────────────────────────────────────

/**
 * Project the edit into `framework_slot_definition`, and report rather than
 * throw. See the file header for why the failure is a return value.
 */
async function resyncGlobalSlots(context: Record<string, unknown>): Promise<SlotSyncOutcome> {
  try {
    const result = await syncGlobalSlotDefinitions();
    if (result.status !== 'synced') {
      logger.warn(
        'slot definitions: the edit committed but the global sync wrote nothing — the agent is still reading the previous projection',
        { ...context, status: result.status }
      );
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the global slot sync failed';
    logger.error(
      'slot definitions: the edit committed but the global sync threw — the agent is still reading the previous projection until the next save or boot',
      { ...context, error: message }
    );
    return { status: 'failed', message };
  }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * Apply one definition's next state, if it differs, as a row update plus a
 * revision — atomically, and only while the version is still the one that was
 * read.
 *
 * Every single-definition write goes through here, so the change rule, the
 * lock and the history are stated once rather than three times.
 */
async function writeDefinitionChange(
  slug: string,
  toNext: (before: StoredSlotDefinitionFields) => StoredSlotDefinitionFields,
  versionRead: number,
  editorId: string
): Promise<{
  definition: SlotDefinitionRow;
  changed: SlotDefinitionField[];
  changes: SlotFieldChanges;
}> {
  const before = await prisma.appSlotDefinition.findUnique({
    where: { slug },
    select: DEFINITION_SELECT,
  });
  if (!before) throw notFound(slug);
  if (before.version !== versionRead) throw versionMoved(slug, before.version, versionRead);

  // Computed from the row we just read rather than passed in, so there is one
  // read of the stored state and the caller cannot supply a `next` derived from
  // a row it fetched separately (and possibly earlier).
  const next = toNext(fieldsOf(before));
  const changed = changedDefinitionFields(fieldsOf(before), next);
  // The change rule: an edit that changes nothing writes no revision and bumps
  // no version. Returning `before` rather than re-reading is the same row.
  if (changed.length === 0) return { definition: before, changed, changes: {} };

  const version = before.version + 1;

  return executeTransaction(async (tx) => {
    // Conditional on the version, so a save racing another between the read
    // above and here is refused too — and because this runs first, throwing on
    // a loss rolls the revision back with it.
    const { count } = await tx.appSlotDefinition.updateMany({
      where: { slug, version: versionRead },
      data: { ...next, version },
    });
    if (count === 0) {
      const now = await tx.appSlotDefinition.findUnique({
        where: { slug },
        select: { version: true },
      });
      throw versionMoved(slug, now?.version ?? versionRead, versionRead);
    }

    await tx.appSlotDefinitionRevision.create({
      data: { slotSlug: slug, version, ...next, changedFields: changed, origin: 'admin', editorId },
    });

    const definition = await tx.appSlotDefinition.findUniqueOrThrow({
      where: { slug },
      select: DEFINITION_SELECT,
    });
    return { definition, changed, changes: toFieldChanges(fieldsOf(before), next, changed) };
  });
}

/**
 * Add a definition.
 *
 * Born at version 1 with a revision whose `changedFields` is every field —
 * against nothing, everything is new, which is what makes the history view read
 * v1 as the creation rather than as a change to eight things at once. The same
 * sentence is in the seed, for the same reason.
 */
export async function createSlotDefinition(
  input: SlotDefinitionCreate,
  editorId: string
): Promise<{ definition: SlotDefinitionRow; sync: SlotSyncOutcome }> {
  const { slug, ...authored } = input;
  const next: StoredSlotDefinitionFields = {
    ...authored,
    // Never offered and never written otherwise: a definition row IS the
    // pre-declaration, and open-mode capture mints a slug with no backing row
    // (`.context/app/slots.md`).
    mode: SLOT_MODE.targeted,
    isActive: true,
  };

  const definition = await executeTransaction(async (tx) => {
    const clash = await tx.appSlotDefinition.findUnique({
      where: { slug },
      select: { slug: true, isActive: true },
    });
    if (clash) {
      // Naming the retired case explicitly: otherwise "already exists" on a slug
      // nothing in the editor is showing reads as a bug rather than as the
      // retired row it is, and the admin's next move is to invent a slug variant
      // — which is the one thing a slug must never become.
      throw new ConflictError(
        clash.isActive
          ? `There is already a slot definition with the slug "${slug}".`
          : `The slug "${slug}" belongs to a retired definition. Restore it instead of adding it again — the answers already captured under it are still resolved through its history.`,
        { reason: clash.isActive ? 'exists' : 'retired', slug }
      );
    }

    const created = await tx.appSlotDefinition.create({
      data: { slug, ...next, version: 1 },
      select: DEFINITION_SELECT,
    });
    await tx.appSlotDefinitionRevision.create({
      data: {
        slotSlug: slug,
        version: 1,
        ...next,
        changedFields: [...SLOT_DEFINITION_FIELDS],
        origin: 'admin',
        editorId,
      },
    });
    return created;
  });

  const sync = await resyncGlobalSlots({ action: 'create', slug });
  return { definition, sync };
}

/** Reword one definition. The slug is not in `update` and cannot be. */
export async function updateSlotDefinition(
  slug: string,
  update: SlotDefinitionUpdate,
  versionRead: number,
  editorId: string
): Promise<{
  definition: SlotDefinitionRow;
  changed: SlotDefinitionField[];
  changes: SlotFieldChanges;
  sync: SlotSyncOutcome;
}> {
  const { definition, changed, changes } = await writeDefinitionChange(
    slug,
    // `isActive` and `mode` are carried through from the stored row, not taken
    // from the caller: retirement is its own route, and mode is never written
    // anything but `targeted`.
    (before) => ({ ...before, ...update }),
    versionRead,
    editorId
  );

  if (changed.length === 0) return { definition, changed, changes, sync: { status: 'not_needed' } };
  const sync = await resyncGlobalSlots({ action: 'update', slug, changed });
  return { definition, changed, changes, sync };
}

/**
 * Retire or restore one definition.
 *
 * Retiring sets `isActive = false` and nothing else. The row stays, the
 * provider stops handing it to the framework sync, and the sync deactivates its
 * projection — the case pinned as *"a slug the provider drops is deactivated"*
 * in `tests/integration/lib/framework/data-slots/global-slots.test.ts`. Every
 * answer captured under the slug keeps resolving, because nothing on the read
 * path joins a value to a definition at all.
 */
export async function setSlotDefinitionActive(
  slug: string,
  isActive: boolean,
  versionRead: number,
  editorId: string
): Promise<{
  definition: SlotDefinitionRow;
  changed: SlotDefinitionField[];
  changes: SlotFieldChanges;
  sync: SlotSyncOutcome;
}> {
  const { definition, changed, changes } = await writeDefinitionChange(
    slug,
    (before) => ({ ...before, isActive }),
    versionRead,
    editorId
  );

  if (changed.length === 0) return { definition, changed, changes, sync: { status: 'not_needed' } };
  const sync = await resyncGlobalSlots({ action: isActive ? 'restore' : 'retire', slug });
  return { definition, changed, changes, sync };
}

// ─── Upload ─────────────────────────────────────────────────────────────────

/**
 * What an upload would do to one slug.
 *
 * `before` is absent only on a `create`. `changedFields` is what the revision
 * will record, and on a create it is every field, for the reason v1 always is.
 */
export interface SlotUploadChange {
  slug: string;
  kind: 'create' | 'update' | 'retire';
  changedFields: SlotDefinitionField[];
  before: StoredSlotDefinitionFields | null;
  after: StoredSlotDefinitionFields;
  /** The version the change will produce. 1 on a create. */
  version: number;
}

/**
 * Everything an upload would do, and everything it deliberately would not.
 *
 * The three "would not" lists are the point of previewing at all: an upload
 * that only showed its writes would leave the admin to infer the omissions,
 * and the omissions are where a taxonomy file quietly loses a slot.
 */
export interface SlotUploadPlan {
  mode: SlotUploadMode;
  creates: SlotUploadChange[];
  updates: SlotUploadChange[];
  retirements: SlotUploadChange[];
  /** In the file, stored, and identical. Nothing to do. */
  unchanged: string[];
  /**
   * In the file, but retired here — left exactly as it is, in both modes.
   *
   * The file format cannot express retirement (it has no `isActive`), so a
   * retired slug appearing in it is indistinguishable from one that was never
   * retired. Reviving it on that evidence is the trap the seed's own docblock
   * names: a per-slug "create if absent" would revive every slot an admin had
   * retired, on every run. Restoring is a deliberate act with its own route.
   */
  skippedRetired: string[];
  /**
   * Stored and active, and the file does not mention it. Left alone in `merge`;
   * retired in `replace`, in which case it also appears in `retirements`.
   */
  absentFromFile: string[];
}

/**
 * Parse an uploaded file, and refuse the one vocabulary value the editor never
 * writes.
 *
 * The file is checked by `slotTaxonomyFileSchema` — the same schema the seed
 * parses the bundled file with — so the admin reads the same referential errors
 * ("every slot must name a group declared in `groups`") rather than a second,
 * weaker description of the same format.
 *
 * `mode: open` is refused by name rather than coerced. A definition row IS the
 * pre-declaration; an open-mode row would claim to pre-declare a slug that
 * open-mode capture is supposed to mint at runtime, and silently rewriting it
 * to `targeted` would accept a file that meant something else.
 */
function parseTaxonomyUploadFile(raw: unknown): SlotTaxonomyFile {
  const parsed = slotTaxonomyFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('That is not a slot taxonomy file', {
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const openMode = parsed.data.slots
    .filter((slot) => slot.mode === SLOT_MODE.open)
    .map((slot) => slot.slug);
  if (openMode.length > 0) {
    throw new ValidationError(
      `A taxonomy file may not declare an open-mode slot. A definition row is the pre-declaration; open-mode capture mints its own slug and needs no row. Change these to "targeted" or remove them: ${openMode.join(', ')}.`,
      { openMode }
    );
  }

  return parsed.data;
}

/**
 * What this file would do to these rows — **pure, and the only place that
 * decides**.
 *
 * Preview and apply are two callers of this one function, which is what makes
 * "the preview matches what apply does" a property of the code rather than a
 * pair of implementations kept in step by hand. Apply re-plans against the rows
 * as they stand inside its own transaction, so a definition edited between the
 * preview and the apply is reconciled as it actually is — and the plan that
 * comes back in the response is the one that ran, not the one that was shown.
 */
export function planTaxonomyUpload(
  file: SlotTaxonomyFile,
  mode: SlotUploadMode,
  stored: readonly SlotDefinitionRow[]
): SlotUploadPlan {
  const bySlug = new Map(stored.map((row) => [row.slug, row]));
  const inFile = new Set(file.slots.map((slot) => slot.slug));

  const plan: SlotUploadPlan = {
    mode,
    creates: [],
    updates: [],
    retirements: [],
    unchanged: [],
    skippedRetired: [],
    absentFromFile: [],
  };

  for (const slot of file.slots) {
    const current = bySlug.get(slot.slug);
    const authored = {
      group: slot.group,
      description: slot.description,
      visibility: slot.visibility,
      mode: slot.mode,
      dataType: slot.dataType,
      sensitivity: slot.sensitivity,
      priorityWeight: slot.priorityWeight,
    };

    if (!current) {
      plan.creates.push({
        slug: slot.slug,
        kind: 'create',
        changedFields: [...SLOT_DEFINITION_FIELDS],
        before: null,
        after: { ...authored, isActive: true },
        version: 1,
      });
      continue;
    }

    if (!current.isActive) {
      plan.skippedRetired.push(slot.slug);
      continue;
    }

    const before = fieldsOf(current);
    const after: StoredSlotDefinitionFields = { ...before, ...authored };
    const changedFields = changedDefinitionFields(before, after);
    if (changedFields.length === 0) {
      plan.unchanged.push(slot.slug);
      continue;
    }
    plan.updates.push({
      slug: slot.slug,
      kind: 'update',
      changedFields,
      before,
      after,
      version: current.version + 1,
    });
  }

  for (const row of stored) {
    if (inFile.has(row.slug) || !row.isActive) continue;
    plan.absentFromFile.push(row.slug);
    if (mode !== 'replace') continue;

    const before = fieldsOf(row);
    const after: StoredSlotDefinitionFields = { ...before, isActive: false };
    plan.retirements.push({
      slug: row.slug,
      kind: 'retire',
      changedFields: changedDefinitionFields(before, after),
      before,
      after,
      version: row.version + 1,
    });
  }

  return plan;
}

/** Whether a plan would write anything at all. */
export function planWritesNothing(plan: SlotUploadPlan): boolean {
  return plan.creates.length + plan.updates.length + plan.retirements.length === 0;
}

/** What this file would do, without doing it. */
export async function previewTaxonomyUpload(
  raw: unknown,
  mode: SlotUploadMode
): Promise<SlotUploadPlan> {
  const file = parseTaxonomyUploadFile(raw);
  const { definitions } = await getSlotTaxonomyAdminView();
  return planTaxonomyUpload(file, mode, definitions);
}

/**
 * Apply a taxonomy file.
 *
 * Idempotent, and by construction rather than by a guard: every write is driven
 * by {@link changedDefinitionFields}, so a second apply of the same file finds
 * its creates already stored and identical, its updates already applied, and
 * its retirements already retired — and plans nothing.
 */
export async function applyTaxonomyUpload(
  raw: unknown,
  mode: SlotUploadMode,
  editorId: string
): Promise<{ plan: SlotUploadPlan; sync: SlotSyncOutcome }> {
  const file = parseTaxonomyUploadFile(raw);

  const plan = await executeTransaction(
    async (tx) => {
      const stored = await tx.appSlotDefinition.findMany({
        select: DEFINITION_SELECT,
        orderBy: [{ group: 'asc' }, { slug: 'asc' }],
      });
      const planned = planTaxonomyUpload(file, mode, stored);

      if (planned.creates.length > 0) {
        await tx.appSlotDefinition.createMany({
          data: planned.creates.map((change) => ({
            slug: change.slug,
            ...change.after,
            version: 1,
          })),
        });
      }

      // One at a time: each carries its own version, so there is no single
      // `updateMany` that expresses them. Unlike the form's write there is no
      // version to check against — the admin is reconciling a file against
      // whatever is stored now, which is what the re-plan above reads.
      for (const change of [...planned.updates, ...planned.retirements]) {
        await tx.appSlotDefinition.update({
          where: { slug: change.slug },
          data: { ...change.after, version: change.version },
        });
      }

      const written = [...planned.creates, ...planned.updates, ...planned.retirements];
      if (written.length > 0) {
        await tx.appSlotDefinitionRevision.createMany({
          data: written.map((change) => ({
            slotSlug: change.slug,
            version: change.version,
            ...change.after,
            changedFields: change.changedFields,
            origin: 'admin' as const,
            editorId,
          })),
        });
      }

      return planned;
    },
    { timeout: UPLOAD_TX_TIMEOUT_MS }
  );

  if (planWritesNothing(plan)) return { plan, sync: { status: 'not_needed' } };
  const sync = await resyncGlobalSlots({
    action: 'upload',
    mode,
    created: plan.creates.length,
    updated: plan.updates.length,
    retired: plan.retirements.length,
  });
  return { plan, sync };
}
