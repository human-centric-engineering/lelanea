/**
 * What the four content editors share (f-content-seeds t-91): the stale-form
 * refusal, the history's editor lookup, the ordering write, the import plan's
 * shape, and the capped import body.
 *
 * ## The lock
 *
 * Every row with a `revision` is saved against the revision the admin read,
 * checked before the write and again inside it (a conditional `updateMany`), so
 * a save racing another between the two is refused too. The shape is the slot
 * editor's (`lib/app/slots/definitions-admin.ts`), and its reason transfers
 * whole: `revision` is the number a revision row records, so a lost update would
 * leave the history claiming a revision whose words nothing stored ever had.
 * Here it also serialises the saves that feed the knowledge mirror, which the
 * t-90 review declined to lock (see `syncKnowledgeMirror` in
 * `lib/app/content/document-store.ts`).
 *
 * The three collection rows (the documents' collection, the journey, the
 * resource library) have no revision chain. They are locked on `updatedAt`
 * instead: the same refusal, without a history to protect.
 */

import { z } from 'zod';
import type { NextRequest } from 'next/server';

import { APIError, ConflictError, ErrorCodes, ValidationError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import type { KeyedChange, KeyedPlan } from '@/lib/app/content/admin/keyed-import';

// ─── Refusals ───────────────────────────────────────────────────────────────

/** The stale-form refusal. `reason` is what a client branches on. */
export function revisionMoved(what: string, current: number, read: number): ConflictError {
  return new ConflictError(
    `${what} was changed by someone else since you opened it (revision ${read}, now ${current}). Reload and read it again before saving.`,
    { reason: 'revision_moved', currentRevision: current }
  );
}

/** The same refusal for a row locked on `updatedAt`. */
export function staleRow(what: string): ConflictError {
  return new ConflictError(
    `${what} was changed by someone else since you opened it. Reload and read it again before saving.`,
    { reason: 'revision_moved' }
  );
}

/**
 * A removal refused because something reads the thing. The readers are named,
 * because "cannot delete" with no reason sends the admin looking for a bug.
 */
export function guardedRemoval(
  what: string,
  readers: readonly string[],
  remedy: string
): ConflictError {
  return new ConflictError(`${what} cannot be removed: ${readers.join('; ')} read it. ${remedy}`, {
    reason: 'has_readers',
    readers,
  });
}

// ─── History ────────────────────────────────────────────────────────────────

/** One past revision, whole. */
export interface RevisionEntry<S> {
  revision: number;
  snapshot: S;
  changedFields: string[];
  /** `seed` | `admin`. What tells the seed apart from an erased admin. */
  origin: string;
  editorId: string | null;
  editorEmail: string | null;
  changedAt: Date;
}

/**
 * Resolve editor ids to emails. `editorId` is a plain scalar with no Prisma
 * relation (a fork table must not add a reverse field to Sunrise's `User`), so
 * this is a second query rather than a join. Null for the seed, and for an
 * admin whose account has since been erased.
 */
export async function editorEmails(
  editorIds: readonly (string | null)[]
): Promise<Map<string, string>> {
  const ids = [...new Set(editorIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user.email]));
}

/** Revision rows as history entries, newest first. */
export async function toHistory<R extends HistoryRow, S>(
  rows: readonly R[],
  snapshotOf: (row: R) => S
): Promise<RevisionEntry<S>[]> {
  const emails = await editorEmails(rows.map((row) => row.editorId));
  return [...rows]
    .sort((a, b) => b.revision - a.revision)
    .map((row) => ({
      revision: row.revision,
      snapshot: snapshotOf(row),
      changedFields: row.changedFields,
      origin: row.origin,
      editorId: row.editorId,
      editorEmail: row.editorId === null ? null : (emails.get(row.editorId) ?? null),
      changedAt: row.changedAt,
    }));
}

interface HistoryRow {
  revision: number;
  changedFields: string[];
  origin: string;
  editorId: string | null;
  changedAt: Date;
}

// ─── Ordering ───────────────────────────────────────────────────────────────

/**
 * Where a row being moved waits while the others move. Every ordered column
 * here has a unique index with its collection, so moving A into B's place while
 * B still holds it fails; each moved row first parks at a distinct value no row
 * can hold (retired resources use small negatives, so these start far below).
 */
export function parkingPosition(index: number): number {
  return -1_000_000 - index;
}

// ─── Acknowledgement versions ───────────────────────────────────────────────

/**
 * The next acknowledgement version after `current`: `1.1` → `1.2`, `2` → `2.1`.
 *
 * A label, not arithmetic: the gate compares versions as strings (a row
 * satisfies a kind only for exactly the required string), so all this has to do
 * is produce one nobody has acknowledged yet. Every earlier label is one the
 * document has already had, and minor numbers only go up, so it never repeats.
 */
export function nextAcknowledgementVersion(current: string): string {
  const match = /^(.*?)(\d+)$/.exec(current);
  const [, head, tail] = match ?? [];
  if (head !== undefined && tail !== undefined && head.endsWith('.')) {
    return `${head}${Number(tail) + 1}`;
  }
  return `${current}.1`;
}

// ─── Import plans ───────────────────────────────────────────────────────────

/** One planned change, as the preview shows it. */
export interface ImportPlanItem {
  key: string;
  changedFields: string[];
}

/** One entity's part of an import plan. */
export interface ImportPlanSection {
  entity: string;
  /** What an admin calls this entity, plural: "Documents", "Modules". */
  label: string;
  creates: ImportPlanItem[];
  updates: ImportPlanItem[];
  /** Deletions, or retirements where the entity keeps a tombstone. */
  removals: ImportPlanItem[];
  /** Whether a removal here deletes or retires. */
  removalKind: 'delete' | 'retire';
  unchanged: string[];
  skippedRetired: string[];
}

/**
 * Everything an import would do, and why it may not.
 *
 * `refusals` is non-empty when the file cannot be applied as it stands: a
 * removal of something a surface reads, a changed legal text with no new
 * version. The preview shows them; apply refuses with the same list.
 */
export interface ContentImportPlan {
  collection: string;
  sections: ImportPlanSection[];
  refusals: string[];
  writesNothing: boolean;
}

/** One keyed plan as a preview section. */
export function toPlanSection<F>(
  entity: string,
  label: string,
  plan: KeyedPlan<F>,
  removalKind: ImportPlanSection['removalKind']
): ImportPlanSection {
  const item = (change: KeyedChange<F>): ImportPlanItem => ({
    key: change.key,
    changedFields: change.changedFields,
  });
  return {
    entity,
    label,
    creates: plan.creates.map(item),
    updates: plan.updates.map(item),
    removals: plan.removals.map(item),
    removalKind,
    unchanged: plan.unchanged,
    skippedRetired: plan.skippedRetired,
  };
}

/** Whether a set of sections writes nothing. */
export function sectionsWriteNothing(sections: readonly ImportPlanSection[]): boolean {
  return sections.every(
    (section) => section.creates.length + section.updates.length + section.removals.length === 0
  );
}

/** The refusal apply throws when a plan carries refusals. */
export function importRefused(collection: string, refusals: readonly string[]): ConflictError {
  return new ConflictError(`This ${collection} file cannot be applied: ${refusals.join(' ')}`, {
    reason: 'import_refused',
    refusals,
  });
}

/**
 * Parse a file with its collection's schema, and name every problem.
 *
 * The collection's own schema, the seed's, so an admin reads the same
 * referential errors the seed would.
 */
export function parseContentFile<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`That is not a ${what} file`, {
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

// ─── The import body ────────────────────────────────────────────────────────

/**
 * The largest import body accepted, in bytes. Her largest file is the
 * documents collection at about 60 KB, so this is sixteen times the real thing
 * and still small enough that parsing it never matters.
 */
export const MAX_IMPORT_BYTES = 1_000_000;

const importBodySchema = z.strictObject({ file: z.unknown() });

/**
 * Read an import body, refusing an oversize one before parsing it.
 *
 * The platform has no body ceiling for JSON routes (`lib/api/multipart-guard.ts`
 * guards `formData()` only, as the slot preview route found), so the cap is
 * here. `Content-Length` is checked first, which refuses an honest oversize
 * request without reading it; the text is measured as well, because the header
 * is the client's claim.
 *
 * @throws APIError 413 `FILE_TOO_LARGE`, or ValidationError on bad JSON or shape.
 */
export async function readImportBody(request: NextRequest): Promise<{ file: unknown }> {
  const tooLarge = () =>
    new APIError(
      `That file is larger than ${MAX_IMPORT_BYTES / 1_000_000} MB. A content file is tens of kilobytes; check it is the right file.`,
      ErrorCodes.FILE_TOO_LARGE,
      413,
      { maxBytes: MAX_IMPORT_BYTES }
    );

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES) throw tooLarge();

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ValidationError('Invalid JSON in request body');
  }
  const parsed = importBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid request body', {
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
