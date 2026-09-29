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
 * **A question keeps its id, and an id is never given out twice.** A person's
 * answer is filed under the question's slot, `discovery_<id>`
 * (`lib/app/onboarding/discovery-slots.ts`, f-onboarding t-101). So a reworded
 * or moved question keeps its id, and a new one takes the id after the highest
 * the set has ever used, not just the highest still in it.
 *
 * **Removal is a delete, and the slot is the tombstone.** The row and its
 * history go, and the audit entry keeps the removed question's words. The
 * answers do not go: they stay filed under the slot, which Daybreak's module
 * slot sync deactivates when the question drops out of the owning module's
 * `slotDefinitions`, keeping the last wording it had. That deactivated slot is what stops the id coming back:
 * {@link nextQuestionId} counts it, and an import that would re-create it is
 * refused. Otherwise a new question under a freed id would inherit, as its own
 * answers, what people wrote to the old one.
 *
 * **Every save, restore, add, removal and import ends in a re-sync** of the
 * owning module's slots (`registry.ts`, `resyncDiscoverySlots`), reported
 * rather than thrown, for the reasons `lib/app/slots/definitions-admin.ts`
 * gives (`HB9`, `HB10`). It runs even when
 * nothing changed, so saving any question again is a real retry. A reorder
 * changes no slot and does not re-sync.
 *
 * @see lib/app/content/question-store.ts — the read every surface makes
 */

import { getRegisteredModule } from '@/lib/framework/modules/registry';
import { fallbackModuleName, moduleSlugFromId } from '@/lib/app/modules/definitions';
import { readDiscoveryConfig } from '@/lib/app/onboarding/discovery-config-store';
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
import { idsBySlug } from '@/lib/app/content/row-ids';
import { DISCOVERY_SLOT_PREFIX } from '@/lib/app/onboarding/discovery-slot-names';
import {
  type ContentImportPlan,
  type ImportPlanSection,
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

/**
 * The module that owns the questions (t-101): where its Core Set switch is
 * set, on the module's Config tab, and what it says now.
 */
export interface QuestionsOwningModule {
  slug: string;
  name: string;
  coreSetOnly: boolean;
}

export interface QuestionsAdminView {
  seeded: boolean;
  set: DiscoveryQuestionSet | null;
  readers: readonly string[];
  /** `null` when the set is not seeded. */
  module: QuestionsOwningModule | null;
}

export interface QuestionWriteResult {
  changed: string[];
  changes: FieldChanges;
  revision: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function setFieldsOf(row: Omit<QuestionSetRow, 'slug' | 'revision'>) {
  const preamble = storedPreambleSchema.parse(row.preamble);
  const pacing = storedPacingSchema.parse(row.pacing);
  return {
    title: row.title,
    chartTitle: row.chartTitle,
    moduleId: row.moduleSlug,
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
    weight: row.weight,
  };
}

function toQuestionData(fields: QuestionFields) {
  return { ...fields, conditionalFollowUp: fields.conditionalFollowUp ?? DB_NULL };
}

/**
 * The set's columns: `moduleId` is stored as `moduleSlug`, beside the module
 * row's generated id (t-113), which the caller supplies.
 */
function toSetData({ moduleId, ...fields }: QuestionSetFields, moduleRowId: string) {
  return { ...fields, moduleSlug: moduleId, moduleId: moduleRowId };
}

const SET_FIELDS = [...QUESTION_SET_SNAPSHOT_FIELDS, 'moduleId'] as const;

// ─── Reads ──────────────────────────────────────────────────────────────────

async function owningModuleOf(moduleId: string): Promise<QuestionsOwningModule> {
  const slug = moduleSlugFromId(moduleId);
  const { coreSetOnly } = await readDiscoveryConfig(slug);
  return { slug, name: getRegisteredModule(slug)?.name ?? fallbackModuleName(slug), coreSetOnly };
}

export async function getQuestionsAdminView(): Promise<QuestionsAdminView> {
  const exists = await prisma.appQuestionSet.findFirst({
    where: { slug: DISCOVERY_QUESTION_SET_ID },
    select: { slug: true },
  });
  const set = exists ? await getDiscoveryQuestions() : null;
  return {
    seeded: exists !== null,
    set,
    readers: QUESTION_READERS,
    module: set ? await owningModuleOf(set.collection.module) : null,
  };
}

export async function listQuestionSetHistory(
  id: string
): Promise<RevisionEntry<Omit<QuestionSetFields, 'moduleId'>>[]> {
  const [set, revisions] = await Promise.all([
    prisma.appQuestionSet.findFirst({ where: { slug: id }, select: { moduleSlug: true } }),
    prisma.appQuestionSetRevision.findMany({
      where: { setSlug: id },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!set) throw new NotFoundError(`There is no question set "${id}".`);
  return toHistory(revisions, (row: AppQuestionSetRevision) =>
    setSnapshotOf(setFieldsOf({ ...row, moduleSlug: set.moduleSlug }))
  );
}

export async function listQuestionHistory(id: string): Promise<RevisionEntry<QuestionFields>[]> {
  const [question, revisions] = await Promise.all([
    prisma.appDiscoveryQuestion.findFirst({ where: { slug: id }, select: { slug: true } }),
    prisma.appDiscoveryQuestionRevision.findMany({
      where: { questionSlug: id },
      orderBy: { revision: 'desc' },
    }),
  ]);
  if (!question) throw new NotFoundError(`There is no discovery question "${id}".`);
  return toHistory(revisions, (row: AppDiscoveryQuestionRevision) =>
    questionFieldsOf({ ...row, slug: id })
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
    const row = await tx.appQuestionSet.findFirst({ where: { slug: id } });
    if (!row) throw new NotFoundError(`There is no question set "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved('The question set', row.revision, revisionRead);

    const before = setFieldsOf(row);
    const next = toNext(before);
    const changed = changedFieldsOf(before, next, SET_FIELDS);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };
    let moduleRowId = row.moduleId;
    if (next.moduleId !== before.moduleId) {
      const target = await tx.appJourneyModule.findFirst({
        where: { slug: next.moduleId },
        select: { id: true },
      });
      if (!target)
        throw new ValidationError(`There is no module "${next.moduleId}" on the journey.`);
      moduleRowId = target.id;
    }

    const revision = row.revision + 1;
    const { count } = await tx.appQuestionSet.updateMany({
      where: { slug: id, revision: revisionRead },
      data: { ...toSetData(next, moduleRowId), revision },
    });
    if (count === 0)
      throw await revisionMovedNow(
        'The question set',
        revisionRead,
        tx.appQuestionSet.findFirst({ where: { slug: id }, select: { revision: true } })
      );
    await tx.appQuestionSetRevision.create({
      data: {
        setSlug: id,
        setId: row.id,
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
    const row = await tx.appDiscoveryQuestion.findFirst({ where: { slug: id } });
    if (!row) throw new NotFoundError(`There is no discovery question "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`Question ${row.number}`, row.revision, revisionRead);

    const before = questionFieldsOf(row);
    const next = toNext(before);
    questionFieldsOf({ slug: id, ...next });
    const changed = changedFieldsOf(before, next, QUESTION_SNAPSHOT_FIELDS);
    if (changed.length === 0) return { changed, changes: {}, revision: row.revision };

    const revision = row.revision + 1;
    const data = toQuestionData(next);
    const { count } = await tx.appDiscoveryQuestion.updateMany({
      where: { slug: id, revision: revisionRead },
      data: { ...data, revision },
    });
    if (count === 0)
      throw await revisionMovedNow(
        `Question ${row.number}`,
        revisionRead,
        tx.appDiscoveryQuestion.findFirst({ where: { slug: id }, select: { revision: true } })
      );
    await tx.appDiscoveryQuestionRevision.create({
      data: {
        questionSlug: id,
        questionId: row.id,
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
  const past = await prisma.appQuestionSetRevision.findFirst({
    where: { setSlug: id, revision },
  });
  if (!past) throw new NotFoundError(`The question set has no revision ${revision}.`);
  // The module it belongs to is not in the snapshot, so it stays where it is.
  return writeSet(
    id,
    (before) => setFieldsOf({ ...past, moduleSlug: before.moduleId }),
    revisionRead,
    editorId
  );
}

/**
 * Restore a question's words. Its number stays: moving is a reorder. Its weight
 * stays too: it is an admin setting, and a restore of old wording must not put
 * a question back into the Core Set (every revision before t-101 says 100).
 */
export async function restoreQuestionRevision(
  id: string,
  revision: number,
  revisionRead: number,
  editorId: string
): Promise<QuestionWriteResult> {
  const past = await prisma.appDiscoveryQuestionRevision.findFirst({
    where: { questionSlug: id, revision },
  });
  if (!past) throw new NotFoundError(`Question "${id}" has no revision ${revision}.`);
  return writeQuestion(
    id,
    (before) => ({
      ...questionFieldsOf({ ...past, slug: id }),
      number: before.number,
      weight: before.weight,
    }),
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
  const moving = rows.filter((row) => numbers.get(row.slug) !== row.number);
  for (const [index, row] of moving.entries()) {
    await tx.appDiscoveryQuestion.update({
      where: { id: row.id },
      data: { number: parkingPosition(index) },
    });
  }
  for (const row of moving) {
    const number = numbers.get(row.slug)!;
    const revision = row.revision + 1;
    await tx.appDiscoveryQuestion.update({ where: { id: row.id }, data: { number, revision } });
    await tx.appDiscoveryQuestionRevision.create({
      data: {
        questionSlug: row.slug,
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
 * The ids of removed questions: those with no row but a discovery slot, or
 * answers filed under one. Either way the id is not free (file header).
 *
 * **Both, not just the slot.** The slot is the usual tombstone, but it exists
 * only once a sync has projected it. A question added while the sync was
 * failing can be answered and then removed before any sync succeeds, leaving
 * answers under a slug with no definition. Counting the answers too is what
 * keeps that id from being handed out.
 */
async function retiredQuestionIds(
  client: Pick<Tx, 'slotDefinition' | 'slotValue'>,
  liveIds: ReadonlySet<string>
): Promise<Set<string>> {
  const [slots, answered] = await Promise.all([
    client.slotDefinition.findMany({
      where: { slug: { startsWith: DISCOVERY_SLOT_PREFIX } },
      select: { slug: true },
    }),
    // `groupBy`, not `findMany({ distinct })`: this repo does not enable
    // Prisma's `nativeDistinct`, so `distinct` would load every answer ever
    // given, every version of it, and de-duplicate in memory, inside the
    // transaction a question add holds. `groupBy` de-duplicates in the
    // database and returns one row per slug. There is no index on `slotSlug`
    // to make the scan cheaper, and none is added here: the table is
    // Daybreak's, and a leaf index on it is what the next generated migration
    // would drop (`B13`). It runs on an admin's add or import, not per turn.
    client.slotValue.groupBy({
      by: ['slotSlug'],
      where: { slotSlug: { startsWith: DISCOVERY_SLOT_PREFIX } },
    }),
  ]);
  return new Set(
    [...slots.map((slot) => slot.slug), ...answered.map((value) => value.slotSlug)]
      .map((slug) => slug.slice(DISCOVERY_SLOT_PREFIX.length))
      .filter((id) => !liveIds.has(id))
  );
}

/**
 * The id after the highest the set has ever used: `q31` after `q30`, and after
 * a removed `q31` too. See the file header for why a freed id is never reused.
 */
async function nextQuestionId(tx: Tx): Promise<string> {
  const live = await tx.appDiscoveryQuestion.findMany({ select: { slug: true } });
  const liveIds = new Set(live.map((row) => row.slug));
  const everUsed = [...liveIds, ...(await retiredQuestionIds(tx, liveIds))];
  const highest = everUsed
    .map((id) => /^q(\d+)$/.exec(id)?.[1])
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
    const set = await tx.appQuestionSet.findFirst({
      where: { slug: DISCOVERY_QUESTION_SET_ID },
      select: { id: true, slug: true },
    });
    if (!set) throw new NotFoundError('The discovery questions have not been seeded yet.');
    const count = await tx.appDiscoveryQuestion.count({ where: { setSlug: set.slug } });
    const id = await nextQuestionId(tx);
    const fields = { ...edit, number: count + 1 };
    questionFieldsOf({ slug: id, ...fields });
    const data = toQuestionData(fields);
    const created = await tx.appDiscoveryQuestion.create({
      data: { slug: id, setSlug: set.slug, setId: set.id, ...data, revision: 1 },
      select: { id: true },
    });
    await tx.appDiscoveryQuestionRevision.create({
      data: {
        questionSlug: id,
        questionId: created.id,
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
    const row = await tx.appDiscoveryQuestion.findFirst({ where: { slug: id } });
    if (!row) throw new NotFoundError(`There is no discovery question "${id}".`);
    if (row.revision !== revisionRead)
      throw revisionMoved(`Question ${row.number}`, row.revision, revisionRead);
    const remaining = await tx.appDiscoveryQuestion.count({ where: { setSlug: row.setSlug } });
    if (remaining <= 1) {
      throw new ConflictError(
        'The set must keep at least one question; the file format cannot hold an empty set.',
        {
          reason: 'last_question',
        }
      );
    }
    await tx.appDiscoveryQuestion.delete({ where: { id: row.id } });
    const rest = await tx.appDiscoveryQuestion.findMany({
      where: { setSlug: row.setSlug },
      orderBy: { number: 'asc' },
    });
    const renumbered = await applyNumbers(
      tx,
      rest,
      new Map(rest.map((q, index) => [q.slug, index + 1])),
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
      where: { setSlug: DISCOVERY_QUESTION_SET_ID },
      orderBy: { number: 'asc' },
    });
    const byId = new Map(rows.map((row) => [row.slug, row]));
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
  /** Removed questions whose answers are still filed under their id (file header). */
  retiredIds: ReadonlySet<string>;
}

interface QuestionsImport {
  plan: ContentImportPlan;
  setId: string;
  setChanged: string[];
  setAfter: QuestionSetFields | null;
  questions: KeyedPlan<QuestionFields>;
}

/**
 * What a discovery questions file would do. Pure. A stored question the file
 * leaves out is kept, numbered after the file's own in its stored order
 * (t-100); with `removeAbsent` it is removed instead. The preview names each.
 */
export function planQuestionsImport(
  file: DiscoveryQuestionsFile,
  stored: StoredQuestions,
  removeAbsent: boolean
): QuestionsImport {
  const seed = questionSeedFromFile(file);
  const refusals: string[] = [];
  if (!stored.set)
    refusals.push(
      'The discovery questions have not been seeded, so there is nothing to import into.'
    );
  else if (stored.set.slug !== seed.set.slug) {
    refusals.push(
      `This file is for the set "${seed.set.slug}", and this database holds "${stored.set.slug}".`
    );
  }
  if (!stored.moduleIds.has(seed.set.moduleSlug)) {
    refusals.push(
      `The file puts the questions in module "${seed.set.moduleSlug}", which is not on the journey.`
    );
  }
  for (const question of seed.questions) {
    if (stored.retiredIds.has(question.slug)) {
      refusals.push(
        `The file adds question "${question.slug}", but that id belonged to a question that was removed, and people's answers to it are still filed under it. Give the new question an id the set has never used.`
      );
    }
  }

  const { slug: _slug, ...setIncoming } = seed.set;
  const setAfter = setFieldsOf(setIncoming);
  const setChanged = stored.set
    ? changedFieldsOf(setFieldsOf(stored.set), setAfter, SET_FIELDS)
    : [];

  // Kept ones follow the file's, so the numbering stays 1..n with no gap and
  // no two questions claiming one number.
  const inFile = new Set(seed.questions.map((question) => question.slug));
  // A weight is an admin setting too. Her file carries none, so a question the
  // file names without one keeps its stored weight rather than being reset.
  const fileWeights = new Map(file.questions.map((question) => [question.id, question.weight]));
  const kept = removeAbsent ? [] : stored.questions.filter((row) => !inFile.has(row.slug));
  const questions = planKeyedImport<Omit<DiscoveryQuestionRow, 'revision'>, QuestionFields>({
    incoming: [
      ...seed.questions.map((question) => ({ key: question.slug, value: question })),
      ...kept.map((row, index) => ({
        key: row.slug,
        value: { ...row, number: seed.questions.length + index + 1 },
      })),
    ],
    stored: stored.questions.map((row) => ({
      key: row.slug,
      fields: questionFieldsOf(row),
      revision: row.revision,
    })),
    diff: (before, after) => changedFieldsOf(before, after, QUESTION_SNAPSHOT_FIELDS),
    allFields: QUESTION_SNAPSHOT_FIELDS,
    toCreate: (question) => questionFieldsOf(question),
    toUpdate: (before, question) =>
      questionFieldsOf({ ...question, weight: fileWeights.get(question.slug) ?? before.weight }),
    onAbsent: removeAbsent ? () => null : 'keep',
  });

  const sections: ImportPlanSection[] = [
    {
      ...toPlanSection('question', 'Questions', questions, 'delete'),
      kept: kept.map((row) => row.slug),
    },
  ];
  if (setChanged.length > 0 && stored.set) {
    sections.unshift({
      entity: 'set',
      label: 'Question set',
      creates: [],
      updates: [{ key: stored.set.slug, changedFields: setChanged }],
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
    setId: stored.set?.slug ?? seed.set.slug,
    setChanged,
    setAfter: stored.set ? setAfter : null,
    questions,
  };
}

async function readStored(
  client: Pick<
    typeof prisma,
    'appQuestionSet' | 'appDiscoveryQuestion' | 'appJourneyModule' | 'slotDefinition' | 'slotValue'
  >
): Promise<StoredQuestions> {
  const [set, questions, modules] = await Promise.all([
    client.appQuestionSet.findFirst({ where: { slug: DISCOVERY_QUESTION_SET_ID } }),
    client.appDiscoveryQuestion.findMany({
      where: { setSlug: DISCOVERY_QUESTION_SET_ID },
      orderBy: { number: 'asc' },
    }),
    client.appJourneyModule.findMany({ select: { slug: true } }),
  ]);
  return {
    set,
    questions,
    moduleIds: new Set(modules.map((row) => row.slug)),
    retiredIds: await retiredQuestionIds(client, new Set(questions.map((row) => row.slug))),
  };
}

function parseQuestionsFile(raw: unknown): DiscoveryQuestionsFile {
  return parseContentFile(discoveryQuestionsFileSchema, raw, 'discovery questions');
}

export async function previewQuestionsImport(
  raw: unknown,
  removeAbsent: boolean
): Promise<ContentImportPlan> {
  return planQuestionsImport(parseQuestionsFile(raw), await readStored(prisma), removeAbsent).plan;
}

/** Apply a discovery questions file. Re-planned in the transaction; idempotent. */
export async function applyQuestionsImport(
  raw: unknown,
  removeAbsent: boolean,
  editorId: string
): Promise<ContentImportPlan> {
  const file = parseQuestionsFile(raw);
  return executeTransaction(
    async (tx) => {
      const stored = await readStored(tx);
      const planned = planQuestionsImport(file, stored, removeAbsent);
      if (planned.plan.refusals.length > 0)
        throw importRefused('discovery questions', planned.plan.refusals);
      if (planned.plan.writesNothing) return planned.plan;
      // Not refused, so the set is stored.
      const setRowId = stored.set!.id;
      const storedQuestionId = idsBySlug(stored.questions, 'discovery question');

      if (planned.setChanged.length > 0 && planned.setAfter && stored.set) {
        const revision = stored.set.revision + 1;
        let moduleRowId = stored.set.moduleId;
        if (planned.setAfter.moduleId !== stored.set.moduleSlug) {
          // The plan refused a module not on the journey, so this finds it.
          const target = await tx.appJourneyModule.findFirst({
            where: { slug: planned.setAfter.moduleId },
            select: { id: true },
          });
          if (!target)
            throw new ValidationError(
              `There is no module "${planned.setAfter.moduleId}" on the journey.`
            );
          moduleRowId = target.id;
        }
        await tx.appQuestionSet.update({
          where: { id: stored.set.id },
          data: { ...toSetData(planned.setAfter, moduleRowId), revision },
        });
        await tx.appQuestionSetRevision.create({
          data: {
            setSlug: planned.setId,
            setId: stored.set.id,
            revision,
            ...setSnapshotOf(planned.setAfter),
            changedFields: planned.setChanged,
            origin: 'admin',
            editorId,
          },
        });
      }

      for (const change of planned.questions.removals) {
        await tx.appDiscoveryQuestion.delete({ where: { id: storedQuestionId(change.key) } });
      }
      const moving = planned.questions.updates.filter((change) =>
        change.changedFields.includes('number')
      );
      for (const [index, change] of moving.entries()) {
        await tx.appDiscoveryQuestion.update({
          where: { id: storedQuestionId(change.key) },
          data: { number: parkingPosition(index) },
        });
      }
      const created: { id: string; slug: string }[] = [];
      for (const change of planned.questions.creates) {
        created.push(
          await tx.appDiscoveryQuestion.create({
            data: {
              slug: change.key,
              setSlug: planned.setId,
              setId: setRowId,
              ...toQuestionData(change.after!),
              revision: 1,
            },
            select: { id: true, slug: true },
          })
        );
      }
      for (const change of planned.questions.updates) {
        await tx.appDiscoveryQuestion.update({
          where: { id: storedQuestionId(change.key) },
          data: { ...toQuestionData(change.after!), revision: change.revision },
        });
      }
      const questionId = idsBySlug([...stored.questions, ...created], 'discovery question');
      for (const change of [...planned.questions.creates, ...planned.questions.updates]) {
        await tx.appDiscoveryQuestionRevision.create({
          data: {
            questionSlug: change.key,
            questionId: questionId(change.key),
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
