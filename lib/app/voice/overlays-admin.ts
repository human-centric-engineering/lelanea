/**
 * Her register overlays, edited in the admin (f-content-seeds t-92): each
 * situation's beats, the two blocks that belong to no one situation, their
 * sign-off, their history, and the file round-trip.
 *
 * The only writer after the seed. The rows are what every voice turn reads
 * (`getVoiceOverlays`, no cache of its own), so a save here is what the next
 * turn's prompt carries — within the 60s `buildContext` already caches a block
 * for, and nothing longer.
 *
 * ## Sign-off
 *
 * The same rule as the crisis copy: **any change to the words returns the thing
 * to `draft`**, and only a sign-off moves it to `signed_off`. A sign-off names
 * the revision it read, so nobody signs off words they did not see, and it is
 * itself a revision (`changedFields: ['status']`), so the history says who
 * signed what off, when. A move in the order is not a change to the words and
 * leaves a sign-off standing: the position decides nothing a model reads.
 *
 * ## Removal
 *
 * Deleting a situation is allowed, and the admin is told first which contexts
 * select it ({@link overlaySelectors}). It is not refused: a context whose
 * situation has gone falls back to the core-only block, which is the safe
 * direction (`lib/app/voice/overlays.ts`), and the person deleting it is the one
 * deciding that. The last one is refused, because the file format cannot hold
 * a set with none. The audit entry keeps the removed words; the history goes
 * with the row.
 *
 * ## Import keeps by default
 *
 * A file adds and updates. A stored situation the file leaves out is kept
 * unless the import is asked to remove it (the owner's ruling, 2026-09-24):
 * preview and apply take the same flag, so what was previewed is what runs.
 *
 * @see lib/app/content/voice-overlay-store.ts — the read every turn makes
 * @see .context/app/voice.md
 */

import type { AppVoiceOverlay, AppVoiceOverlaySet } from '@prisma/client';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { isRecord } from '@/lib/utils';
import { voiceOverlaysFileSchema, type VoiceOverlaysFile } from '@/lib/app/content/schemas';
import {
  VOICE_OVERLAY_SET_ID,
  VOICE_OVERLAY_SET_SNAPSHOT_FIELDS,
  VOICE_OVERLAY_SNAPSHOT_FIELDS,
} from '@/lib/app/content/voice-overlay-store';
import {
  storedCoreOnlySchema,
  storedExemplarsSchema,
  storedProvenanceSchema,
  toVoiceOverlays,
  type VoiceContentStatus,
} from '@/lib/app/content/voice-overlay-view';
import {
  changedFieldsOf,
  planKeyedImport,
  type KeyedPlan,
} from '@/lib/app/content/admin/keyed-import';
import {
  importRefused,
  parkingPosition,
  parseContentFile,
  revisionMoved,
  sectionsWriteNothing,
  toHistory,
  toPlanSection,
  type ContentImportPlan,
  type ImportPlanSection,
  type RevisionEntry,
} from '@/lib/app/content/admin/shared';
import { SEAT_SITUATIONS } from '@/lib/app/voice/context-contributor';
import type {
  OverlayCreate,
  OverlayEdit,
  OverlaySetEdit,
} from '@/lib/validations/app-voice-content';

const IMPORT_TX_TIMEOUT_MS = 30_000;

type Tx = Parameters<Parameters<typeof executeTransaction>[0]>[0];
type FieldChanges = Record<string, { from: unknown; to: unknown }>;
const NO_CHANGES: FieldChanges = {};

// ─── Shapes ─────────────────────────────────────────────────────────────────

/**
 * The set's stored words: everything a revision records but its status. The
 * JSON blocks are the schemas' own types — type aliases, which Prisma's JSON
 * input accepts where the view's interfaces are refused.
 */
export type OverlaySetWords = {
  title: string;
  version: string;
  locale: string;
  provenance: z.infer<typeof storedProvenanceSchema>;
  exemplars: z.infer<typeof storedExemplarsSchema>;
  coreOnly: z.infer<typeof storedCoreOnlySchema>;
};

/** One overlay's stored words, and its place in the order. */
export interface OverlayWords {
  position: number;
  label: string;
  /** The file's `when`. Never reaches a prompt. */
  reviewerNote: string;
  heading: string;
  lines: string[];
  exemplarQuery: string;
}

const SET_WORD_FIELDS = VOICE_OVERLAY_SET_SNAPSHOT_FIELDS.filter(
  (field): field is Exclude<typeof field, 'status'> => field !== 'status'
);
const OVERLAY_WORD_FIELDS = VOICE_OVERLAY_SNAPSHOT_FIELDS.filter(
  (field): field is Exclude<typeof field, 'status'> => field !== 'status'
);

interface Signed {
  status: VoiceContentStatus;
  signedOffAt: Date | null;
  revision: number;
}

export interface OverlaySetAdminRow extends OverlaySetWords, Signed {
  id: string;
}

export interface OverlayAdminRow extends Signed {
  situation: string;
  position: number;
  label: string;
  when: string;
  heading: string;
  lines: string[];
  exemplarQuery: string;
  /** The contexts that select this situation, named before a delete. */
  selectedBy: string[];
}

export interface OverlaysAdminView {
  seeded: boolean;
  /**
   * Why the stored rows cannot be served, or `null` when they can. Non-null
   * means every voice turn is going without a register (the contributor logs
   * and composes nothing), so the page says so.
   */
  unservable: string | null;
  set: OverlaySetAdminRow | null;
  overlays: OverlayAdminRow[];
}

export interface VoiceWriteResult {
  changed: string[];
  changes: FieldChanges;
  revision: number;
  status: VoiceContentStatus;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusOf(raw: string): VoiceContentStatus {
  if (raw === 'draft' || raw === 'signed_off') return raw;
  throw new Error(`Unknown voice content status "${raw}"`);
}

/** The set row's words, validated as the read path validates them. */
function setWordsOf(row: {
  title: string;
  version: string;
  locale: string;
  provenance: unknown;
  exemplars: unknown;
  coreOnly: unknown;
}): OverlaySetWords {
  return {
    title: row.title,
    version: row.version,
    locale: row.locale,
    provenance: storedProvenanceSchema.parse(row.provenance),
    exemplars: storedExemplarsSchema.parse(row.exemplars),
    coreOnly: storedCoreOnlySchema.parse(row.coreOnly),
  };
}

function overlayWordsOf(row: {
  position: number;
  label: string;
  reviewerNote: string;
  heading: string;
  lines: string[];
  exemplarQuery: string;
}): OverlayWords {
  return {
    position: row.position,
    label: row.label,
    reviewerNote: row.reviewerNote,
    heading: row.heading,
    lines: [...row.lines],
    exemplarQuery: row.exemplarQuery,
  };
}

function toChanges<F extends object>(before: F, after: F, changed: readonly (keyof F & string)[]) {
  return Object.fromEntries(
    changed.map((field) => [field, { from: before[field], to: after[field] }])
  );
}

/**
 * The contexts that select a situation, in words an admin reads.
 *
 * From the one map that pins a seat to a situation (`SEAT_SITUATIONS`), so a
 * seat added there is named here without an edit. The admin chat is always
 * listed, because it sends whatever situation it is asked for.
 */
export function overlaySelectors(situation: string): string[] {
  const seats = [...SEAT_SITUATIONS]
    .filter(([, selected]) => selected === situation)
    .map(([seat]) => `the ${seat} seat, on every turn a person takes there`);
  return [...seats, 'the admin chat, when it is asked for this situation'];
}

function describeUnservable(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toSetAdminRow(row: AppVoiceOverlaySet): OverlaySetAdminRow {
  return {
    id: row.id,
    ...setWordsOf(row),
    status: statusOf(row.status),
    signedOffAt: row.signedOffAt,
    revision: row.revision,
  };
}

function toOverlayAdminRow(row: AppVoiceOverlay): OverlayAdminRow {
  return {
    situation: row.situation,
    position: row.position,
    label: row.label,
    when: row.reviewerNote,
    heading: row.heading,
    lines: [...row.lines],
    exemplarQuery: row.exemplarQuery,
    status: statusOf(row.status),
    signedOffAt: row.signedOffAt,
    revision: row.revision,
    selectedBy: overlaySelectors(row.situation),
  };
}

function notSeeded(): ConflictError {
  return new ConflictError(
    'The voice overlays have not been seeded, so there is nothing to edit. Run `npm run db:seed`.',
    { reason: 'not_seeded' }
  );
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** The set and its overlays as stored, for the Voice page. */
export async function getOverlaysAdminView(): Promise<OverlaysAdminView> {
  const set = await prisma.appVoiceOverlaySet.findUnique({
    where: { id: VOICE_OVERLAY_SET_ID },
    include: { overlays: { orderBy: { position: 'asc' } } },
  });
  if (!set) return { seeded: false, unservable: null, set: null, overlays: [] };

  let unservable: string | null = null;
  try {
    toVoiceOverlays(set, set.overlays);
  } catch (err) {
    unservable = describeUnservable(err);
  }
  // A set whose JSON fails its schema cannot be shown as fields either. The
  // page reports it and offers the import, which rewrites the set whole.
  let setRow: OverlaySetAdminRow | null = null;
  try {
    setRow = toSetAdminRow(set);
  } catch (err) {
    unservable ??= describeUnservable(err);
  }
  return { seeded: true, unservable, set: setRow, overlays: set.overlays.map(toOverlayAdminRow) };
}

/** Every revision of the set's framing, newest first. */
export async function listOverlaySetHistory(): Promise<
  RevisionEntry<OverlaySetWords & { status: VoiceContentStatus }>[]
> {
  const revisions = await prisma.appVoiceOverlaySetRevision.findMany({
    where: { setId: VOICE_OVERLAY_SET_ID },
    orderBy: { revision: 'desc' },
  });
  return toHistory(revisions, (row) => ({ ...setWordsOf(row), status: statusOf(row.status) }));
}

/** Every revision of one overlay, newest first. */
export async function listOverlayHistory(
  situation: string
): Promise<RevisionEntry<OverlayWords & { status: VoiceContentStatus }>[]> {
  const [overlay, revisions] = await Promise.all([
    prisma.appVoiceOverlay.findUnique({ where: { situation }, select: { situation: true } }),
    prisma.appVoiceOverlayRevision.findMany({
      where: { situation },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!overlay) throw new NotFoundError(`There is no overlay for the situation "${situation}".`);
  return toHistory(revisions, (row) => ({ ...overlayWordsOf(row), status: statusOf(row.status) }));
}

// ─── The set's framing ──────────────────────────────────────────────────────

async function writeSet(
  toNext: (before: OverlaySetWords) => OverlaySetWords,
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await tx.appVoiceOverlaySet.findUnique({ where: { id: VOICE_OVERLAY_SET_ID } });
    if (!row) throw notSeeded();
    if (row.revision !== revisionRead)
      throw revisionMoved('The overlay set', row.revision, revisionRead);

    const before = setWordsOf(row);
    const next = setWordsOf(toNext(before));
    const changed = changedFieldsOf(before, next, SET_WORD_FIELDS);
    if (changed.length === 0)
      return { changed, changes: {}, revision: row.revision, status: statusOf(row.status) };

    const revision = row.revision + 1;
    const { count } = await tx.appVoiceOverlaySet.updateMany({
      where: { id: VOICE_OVERLAY_SET_ID, revision: revisionRead },
      data: { ...next, status: 'draft', signedOffAt: null, revision },
    });
    if (count === 0) throw revisionMoved('The overlay set', revision, revisionRead);
    await tx.appVoiceOverlaySetRevision.create({
      data: {
        setId: VOICE_OVERLAY_SET_ID,
        revision,
        ...next,
        status: 'draft',
        changedFields: row.status === 'draft' ? changed : [...changed, 'status'],
        origin: 'admin',
        editorId,
      },
    });
    return { changed, changes: toChanges(before, next, changed), revision, status: 'draft' };
  });
}

/** Save the two blocks that belong to no one situation. Back to `draft` if anything changed. */
export function updateOverlaySet(
  edit: OverlaySetEdit,
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  return writeSet((before) => ({ ...before, ...edit }), revisionRead, editorId);
}

/** Put the set's framing back to an earlier revision, as a new one. It returns to `draft`. */
export async function restoreOverlaySetRevision(
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  const past = await prisma.appVoiceOverlaySetRevision.findUnique({
    where: { setId_revision: { setId: VOICE_OVERLAY_SET_ID, revision } },
  });
  if (!past) throw new NotFoundError(`The overlay set has no revision ${revision}.`);
  return writeSet(() => setWordsOf(past), revisionRead, editorId);
}

/** Sign the set's framing off, at the revision the admin read. */
export async function signOffOverlaySet(
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await tx.appVoiceOverlaySet.findUnique({ where: { id: VOICE_OVERLAY_SET_ID } });
    if (!row) throw notSeeded();
    if (row.revision !== revisionRead)
      throw revisionMoved('The overlay set', row.revision, revisionRead);
    if (row.status === 'signed_off')
      return { changed: [], changes: NO_CHANGES, revision: row.revision, status: 'signed_off' };

    const words = setWordsOf(row);
    const revision = row.revision + 1;
    const { count } = await tx.appVoiceOverlaySet.updateMany({
      where: { id: VOICE_OVERLAY_SET_ID, revision: revisionRead },
      data: { status: 'signed_off', signedOffAt: new Date(), revision },
    });
    if (count === 0) throw revisionMoved('The overlay set', revision, revisionRead);
    await tx.appVoiceOverlaySetRevision.create({
      data: {
        setId: VOICE_OVERLAY_SET_ID,
        revision,
        ...words,
        status: 'signed_off',
        changedFields: ['status'],
        origin: 'admin',
        editorId,
      },
    });
    return {
      changed: ['status'],
      changes: { status: { from: 'draft', to: 'signed_off' } },
      revision,
      status: 'signed_off',
    };
  });
}

// ─── One overlay ────────────────────────────────────────────────────────────

async function requireOverlay(tx: Tx, situation: string, revisionRead: number) {
  const row = await tx.appVoiceOverlay.findUnique({ where: { situation } });
  if (!row) throw new NotFoundError(`There is no overlay for the situation "${situation}".`);
  if (row.revision !== revisionRead)
    throw revisionMoved(`The "${row.label}" overlay`, row.revision, revisionRead);
  return row;
}

async function writeOverlay(
  situation: string,
  toNext: (before: OverlayWords) => OverlayWords,
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await requireOverlay(tx, situation, revisionRead);
    const before = overlayWordsOf(row);
    const next = toNext(before);
    const changed = changedFieldsOf(before, next, OVERLAY_WORD_FIELDS);
    if (changed.length === 0)
      return { changed, changes: {}, revision: row.revision, status: statusOf(row.status) };

    const revision = row.revision + 1;
    const { count } = await tx.appVoiceOverlay.updateMany({
      where: { situation, revision: revisionRead },
      data: { ...next, status: 'draft', signedOffAt: null, revision },
    });
    if (count === 0) throw revisionMoved(`The "${row.label}" overlay`, revision, revisionRead);
    await tx.appVoiceOverlayRevision.create({
      data: {
        situation,
        revision,
        ...next,
        status: 'draft',
        changedFields: row.status === 'draft' ? changed : [...changed, 'status'],
        origin: 'admin',
        editorId,
      },
    });
    return { changed, changes: toChanges(before, next, changed), revision, status: 'draft' };
  });
}

function wordsFromEdit(edit: OverlayEdit, position: number): OverlayWords {
  return {
    position,
    label: edit.label,
    reviewerNote: edit.when,
    heading: edit.heading,
    lines: [...edit.lines],
    exemplarQuery: edit.exemplarQuery,
  };
}

/** Save one overlay's words. Its key and place stay. Back to `draft` if anything changed. */
export function updateOverlay(
  situation: string,
  edit: OverlayEdit,
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  return writeOverlay(
    situation,
    (before) => wordsFromEdit(edit, before.position),
    revisionRead,
    editorId
  );
}

/** Put one overlay's words back to an earlier revision. Its place stays: moving is an import. */
export async function restoreOverlayRevision(
  situation: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  const past = await prisma.appVoiceOverlayRevision.findUnique({
    where: { situation_revision: { situation, revision } },
  });
  if (!past) throw new NotFoundError(`The "${situation}" overlay has no revision ${revision}.`);
  return writeOverlay(
    situation,
    (before) => ({ ...overlayWordsOf(past), position: before.position }),
    revisionRead,
    editorId
  );
}

/** Sign one overlay off, at the revision the admin read. */
export async function signOffOverlay(
  situation: string,
  revisionRead: number,
  editorId: string
): Promise<VoiceWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await requireOverlay(tx, situation, revisionRead);
    if (row.status === 'signed_off')
      return { changed: [], changes: NO_CHANGES, revision: row.revision, status: 'signed_off' };

    const revision = row.revision + 1;
    const { count } = await tx.appVoiceOverlay.updateMany({
      where: { situation, revision: revisionRead },
      data: { status: 'signed_off', signedOffAt: new Date(), revision },
    });
    if (count === 0) throw revisionMoved(`The "${row.label}" overlay`, revision, revisionRead);
    await tx.appVoiceOverlayRevision.create({
      data: {
        situation,
        revision,
        ...overlayWordsOf(row),
        status: 'signed_off',
        changedFields: ['status'],
        origin: 'admin',
        editorId,
      },
    });
    return {
      changed: ['status'],
      changes: { status: { from: 'draft', to: 'signed_off' } },
      revision,
      status: 'signed_off',
    };
  });
}

/** Add a situation at the end of the order, as a draft. 409 when the key is taken. */
export async function createOverlay(
  create: OverlayCreate,
  editorId: string
): Promise<{ situation: string; position: number }> {
  const { situation, ...edit } = create;
  try {
    return await executeTransaction(async (tx) => {
      const set = await tx.appVoiceOverlaySet.findUnique({
        where: { id: VOICE_OVERLAY_SET_ID },
        select: { id: true },
      });
      if (!set) throw notSeeded();
      const taken = await tx.appVoiceOverlay.findUnique({
        where: { situation },
        select: { situation: true },
      });
      if (taken) throw situationTaken(situation);

      const last = await tx.appVoiceOverlay.findFirst({
        where: { setId: set.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const words = wordsFromEdit(edit, (last?.position ?? 0) + 1);
      await tx.appVoiceOverlay.create({
        data: { situation, setId: set.id, ...words, status: 'draft', revision: 1 },
      });
      await tx.appVoiceOverlayRevision.create({
        data: {
          situation,
          revision: 1,
          ...words,
          status: 'draft',
          changedFields: [...VOICE_OVERLAY_SNAPSHOT_FIELDS],
          origin: 'admin',
          editorId,
        },
      });
      return { situation, position: words.position };
    });
  } catch (err) {
    // Added between the check above and the insert.
    if (isRecord(err) && err.code === 'P2002') throw situationTaken(situation);
    throw err;
  }
}

function situationTaken(situation: string): ConflictError {
  return new ConflictError(
    `There is already an overlay for "${situation}". Edit that one instead.`,
    { reason: 'exists' }
  );
}

/**
 * Close the gaps in the order, parking the rows that move first because
 * `(setId, position)` is unique, and record each move as a revision that keeps
 * the overlay's sign-off.
 */
async function renumber(tx: Tx, editorId: string): Promise<number> {
  const rows = await tx.appVoiceOverlay.findMany({
    where: { setId: VOICE_OVERLAY_SET_ID },
    orderBy: { position: 'asc' },
  });
  const moving = rows
    .map((row, index) => ({ row, position: index + 1 }))
    .filter(({ row, position }) => row.position !== position);
  for (const [index, { row }] of moving.entries()) {
    await tx.appVoiceOverlay.update({
      where: { situation: row.situation },
      data: { position: parkingPosition(index) },
    });
  }
  for (const { row, position } of moving) {
    const revision = row.revision + 1;
    await tx.appVoiceOverlay.update({
      where: { situation: row.situation },
      data: { position, revision },
    });
    await tx.appVoiceOverlayRevision.create({
      data: {
        situation: row.situation,
        revision,
        ...overlayWordsOf({ ...row, position }),
        status: statusOf(row.status),
        changedFields: ['position'],
        origin: 'admin',
        editorId,
      },
    });
  }
  return moving.length;
}

/**
 * Remove one situation and close the gap. Returns what was removed and the
 * contexts that selected it, for the audit entry, since the row and its
 * history go with it.
 */
export async function deleteOverlay(
  situation: string,
  revisionRead: number,
  editorId: string
): Promise<{ removed: OverlayWords; selectedBy: string[]; renumbered: number }> {
  return executeTransaction(async (tx) => {
    const row = await requireOverlay(tx, situation, revisionRead);
    const remaining = await tx.appVoiceOverlay.count({ where: { setId: row.setId } });
    if (remaining <= 1) {
      throw new ConflictError(
        'The set must keep at least one overlay; the file format cannot hold a set with none.',
        { reason: 'last_overlay' }
      );
    }
    await tx.appVoiceOverlay.delete({ where: { situation } });
    const renumbered = await renumber(tx, editorId);
    return { removed: overlayWordsOf(row), selectedBy: overlaySelectors(situation), renumbered };
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

export function overlaysExportFilename(now: Date): string {
  return `lelanea-voice-overlays-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * The set as the seed's file, from the rows. Only what is stored: the file's
 * working notes (`textFormat`, `sourceFiles`, `notes`, `reviewNotes`) are left
 * out rather than invented. Parsed with the seed's schema before it is handed
 * out, so an export is always a file the import and the seed will take.
 */
export async function exportOverlaysFile(): Promise<VoiceOverlaysFile> {
  const set = await prisma.appVoiceOverlaySet.findUnique({
    where: { id: VOICE_OVERLAY_SET_ID },
    include: { overlays: { orderBy: { position: 'asc' } } },
  });
  if (!set) {
    throw new ConflictError(
      'There is nothing to export: the voice overlays have not been seeded.',
      {
        reason: 'nothing_to_export',
      }
    );
  }
  let words: OverlaySetWords;
  try {
    words = setWordsOf(set);
  } catch (err) {
    throw new ConflictError(
      `The stored overlay set cannot be written as a file: ${describeUnservable(err)}`,
      { reason: 'unexportable' }
    );
  }
  const file = {
    fingerprint: {
      id: set.id,
      title: words.title,
      layer: 'overlays',
      version: words.version,
      locale: words.locale,
      provenance: words.provenance,
    },
    overlays: set.overlays.map((row) => ({
      situation: row.situation,
      label: row.label,
      when: row.reviewerNote,
      heading: row.heading,
      lines: [...row.lines],
      exemplarQuery: row.exemplarQuery,
    })),
    exemplars: words.exemplars,
    coreOnly: words.coreOnly,
  };
  const parsed = voiceOverlaysFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new ConflictError(
      `The stored overlays cannot be written as a file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
        .join('; ')}.`,
      { reason: 'unexportable' }
    );
  }
  return parsed.data;
}

// ─── Import ─────────────────────────────────────────────────────────────────

interface StoredOverlays {
  set: AppVoiceOverlaySet | null;
  overlays: readonly AppVoiceOverlay[];
}

interface OverlaysImport {
  plan: ContentImportPlan;
  setChanged: (keyof OverlaySetWords)[];
  setAfter: OverlaySetWords | null;
  overlays: KeyedPlan<OverlayWords>;
}

/** Whether a change touches what a model reads, rather than only the order. */
function wordsChanged(changedFields: readonly string[]): boolean {
  return changedFields.some((field) => field !== 'position');
}

/**
 * What an overlays file would do. Pure.
 *
 * The file's order is the new order. A stored situation the file leaves out is
 * kept, after the file's own, unless `removeAbsent` asks for it to be deleted.
 */
export function planOverlaysImport(
  file: VoiceOverlaysFile,
  stored: StoredOverlays,
  removeAbsent: boolean
): OverlaysImport {
  const refusals: string[] = [];
  if (!stored.set) {
    refusals.push('The voice overlays have not been seeded, so there is nothing to import into.');
  } else if (file.fingerprint.id !== stored.set.id) {
    refusals.push(
      `This file is for the set "${file.fingerprint.id}", and this database holds "${stored.set.id}".`
    );
  }

  const setAfter: OverlaySetWords = {
    title: file.fingerprint.title,
    version: file.fingerprint.version,
    locale: file.fingerprint.locale,
    provenance: { ...file.fingerprint.provenance },
    exemplars: { ...file.exemplars, lines: [...file.exemplars.lines] },
    coreOnly: { ...file.coreOnly, lines: [...file.coreOnly.lines] },
  };
  let setChanged: (keyof OverlaySetWords)[] = [];
  if (stored.set) {
    try {
      setChanged = changedFieldsOf(setWordsOf(stored.set), setAfter, SET_WORD_FIELDS);
    } catch {
      // A stored set that fails its schema is replaced whole.
      setChanged = [...SET_WORD_FIELDS];
    }
  }

  const inFile = new Set(file.overlays.map((overlay) => overlay.situation));
  const kept = removeAbsent ? [] : stored.overlays.filter((row) => !inFile.has(row.situation));
  const incoming = [
    ...file.overlays.map((overlay, index) => ({
      key: overlay.situation,
      value: {
        position: index + 1,
        label: overlay.label,
        reviewerNote: overlay.when,
        heading: overlay.heading,
        lines: [...overlay.lines],
        exemplarQuery: overlay.exemplarQuery,
      },
    })),
    // Kept ones follow the file's, in their stored order, so the order stays
    // contiguous and no two rows are left claiming one place.
    ...kept.map((row, index) => ({
      key: row.situation,
      value: overlayWordsOf({ ...row, position: file.overlays.length + index + 1 }),
    })),
  ];

  const overlays = planKeyedImport<OverlayWords, OverlayWords>({
    incoming,
    stored: stored.overlays.map((row) => ({
      key: row.situation,
      fields: overlayWordsOf(row),
      revision: row.revision,
    })),
    diff: (before, after) => changedFieldsOf(before, after, OVERLAY_WORD_FIELDS),
    allFields: VOICE_OVERLAY_SNAPSHOT_FIELDS,
    toCreate: (value) => value,
    toUpdate: (_before, value) => value,
    onAbsent: removeAbsent ? () => null : 'keep',
  });

  const section: ImportPlanSection = {
    ...toPlanSection('overlay', 'Overlays', overlays, 'delete'),
    kept: kept.map((row) => row.situation),
  };
  const sections: ImportPlanSection[] = [section];
  if (setChanged.length > 0 && stored.set) {
    sections.unshift({
      entity: 'set',
      label: 'The set’s framing',
      creates: [],
      updates: [{ key: stored.set.id, changedFields: setChanged }],
      removals: [],
      removalKind: 'delete',
      unchanged: [],
      skippedRetired: [],
    });
  }

  return {
    plan: {
      collection: 'voice overlays',
      sections,
      refusals,
      writesNothing: sectionsWriteNothing(sections),
    },
    setChanged,
    setAfter: stored.set ? setAfter : null,
    overlays,
  };
}

async function readStored(client: Pick<typeof prisma, 'appVoiceOverlaySet' | 'appVoiceOverlay'>) {
  const [set, overlays] = await Promise.all([
    client.appVoiceOverlaySet.findUnique({ where: { id: VOICE_OVERLAY_SET_ID } }),
    client.appVoiceOverlay.findMany({
      where: { setId: VOICE_OVERLAY_SET_ID },
      orderBy: { position: 'asc' },
    }),
  ]);
  return { set, overlays };
}

function parseOverlaysFile(raw: unknown): VoiceOverlaysFile {
  return parseContentFile(voiceOverlaysFileSchema, raw, 'voice overlays');
}

export async function previewOverlaysImport(
  raw: unknown,
  removeAbsent: boolean
): Promise<ContentImportPlan> {
  return planOverlaysImport(parseOverlaysFile(raw), await readStored(prisma), removeAbsent).plan;
}

/**
 * Apply an overlays file. Re-planned in the transaction against the rows as
 * they stand; idempotent. Anything whose words it changes returns to `draft`.
 */
export async function applyOverlaysImport(
  raw: unknown,
  removeAbsent: boolean,
  editorId: string
): Promise<ContentImportPlan> {
  const file = parseOverlaysFile(raw);
  return executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planOverlaysImport(file, stored, removeAbsent);
      if (planned.plan.refusals.length > 0)
        throw importRefused('voice overlays', planned.plan.refusals);
      if (planned.plan.writesNothing) return planned.plan;

      if (planned.setChanged.length > 0 && planned.setAfter && stored.set) {
        const revision = stored.set.revision + 1;
        await tx.appVoiceOverlaySet.update({
          where: { id: stored.set.id },
          data: { ...planned.setAfter, status: 'draft', signedOffAt: null, revision },
        });
        await tx.appVoiceOverlaySetRevision.create({
          data: {
            setId: stored.set.id,
            revision,
            ...planned.setAfter,
            status: 'draft',
            changedFields:
              stored.set.status === 'draft'
                ? planned.setChanged
                : [...planned.setChanged, 'status'],
            origin: 'admin',
            editorId,
          },
        });
      }

      const statusBefore = new Map(stored.overlays.map((row) => [row.situation, row.status]));
      for (const change of planned.overlays.removals) {
        await tx.appVoiceOverlay.delete({ where: { situation: change.key } });
      }
      const moving = planned.overlays.updates.filter((change) =>
        change.changedFields.includes('position')
      );
      for (const [index, change] of moving.entries()) {
        await tx.appVoiceOverlay.update({
          where: { situation: change.key },
          data: { position: parkingPosition(index) },
        });
      }
      for (const change of planned.overlays.creates) {
        await tx.appVoiceOverlay.create({
          data: {
            situation: change.key,
            setId: VOICE_OVERLAY_SET_ID,
            ...change.after!,
            status: 'draft',
            revision: 1,
          },
        });
        await tx.appVoiceOverlayRevision.create({
          data: {
            situation: change.key,
            revision: 1,
            ...change.after!,
            status: 'draft',
            changedFields: change.changedFields,
            origin: 'admin',
            editorId,
          },
        });
      }
      for (const change of planned.overlays.updates) {
        // A move alone keeps the sign-off, as a move in the editor does.
        const before = statusOf(statusBefore.get(change.key) ?? 'draft');
        const status = wordsChanged(change.changedFields) ? 'draft' : before;
        await tx.appVoiceOverlay.update({
          where: { situation: change.key },
          data: {
            ...change.after!,
            status,
            ...(status === 'draft' ? { signedOffAt: null } : {}),
            revision: change.revision,
          },
        });
        await tx.appVoiceOverlayRevision.create({
          data: {
            situation: change.key,
            revision: change.revision,
            ...change.after!,
            status,
            changedFields:
              status === before ? change.changedFields : [...change.changedFields, 'status'],
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
