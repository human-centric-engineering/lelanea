/**
 * Her foundational documents, edited in the admin (f-content-seeds t-91).
 *
 * The other writer to `app_foundational_document` besides the seed. Every write
 * here ends in `syncKnowledgeMirror()` (`lib/app/content/document-store.ts`), so
 * an edit reaches the agent's knowledge base as well as every page and client.
 * The pages and the public API read the rows per request with no cache, and the
 * API's ETag is computed over the record including `revision`, so an edit is
 * what the next request of every client sees.
 *
 * ## Three rules the editor enforces rather than leaves to care
 *
 * - **A document is never deleted while something reads it.** Every one of the
 *   seven is rendered by id somewhere (`DOCUMENT_READERS`), and a surface that
 *   cannot find its document throws at render. So delete is refused with the
 *   readers named, and the editor says so beside the button rather than failing
 *   on save.
 * - **A section key code selects by cannot be removed or renamed here.** A
 *   surface asks for it by a name written in code (`SECTION_READERS`), and a
 *   missing key throws `MissingSectionError` at render. Renaming one is a code
 *   change to the named reader in the same PR, so the editor refuses it and
 *   names the reader. Every other key is free to add, rename or remove.
 * - **Changing the words of a document people must agree to asks them to agree
 *   again.** The gate requires an acknowledgement of exactly the document's
 *   `version` (`lib/app/gateway/acknowledgements.ts`). A save that changes the
 *   title, subtitle or blocks of a document with `requiresAcknowledgement`, and
 *   leaves the version alone, mints the next one (`1.1` → `1.2`), and every
 *   member is gated again. The editor says so before the save. An admin who
 *   types a version of their own gets that one instead. `requiresAcknowledgement`
 *   itself is not editable: which documents gate is `DOCUMENT_FOR_KIND`, in code.
 *
 * ## The import mints nothing
 *
 * A file that changes an acknowledged document's words must carry a new version
 * for it, or the import is refused. Minting on import would not be idempotent: a
 * second apply of the same file would find the text equal, the stored version
 * newer than the file's, and plan the version back.
 *
 * @see lib/app/content/admin/shared.ts — the lock, and why it is on `revision`
 * @see lib/app/content/content-files.ts — the file shape the export writes
 */

import type { AppFoundationalDocument, AppFoundationalDocumentRevision } from '@prisma/client';

import { z } from 'zod';

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import {
  foundationalDocumentsFileSchema,
  storedDocumentBlocksSchema,
  type FoundationalDocumentsFile,
  type StoredDocumentBlock,
} from '@/lib/app/content/schemas';
import {
  toDocumentDetail,
  type ContentCollectionMeta,
  type DocumentSeed,
  type FoundationalDocumentDetail,
} from '@/lib/app/content/document-view';
import { DOCUMENT_SNAPSHOT_FIELDS, syncKnowledgeMirror } from '@/lib/app/content/document-store';
import {
  foundationalFileFromRows,
  foundationalSeedFromFile,
} from '@/lib/app/content/content-files';
import {
  changedFieldsOf,
  planKeyedImport,
  type KeyedPlan,
} from '@/lib/app/content/admin/keyed-import';
import {
  DOCUMENT_READERS,
  sectionReadersOf,
  type SectionReader,
} from '@/lib/app/content/admin/readers';
import {
  type ContentImportPlan,
  guardedRemoval,
  IMPORT_TX_TIMEOUT_MS,
  importRefused,
  nextAcknowledgementVersion,
  parkingPosition,
  parseContentFile,
  type RevisionEntry,
  revisionMoved,
  revisionMovedNow,
  sectionsWriteNothing,
  staleRow,
  toChanges,
  toHistory,
  toPlanSection,
  type Tx,
} from '@/lib/app/content/admin/shared';
import type { DocumentEdit, DocumentCollectionEdit } from '@/lib/app/content/admin/validation';

const categorySchema = z.enum(['onboarding', 'about', 'legal']);

/** A bulk apply writes a handful of rows; generous against a slow database. */

// ─── Shapes ─────────────────────────────────────────────────────────────────

/** Every field a revision snapshots: the seed's write, whole. */
export type DocumentFields = Omit<DocumentSeed, 'id'>;
type DocumentField = (typeof DOCUMENT_SNAPSHOT_FIELDS)[number];

/** One document as the editor reads it. */
export interface DocumentAdminRow extends FoundationalDocumentDetail {
  position: number;
  /** Who renders it by id. Non-empty means it cannot be deleted. */
  readers: readonly string[];
  /** The section keys code selects by in this document, which the editor locks. */
  lockedSections: readonly SectionReader[];
}

export interface DocumentsAdminView {
  /** False before the seed has run. */
  seeded: boolean;
  collection: (ContentCollectionMeta & { updatedAt: string }) | null;
  documents: DocumentAdminRow[];
}

/** What one write changed, as the audit log records it. */
export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

export interface DocumentWriteResult {
  document: DocumentAdminRow;
  changed: DocumentField[];
  changes: FieldChanges;
  /** The new acknowledgement version this save minted, or null. */
  mintedVersion: string | null;
}

// ─── Row helpers ────────────────────────────────────────────────────────────

function fieldsOf(row: AppFoundationalDocument): DocumentFields {
  const detail = toDocumentDetail(row);
  return {
    position: row.position,
    title: detail.title,
    subtitle: detail.subtitle,
    category: detail.category,
    surface: detail.surface,
    requiresAcknowledgement: detail.requiresAcknowledgement,
    placeholders: [...detail.placeholders],
    renderStyle: detail.renderStyle,
    renderNote: detail.renderNote,
    blocks: detail.blocks.map((block) => ({ ...block })),
    version: detail.version,
    locale: detail.locale,
  };
}

function toAdminRow(row: AppFoundationalDocument): DocumentAdminRow {
  return {
    ...toDocumentDetail(row),
    position: row.position,
    readers: DOCUMENT_READERS[row.id] ?? [],
    lockedSections: sectionReadersOf(row.id),
  };
}

function diff(before: DocumentFields, after: DocumentFields): DocumentField[] {
  return changedFieldsOf(before, after, DOCUMENT_SNAPSHOT_FIELDS);
}

/** The fields a change to which asks people to agree again. */
const AGREED_TEXT_FIELDS: readonly DocumentField[] = ['title', 'subtitle', 'blocks'];

function textChanged(before: DocumentFields, after: DocumentFields): boolean {
  return diff(before, after).some((field) => AGREED_TEXT_FIELDS.includes(field));
}

function notFound(id: string): NotFoundError {
  return new NotFoundError(`There is no foundational document "${id}".`);
}

/**
 * Why these blocks would break a surface, or null. Checks every key code
 * selects by in this document is still present, and still has a heading where
 * the reader needs one.
 */
export function brokenSections(
  documentId: string,
  blocks: readonly StoredDocumentBlock[]
): string | null {
  const problems = sectionReadersOf(documentId).flatMap((entry) => {
    const inSection = blocks.filter((block) => block.section === entry.section);
    if (inSection.length === 0) {
      return [
        `section "${entry.section}" is gone, and ${entry.readers.join(', ')} select${entry.readers.length === 1 ? 's' : ''} it by that name`,
      ];
    }
    if (entry.needsHeading && !inSection.some((block) => block.type === 'heading')) {
      return [
        `section "${entry.section}" lost its heading, which ${entry.readers.join(', ')} shows`,
      ];
    }
    return [];
  });
  return problems.length === 0
    ? null
    : `In "${documentId}", ${problems.join('; ')}. Keep those keys on the blocks you want those surfaces to show; renaming one needs the code that reads it to change in the same release.`;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getDocumentsAdminView(): Promise<DocumentsAdminView> {
  const [collection, rows] = await Promise.all([
    prisma.appDocumentCollection.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.appFoundationalDocument.findMany({ orderBy: { position: 'asc' } }),
  ]);
  return {
    seeded: collection !== null,
    collection: collection && {
      id: collection.id,
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
      updatedAt: collection.updatedAt.toISOString(),
    },
    documents: rows.map(toAdminRow),
  };
}

function snapshotOf(row: AppFoundationalDocumentRevision): DocumentFields {
  return {
    position: row.position,
    title: row.title,
    subtitle: row.subtitle,
    category: categorySchema.parse(row.category),
    surface: row.surface,
    requiresAcknowledgement: row.requiresAcknowledgement,
    placeholders: row.placeholders,
    renderStyle: row.renderStyle,
    renderNote: row.renderNote,
    blocks: storedDocumentBlocksSchema.parse(row.blocks),
    version: row.version,
    locale: row.locale,
  };
}

/** Every revision of one document, newest first. */
export async function listDocumentHistory(id: string): Promise<RevisionEntry<DocumentFields>[]> {
  const [document, revisions] = await Promise.all([
    prisma.appFoundationalDocument.findUnique({ where: { id }, select: { id: true } }),
    prisma.appFoundationalDocumentRevision.findMany({
      where: { documentId: id },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!document) throw notFound(id);
  return toHistory(revisions, snapshotOf);
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * Write one document's next state, if it differs, as a row update plus a
 * revision, atomically and only while the revision is the one that was read.
 * Every single-document write goes through here.
 */
async function writeDocument(
  id: string,
  toNext: (before: DocumentFields) => DocumentFields,
  revisionRead: number,
  editorId: string
): Promise<DocumentWriteResult> {
  const result = await executeTransaction(async (tx) => {
    const row = await tx.appFoundationalDocument.findUnique({ where: { id } });
    if (!row) throw notFound(id);
    if (row.revision !== revisionRead)
      throw revisionMoved(`"${row.title}"`, row.revision, revisionRead);

    const before = fieldsOf(row);
    let next = toNext(before);

    const broken = brokenSections(id, next.blocks);
    if (broken) throw new ConflictError(broken, { reason: 'section_in_use' });

    let mintedVersion: string | null = null;
    if (
      before.requiresAcknowledgement &&
      next.version === before.version &&
      textChanged(before, next)
    ) {
      mintedVersion = nextAcknowledgementVersion(before.version);
      next = { ...next, version: mintedVersion };
    }

    const changed = diff(before, next);
    if (changed.length === 0) {
      return { document: toAdminRow(row), changed, changes: {}, mintedVersion: null };
    }

    const revision = row.revision + 1;
    const { count } = await tx.appFoundationalDocument.updateMany({
      where: { id, revision: revisionRead },
      data: { ...next, revision },
    });
    if (count === 0)
      throw await revisionMovedNow(
        `"${row.title}"`,
        revisionRead,
        tx.appFoundationalDocument.findUnique({ where: { id }, select: { revision: true } })
      );
    await tx.appFoundationalDocumentRevision.create({
      data: {
        documentId: id,
        revision,
        ...next,
        changedFields: changed,
        origin: 'admin',
        editorId,
      },
    });
    const saved = await tx.appFoundationalDocument.findUniqueOrThrow({ where: { id } });
    return {
      document: toAdminRow(saved),
      changed,
      changes: toChanges(before, next, changed),
      mintedVersion,
    };
  });

  if (result.changed.length > 0) await syncKnowledgeMirror();
  return result;
}

/**
 * Save an edit to one document.
 *
 * `blocks` is validated with the stored-blocks schema (contiguous sections,
 * the block shapes), and the keys code selects by must survive. See the file
 * header for the acknowledgement rule.
 */
export function updateDocument(
  id: string,
  edit: DocumentEdit,
  revisionRead: number,
  editorId: string
): Promise<DocumentWriteResult> {
  const blocks = storedDocumentBlocksSchema.safeParse(edit.blocks);
  if (!blocks.success) {
    throw new ValidationError('Those blocks are not a valid document', {
      errors: blocks.error.issues.map((issue) => ({
        path: ['blocks', ...issue.path].join('.'),
        message: issue.message,
      })),
    });
  }
  return writeDocument(
    id,
    (before) => ({ ...before, ...edit, blocks: blocks.data }),
    revisionRead,
    editorId
  );
}

/**
 * Put one document back to how it stood at an earlier revision, as a new
 * revision. Never a rewind: the history keeps every step, including this one.
 *
 * Its reading position stays where it is now, because moving one document
 * would collide with whichever holds that place today; reordering is its own
 * act. For a document people agree to, the version is not put back either: the
 * words change, so the acknowledgement rule mints the next one, and nobody who
 * agreed to the later words is counted as having agreed to these.
 */
export async function restoreDocumentRevision(
  id: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<DocumentWriteResult> {
  const past = await prisma.appFoundationalDocumentRevision.findUnique({
    where: { documentId_revision: { documentId: id, revision } },
  });
  if (!past) throw new NotFoundError(`"${id}" has no revision ${revision}.`);
  const snapshot = snapshotOf(past);

  return writeDocument(
    id,
    (before) => ({
      ...snapshot,
      position: before.position,
      requiresAcknowledgement: before.requiresAcknowledgement,
      version: before.requiresAcknowledgement ? before.version : snapshot.version,
      locale: before.locale,
    }),
    revisionRead,
    editorId
  );
}

/**
 * Delete one document, at the revision read. Refused for every document a
 * surface renders, which today is all seven, for one a resource opens in the
 * app, and for one a key's words cite as their source (`sourceId` holds no
 * foreign key, so nothing else would stop it — and words citing a missing
 * document leave the library unable to export, import or save them).
 */
export async function deleteDocument(
  id: string,
  revisionRead: number,
  editorId: string
): Promise<void> {
  const readers = DOCUMENT_READERS[id] ?? [];
  if (readers.length > 0) {
    throw guardedRemoval(
      `"${id}"`,
      readers,
      'A document a surface renders can be edited, never deleted.'
    );
  }

  await executeTransaction(async (tx) => {
    const row = await tx.appFoundationalDocument.findUnique({ where: { id } });
    if (!row) throw notFound(id);
    if (row.revision !== revisionRead)
      throw revisionMoved(`"${row.title}"`, row.revision, revisionRead);
    const opening = await tx.appResource.findMany({
      where: { documentId: id },
      select: { id: true },
    });
    if (opening.length > 0) {
      throw guardedRemoval(
        `"${id}"`,
        opening.map((resource) => `the resource "${resource.id}"`),
        'Point those articles elsewhere first.'
      );
    }
    const citing = await tx.appResourceWords.findMany({
      where: { sourceCollection: WORDS_DOCUMENT_SOURCE, sourceId: id },
      select: { key: true },
    });
    if (citing.length > 0) {
      throw guardedRemoval(
        `"${id}"`,
        citing.map((words) => `the words for "${words.key}"`),
        'Cite another document in those words first.'
      );
    }
    await tx.appFoundationalDocument.delete({ where: { id } });
    // Keep reading positions contiguous: an export numbers from its list.
    const rest = await tx.appFoundationalDocument.findMany({ orderBy: { position: 'asc' } });
    await applyPositions(tx, rest, new Map(rest.map((doc, index) => [doc.id, index])), editorId);
  });
  await syncKnowledgeMirror();
}

/**
 * Move documents to new reading positions, parking first so no two share a
 * place mid-move, and record each move as a revision.
 */
async function applyPositions(
  tx: Tx,
  rows: readonly AppFoundationalDocument[],
  positions: ReadonlyMap<string, number>,
  editorId: string
): Promise<number> {
  const moving = rows.filter((row) => positions.get(row.id) !== row.position);
  for (const [index, row] of moving.entries()) {
    await tx.appFoundationalDocument.update({
      where: { id: row.id },
      data: { position: parkingPosition(index) },
    });
  }
  for (const row of moving) {
    const position = positions.get(row.id)!;
    const revision = row.revision + 1;
    await tx.appFoundationalDocument.update({
      where: { id: row.id },
      data: { position, revision },
    });
    await tx.appFoundationalDocumentRevision.create({
      data: {
        documentId: row.id,
        revision,
        ...fieldsOf(row),
        position,
        changedFields: ['position'],
        origin: 'admin',
        editorId,
      },
    });
  }
  return moving.length;
}

/**
 * Put the documents in a new reading order. `order` names every document once,
 * each with the revision the admin read, so a reorder against a list someone
 * else has since changed is refused rather than applied to the wrong rows.
 */
export async function reorderDocuments(
  order: readonly { id: string; revision: number }[],
  editorId: string
): Promise<{ moved: number }> {
  return executeTransaction(async (tx) => {
    const rows = await tx.appFoundationalDocument.findMany({ orderBy: { position: 'asc' } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (
      order.length !== rows.length ||
      new Set(order.map((entry) => entry.id)).size !== rows.length
    ) {
      throw new ValidationError('A new order must name every document exactly once.');
    }
    for (const entry of order) {
      const row = byId.get(entry.id);
      if (!row) throw notFound(entry.id);
      if (row.revision !== entry.revision)
        throw revisionMoved(`"${row.title}"`, row.revision, entry.revision);
    }
    const moved = await applyPositions(
      tx,
      rows,
      new Map(order.map((entry, index) => [entry.id, index])),
      editorId
    );
    return { moved };
  });
}

/**
 * Save the collection's own fields: its title, its version label and its
 * locale. A new locale is written to every document too, because a document's
 * locale is always the collection's (the file has one).
 */
export async function updateDocumentCollection(
  edit: DocumentCollectionEdit,
  updatedAtRead: string,
  editorId: string
): Promise<{ changed: string[]; changes: FieldChanges }> {
  const result = await executeTransaction(async (tx) => {
    const collection = await tx.appDocumentCollection.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!collection) throw new NotFoundError('The documents have not been seeded yet.');
    if (collection.updatedAt.toISOString() !== updatedAtRead) throw staleRow('The collection');

    const before = {
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
    };
    const changed = changedFieldsOf(before, edit, ['title', 'version', 'locale']);
    if (changed.length === 0) return { changed, changes: {} };

    const { count } = await tx.appDocumentCollection.updateMany({
      where: { id: collection.id, updatedAt: collection.updatedAt },
      data: edit,
    });
    if (count === 0) throw staleRow('The collection');

    if (changed.includes('locale')) {
      const documents = await tx.appFoundationalDocument.findMany({ orderBy: { position: 'asc' } });
      for (const row of documents.filter((doc) => doc.locale !== edit.locale)) {
        const revision = row.revision + 1;
        await tx.appFoundationalDocument.update({
          where: { id: row.id },
          data: { locale: edit.locale, revision },
        });
        await tx.appFoundationalDocumentRevision.create({
          data: {
            documentId: row.id,
            revision,
            ...fieldsOf(row),
            locale: edit.locale,
            changedFields: ['locale'],
            origin: 'admin',
            editorId,
          },
        });
      }
    }
    return {
      changed,
      changes: Object.fromEntries(
        changed.map((field) => [field, { from: before[field], to: edit[field] }])
      ),
    };
  });
  if (result.changed.includes('locale')) await syncKnowledgeMirror();
  return result;
}

// ─── Export ─────────────────────────────────────────────────────────────────

/** `lelanea-foundational-documents-2026-09-23.json` */
export function documentsExportFilename(now: Date): string {
  return `lelanea-foundational-documents-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * The stored documents as a documents file, in the shape the seed reads.
 *
 * Parsed with the seed's own schema before it is returned, so an export that
 * could not be imported, or seeded, is a throw here rather than a file that
 * fails at the other end.
 */
export async function exportDocumentsFile(): Promise<FoundationalDocumentsFile> {
  const { collection, documents } = await getDocumentsAdminView();
  if (!collection) {
    throw new ConflictError('There is nothing to export: the documents have not been seeded.', {
      reason: 'nothing_to_export',
    });
  }
  const file = foundationalFileFromRows(collection, documents);
  const parsed = foundationalDocumentsFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new ConflictError(
      `The stored documents cannot be written as a file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
        .join('; ')}.`,
      { reason: 'unexportable' }
    );
  }
  return parsed.data;
}

// ─── Import ─────────────────────────────────────────────────────────────────

/** The `sourceCollection` of words that cite one of these documents. */
const WORDS_DOCUMENT_SOURCE = 'foundational_documents';

interface StoredDocuments {
  collection: { id: string; title: string; version: string; locale: string } | null;
  rows: readonly AppFoundationalDocument[];
  /** Every resource that opens a document, retired ones included: each holds its document. */
  openedBy: readonly { id: string; documentId: string }[];
  /** Every key whose words cite a foundational document as their source. */
  citedBy: readonly { key: string; documentId: string }[];
}

interface DocumentsImport {
  plan: ContentImportPlan;
  documents: KeyedPlan<DocumentFields>;
  collection: { id: string; title: string; version: string; locale: string } | null;
  collectionChanged: string[];
}

/**
 * What a documents file would do to these rows. Pure: the preview returns it,
 * and apply computes it again inside its transaction.
 *
 * The file is the whole collection, so a stored document it omits is a
 * deletion, which is refused for any document a surface renders. Section keys
 * and acknowledgement versions are checked as the editor checks them; see the
 * file header.
 */
export function planDocumentsImport(
  file: FoundationalDocumentsFile,
  stored: StoredDocuments
): DocumentsImport {
  const seed = foundationalSeedFromFile(file);
  const refusals: string[] = [];

  if (!stored.collection) {
    refusals.push(
      'The documents have not been seeded, so there is nothing to import into. Run the seed first.'
    );
  } else if (stored.collection.id !== seed.collection.id) {
    refusals.push(
      `This file is for the collection "${seed.collection.id}", and this database holds "${stored.collection.id}".`
    );
  }

  const collectionAfter = {
    title: seed.collection.title,
    version: seed.collection.version,
    locale: seed.collection.locale,
  };
  const collectionChanged = stored.collection
    ? changedFieldsOf(stored.collection, { ...stored.collection, ...collectionAfter }, [
        'title',
        'version',
        'locale',
      ])
    : [];

  const documents = planKeyedImport<DocumentSeed, DocumentFields>({
    incoming: seed.documents.map((document) => ({ key: document.id, value: document })),
    stored: stored.rows.map((row) => ({
      key: row.id,
      fields: fieldsOf(row),
      revision: row.revision,
    })),
    diff,
    allFields: DOCUMENT_SNAPSHOT_FIELDS,
    toCreate: ({ id: _id, ...fields }) => fields,
    toUpdate: (_before, { id: _id, ...fields }) => fields,
    onAbsent: () => null,
  });

  for (const change of documents.creates) {
    if (change.after?.requiresAcknowledgement) {
      refusals.push(
        `"${change.key}" is new and asks to be acknowledged, but which documents the gate asks people to agree to is fixed in code. Import it without "requiresAcknowledgement".`
      );
    }
    const broken = change.after && brokenSections(change.key, change.after.blocks);
    if (broken) refusals.push(broken);
  }
  for (const change of documents.updates) {
    const before = change.before!;
    const after = change.after!;
    const broken = brokenSections(change.key, after.blocks);
    if (broken) refusals.push(broken);
    if (before.requiresAcknowledgement !== after.requiresAcknowledgement) {
      refusals.push(
        `"${change.key}" changes whether it must be acknowledged, which is fixed in code, not in the file.`
      );
    }
    if (
      before.requiresAcknowledgement &&
      after.version === before.version &&
      textChanged(before, after)
    ) {
      refusals.push(
        `"${change.key}" changes words people have agreed to without a new version. Set its "version" to "${nextAcknowledgementVersion(before.version)}" (or any label not used before), and everyone will be asked to agree again.`
      );
    }
  }
  for (const change of documents.removals) {
    const readers = DOCUMENT_READERS[change.key] ?? [];
    if (readers.length > 0) {
      refusals.push(
        `"${change.key}" is missing from the file, and ${readers.join(', ')} render it, so it cannot be deleted.`
      );
    }
    const opening = stored.openedBy.filter((resource) => resource.documentId === change.key);
    if (opening.length > 0) {
      refusals.push(
        `"${change.key}" is missing from the file, and ${opening.map((resource) => `the resource "${resource.id}"`).join(', ')} open it, so it cannot be deleted. Point those articles elsewhere first.`
      );
    }
    const citing = stored.citedBy.filter((words) => words.documentId === change.key);
    if (citing.length > 0) {
      refusals.push(
        `"${change.key}" is missing from the file, and ${citing.map((words) => `the words for "${words.key}"`).join(', ')} cite it, so it cannot be deleted. Cite another document in those words first.`
      );
    }
  }

  const sections = [toPlanSection('document', 'Documents', documents, 'delete')];
  const writesCollection = collectionChanged.length > 0;
  if (writesCollection) {
    sections.unshift({
      entity: 'collection',
      label: 'Collection',
      creates: [],
      updates: [{ key: stored.collection!.id, changedFields: collectionChanged }],
      removals: [],
      removalKind: 'delete',
      unchanged: [],
      skippedRetired: [],
    });
  }

  return {
    plan: {
      collection: 'documents',
      sections,
      refusals,
      writesNothing: sectionsWriteNothing(sections),
    },
    documents,
    collection: stored.collection && { id: stored.collection.id, ...collectionAfter },
    collectionChanged,
  };
}

async function readStored(
  client: Pick<
    typeof prisma,
    'appDocumentCollection' | 'appFoundationalDocument' | 'appResource' | 'appResourceWords'
  >
): Promise<StoredDocuments> {
  const [collection, rows, resources, words] = await Promise.all([
    client.appDocumentCollection.findFirst({ orderBy: { createdAt: 'asc' } }),
    client.appFoundationalDocument.findMany({ orderBy: { position: 'asc' } }),
    client.appResource.findMany({ select: { id: true, documentId: true } }),
    client.appResourceWords.findMany({
      where: { sourceCollection: WORDS_DOCUMENT_SOURCE },
      select: { key: true, sourceId: true },
    }),
  ]);
  return {
    collection: collection && {
      id: collection.id,
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
    },
    rows,
    openedBy: resources.flatMap(({ id, documentId }) => (documentId ? [{ id, documentId }] : [])),
    citedBy: words.map(({ key, sourceId }) => ({ key, documentId: sourceId })),
  };
}

function parseDocumentsFile(raw: unknown): FoundationalDocumentsFile {
  return parseContentFile(foundationalDocumentsFileSchema, raw, 'foundational documents');
}

/** What a documents file would do, without doing it. */
export async function previewDocumentsImport(raw: unknown): Promise<ContentImportPlan> {
  return planDocumentsImport(parseDocumentsFile(raw), await readStored(prisma)).plan;
}

/**
 * Apply a documents file. Re-plans inside the transaction against the rows as
 * they stand, refuses if that plan carries refusals, and returns the plan that
 * ran. Idempotent: a second apply of the same file plans nothing.
 */
export async function applyDocumentsImport(
  raw: unknown,
  editorId: string
): Promise<ContentImportPlan> {
  const file = parseDocumentsFile(raw);

  const plan = await executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planDocumentsImport(file, stored);
      if (planned.plan.refusals.length > 0) throw importRefused('documents', planned.plan.refusals);
      if (planned.plan.writesNothing) return planned.plan;

      if (planned.collectionChanged.length > 0 && planned.collection) {
        const { id, ...fields } = planned.collection;
        await tx.appDocumentCollection.update({ where: { id }, data: fields });
      }

      for (const change of planned.documents.removals) {
        await tx.appFoundationalDocument.delete({ where: { id: change.key } });
      }

      // Park every document whose position changes before any lands, so a
      // create or a move never meets a place still held.
      const moving = planned.documents.updates.filter((change) =>
        change.changedFields.includes('position')
      );
      for (const [index, change] of moving.entries()) {
        await tx.appFoundationalDocument.update({
          where: { id: change.key },
          data: { position: parkingPosition(index) },
        });
      }

      const collectionId = stored.collection!.id;
      for (const change of planned.documents.creates) {
        await tx.appFoundationalDocument.create({
          data: { id: change.key, collectionId, ...change.after!, revision: 1 },
        });
      }
      for (const change of planned.documents.updates) {
        await tx.appFoundationalDocument.update({
          where: { id: change.key },
          data: { ...change.after!, revision: change.revision },
        });
      }

      const written = [...planned.documents.creates, ...planned.documents.updates];
      for (const change of written) {
        await tx.appFoundationalDocumentRevision.create({
          data: {
            documentId: change.key,
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

  if (!plan.writesNothing) await syncKnowledgeMirror();
  return plan;
}
