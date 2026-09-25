/**
 * The content imports keep what a file leaves out, and remove it only when
 * asked (f-content-seeds t-100, the owner's ruling of 2026-09-24).
 *
 * For each of the four collections, against the REAL seeded rows
 * (`content-db-fake.ts`):
 *
 * - without the flag, an omitted item is planned as kept, not removed, and the
 *   apply leaves it stored, placed after the file's own so a fresh export of
 *   the result re-imports with no writes;
 * - with the flag, the collection removes what it removed before t-100, and
 *   still refuses a guarded removal;
 * - an apply without the flag never removes, whatever a preview with it showed.
 *
 * Each case first asserts the omitted item is stored, so "kept" is never the
 * empty answer of a database that never had it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({
  reconcileKnowledgeMirror: vi.fn(async () => ({ status: 'reconciled', failed: [] })),
}));

import { seedFoundationalDocuments } from '@/lib/app/content/document-store';
import { seedJourneyStructure } from '@/lib/app/content/journey-store';
import { seedDiscoveryQuestions } from '@/lib/app/content/question-store';
import { seedResources } from '@/lib/app/content/resource-store';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import * as documents from '@/lib/app/content/admin/documents';
import * as journey from '@/lib/app/content/admin/journey';
import * as questions from '@/lib/app/content/admin/questions';
import * as resources from '@/lib/app/content/admin/resources';
import type { ContentImportPlan, ImportPlanSection } from '@/lib/app/content/admin/shared';

const EDITOR = 'editor';

beforeEach(async () => {
  db.current = createContentDbFake();
  const client = db.current.client as unknown as PrismaClient;
  await seedFoundationalDocuments(buildFoundationalSeed(), client);
  await seedJourneyStructure(buildJourneySeed(), client);
  await seedDiscoveryQuestions(buildQuestionSeed(), client);
  await seedResources(buildResourcesSeed(), client);
});

function section(plan: ContentImportPlan, entity: string): ImportPlanSection {
  const found = plan.sections.find((entry) => entry.entity === entity);
  if (!found) throw new Error(`No "${entity}" section in the plan`);
  return found;
}

function ids(table: string): string[] {
  return db.current!.rows(table).map((row) => (row.id ?? row.key) as string);
}

// ─── Documents ──────────────────────────────────────────────────────────────

describe('documents', () => {
  /** A document nothing reads, so removing it is allowed. */
  async function addLoose(): Promise<void> {
    const file = await documents.exportDocumentsFile();
    file.documents.push({
      id: 'loose',
      title: 'Loose',
      subtitle: null,
      category: 'about',
      surface: 's',
      version: '1.0',
      blocks: [{ type: 'paragraph', text: 'Nothing reads this.', section: null }],
    });
    file.collection.suggestedOrder.unshift('loose');
    await documents.applyDocumentsImport(file, false, EDITOR);
  }

  async function without(id: string) {
    const file = await documents.exportDocumentsFile();
    file.documents = file.documents.filter((document) => document.id !== id);
    file.collection.suggestedOrder = file.collection.suggestedOrder.filter((each) => each !== id);
    return file;
  }

  it('keeps an omitted document, after the file’s own, and a re-export plans nothing', async () => {
    await addLoose();
    expect(ids('appFoundationalDocument')).toContain('loose');
    const file = await without('loose');

    const plan = await documents.previewDocumentsImport(file, false);
    expect(section(plan, 'document').removals).toEqual([]);
    expect(section(plan, 'document').kept).toEqual(['loose']);
    expect(plan.refusals).toEqual([]);

    await documents.applyDocumentsImport(file, false, EDITOR);
    const rows = db
      .current!.rows('appFoundationalDocument')
      .sort((a, b) => (a.position as number) - (b.position as number));
    expect(rows.at(-1)).toMatchObject({ id: 'loose' });
    expect(rows.map((row) => row.position)).toEqual(rows.map((_row, index) => index));

    const again = await documents.exportDocumentsFile();
    expect((await documents.previewDocumentsImport(again, false)).writesNothing).toBe(true);
    expect((await documents.previewDocumentsImport(again, true)).writesNothing).toBe(true);
  });

  it('with the flag, deletes it as before', async () => {
    await addLoose();
    const file = await without('loose');

    const plan = await documents.applyDocumentsImport(file, true, EDITOR);

    expect(section(plan, 'document').removals.map((item) => item.key)).toEqual(['loose']);
    expect(section(plan, 'document').kept).toEqual([]);
    expect(ids('appFoundationalDocument')).not.toContain('loose');
  });

  it('with the flag, still refuses one a surface renders; without it, keeps it', async () => {
    const file = await without('the_mission');

    const removing = await documents.previewDocumentsImport(file, true);
    expect(removing.refusals.join(' ')).toContain('"the_mission" is missing from the file');
    expect(removing.refusals.join(' ')).toContain('import without removing');

    const keeping = await documents.previewDocumentsImport(file, false);
    expect(keeping.refusals).toEqual([]);
    expect(section(keeping, 'document').kept).toEqual(['the_mission']);
  });

  it('an apply without the flag never removes, whatever the preview with it showed', async () => {
    await addLoose();
    const file = await without('loose');
    expect(
      section(await documents.previewDocumentsImport(file, true), 'document').removals
    ).toEqual([expect.objectContaining({ key: 'loose' })]);

    const applied = await documents.applyDocumentsImport(file, false, EDITOR);

    expect(section(applied, 'document').removals).toEqual([]);
    expect(ids('appFoundationalDocument')).toContain('loose');
  });
});

// ─── Journey ────────────────────────────────────────────────────────────────

describe('journey', () => {
  /** The exported file with its last module left out, and a title changed so it writes. */
  async function withoutLastModule() {
    const file = await journey.exportJourneyFile();
    const dropped = file.modules.at(-1)!.id;
    file.modules = file.modules.slice(0, -1);
    file.tiers = file.tiers.map((tier) => ({
      ...tier,
      modules: tier.modules.filter((id) => id !== dropped),
    }));
    file.modules[0].title = 'Retitled by import';
    return { file, dropped };
  }

  it('keeps an omitted module and still applies the rest', async () => {
    const { file, dropped } = await withoutLastModule();
    const before = db.current!.rows('appJourneyModule').find((row) => row.id === dropped);
    expect(before).toBeDefined();

    const plan = await journey.previewJourneyImport(file, false);
    expect(plan.refusals).toEqual([]);
    expect(section(plan, 'module').removals).toEqual([]);
    expect(section(plan, 'module').kept).toEqual([dropped]);

    await journey.applyJourneyImport(file, false, EDITOR);
    const rows = db.current!.rows('appJourneyModule');
    expect(rows.find((row) => row.id === dropped)).toEqual(before);
    expect(rows.find((row) => row.id === file.modules[0].id)).toMatchObject({
      title: 'Retitled by import',
    });
  });

  it('with the flag, refuses the file, since the roster owns the structure', async () => {
    const { file } = await withoutLastModule();
    const before = db.current!.fingerprint();

    expect((await journey.previewJourneyImport(file, true)).refusals.join(' ')).toContain('roster');
    await expect(journey.applyJourneyImport(file, true, EDITOR)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'import_refused' },
    });
    expect(db.current!.fingerprint()).toBe(before);
  });

  it('refuses a part file that moves a module, flag or not', async () => {
    const { file } = await withoutLastModule();
    file.modules[0].number = 99;

    expect((await journey.previewJourneyImport(file, false)).refusals.join(' ')).toContain(
      'numbered 99'
    );
  });
});

// ─── Questions ──────────────────────────────────────────────────────────────

describe('questions', () => {
  async function withoutQ02() {
    const file = await questions.exportQuestionsFile();
    file.questions = file.questions
      .filter((question) => question.id !== 'q02')
      .map((question, index) => ({ ...question, number: index + 1 }));
    file.content.questionCount = file.questions.length;
    return file;
  }

  it('keeps an omitted question, numbered last, and a re-export plans nothing', async () => {
    expect(ids('appDiscoveryQuestion')).toContain('q02');
    const file = await withoutQ02();

    const plan = await questions.previewQuestionsImport(file, false);
    expect(section(plan, 'question').removals).toEqual([]);
    expect(section(plan, 'question').kept).toEqual(['q02']);

    await questions.applyQuestionsImport(file, false, EDITOR);
    const rows = db.current!.rows('appDiscoveryQuestion');
    expect(rows.find((row) => row.id === 'q02')).toMatchObject({ number: 30 });
    expect(rows.map((row) => row.number as number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1)
    );

    const again = await questions.exportQuestionsFile();
    expect((await questions.previewQuestionsImport(again, false)).writesNothing).toBe(true);
    expect((await questions.previewQuestionsImport(again, true)).writesNothing).toBe(true);
  });

  it('with the flag, deletes it as before', async () => {
    const plan = await questions.applyQuestionsImport(await withoutQ02(), true, EDITOR);

    expect(section(plan, 'question').removals.map((item) => item.key)).toEqual(['q02']);
    expect(ids('appDiscoveryQuestion')).not.toContain('q02');
  });

  it('an apply without the flag never removes, whatever the preview with it showed', async () => {
    const file = await withoutQ02();
    expect(
      section(await questions.previewQuestionsImport(file, true), 'question').removals
    ).toHaveLength(1);

    await questions.applyQuestionsImport(file, false, EDITOR);

    expect(ids('appDiscoveryQuestion')).toContain('q02');
  });
});

// ─── Resources ──────────────────────────────────────────────────────────────

describe('resources', () => {
  const video = (id: string) => ({
    kind: 'video' as const,
    title: id,
    subtitle: id,
    relatesTo: null,
    duration: '1:00',
    href: `https://example.com/${id}`,
  });

  /** Two videos stored; the file names only the second, and drops a words key. */
  async function setUp() {
    await resources.createResource('first', video('first'), EDITOR);
    await resources.createResource('second', video('second'), EDITOR);
    const file = await resources.exportResourcesFile();
    // `default` is the fallback every file must carry; any other key may go.
    const wordsKey = Object.keys(file.words).find((key) => key !== 'default');
    if (!wordsKey) throw new Error('The seeded library has no words beyond the default');
    file.videos = file.videos.filter((entry) => entry.id !== 'first');
    delete file.words[wordsKey];
    return { file, wordsKey };
  }

  it('keeps an omitted resource and words, and a re-export plans nothing', async () => {
    const { file, wordsKey } = await setUp();

    const plan = await resources.previewResourcesImport(file, false);
    expect(section(plan, 'resource').removals).toEqual([]);
    expect(section(plan, 'resource').kept).toEqual(['first']);
    expect(section(plan, 'words').removals).toEqual([]);
    expect(section(plan, 'words').kept).toEqual([wordsKey]);

    await resources.applyResourcesImport(file, false, EDITOR);
    const videos = db
      .current!.rows('appResource')
      .map((row) => [row.id, row.position, row.retired]);
    expect(videos).toEqual(
      expect.arrayContaining([
        ['second', 0, false],
        ['first', 1, false],
      ])
    );
    expect(ids('appResourceWords')).toContain(wordsKey);

    const again = await resources.exportResourcesFile();
    expect((await resources.previewResourcesImport(again, false)).writesNothing).toBe(true);
    expect((await resources.previewResourcesImport(again, true)).writesNothing).toBe(true);
  });

  it('with the flag, retires the resource and deletes the words as before', async () => {
    const { file, wordsKey } = await setUp();

    const plan = await resources.applyResourcesImport(file, true, EDITOR);

    expect(section(plan, 'resource').removals.map((item) => item.key)).toEqual(['first']);
    expect(section(plan, 'words').removals.map((item) => item.key)).toEqual([wordsKey]);
    expect(db.current!.rows('appResource').find((row) => row.id === 'first')).toMatchObject({
      retired: true,
    });
    expect(ids('appResourceWords')).not.toContain(wordsKey);
  });

  it('an apply without the flag never removes, whatever the preview with it showed', async () => {
    const { file, wordsKey } = await setUp();
    expect(
      section(await resources.previewResourcesImport(file, true), 'resource').removals
    ).toHaveLength(1);

    await resources.applyResourcesImport(file, false, EDITOR);

    expect(db.current!.rows('appResource').find((row) => row.id === 'first')).toMatchObject({
      retired: false,
    });
    expect(ids('appResourceWords')).toContain(wordsKey);
  });
});
