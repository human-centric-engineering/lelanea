/**
 * The resource library, edited in the admin (f-content-seeds t-91): its
 * collection row, every film and reading, and her words by key.
 *
 * ## Resources are retired, never deleted
 *
 * A conversation stores a resource suggestion by id and rebuilds its chip from
 * the library whenever the conversation is reloaded or replayed
 * (`lib/app/resources/suggest.ts`). Deleting a resource, or changing its id,
 * would make that chip vanish from history with no error. So:
 *
 * - **An id is never edited.** It is in the path, never in a body.
 * - **"Delete" retires.** `app_resource.retired` is the tombstone: the row
 *   stays, every surface that offers or lists the library stops showing it, the
 *   AI can no longer suggest it, and chip resolution still finds it
 *   (`getResourcesLibrary({ includeRetired: true })`). Retiring can be undone.
 *
 * The alternative the task allowed, counting the past suggestions that would
 * lose their chip and deleting anyway, was rejected: it tells the admin what
 * they are about to lose instead of not losing it, and the count needs a scan of
 * every turn's provenance JSON.
 *
 * A retired resource leaves the drawer's order: its position moves below zero
 * and the live ones close up, so a fresh export (live resources only, because
 * the file cannot say "retired") re-imports with no position changes.
 *
 * **Words** (her quote and paragraphs per key) are deleted outright, except
 * `default`, which every key without words of its own falls back to. Nothing
 * stores a words key, so there is no history to protect.
 *
 * @see lib/app/content/resource-store.ts — the reads every surface makes
 */

import type {
  AppResource,
  AppResourceRevision,
  AppResourceWords,
  AppResourceWordsRevision,
} from '@prisma/client';

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import {
  getResourcesLibrary,
  RESOURCE_SNAPSHOT_FIELDS,
  WORDS_SNAPSHOT_FIELDS,
} from '@/lib/app/content/resource-store';
import {
  buildResourcesFileSchema,
  FIXED_RESOURCE_KEYS,
  provenanceSchema,
  type ResourcesFile,
  type ResourcesProvenance,
} from '@/lib/app/content/resources';
import {
  toFilm,
  toReading,
  toWords,
  type ResourceRow,
  type ResourceWordsRow,
} from '@/lib/app/content/resource-view';
import { resourcesFileFromLibrary, resourcesSeedFromFile } from '@/lib/app/content/content-files';
import { JOURNEY_MODULES } from '@/lib/app/journey/roster';
import {
  changedFieldsOf,
  planKeyedImport,
  type KeyedPlan,
} from '@/lib/app/content/admin/keyed-import';
import { RESOURCE_READERS } from '@/lib/app/content/admin/readers';
import {
  guardedRemoval,
  importRefused,
  parkingPosition,
  parseContentFile,
  revisionMoved,
  sectionsWriteNothing,
  staleRow,
  toHistory,
  toPlanSection,
  type ContentImportPlan,
  type RevisionEntry,
} from '@/lib/app/content/admin/shared';
import type { FieldChanges } from '@/lib/app/content/admin/documents';
import type {
  ResourceCollectionEdit,
  ResourceEdit,
  WordsEdit,
} from '@/lib/app/content/admin/validation';

const IMPORT_TX_TIMEOUT_MS = 30_000;

type Tx = Parameters<Parameters<typeof executeTransaction>[0]>[0];

/** Every field a resource revision snapshots. */
export type ResourceFields = Omit<ResourceRow, 'id' | 'revision'> & { retired: boolean };
export type WordsFields = Omit<ResourceWordsRow, 'key' | 'revision'>;

/** One resource as the editor reads it: retired ones included. */
export interface ResourceAdminRow extends ResourceFields {
  id: string;
  revision: number;
}

export interface ResourcesAdminView {
  seeded: boolean;
  collection: {
    id: string;
    title: string;
    version: string;
    locale: string;
    provenance: ResourcesProvenance;
    updatedAt: string;
  } | null;
  /** Films then readings, live ones in drawer order, then the retired. */
  resources: ResourceAdminRow[];
  words: (WordsFields & { key: string; revision: number })[];
  /** What a resource may relate to: a module id, `journey` or `situations`. */
  relatesToOptions: readonly string[];
  /** What a words key may be: a module id or a fixed key. */
  wordsKeyOptions: readonly string[];
  /** The foundational documents a reading may open. */
  documentIds: readonly string[];
  readers: readonly string[];
}

export interface ResourceWriteResult {
  changed: string[];
  changes: FieldChanges;
  revision: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resourceFieldsOf(
  row: Omit<ResourceRow, 'revision'> & { retired: boolean }
): ResourceFields {
  return {
    kind: row.kind,
    position: row.position,
    title: row.title,
    subtitle: row.subtitle,
    relatesTo: row.relatesTo,
    duration: row.duration,
    readingTime: row.readingTime,
    href: row.href,
    documentId: row.documentId,
    retired: row.retired,
  };
}

function wordsFieldsOf(row: WordsFields): WordsFields {
  return {
    quote: row.quote,
    paragraphs: [...row.paragraphs],
    sourceCollection: row.sourceCollection,
    sourceId: row.sourceId,
  };
}

/** A words edit as its row's columns. */
function wordsFromEdit(edit: WordsEdit): WordsFields {
  return {
    quote: edit.quote,
    paragraphs: [...edit.paragraphs],
    sourceCollection: edit.source.collection,
    sourceId: edit.source.id,
  };
}

/** A resource edit as its row's content columns. */
function contentFromEdit(edit: ResourceEdit) {
  return {
    title: edit.title,
    subtitle: edit.subtitle,
    relatesTo: edit.relatesTo,
    duration: edit.kind === 'film' ? edit.duration : null,
    readingTime: edit.kind === 'reading' ? edit.readingTime : null,
    href: 'href' in edit ? edit.href : null,
    documentId: 'documentId' in edit ? edit.documentId : null,
  };
}

function toChanges<F extends object>(before: F, after: F, changed: readonly (keyof F & string)[]) {
  return Object.fromEntries(
    changed.map((field) => [field, { from: before[field], to: after[field] }])
  );
}

function resourceDiff(before: ResourceFields, after: ResourceFields) {
  return changedFieldsOf(before, after, RESOURCE_SNAPSHOT_FIELDS);
}

function wordsDiff(before: WordsFields, after: WordsFields) {
  return changedFieldsOf(before, after, WORDS_SNAPSHOT_FIELDS);
}

const RELATES_TO_OPTIONS: readonly string[] = [
  ...JOURNEY_MODULES.map((entry) => entry.id),
  'journey',
  'situations',
];
const WORDS_KEY_OPTIONS: readonly string[] = [
  ...JOURNEY_MODULES.map((entry) => entry.id),
  ...FIXED_RESOURCE_KEYS,
];

/**
 * Throw unless these fields are a resource the read path will serve, relating
 * to a key the journey has and opening a document that exists.
 */
async function assertServable(tx: Tx, id: string, fields: ResourceFields): Promise<void> {
  const asRow: ResourceRow = { id, ...fields, revision: 1 };
  try {
    if (fields.kind === 'film') toFilm(asRow);
    else toReading(asRow);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error));
  }
  if (fields.relatesTo !== null && !RELATES_TO_OPTIONS.includes(fields.relatesTo)) {
    throw new ValidationError(
      `"${fields.relatesTo}" is not a module on the journey, "journey" or "situations".`
    );
  }
  if (fields.documentId !== null) {
    const document = await tx.appFoundationalDocument.findUnique({
      where: { id: fields.documentId },
      select: { id: true },
    });
    if (!document)
      throw new ValidationError(`There is no foundational document "${fields.documentId}".`);
  }
}

function assertWords(key: string, fields: WordsFields): void {
  if (!WORDS_KEY_OPTIONS.includes(key)) {
    throw new ValidationError(
      `"${key}" is not a module on the journey or one of ${FIXED_RESOURCE_KEYS.join(', ')}.`
    );
  }
  try {
    toWords({ key, ...fields, revision: 1 });
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error));
  }
}

/** Where the next retired resource of a kind parks: below every other. */
function nextRetiredPosition(rows: readonly Pick<AppResource, 'position'>[]): number {
  return Math.min(0, ...rows.map((row) => row.position)) - 1;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getResourcesAdminView(): Promise<ResourcesAdminView> {
  const [collection, resources, words, documents] = await Promise.all([
    prisma.appResourceCollection.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.appResource.findMany({ orderBy: [{ kind: 'asc' }, { position: 'asc' }] }),
    prisma.appResourceWords.findMany({ orderBy: { key: 'asc' } }),
    prisma.appFoundationalDocument.findMany({ select: { id: true }, orderBy: { position: 'asc' } }),
  ]);
  const live = resources.filter((row) => !row.retired);
  const retired = resources.filter((row) => row.retired);
  const byKind = (rows: readonly AppResource[]) => [
    ...rows.filter((row) => row.kind === 'film'),
    ...rows.filter((row) => row.kind === 'reading'),
  ];
  return {
    seeded: collection !== null,
    collection: collection && {
      id: collection.id,
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
      provenance: provenanceSchema.parse(collection.provenance),
      updatedAt: collection.updatedAt.toISOString(),
    },
    resources: [...byKind(live), ...byKind(retired)].map((row) => ({
      id: row.id,
      revision: row.revision,
      ...resourceFieldsOf(row),
    })),
    words: words.map((row) => ({ key: row.key, revision: row.revision, ...wordsFieldsOf(row) })),
    relatesToOptions: RELATES_TO_OPTIONS,
    wordsKeyOptions: WORDS_KEY_OPTIONS,
    documentIds: documents.map((row) => row.id),
    readers: RESOURCE_READERS,
  };
}

export async function listResourceHistory(id: string): Promise<RevisionEntry<ResourceFields>[]> {
  const [resource, revisions] = await Promise.all([
    prisma.appResource.findUnique({ where: { id }, select: { id: true } }),
    prisma.appResourceRevision.findMany({
      where: { resourceId: id },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!resource) throw new NotFoundError(`There is no resource "${id}".`);
  return toHistory(revisions, (row: AppResourceRevision) => resourceFieldsOf({ ...row, id }));
}

export async function listWordsHistory(key: string): Promise<RevisionEntry<WordsFields>[]> {
  const [words, revisions] = await Promise.all([
    prisma.appResourceWords.findUnique({ where: { key }, select: { key: true } }),
    prisma.appResourceWordsRevision.findMany({
      where: { wordsKey: key },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!words) throw new NotFoundError(`There are no words for "${key}".`);
  return toHistory(revisions, (row: AppResourceWordsRevision) => wordsFieldsOf(row));
}

// ─── Resource writes ────────────────────────────────────────────────────────

async function writeResource(
  id: string,
  toNext: (before: ResourceFields) => ResourceFields,
  revisionRead: number,
  editorId: string
): Promise<ResourceWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await tx.appResource.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`There is no resource "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`"${row.title}"`, row.revision, revisionRead);

    const before = resourceFieldsOf(row);
    const next = toNext(before);
    if (next.kind !== before.kind) {
      throw new ValidationError(
        `"${id}" is a ${before.kind}. A film and a reading are offered in different places, so add a new one instead.`
      );
    }
    await assertServable(tx, id, next);
    const changed = resourceDiff(before, next);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };

    const revision = row.revision + 1;
    const { count } = await tx.appResource.updateMany({
      where: { id, revision: revisionRead },
      data: { ...next, revision },
    });
    if (count === 0) throw revisionMoved(`"${row.title}"`, revision, revisionRead);
    await tx.appResourceRevision.create({
      data: {
        resourceId: id,
        revision,
        ...next,
        changedFields: changed,
        origin: 'admin',
        editorId,
      },
    });
    return { changed, changes: toChanges(before, next, changed), revision };
  });
}

/** Save an edit to one resource's content. Its id, kind and place are not edited here. */
export function updateResource(
  id: string,
  edit: ResourceEdit,
  revisionRead: number,
  editorId: string
): Promise<ResourceWriteResult> {
  return writeResource(
    id,
    (before) => ({ ...before, kind: edit.kind, ...contentFromEdit(edit) }),
    revisionRead,
    editorId
  );
}

/** Put one resource's content back to an earlier revision, as a new revision. */
export async function restoreResourceRevision(
  id: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<ResourceWriteResult> {
  const past = await prisma.appResourceRevision.findUnique({
    where: { resourceId_revision: { resourceId: id, revision } },
  });
  if (!past) throw new NotFoundError(`The resource "${id}" has no revision ${revision}.`);
  return writeResource(
    id,
    (before) => ({
      ...before,
      title: past.title,
      subtitle: past.subtitle,
      relatesTo: past.relatesTo,
      duration: past.duration,
      readingTime: past.readingTime,
      href: past.href,
      documentId: past.documentId,
    }),
    revisionRead,
    editorId
  );
}

/**
 * Close up the live resources of one kind after one leaves (or before one
 * returns at the end), so live positions stay contiguous from 0.
 */
async function compactKind(
  tx: Tx,
  kind: string,
  excluding: string,
  editorId: string
): Promise<void> {
  const live = await tx.appResource.findMany({
    where: { kind, retired: false, NOT: { id: excluding } },
    orderBy: { position: 'asc' },
  });
  const moving = live.filter((row, index) => row.position !== index);
  for (const [index, row] of moving.entries()) {
    await tx.appResource.update({
      where: { id: row.id },
      data: { position: parkingPosition(index) },
    });
  }
  for (const row of moving) {
    const position = live.indexOf(row);
    const revision = row.revision + 1;
    await tx.appResource.update({ where: { id: row.id }, data: { position, revision } });
    await tx.appResourceRevision.create({
      data: {
        resourceId: row.id,
        revision,
        ...resourceFieldsOf(row),
        position,
        changedFields: ['position'],
        origin: 'admin',
        editorId,
      },
    });
  }
}

/**
 * Retire or restore one resource. Retiring moves it below zero and closes the
 * gap it leaves; restoring puts it back at the end of its kind. See the file
 * header for why this is the only removal a resource has.
 */
export async function setResourceRetired(
  id: string,
  retired: boolean,
  revisionRead: number,
  editorId: string
): Promise<ResourceWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await tx.appResource.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`There is no resource "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`"${row.title}"`, row.revision, revisionRead);

    const before = resourceFieldsOf(row);
    if (before.retired === retired) return { changed: [], changes: {}, revision: row.revision };

    const others = await tx.appResource.findMany({ where: { kind: row.kind, NOT: { id } } });
    // Live positions are contiguous from 0, so the count of the other live
    // ones is the free place at the end.
    const position = retired
      ? nextRetiredPosition(others)
      : others.filter((other) => !other.retired).length;
    const next: ResourceFields = { ...before, retired, position };
    const changed = resourceDiff(before, next);
    const revision = row.revision + 1;

    const { count } = await tx.appResource.updateMany({
      where: { id, revision: revisionRead },
      data: { retired, position, revision },
    });
    if (count === 0) throw revisionMoved(`"${row.title}"`, revision, revisionRead);
    await tx.appResourceRevision.create({
      data: {
        resourceId: id,
        revision,
        ...next,
        changedFields: changed,
        origin: 'admin',
        editorId,
      },
    });
    if (retired) await compactKind(tx, row.kind, id, editorId);
    return { changed, changes: toChanges(before, next, changed), revision };
  });
}

/** Add a film or a reading at the end of its kind. */
export async function createResource(
  id: string,
  edit: ResourceEdit,
  editorId: string
): Promise<{ id: string }> {
  return executeTransaction(async (tx) => {
    const collection = await tx.appResourceCollection.findFirst({ select: { id: true } });
    if (!collection) throw new NotFoundError('The resource library has not been seeded yet.');
    const clash = await tx.appResource.findUnique({ where: { id }, select: { retired: true } });
    if (clash) {
      throw new ConflictError(
        clash.retired
          ? `"${id}" belongs to a retired resource. Restore it instead: past suggestions still name it.`
          : `There is already a resource "${id}".`,
        { reason: clash.retired ? 'retired' : 'exists' }
      );
    }
    const position = await tx.appResource.count({ where: { kind: edit.kind, retired: false } });
    const fields: ResourceFields = {
      kind: edit.kind,
      position,
      ...contentFromEdit(edit),
      retired: false,
    };
    await assertServable(tx, id, fields);
    await tx.appResource.create({
      data: { id, collectionId: collection.id, ...fields, revision: 1 },
    });
    await tx.appResourceRevision.create({
      data: {
        resourceId: id,
        revision: 1,
        ...fields,
        changedFields: [...RESOURCE_SNAPSHOT_FIELDS],
        origin: 'admin',
        editorId,
      },
    });
    return { id };
  });
}

/** Put the live resources of one kind in a new order. */
export async function reorderResources(
  kind: 'film' | 'reading',
  order: readonly { id: string; revision: number }[],
  editorId: string
): Promise<{ moved: number }> {
  return executeTransaction(async (tx) => {
    const rows = await tx.appResource.findMany({
      where: { kind, retired: false },
      orderBy: { position: 'asc' },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (
      order.length !== rows.length ||
      new Set(order.map((entry) => entry.id)).size !== rows.length
    ) {
      throw new ValidationError(`A new order must name every live ${kind} exactly once.`);
    }
    for (const entry of order) {
      const row = byId.get(entry.id);
      if (!row) throw new NotFoundError(`There is no live ${kind} "${entry.id}".`);
      if (row.revision !== entry.revision)
        throw revisionMoved(`"${row.title}"`, row.revision, entry.revision);
    }
    const target = new Map(order.map((entry, index) => [entry.id, index]));
    const moving = rows.filter((row) => target.get(row.id) !== row.position);
    for (const [index, row] of moving.entries()) {
      await tx.appResource.update({
        where: { id: row.id },
        data: { position: parkingPosition(index) },
      });
    }
    for (const row of moving) {
      const position = target.get(row.id)!;
      const revision = row.revision + 1;
      await tx.appResource.update({ where: { id: row.id }, data: { position, revision } });
      await tx.appResourceRevision.create({
        data: {
          resourceId: row.id,
          revision,
          ...resourceFieldsOf(row),
          position,
          changedFields: ['position'],
          origin: 'admin',
          editorId,
        },
      });
    }
    return { moved: moving.length };
  });
}

// ─── Words writes ───────────────────────────────────────────────────────────

async function writeWords(
  key: string,
  toNext: (before: WordsFields) => WordsFields,
  revisionRead: number,
  editorId: string
): Promise<ResourceWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await tx.appResourceWords.findUnique({ where: { key } });
    if (!row) throw new NotFoundError(`There are no words for "${key}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`The words for "${key}"`, row.revision, revisionRead);
    const before = wordsFieldsOf(row);
    const next = toNext(before);
    assertWords(key, next);
    const changed = wordsDiff(before, next);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };
    const revision = row.revision + 1;
    const { count } = await tx.appResourceWords.updateMany({
      where: { key, revision: revisionRead },
      data: { ...next, revision },
    });
    if (count === 0) throw revisionMoved(`The words for "${key}"`, revision, revisionRead);
    await tx.appResourceWordsRevision.create({
      data: { wordsKey: key, revision, ...next, changedFields: changed, origin: 'admin', editorId },
    });
    return { changed, changes: toChanges(before, next, changed), revision };
  });
}

export function updateWords(
  key: string,
  edit: WordsEdit,
  revisionRead: number,
  editorId: string
): Promise<ResourceWriteResult> {
  return writeWords(key, () => wordsFromEdit(edit), revisionRead, editorId);
}

export async function restoreWordsRevision(
  key: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<ResourceWriteResult> {
  const past = await prisma.appResourceWordsRevision.findUnique({
    where: { wordsKey_revision: { wordsKey: key, revision } },
  });
  if (!past) throw new NotFoundError(`The words for "${key}" have no revision ${revision}.`);
  return writeWords(key, () => wordsFieldsOf(past), revisionRead, editorId);
}

/** Give a key words of its own. */
export async function createWords(
  key: string,
  edit: WordsEdit,
  editorId: string
): Promise<{ key: string }> {
  return executeTransaction(async (tx) => {
    const collection = await tx.appResourceCollection.findFirst({ select: { id: true } });
    if (!collection) throw new NotFoundError('The resource library has not been seeded yet.');
    const fields = wordsFromEdit(edit);
    assertWords(key, fields);
    const clash = await tx.appResourceWords.findUnique({ where: { key }, select: { key: true } });
    if (clash)
      throw new ConflictError(`"${key}" already has words. Edit them instead.`, {
        reason: 'exists',
      });
    await tx.appResourceWords.create({
      data: { key, collectionId: collection.id, ...fields, revision: 1 },
    });
    await tx.appResourceWordsRevision.create({
      data: {
        wordsKey: key,
        revision: 1,
        ...fields,
        changedFields: [...WORDS_SNAPSHOT_FIELDS],
        origin: 'admin',
        editorId,
      },
    });
    return { key };
  });
}

/**
 * Remove a key's words, so it falls back to `default`'s. `default` itself cannot
 * be removed: every key without words of its own reads it.
 */
export async function deleteWords(
  key: string,
  revisionRead: number
): Promise<{ removed: WordsFields }> {
  if (key === 'default') {
    throw guardedRemoval(
      'The default words',
      ['every module and key without words of its own'],
      'Edit them instead.'
    );
  }
  return executeTransaction(async (tx) => {
    const row = await tx.appResourceWords.findUnique({ where: { key } });
    if (!row) throw new NotFoundError(`There are no words for "${key}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`The words for "${key}"`, row.revision, revisionRead);
    await tx.appResourceWords.delete({ where: { key } });
    return { removed: wordsFieldsOf(row) };
  });
}

/** Save the library's own fields, including its sign-off provenance. Locked on `updatedAt`. */
export async function updateResourceCollection(
  edit: ResourceCollectionEdit,
  updatedAtRead: string
): Promise<{ changed: string[]; changes: FieldChanges }> {
  return executeTransaction(async (tx) => {
    const collection = await tx.appResourceCollection.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!collection) throw new NotFoundError('The resource library has not been seeded yet.');
    if (collection.updatedAt.toISOString() !== updatedAtRead) throw staleRow('The library');
    const before = {
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
      provenance: provenanceSchema.parse(collection.provenance),
    };
    const changed = changedFieldsOf(before, edit, ['title', 'version', 'locale', 'provenance']);
    if (changed.length === 0) return { changed, changes: {} };
    const { count } = await tx.appResourceCollection.updateMany({
      where: { id: collection.id, updatedAt: collection.updatedAt },
      data: edit,
    });
    if (count === 0) throw staleRow('The library');
    return { changed, changes: toChanges(before, edit, changed) };
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

export function resourcesExportFilename(now: Date): string {
  return `lelanea-resources-${now.toISOString().slice(0, 10)}.json`;
}

/** The file schema, checked against the roster's modules and the stored documents. */
async function resourcesFileSchema() {
  const documents = await prisma.appFoundationalDocument.findMany({ select: { id: true } });
  return buildResourcesFileSchema({
    moduleIds: new Set(JOURNEY_MODULES.map((entry) => entry.id)),
    documentIds: new Set(documents.map((row) => row.id)),
  });
}

/** The live library as a resources file, checked with the seed's schema. Retired resources are not in it. */
export async function exportResourcesFile(): Promise<ResourcesFile> {
  const collection = await prisma.appResourceCollection.findFirst({ select: { id: true } });
  if (!collection) {
    throw new ConflictError(
      'There is nothing to export: the resource library has not been seeded.',
      {
        reason: 'nothing_to_export',
      }
    );
  }
  const parsed = (await resourcesFileSchema()).safeParse(
    resourcesFileFromLibrary(await getResourcesLibrary())
  );
  if (!parsed.success) {
    throw new ConflictError(
      `The stored library cannot be written as a file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
        .join('; ')}.`,
      { reason: 'unexportable' }
    );
  }
  return parsed.data;
}

// ─── Import ─────────────────────────────────────────────────────────────────

interface StoredResources {
  collection: {
    id: string;
    title: string;
    version: string;
    locale: string;
    provenance: unknown;
  } | null;
  resources: readonly AppResource[];
  words: readonly AppResourceWords[];
}

interface ResourcesImport {
  plan: ContentImportPlan;
  collectionChanged: string[];
  collectionAfter: {
    title: string;
    version: string;
    locale: string;
    provenance: ResourcesProvenance;
  };
  resources: KeyedPlan<ResourceFields>;
  words: KeyedPlan<WordsFields>;
}

/**
 * What a resources file would do. Pure. The file is the whole live library: a
 * live resource it omits is retired (never deleted), a retired one it names is
 * left retired, and a words key it omits is removed.
 */
export function planResourcesImport(file: ResourcesFile, stored: StoredResources): ResourcesImport {
  const seed = resourcesSeedFromFile(file);
  const refusals: string[] = [];
  if (!stored.collection)
    refusals.push('The resource library has not been seeded, so there is nothing to import into.');

  // A file naming a resource retired here leaves it retired (a file cannot say
  // "retired", so it cannot mean "bring it back"). It is taken out before the
  // live ones are numbered, so they stay contiguous and a fresh export of the
  // result re-imports with no position changes.
  const retiredHere = new Set(stored.resources.filter((row) => row.retired).map((row) => row.id));
  const namedRetired = seed.resources.filter((row) => retiredHere.has(row.id)).map((row) => row.id);
  const liveIncoming = (['film', 'reading'] as const).flatMap((kind) =>
    seed.resources
      .filter((row) => row.kind === kind && !retiredHere.has(row.id))
      .map((row, position) => ({ ...row, position }))
  );

  // Retired rows park below zero, one below another, in the order they retire.
  let retiredBelow = Math.min(0, ...stored.resources.map((row) => row.position));
  const resources = planKeyedImport<Omit<ResourceRow, 'revision'>, ResourceFields>({
    incoming: liveIncoming.map((row) => ({ key: row.id, value: row })),
    stored: stored.resources.map((row) => ({
      key: row.id,
      fields: resourceFieldsOf(row),
      revision: row.revision,
      retired: row.retired,
    })),
    diff: resourceDiff,
    allFields: RESOURCE_SNAPSHOT_FIELDS,
    toCreate: (row) => resourceFieldsOf({ ...row, retired: false }),
    toUpdate: (_before, row) => resourceFieldsOf({ ...row, retired: false }),
    onAbsent: (before) => ({ ...before, retired: true, position: --retiredBelow }),
  });
  resources.skippedRetired.push(...namedRetired);
  for (const change of resources.updates) {
    if (change.before && change.after && change.before.kind !== change.after.kind) {
      refusals.push(
        `"${change.key}" is a ${change.before.kind} here and a ${change.after.kind} in the file. Give the new one its own id.`
      );
    }
  }

  const words = planKeyedImport<Omit<ResourceWordsRow, 'revision'>, WordsFields>({
    incoming: seed.words.map((row) => ({ key: row.key, value: row })),
    stored: stored.words.map((row) => ({
      key: row.key,
      fields: wordsFieldsOf(row),
      revision: row.revision,
    })),
    diff: wordsDiff,
    allFields: WORDS_SNAPSHOT_FIELDS,
    toCreate: (row) => wordsFieldsOf(row),
    toUpdate: (_before, row) => wordsFieldsOf(row),
    onAbsent: () => null,
  });

  const collectionAfter = {
    title: seed.collection.title,
    version: seed.collection.version,
    locale: seed.collection.locale,
    provenance: provenanceSchema.parse(seed.collection.provenance),
  };
  const collectionChanged = stored.collection
    ? changedFieldsOf(
        {
          title: stored.collection.title,
          version: stored.collection.version,
          locale: stored.collection.locale,
          provenance: provenanceSchema.parse(stored.collection.provenance),
        },
        collectionAfter,
        ['title', 'version', 'locale', 'provenance']
      )
    : [];

  const sections = [
    toPlanSection('resource', 'Films and readings', resources, 'retire'),
    toPlanSection('words', 'Her words', words, 'delete'),
  ];
  if (collectionChanged.length > 0 && stored.collection) {
    sections.unshift({
      entity: 'collection',
      label: 'Library',
      creates: [],
      updates: [{ key: stored.collection.id, changedFields: collectionChanged }],
      removals: [],
      removalKind: 'delete',
      unchanged: [],
      skippedRetired: [],
    });
  }
  return {
    plan: {
      collection: 'resources',
      sections,
      refusals,
      writesNothing: sectionsWriteNothing(sections),
    },
    collectionChanged,
    collectionAfter,
    resources,
    words,
  };
}

async function readStored(
  client: Pick<typeof prisma, 'appResourceCollection' | 'appResource' | 'appResourceWords'>
): Promise<StoredResources> {
  const [collection, resources, words] = await Promise.all([
    client.appResourceCollection.findFirst({ orderBy: { createdAt: 'asc' } }),
    client.appResource.findMany({ orderBy: [{ kind: 'asc' }, { position: 'asc' }] }),
    client.appResourceWords.findMany({ orderBy: { key: 'asc' } }),
  ]);
  return { collection, resources, words };
}

async function parseResourcesFile(raw: unknown): Promise<ResourcesFile> {
  return parseContentFile(await resourcesFileSchema(), raw, 'resources');
}

export async function previewResourcesImport(raw: unknown): Promise<ContentImportPlan> {
  return planResourcesImport(await parseResourcesFile(raw), await readStored(prisma)).plan;
}

/** Apply a resources file. Re-planned in the transaction; idempotent. */
export async function applyResourcesImport(
  raw: unknown,
  editorId: string
): Promise<ContentImportPlan> {
  const file = await parseResourcesFile(raw);
  return executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planResourcesImport(file, stored);
      if (planned.plan.refusals.length > 0) throw importRefused('resources', planned.plan.refusals);
      if (planned.plan.writesNothing) return planned.plan;
      const collectionId = stored.collection!.id;

      if (planned.collectionChanged.length > 0) {
        await tx.appResourceCollection.update({
          where: { id: collectionId },
          data: planned.collectionAfter,
        });
      }

      // Park everything that moves before anything lands: retirements to
      // their place below zero, moving updates out of the way.
      for (const change of planned.resources.removals) {
        await tx.appResource.update({
          where: { id: change.key },
          data: { position: change.after!.position },
        });
      }
      const moving = planned.resources.updates.filter((change) =>
        change.changedFields.includes('position')
      );
      for (const [index, change] of moving.entries()) {
        await tx.appResource.update({
          where: { id: change.key },
          data: { position: parkingPosition(index) },
        });
      }
      for (const change of planned.resources.creates) {
        await tx.appResource.create({
          data: { id: change.key, collectionId, ...change.after!, revision: 1 },
        });
      }
      for (const change of [...planned.resources.updates, ...planned.resources.removals]) {
        await tx.appResource.update({
          where: { id: change.key },
          data: { ...change.after!, revision: change.revision },
        });
      }
      for (const change of [
        ...planned.resources.creates,
        ...planned.resources.updates,
        ...planned.resources.removals,
      ]) {
        await tx.appResourceRevision.create({
          data: {
            resourceId: change.key,
            revision: change.revision,
            ...change.after!,
            changedFields: change.changedFields,
            origin: 'admin',
            editorId,
          },
        });
      }

      for (const change of planned.words.removals) {
        await tx.appResourceWords.delete({ where: { key: change.key } });
      }
      for (const change of planned.words.creates) {
        await tx.appResourceWords.create({
          data: { key: change.key, collectionId, ...change.after!, revision: 1 },
        });
      }
      for (const change of planned.words.updates) {
        await tx.appResourceWords.update({
          where: { key: change.key },
          data: { ...change.after!, revision: change.revision },
        });
      }
      for (const change of [...planned.words.creates, ...planned.words.updates]) {
        await tx.appResourceWordsRevision.create({
          data: {
            wordsKey: change.key,
            revision: change.revision,
            ...change.after!,
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
}
