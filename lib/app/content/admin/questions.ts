/**
 * The discovery questions, edited in the admin (f-content-seeds t-91): the
 * set's framing (title, preamble, pacing) and each question.
 *
 * Questions can be added, reworded, reordered and removed. Their numbers stay
 * contiguous from 1, because the file format requires it (a question's number
 * is its position) and a gap would make every export re-number on import.
 * Removing one re-numbers those after it, each as a revision, so the history
 * says when a question moved as well as when it changed.
 *
 * **A question keeps its id.** It is how an answer will be filed once
 * onboarding stores them, so a reworded or moved question keeps its id, and a
 * new one takes the id after the highest (`q31`).
 *
 * **Removal is a delete.** Nothing stores a question id yet: the public content
 * API is the only reader (`QUESTION_READERS`), and the editor names it before
 * confirming. The audit entry keeps the removed question's words. **Revisit
 * when** onboarding stores answers by question id: a removed question will then
 * need a tombstone, as a retired resource has.
 *
 * @see lib/app/content/question-store.ts — the read every surface makes
 */

import type {
  AppDiscoveryQuestion,
  AppDiscoveryQuestionRevision,
  AppQuestionSet,
  AppQuestionSetRevision,
} from '@prisma/client';

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { executeTransaction } from '@/lib/db/utils';
import { DB_NULL } from '@/lib/app-db/json-null';
import {
  discoveryQuestionsFileSchema,
  type DiscoveryQuestionsFile,
} from '@/lib/app/content/schemas';
import {
  DISCOVERY_QUESTION_SET_ID,
  QUESTION_SET_SNAPSHOT_FIELDS,
  QUESTION_SNAPSHOT_FIELDS,
  getDiscoveryQuestions,
} from '@/lib/app/content/question-store';
import {
  storedFollowUpSchema,
  storedPacingSchema,
  storedPreambleSchema,
  toQuestionView,
  type DiscoveryQuestionRow,
  type DiscoveryQuestionSet,
  type QuestionSetRow,
} from '@/lib/app/content/question-view';
import { questionSeedFromFile, questionsFileFromSet } from '@/lib/app/content/content-files';
import {
  changedFieldsOf,
  planKeyedImport,
  type KeyedPlan,
} from '@/lib/app/content/admin/keyed-import';
import { QUESTION_READERS } from '@/lib/app/content/admin/readers';
import {
  type ContentImportPlan,
  IMPORT_TX_TIMEOUT_MS,
  importRefused,
  parkingPosition,
  parseContentFile,
  type RevisionEntry,
  revisionMoved,
  revisionMovedNow,
  sectionsWriteNothing,
  toChanges,
  toHistory,
  toPlanSection,
  type Tx,
} from '@/lib/app/content/admin/shared';
import type { FieldChanges } from '@/lib/app/content/admin/documents';
import type { QuestionEdit, QuestionSetEdit } from '@/lib/app/content/admin/validation';

export type QuestionSetFields = ReturnType<typeof setFieldsOf>;
export type QuestionFields = ReturnType<typeof questionFieldsOf>;

export interface QuestionsAdminView {
  seeded: boolean;
  set: DiscoveryQuestionSet | null;
  readers: readonly string[];
}

export interface QuestionWriteResult {
  changed: string[];
  changes: FieldChanges;
  revision: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function setFieldsOf(row: Omit<QuestionSetRow, 'id' | 'revision'>) {
  const preamble = storedPreambleSchema.parse(row.preamble);
  const pacing = storedPacingSchema.parse(row.pacing);
  return {
    title: row.title,
    chartTitle: row.chartTitle,
    moduleId: row.moduleId,
    phase: row.phase,
    preamble,
    pacing,
    version: row.version,
    locale: row.locale,
  };
}

/** The set columns a revision snapshots: all but `moduleId`, which the revision table does not carry. */
function setSnapshotOf(fields: QuestionSetFields) {
  const { moduleId: _moduleId, ...snapshot } = fields;
  return snapshot;
}

function questionFieldsOf(row: Omit<DiscoveryQuestionRow, 'revision'>) {
  // The read path's own check, so nothing is saved it would refuse.
  const view = toQuestionView({ ...row, revision: 1 });
  return {
    number: row.number,
    text: view.text,
    inputType: view.inputType,
    hint: row.hint,
    conditionalFollowUp: storedFollowUpSchema.parse(row.conditionalFollowUp ?? null),
  };
}

function toQuestionData(fields: QuestionFields) {
  return { ...fields, conditionalFollowUp: fields.conditionalFollowUp ?? DB_NULL };
}

const SET_FIELDS = [...QUESTION_SET_SNAPSHOT_FIELDS, 'moduleId'] as const;

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getQuestionsAdminView(): Promise<QuestionsAdminView> {
  const exists = await prisma.appQuestionSet.findUnique({
    where: { id: DISCOVERY_QUESTION_SET_ID },
    select: { id: true },
  });
  return {
    seeded: exists !== null,
    set: exists ? await getDiscoveryQuestions() : null,
    readers: QUESTION_READERS,
  };
}

export async function listQuestionSetHistory(
  id: string
): Promise<RevisionEntry<Omit<QuestionSetFields, 'moduleId'>>[]> {
  const [set, revisions] = await Promise.all([
    prisma.appQuestionSet.findUnique({ where: { id }, select: { moduleId: true } }),
    prisma.appQuestionSetRevision.findMany({ where: { setId: id }, orderBy: { revision: 'desc' } }),
  ]);
  if (!set) throw new NotFoundError(`There is no question set "${id}".`);
  return toHistory(revisions, (row: AppQuestionSetRevision) =>
    setSnapshotOf(setFieldsOf({ ...row, moduleId: set.moduleId }))
  );
}

export async function listQuestionHistory(id: string): Promise<RevisionEntry<QuestionFields>[]> {
  const [question, revisions] = await Promise.all([
    prisma.appDiscoveryQuestion.findUnique({ where: { id }, select: { id: true } }),
    prisma.appDiscoveryQuestionRevision.findMany({
      where: { questionId: id },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!question) throw new NotFoundError(`There is no discovery question "${id}".`);
  return toHistory(revisions, (row: AppDiscoveryQuestionRevision) =>
    questionFieldsOf({ ...row, id })
  );
}

// ─── Writes ─────────────────────────────────────────────────────────────────

async function writeSet(
  id: string,
  toNext: (before: QuestionSetFields) => QuestionSetFields,
  revisionRead: number,
  editorId: string
): Promise<QuestionWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await tx.appQuestionSet.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`There is no question set "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved('The question set', row.revision, revisionRead);

    const before = setFieldsOf(row);
    const next = toNext(before);
    const changed = changedFieldsOf(before, next, SET_FIELDS);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };
    if (next.moduleId !== before.moduleId) {
      const target = await tx.appJourneyModule.findUnique({
        where: { id: next.moduleId },
        select: { id: true },
      });
      if (!target)
        throw new ValidationError(`There is no module "${next.moduleId}" on the journey.`);
    }

    const revision = row.revision + 1;
    const { count } = await tx.appQuestionSet.updateMany({
      where: { id, revision: revisionRead },
      data: { ...next, revision },
    });
    if (count === 0)
      throw await revisionMovedNow(
        'The question set',
        revisionRead,
        tx.appQuestionSet.findUnique({ where: { id }, select: { revision: true } })
      );
    await tx.appQuestionSetRevision.create({
      data: {
        setId: id,
        revision,
        ...setSnapshotOf(next),
        // `moduleId` is not a revision column; a move between modules is still
        // recorded as a revision, with the field named in `changedFields`.
        changedFields: changed,
        origin: 'admin',
        editorId,
      },
    });
    return { changed, changes: toChanges(before, next, changed), revision };
  });
}

async function writeQuestion(
  id: string,
  toNext: (before: QuestionFields) => QuestionFields,
  revisionRead: number,
  editorId: string
): Promise<QuestionWriteResult> {
  return executeTransaction(async (tx) => {
    const row = await tx.appDiscoveryQuestion.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`There is no discovery question "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`Question ${row.number}`, row.revision, revisionRead);

    const before = questionFieldsOf(row);
    const next = toNext(before);
    questionFieldsOf({ id, ...next });
    const changed = changedFieldsOf(before, next, QUESTION_SNAPSHOT_FIELDS);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };

    const revision = row.revision + 1;
    const data = toQuestionData(next);
    const { count } = await tx.appDiscoveryQuestion.updateMany({
      where: { id, revision: revisionRead },
      data: { ...data, revision },
    });
    if (count === 0)
      throw await revisionMovedNow(
        `Question ${row.number}`,
        revisionRead,
        tx.appDiscoveryQuestion.findUnique({ where: { id }, select: { revision: true } })
      );
    await tx.appDiscoveryQuestionRevision.create({
      data: {
        questionId: id,
        revision,
        ...data,
        changedFields: changed,
        origin: 'admin',
        editorId,
      },
    });
    return { changed, changes: toChanges(before, next, changed), revision };
  });
}

export function updateQuestionSet(
  id: string,
  edit: QuestionSetEdit,
  revisionRead: number,
  editorId: string
): Promise<QuestionWriteResult> {
  return writeSet(id, () => ({ ...edit }), revisionRead, editorId);
}

export function updateQuestion(
  id: string,
  edit: QuestionEdit,
  revisionRead: number,
  editorId: string
): Promise<QuestionWriteResult> {
  return writeQuestion(
    id,
    (before) => ({ ...edit, number: before.number }),
    revisionRead,
    editorId
  );
}

export async function restoreQuestionSetRevision(
  id: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<QuestionWriteResult> {
  const past = await prisma.appQuestionSetRevision.findUnique({
    where: { setId_revision: { setId: id, revision } },
  });
  if (!past) throw new NotFoundError(`The question set has no revision ${revision}.`);
  // The module it belongs to is not in the snapshot, so it stays where it is.
  return writeSet(
    id,
    (before) => setFieldsOf({ ...past, moduleId: before.moduleId }),
    revisionRead,
    editorId
  );
}

/** Restore a question's words. Its number stays: moving is a reorder. */
export async function restoreQuestionRevision(
  id: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<QuestionWriteResult> {
  const past = await prisma.appDiscoveryQuestionRevision.findUnique({
    where: { questionId_revision: { questionId: id, revision } },
  });
  if (!past) throw new NotFoundError(`Question "${id}" has no revision ${revision}.`);
  return writeQuestion(
    id,
    (before) => ({ ...questionFieldsOf({ ...past, id }), number: before.number }),
    revisionRead,
    editorId
  );
}

/**
 * Give questions new numbers, parking the moving ones first because
 * `(setId, number)` is unique, and record each move as a revision.
 */
async function applyNumbers(
  tx: Tx,
  rows: readonly AppDiscoveryQuestion[],
  numbers: ReadonlyMap<string, number>,
  editorId: string
): Promise<number> {
  const moving = rows.filter((row) => numbers.get(row.id) !== row.number);
  for (const [index, row] of moving.entries()) {
    await tx.appDiscoveryQuestion.update({
      where: { id: row.id },
      data: { number: parkingPosition(index) },
    });
  }
  for (const row of moving) {
    const number = numbers.get(row.id)!;
    const revision = row.revision + 1;
    await tx.appDiscoveryQuestion.update({ where: { id: row.id }, data: { number, revision } });
    await tx.appDiscoveryQuestionRevision.create({
      data: {
        questionId: row.id,
        revision,
        ...toQuestionData({ ...questionFieldsOf(row), number }),
        changedFields: ['number'],
        origin: 'admin',
        editorId,
      },
    });
  }
  return moving.length;
}

/**
 * The id after the highest in the set: `q31` after `q30`. A removed question's
 * history goes with it, so an id freed at the end can be taken again; that is
 * harmless while nothing stores a question id (see the file header).
 */
async function nextQuestionId(tx: Tx): Promise<string> {
  const live = await tx.appDiscoveryQuestion.findMany({ select: { id: true } });
  const highest = live
    .map((row) => /^q(\d+)$/.exec(row.id)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .reduce((max, digits) => Math.max(max, Number(digits)), 0);
  return `q${String(highest + 1).padStart(2, '0')}`;
}

/** Add a question at the end of the set. */
export async function createQuestion(
  edit: QuestionEdit,
  editorId: string
): Promise<{ id: string; number: number }> {
  return executeTransaction(async (tx) => {
    const set = await tx.appQuestionSet.findUnique({
      where: { id: DISCOVERY_QUESTION_SET_ID },
      select: { id: true },
    });
    if (!set) throw new NotFoundError('The discovery questions have not been seeded yet.');
    const count = await tx.appDiscoveryQuestion.count({ where: { setId: set.id } });
    const id = await nextQuestionId(tx);
    const fields = { ...edit, number: count + 1 };
    questionFieldsOf({ id, ...fields });
    const data = toQuestionData(fields);
    await tx.appDiscoveryQuestion.create({ data: { id, setId: set.id, ...data, revision: 1 } });
    await tx.appDiscoveryQuestionRevision.create({
      data: {
        questionId: id,
        revision: 1,
        ...data,
        changedFields: [...QUESTION_SNAPSHOT_FIELDS],
        origin: 'admin',
        editorId,
      },
    });
    return { id, number: fields.number };
  });
}

/**
 * Remove one question and close the gap. Returns what was removed, for the
 * audit entry, since the row and its history go with it.
 */
export async function deleteQuestion(
  id: string,
  revisionRead: number,
  editorId: string
): Promise<{ removed: QuestionFields; renumbered: number }> {
  return executeTransaction(async (tx) => {
    const row = await tx.appDiscoveryQuestion.findUnique({ where: { id } });
    if (!row) throw new NotFoundError(`There is no discovery question "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`Question ${row.number}`, row.revision, revisionRead);
    const remaining = await tx.appDiscoveryQuestion.count({ where: { setId: row.setId } });
    if (remaining <= 1) {
      throw new ConflictError(
        'The set must keep at least one question; the file format cannot hold an empty set.',
        {
          reason: 'last_question',
        }
      );
    }
    await tx.appDiscoveryQuestion.delete({ where: { id } });
    const rest = await tx.appDiscoveryQuestion.findMany({
      where: { setId: row.setId },
      orderBy: { number: 'asc' },
    });
    const renumbered = await applyNumbers(
      tx,
      rest,
      new Map(rest.map((q, index) => [q.id, index + 1])),
      editorId
    );
    return { removed: questionFieldsOf(row), renumbered };
  });
}

/** Put the questions in a new order. Every question once, each with the revision read. */
export async function reorderQuestions(
  order: readonly { id: string; revision: number }[],
  editorId: string
): Promise<{ moved: number }> {
  return executeTransaction(async (tx) => {
    const rows = await tx.appDiscoveryQuestion.findMany({
      where: { setId: DISCOVERY_QUESTION_SET_ID },
      orderBy: { number: 'asc' },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (
      order.length !== rows.length ||
      new Set(order.map((entry) => entry.id)).size !== rows.length
    ) {
      throw new ValidationError('A new order must name every question exactly once.');
    }
    for (const entry of order) {
      const row = byId.get(entry.id);
      if (!row) throw new NotFoundError(`There is no discovery question "${entry.id}".`);
      if (row.revision !== entry.revision)
        throw revisionMoved(`Question ${row.number}`, row.revision, entry.revision);
    }
    const moved = await applyNumbers(
      tx,
      rows,
      new Map(order.map((entry, index) => [entry.id, index + 1])),
      editorId
    );
    return { moved };
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

export function questionsExportFilename(now: Date): string {
  return `lelanea-discovery-questions-${now.toISOString().slice(0, 10)}.json`;
}

export async function exportQuestionsFile(): Promise<DiscoveryQuestionsFile> {
  const { set } = await getQuestionsAdminView();
  if (!set) {
    throw new ConflictError(
      'There is nothing to export: the discovery questions have not been seeded.',
      {
        reason: 'nothing_to_export',
      }
    );
  }
  const parsed = discoveryQuestionsFileSchema.safeParse(questionsFileFromSet(set));
  if (!parsed.success) {
    throw new ConflictError(
      `The stored questions cannot be written as a file: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
        .join('; ')}.`,
      { reason: 'unexportable' }
    );
  }
  return parsed.data;
}

// ─── Import ─────────────────────────────────────────────────────────────────

interface StoredQuestions {
  set: AppQuestionSet | null;
  questions: readonly AppDiscoveryQuestion[];
  moduleIds: ReadonlySet<string>;
}

interface QuestionsImport {
  plan: ContentImportPlan;
  setId: string;
  setChanged: string[];
  setAfter: QuestionSetFields | null;
  questions: KeyedPlan<QuestionFields>;
}

/**
 * What a discovery questions file would do. Pure. The file is the whole set,
 * so a stored question it omits is removed; the preview names each one.
 */
export function planQuestionsImport(
  file: DiscoveryQuestionsFile,
  stored: StoredQuestions
): QuestionsImport {
  const seed = questionSeedFromFile(file);
  const refusals: string[] = [];
  if (!stored.set)
    refusals.push(
      'The discovery questions have not been seeded, so there is nothing to import into.'
    );
  else if (stored.set.id !== seed.set.id) {
    refusals.push(
      `This file is for the set "${seed.set.id}", and this database holds "${stored.set.id}".`
    );
  }
  if (!stored.moduleIds.has(seed.set.moduleId)) {
    refusals.push(
      `The file puts the questions in module "${seed.set.moduleId}", which is not on the journey.`
    );
  }

  const { id: _id, ...setIncoming } = seed.set;
  const setAfter = setFieldsOf(setIncoming);
  const setChanged = stored.set
    ? changedFieldsOf(setFieldsOf(stored.set), setAfter, SET_FIELDS)
    : [];

  const questions = planKeyedImport<Omit<DiscoveryQuestionRow, 'revision'>, QuestionFields>({
    incoming: seed.questions.map((question) => ({ key: question.id, value: question })),
    stored: stored.questions.map((row) => ({
      key: row.id,
      fields: questionFieldsOf(row),
      revision: row.revision,
    })),
    diff: (before, after) => changedFieldsOf(before, after, QUESTION_SNAPSHOT_FIELDS),
    allFields: QUESTION_SNAPSHOT_FIELDS,
    toCreate: (question) => questionFieldsOf(question),
    toUpdate: (_before, question) => questionFieldsOf(question),
    onAbsent: () => null,
  });

  const sections = [toPlanSection('question', 'Questions', questions, 'delete')];
  if (setChanged.length > 0 && stored.set) {
    sections.unshift({
      entity: 'set',
      label: 'Question set',
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
      collection: 'questions',
      sections,
      refusals,
      writesNothing: sectionsWriteNothing(sections),
    },
    setId: stored.set?.id ?? seed.set.id,
    setChanged,
    setAfter: stored.set ? setAfter : null,
    questions,
  };
}

async function readStored(
  client: Pick<typeof prisma, 'appQuestionSet' | 'appDiscoveryQuestion' | 'appJourneyModule'>
): Promise<StoredQuestions> {
  const [set, questions, modules] = await Promise.all([
    client.appQuestionSet.findUnique({ where: { id: DISCOVERY_QUESTION_SET_ID } }),
    client.appDiscoveryQuestion.findMany({
      where: { setId: DISCOVERY_QUESTION_SET_ID },
      orderBy: { number: 'asc' },
    }),
    client.appJourneyModule.findMany({ select: { id: true } }),
  ]);
  return { set, questions, moduleIds: new Set(modules.map((row) => row.id)) };
}

function parseQuestionsFile(raw: unknown): DiscoveryQuestionsFile {
  return parseContentFile(discoveryQuestionsFileSchema, raw, 'discovery questions');
}

export async function previewQuestionsImport(raw: unknown): Promise<ContentImportPlan> {
  return planQuestionsImport(parseQuestionsFile(raw), await readStored(prisma)).plan;
}

/** Apply a discovery questions file. Re-planned in the transaction; idempotent. */
export async function applyQuestionsImport(
  raw: unknown,
  editorId: string
): Promise<ContentImportPlan> {
  const file = parseQuestionsFile(raw);
  return executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planQuestionsImport(file, stored);
      if (planned.plan.refusals.length > 0)
        throw importRefused('discovery questions', planned.plan.refusals);
      if (planned.plan.writesNothing) return planned.plan;

      if (planned.setChanged.length > 0 && planned.setAfter && stored.set) {
        const revision = stored.set.revision + 1;
        await tx.appQuestionSet.update({
          where: { id: planned.setId },
          data: { ...planned.setAfter, revision },
        });
        await tx.appQuestionSetRevision.create({
          data: {
            setId: planned.setId,
            revision,
            ...setSnapshotOf(planned.setAfter),
            changedFields: planned.setChanged,
            origin: 'admin',
            editorId,
          },
        });
      }

      for (const change of planned.questions.removals) {
        await tx.appDiscoveryQuestion.delete({ where: { id: change.key } });
      }
      const moving = planned.questions.updates.filter((change) =>
        change.changedFields.includes('number')
      );
      for (const [index, change] of moving.entries()) {
        await tx.appDiscoveryQuestion.update({
          where: { id: change.key },
          data: { number: parkingPosition(index) },
        });
      }
      for (const change of planned.questions.creates) {
        await tx.appDiscoveryQuestion.create({
          data: {
            id: change.key,
            setId: planned.setId,
            ...toQuestionData(change.after!),
            revision: 1,
          },
        });
      }
      for (const change of planned.questions.updates) {
        await tx.appDiscoveryQuestion.update({
          where: { id: change.key },
          data: { ...toQuestionData(change.after!), revision: change.revision },
        });
      }
      for (const change of [...planned.questions.creates, ...planned.questions.updates]) {
        await tx.appDiscoveryQuestionRevision.create({
          data: {
            questionId: change.key,
            revision: change.revision,
            ...toQuestionData(change.after!),
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
